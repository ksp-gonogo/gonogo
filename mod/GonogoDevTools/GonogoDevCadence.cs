using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/cadence-request.cfg</c>, next to this assembly) and changes how
    /// often chosen topics are built and published, live and without a restart, so a
    /// rig can measure what a higher data rate costs.
    ///
    /// <code>
    /// CADENCE
    /// {
    ///     id = &lt;unique string&gt;
    ///     reset = true                  // optional: clear every earlier override first
    ///     rate = vessel.flight 5        // topic, then samples per UT second (0 to 50)
    ///     rate = vessel.landing 5
    ///     report = 10                   // optional: seconds between cost lines, 0 stops them
    /// }
    /// </code>
    ///
    /// <para>Cost lines go to the KSP log, each starting <c>[gonogo-cadence]</c>: per
    /// topic, payloads built and emitted, frames and KB per second, and the real time
    /// spent building and serialising. Topics not named keep one sample per UT second.
    /// Above 1x warp the engine's real-time floor still thins every topic.</para>
    ///
    /// <para>The result reports the overrides the engine holds after the request, read
    /// back from it, not the request echoed. No Sitrep type is referenced: the engine
    /// is found by reflection, as every other tool in this assembly reaches the mod.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevCadence : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-cadence: ";
        private const float PollIntervalSeconds = 1f;
        private const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

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
                _requestPath = Path.Combine(pluginData, "cadence-request.cfg");
                _resultPath = Path.Combine(pluginData, "cadence-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "cadence-applied.cfg"));
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

            var node = ConfigNode.Load(_requestPath)?.GetNode("CADENCE");
            var id = node?.GetValue("id");
            if (node == null || string.IsNullOrEmpty(id))
            {
                return;
            }

            var decision = _ledger!.Admit(id!, File.GetLastWriteTimeUtc(_requestPath), out var stampFailure);
            if (stampFailure != null)
            {
                Debug.LogWarning(LogPrefix + "could not stamp id=" + id + " as applied: " + stampFailure);
            }
            if (decision == DevRequestDecision.AlreadyApplied)
            {
                return;
            }
            if (decision == DevRequestDecision.PredatesSession)
            {
                WriteResult(id!, ok: false, DevRequestLedger.PredatesSessionMessage, null);
                return;
            }

            Apply(id!, node);
        }

        private void Apply(string id, ConfigNode node)
        {
            try
            {
                var request = CadenceRequest.TryParse(node.GetValues("rate"), node.GetValue("report"), node.GetValue("reset"), out var error);
                if (request == null)
                {
                    WriteResult(id, ok: false, "refused: " + error, null);
                    return;
                }

                var engine = FindEngine();
                var cadence = engine?.GetType().GetProperty("Cadence", Any)?.GetValue(engine);
                var stats = engine?.GetType().GetProperty("PublishStats", Any)?.GetValue(engine);
                var setRate = engine?.GetType().GetMethod("TrySetTopicRate", Any);
                if (engine == null || cadence == null || stats == null || setRate == null)
                {
                    WriteResult(id, ok: false, "no running Gonogo engine with per-topic cadence", null);
                    return;
                }

                if (request.Reset)
                {
                    cadence.GetType().GetMethod("ClearOverrides", Any)!.Invoke(cadence, null);
                }

                var refusals = new StringBuilder();
                foreach (var (topic, hz) in request.Rates)
                {
                    var args = new object?[] { topic, hz, null };
                    var taken = (bool)setRate.Invoke(engine, args)!;
                    if (!taken)
                    {
                        refusals.Append(topic).Append(": ").Append(args[2]).Append("; ");
                    }
                }

                if (request.ReportSeconds.HasValue)
                {
                    stats.GetType().GetProperty("ReportIntervalSeconds", Any)!.SetValue(stats, request.ReportSeconds.Value);
                }

                var inForce = (string?)cadence.GetType().GetMethod("Describe", Any)!.Invoke(cadence, null);
                var message = refusals.Length == 0 ? "applied" : "PARTLY REFUSED: " + refusals.ToString().TrimEnd(' ', ';');
                Debug.Log(LogPrefix + "id=" + id + " " + message + "; overrides in force: " + inForce);
                WriteResult(id, refusals.Length == 0, message, inForce);
            }
            catch (Exception ex)
            {
                WriteResult(id, ok: false, "exception: " + (ex.InnerException ?? ex).Message, null);
            }
        }

        /// <summary>The running <c>ChannelEngine</c>, or null.</summary>
        private static object? FindEngine()
        {
            var addon = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetType("Gonogo.KSP.GonogoAddon", false))
                .FirstOrDefault(t => t != null);
            return addon?.GetProperty("SharedEngine", Any)?.GetValue(null);
        }

        private void WriteResult(string id, bool ok, string message, string? overridesInForce)
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
                sb.AppendLine("\toverridesInForce = " + (overridesInForce ?? "unknown"));
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
