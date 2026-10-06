using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/scene-parts-request.cfg</c>, next to this assembly) and
    /// answers with every <c>Part</c> alive in the Unity scene, so an SSH-only
    /// test controller can prove that a craft loaded off-screen and then
    /// released left no stray parts at the world origin.
    ///
    /// Request format (mirrors <see cref="GonogoDevTeleport"/>'s TELEPORT node):
    /// <code>
    /// SCENEPARTS
    /// {
    ///     id = &lt;unique string, e.g. a timestamp&gt;
    /// }
    /// </code>
    ///
    /// <para>The count comes from <c>FindObjectsOfType&lt;Part&gt;()</c>, not from
    /// the vessel list, so a part held by no vessel is counted too. Each entry
    /// carries its vessel name (<c>null</c> when it has none) and the magnitude
    /// of its world position; <c>atOriginCount</c> is the number under one
    /// metre. The per-part list is capped at <see cref="MaxListedParts"/> and
    /// the result says so when it was cut, while the counts always cover every
    /// part.</para>
    ///
    /// Runs in every scene, because the Space Center scene is where a stray part
    /// at the origin shows. With no request file, the production-safe default,
    /// nothing here does anything at all.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.EveryScene, once: false)]
    public sealed class GonogoDevScenePartCount : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-sceneparts: ";
        private const float PollIntervalSeconds = 1f;
        private const int MaxListedParts = 500;
        private const float OriginRadiusMetres = 1f;

        private float _sinceLastPoll;
        private string? _requestPath;
        private string? _resultPath;
        private DevRequestLedger? _ledger;

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
                _requestPath = Path.Combine(pluginData, "scene-parts-request.cfg");
                _resultPath = Path.Combine(pluginData, "scene-parts-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "scene-parts-applied.cfg"));
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
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
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("SCENEPARTS");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError(LogPrefix + "request has no 'id'; ignoring");
                return;
            }

            var decision = _ledger!.Admit(id!, File.GetLastWriteTimeUtc(_requestPath), out var stampFailure);
            if (stampFailure != null)
            {
                Debug.LogWarning(LogPrefix + "could not stamp id=" + id
                    + " as applied, so a restart may apply it again: " + stampFailure);
            }

            if (decision == DevRequestDecision.AlreadyApplied)
            {
                return;
            }

            if (decision == DevRequestDecision.PredatesSession)
            {
                Debug.LogWarning(LogPrefix + "request id=" + id + " predates this KSP session; refused");
                WriteRefusal(id!, DevRequestLedger.PredatesSessionMessage);
                return;
            }

            Report(id!);
        }

        private void Report(string id)
        {
            try
            {
                var parts = UnityEngine.Object.FindObjectsOfType<Part>();
                var atOrigin = 0;
                var sb = new StringBuilder();
                var listed = Math.Min(parts.Length, MaxListedParts);

                for (var i = 0; i < parts.Length; i++)
                {
                    var part = parts[i];
                    var magnitude = part.transform.position.magnitude;
                    if (magnitude < OriginRadiusMetres)
                    {
                        atOrigin++;
                    }
                    if (i >= listed)
                    {
                        continue;
                    }

                    var vessel = part.vessel;
                    sb.AppendLine("\tPART");
                    sb.AppendLine("\t{");
                    sb.AppendLine("\t\tname = " + part.name);
                    sb.AppendLine("\t\tvessel = " + (vessel != null ? vessel.vesselName : "null"));
                    sb.AppendLine("\t\thasVessel = " + (vessel != null ? "True" : "False"));
                    sb.AppendLine("\t\tpositionMagnitude = " + magnitude.ToString("R", CultureInfo.InvariantCulture));
                    sb.AppendLine("\t}");
                }

                var head = new StringBuilder();
                head.AppendLine("\tapplied = " + id);
                head.AppendLine("\tok = True");
                head.AppendLine("\tscene = " + HighLogic.LoadedScene);
                head.AppendLine("\tut = " + Planetarium.GetUniversalTime().ToString("R", CultureInfo.InvariantCulture));
                head.AppendLine("\ttotalParts = " + parts.Length.ToString(CultureInfo.InvariantCulture));
                head.AppendLine("\tatOriginCount = " + atOrigin.ToString(CultureInfo.InvariantCulture));
                head.AppendLine("\tlistedParts = " + listed.ToString(CultureInfo.InvariantCulture));
                head.AppendLine("\tcapped = " + (parts.Length > listed ? "True" : "False"));
                head.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));

                WriteFile(head.ToString() + sb);
            }
            catch (Exception ex)
            {
                WriteRefusal(id, "exception: " + ex.Message);
            }
        }

        private void WriteRefusal(string id, string message)
        {
            var sb = new StringBuilder();
            sb.AppendLine("\tapplied = " + id);
            sb.AppendLine("\tok = False");
            sb.AppendLine("\tmessage = " + message);
            sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            WriteFile(sb.ToString());
        }

        private void WriteFile(string body)
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

                File.WriteAllText(_resultPath, "RESULT\n{\n" + body + "}\n");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }
    }
}
