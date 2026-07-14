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
    /// (<c>PluginData/force-comms-request.cfg</c>, next to this assembly) and,
    /// on a new request, acknowledges the requested comms-blackout mode
    /// (<c>blackout</c> / <c>restore</c> / <c>auto</c>) by writing a result
    /// cfg - the same request/result roundtrip <see cref="GonogoDevTeleport"/>
    /// already uses - so an SSH-only test controller can confirm the game
    /// process saw the request without needing the app open.
    ///
    /// <b>This addon does NOT itself touch comms connectivity.</b>
    /// GonogoDevTools deliberately has no reference to Sitrep.*/Gonogo.KSP
    /// (see this project's csproj comment), so it cannot reach
    /// ChannelEngine/CommsCoreUplink directly. The actual override is applied
    /// by <c>Gonogo.KSP.DevCommsOverride</c> (in the production Gonogo
    /// assembly), which polls this SAME request file independently and is
    /// itself gated on the GonogoDevTools assembly being loaded - see that
    /// class's doc comment for the full design. There is no hand-off between
    /// this addon and that class; they are two independent readers of one
    /// file.
    ///
    /// Request format (mirrors <see cref="GonogoDevTeleport"/>'s TELEPORT node):
    /// <code>
    /// FORCECOMMS
    /// {
    ///     id = &lt;unique string, e.g. a timestamp&gt;
    ///     mode = blackout   // blackout | restore | auto
    /// }
    /// </code>
    /// <c>blackout</c> forces the active vessel's comms connectivity to
    /// DISCONNECTED; <c>restore</c> forces it to CONNECTED; <c>auto</c>
    /// clears the override and returns to the real elected comms backend
    /// (stock CommNet / RealAntennas). With no request file (the
    /// production-safe default), nothing here does anything at all, and
    /// <c>DevCommsOverride</c> resolves to "no override" the same way.
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene
    /// loads, mirroring <see cref="GonogoDevTeleport"/>. <see cref="_lastAppliedId"/>
    /// is <b>static</b> so a request is acknowledged once per id even across
    /// scene reloads.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevForceComms : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevForceComms] ";

        /// <summary>Process-wide last-acknowledged request id - same
        /// lifecycle discipline as <see cref="GonogoDevTeleport"/>'s own
        /// static guard.</summary>
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
                _requestPath = Path.Combine(pluginData, "force-comms-request.cfg");
                _resultPath = Path.Combine(pluginData, "force-comms-result.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            // Modest cadence - NOT every frame. Matches the actual override
            // reader's (Gonogo.KSP.DevCommsOverride) own poll cadence, so
            // acknowledgement latency here is representative of when the
            // override actually takes effect.
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
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
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
            var node = root?.GetNode("FORCECOMMS");
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

            // Already acknowledged this exact request - nothing to do.
            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front, same discipline as GonogoDevTeleport:
            // even a malformed request should not be re-logged every second.
            _lastAppliedId = id;

            var mode = node.GetValue("mode")?.Trim().ToLowerInvariant();
            switch (mode)
            {
                case "blackout":
                case "restore":
                case "auto":
                    Debug.Log(LogPrefix + "request id=" + id + " mode=" + mode
                        + " acknowledged (Gonogo.KSP.DevCommsOverride applies it independently on its own poll)");
                    WriteResult(id, ok: true, mode!, "acknowledged");
                    break;
                default:
                    Debug.LogError(LogPrefix + "request id=" + id + " has unrecognized mode '" + mode + "' (want blackout|restore|auto)");
                    WriteResult(id, ok: false, mode ?? "", "unrecognized mode '" + mode + "' (want blackout|restore|auto)");
                    break;
            }
        }

        private void WriteResult(string id, bool ok, string mode, string message)
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
                sb.AppendLine("\tmode = " + mode);
                sb.AppendLine("\tok = " + (ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + message);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }
    }
}
