using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. In flight, polls a request file
    /// (<c>PluginData/scanstamp-request.cfg</c>, next to this assembly) and, on a
    /// new request, STAMPS full SCANsat coverage onto a body for the requested
    /// scan types - i.e. marks the whole planet as already scanned. This gives
    /// terrain-render / coverage-gate tests a deterministic, reproducible scan
    /// fixture without having to actually fly a scanner over a body (which no
    /// save currently has, confirmed 2026-07-20 by decoding every accessible
    /// save's coverage grid - all zero).
    ///
    /// It calls SCANsat's OWN write path via reflection (no compile-time SCANsat
    /// reference, so this dev assembly stays SCANsat-version-agnostic and still
    /// builds if SCANsat is absent):
    ///   SCANsat.SCANUtil.getData(string bodyName)  -> SCANdata          (public)
    ///   SCANdata.fillMap(SCANtype type)            -> coverage[i,j] |= (short)type   (internal)
    ///   SCANdata.updateCoverage()                  -> refresh cached %   (internal)
    /// fillMap is SCANsat's own loop over the full 360x180 grid, so the result is
    /// genuine SCANdata identical to a fully-scanned body, not a hand-forged blob.
    ///
    /// <b>NOT</b> production behaviour. Lives in the Deck-only GonogoDevTools
    /// assembly and is never shipped. With no request file (the production
    /// default), this addon does nothing at all.
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene loads;
    /// <see cref="_lastAppliedId"/> is static so a request applies once per KSP
    /// process even across scene reloads.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevStampScan : MonoBehaviour
    {
        /// <summary>Process-wide last-applied request id, so writing the same
        /// file twice (or a scene reload re-reading it) never re-stamps.</summary>
        private static string? _lastAppliedId;

        private const float PollIntervalSeconds = 1f;
        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;

        // SCANsat's SCANtype bit values (from the SCANsat.SCANtype [Flags] enum).
        // Passed by NAME in the request; mapped here so the request file never
        // has to know raw bit values. "all" expands to every entry below OR-ed.
        private static readonly Dictionary<string, int> ScanTypeBits =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["AltimetryLoRes"] = 1,
                ["AltimetryHiRes"] = 2,
                ["Biome"] = 8,
                ["Anomaly"] = 16,
                ["AnomalyDetail"] = 32,
                ["ResourceLoRes"] = 128,
                ["ResourceHiRes"] = 256,
            };

        private void Start()
        {
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (string.IsNullOrEmpty(assemblyDir))
                {
                    enabled = false;
                    return;
                }

                var pluginData = Path.Combine(assemblyDir, "PluginData");
                _requestPath = Path.Combine(pluginData, "scanstamp-request.cfg");
                _resultPath = Path.Combine(pluginData, "scanstamp-result.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-scanstamp: Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            try
            {
                Poll();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-scanstamp: poll failed: " + ex.Message);
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                // No request file is the PRODUCTION-SAFE default.
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("STAMPSCAN");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError("[Gonogo] dev-scanstamp: request has no 'id'; ignoring");
                return;
            }

            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front so a broken request is not retried every second.
            _lastAppliedId = id;

            try
            {
                var bodyName = node.GetValue("body");
                if (string.IsNullOrEmpty(bodyName))
                {
                    WriteResult(id, ok: false, "missing 'body'");
                    return;
                }

                var typesRaw = node.GetValue("types");
                if (string.IsNullOrEmpty(typesRaw))
                {
                    typesRaw = "all";
                }

                if (!TryResolveMask(typesRaw!, out var mask, out var typeError))
                {
                    WriteResult(id, ok: false, typeError);
                    return;
                }

                if (!TryStamp(bodyName!, mask, out var stampError))
                {
                    WriteResult(id, ok: false, stampError);
                    return;
                }

                Debug.Log(string.Format(CultureInfo.InvariantCulture,
                    "[Gonogo] dev-scanstamp: stamped body={0} types={1} (mask={2})",
                    bodyName, typesRaw, mask));
                WriteResult(id, ok: true,
                    "stamped " + bodyName + " types=" + typesRaw + " (mask=" + mask + ")");
            }
            catch (Exception ex)
            {
                WriteResult(id, ok: false, "exception: " + ex.Message);
            }
        }

        /// <summary>Map a comma-separated list of scan-type names (or "all") to
        /// the OR-ed SCANtype bitmask.</summary>
        private static bool TryResolveMask(string typesRaw, out int mask, out string error)
        {
            mask = 0;
            error = "";

            if (string.Equals(typesRaw.Trim(), "all", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var bit in ScanTypeBits.Values)
                {
                    mask |= bit;
                }
                return true;
            }

            foreach (var raw in typesRaw.Split(','))
            {
                var name = raw.Trim();
                if (name.Length == 0)
                {
                    continue;
                }
                if (!ScanTypeBits.TryGetValue(name, out var bit))
                {
                    error = "unknown scan type '" + name + "' (valid: "
                        + string.Join(", ", ScanTypeBits.Keys.ToArray()) + ", all)";
                    return false;
                }
                mask |= bit;
            }

            if (mask == 0)
            {
                error = "no scan types resolved from '" + typesRaw + "'";
                return false;
            }
            return true;
        }

        /// <summary>Reflect into SCANsat and fill the body's coverage for `mask`.</summary>
        private static bool TryStamp(string bodyName, int mask, out string error)
        {
            error = "";

            var scanUtil = FindType("SCANsat.SCANUtil");
            var scanData = FindType("SCANsat.SCAN_Data.SCANdata");
            if (scanUtil == null || scanData == null)
            {
                error = "SCANsat types not found (is SCANsat installed?)";
                return false;
            }

            var getData = scanUtil.GetMethod(
                "getData", BindingFlags.Public | BindingFlags.Static,
                null, new[] { typeof(string) }, null);
            var fillMap = scanData.GetMethod(
                "fillMap", BindingFlags.NonPublic | BindingFlags.Instance);
            var updateCoverage = scanData.GetMethod(
                "updateCoverage", BindingFlags.NonPublic | BindingFlags.Instance);

            if (getData == null || fillMap == null)
            {
                error = "SCANsat method(s) not found: "
                    + (getData == null ? "getData " : "")
                    + (fillMap == null ? "fillMap" : "");
                return false;
            }

            var data = getData.Invoke(null, new object[] { bodyName });
            if (data == null)
            {
                error = "SCANUtil.getData returned null for '" + bodyName + "'";
                return false;
            }

            // fillMap takes a SCANtype enum; build it from the raw mask via the
            // parameter's own enum type (no namespace guessing).
            var scanTypeEnum = fillMap.GetParameters()[0].ParameterType;
            var typeValue = Enum.ToObject(scanTypeEnum, mask);

            fillMap.Invoke(data, new[] { typeValue });
            updateCoverage?.Invoke(data, Array.Empty<object>());
            return true;
        }

        private static Type? FindType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var t = asm.GetType(fullName, throwOnError: false);
                if (t != null)
                {
                    return t;
                }
            }
            return null;
        }

        private void WriteResult(string id, bool ok, string message)
        {
            if (string.IsNullOrEmpty(_resultPath))
            {
                return;
            }

            try
            {
                var dir = Path.GetDirectoryName(_resultPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("RESULT");
                sb.AppendLine("{");
                sb.AppendLine("\tapplied = " + id);
                sb.AppendLine("\tok = " + (ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + message);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-scanstamp: failed writing result: " + ex.Message);
            }
        }
    }
}
