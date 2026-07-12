using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. In flight, polls a request file
    /// (<c>PluginData/teleport-request.cfg</c>, next to this assembly) and, on a
    /// new request, teleports the active vessel into a specified orbit around a
    /// specified body. This lets a headless automated test place a vessel
    /// anywhere - something kRPC 0.5.4 cannot do (it has no set-orbit / cheat
    /// API).
    ///
    /// This mirrors KSP's own Alt+F12 "Set Ship Orbit" cheat exactly: the stock
    /// debug window (decompiled <c>Assembly-CSharp</c>) calls
    /// <code>
    ///   FlightGlobals.fetch.SetShipOrbit(selBodyIndex, ecc, sma, inc, LAN, MnA, lPe, ObT);
    /// </code>
    /// and that public method runs the safe stock sequence internally
    /// (<c>PrepForOrbitSet</c>: clear Landed/Splashed, SetLandedAt, kill ground
    /// contact, put every unpacked vessel <c>GoOnRails()</c>, set dominant body;
    /// then <c>ActiveVessel.orbit.SetOrbit(inc, ecc, sma, LAN, argPe, mna, UT, body)</c>
    /// clamped to <c>SOI * 0.99</c>; then <c>PostOrbitSet</c>: updateFromParameters,
    /// bypass collision, FloatingOrigin.SetOffset, CheckReferenceFrame,
    /// HoldVesselUnpack(10), fire SOI-changed, IgnoreGForces/IgnoreSpeed). We call
    /// that same public entry point rather than re-implementing the sequence, so
    /// we inherit whatever stock does on this KSP version.
    ///
    /// <b>NOT</b> production behaviour. Lives in the Deck-only GonogoDevTools
    /// assembly and is never shipped. With no request file (the production
    /// default), this addon does nothing at all.
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene loads.
    /// <see cref="_lastAppliedId"/> is <b>static</b> so a request is applied once
    /// per KSP process even across scene reloads.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevTeleport : MonoBehaviour
    {
        /// <summary>Process-wide last-applied request id. Requests whose id
        /// matches this are ignored, so writing the same file twice (or a scene
        /// reload re-reading it) never re-teleports.</summary>
        private static string? _lastAppliedId;

        private const float PollIntervalSeconds = 1f;
        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;

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
                _requestPath = Path.Combine(pluginData, "teleport-request.cfg");
                _resultPath = Path.Combine(pluginData, "teleport-result.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            // Modest cadence - NOT every frame.
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
                // Never throw out of the poll.
                Debug.LogError("[Gonogo] dev-teleport: poll failed: " + ex.Message);
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
            var node = root?.GetNode("TELEPORT");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError("[Gonogo] dev-teleport: request has no 'id'; ignoring");
                return;
            }

            // Already applied this exact request - nothing to do.
            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front: even if the teleport throws, we do NOT want
            // to retry the same broken request every second.
            _lastAppliedId = id;

            try
            {
                var vessel = FlightGlobals.ActiveVessel;
                if (vessel == null)
                {
                    WriteResult(id, ok: false, "no active vessel");
                    return;
                }

                var bodyName = node.GetValue("body");
                if (string.IsNullOrEmpty(bodyName))
                {
                    WriteResult(id, ok: false, "missing 'body'");
                    return;
                }

                var body = FindBody(bodyName!);
                if (body == null)
                {
                    WriteResult(id, ok: false, "unknown body '" + bodyName + "'");
                    return;
                }

                if (!TryGetDouble(node, "periapsisKm", out var periKm))
                {
                    WriteResult(id, ok: false, "missing/invalid 'periapsisKm'");
                    return;
                }
                if (!TryGetDouble(node, "apoapsisKm", out var apoKm))
                {
                    WriteResult(id, ok: false, "missing/invalid 'apoapsisKm'");
                    return;
                }

                // inclination is optional, default 0.
                if (!TryGetDouble(node, "inclinationDeg", out var inclinationDeg))
                {
                    inclinationDeg = 0.0;
                }

                var (sma, ecc) = OrbitFromApsides(body.Radius, periKm, apoKm);

                Debug.Log(string.Format(CultureInfo.InvariantCulture,
                    "[Gonogo] dev-teleport: request id={0} body={1} periKm={2} apoKm={3} incDeg={4} -> sma={5:F1} ecc={6:F6}",
                    id, body.bodyName, periKm, apoKm, inclinationDeg, sma, ecc));

                var bodyIndex = FlightGlobals.Bodies.IndexOf(body);
                if (bodyIndex < 0)
                {
                    WriteResult(id, ok: false, "body '" + body.bodyName + "' not in FlightGlobals.Bodies");
                    return;
                }

                // Mirror the stock Alt+F12 "Set Ship Orbit" cheat exactly. This
                // public method runs KSP's own PrepForOrbitSet / SetOrbit /
                // PostOrbitSet sequence internally.
                //   SetShipOrbit(selBodyIndex, ecc, sma, inc, LAN, mna, argPe, ObT)
                // inclination is degrees (Orbit.inclination is degrees); LAN,
                // meanAnomalyAtEpoch, argumentOfPeriapsis default to 0; ObT is
                // unused by SetShipOrbit (it uses Planetarium.GetUniversalTime()).
                FlightGlobals.fetch.SetShipOrbit(
                    bodyIndex,
                    ecc,
                    sma,
                    inclinationDeg,
                    /* LAN */ 0.0,
                    /* mna */ 0.0,
                    /* argPe */ 0.0,
                    /* ObT */ 0.0);

                Debug.Log("[Gonogo] dev-teleport: applied request id=" + id);
                WriteResult(id, ok: true,
                    string.Format(CultureInfo.InvariantCulture,
                        "teleported {0} to {1} peri={2}km apo={3}km inc={4}deg (sma={5:F1} ecc={6:F6})",
                        vessel.vesselName, body.bodyName, periKm, apoKm, inclinationDeg, sma, ecc));
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: teleport failed for id=" + id + ": " + ex);
                WriteResult(id, ok: false, "exception: " + ex.Message);
            }
        }

        /// <summary>
        /// Convert an apoapsis / periapsis pair (km above the body's surface)
        /// into semi-major axis (m) and eccentricity. Handles apo==peri
        /// (circular) and apo/peri given in either order.
        ///
        /// Pure and side-effect free so it can be unit-tested in isolation
        /// (there is no test project in GonogoDevTools today, but this is the
        /// one piece of non-trivial math and is deliberately factored out).
        /// </summary>
        public static (double sma, double ecc) OrbitFromApsides(double bodyRadiusM, double periKm, double apoKm)
        {
            var rP = bodyRadiusM + periKm * 1000.0;
            var rA = bodyRadiusM + apoKm * 1000.0;

            // Periapsis must be the smaller radius; swap if the caller inverted.
            if (rP > rA)
            {
                (rP, rA) = (rA, rP);
            }

            var sma = (rA + rP) / 2.0;
            var ecc = (rA + rP) == 0.0 ? 0.0 : (rA - rP) / (rA + rP);
            return (sma, ecc);
        }

        private static CelestialBody? FindBody(string name)
        {
            var bodies = FlightGlobals.Bodies;
            if (bodies == null)
            {
                return null;
            }

            foreach (var b in bodies)
            {
                if (b != null && string.Equals(b.bodyName, name, StringComparison.OrdinalIgnoreCase))
                {
                    return b;
                }
            }
            return null;
        }

        private static bool TryGetDouble(ConfigNode node, string key, out double value)
        {
            value = 0.0;
            var raw = node.GetValue(key);
            return !string.IsNullOrEmpty(raw)
                && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
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
                Debug.LogError("[Gonogo] dev-teleport: failed writing result: " + ex.Message);
            }
        }
    }
}
