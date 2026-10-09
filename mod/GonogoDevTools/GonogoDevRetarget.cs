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
    /// (<c>PluginData/retarget-request.cfg</c>, next to this assembly) and turns a
    /// craft's dish to a peer, or puts a turned dish back, through the elected comms
    /// backend's own <c>TurnDish</c> and <c>RestoreDish</c>: the calls the delivery
    /// network makes when a node holds a message for a peer, made on demand so the
    /// game-touching half of a dish turn can be exercised without arranging a
    /// network that needs one.
    ///
    /// <code>
    /// RETARGET
    /// {
    ///     id = &lt;unique string&gt;
    ///     action = turn            // turn | restore
    ///     node = vessel:&lt;guid&gt;     // turn
    ///     dish = vessel:&lt;guid&gt;#&lt;part&gt;/&lt;ordinal&gt;   // turn: the id comms.contacts gives the dish
    ///     peer = ground:Kerbal Space Center   // turn: vessel:&lt;guid&gt; or ground:&lt;station name&gt;
    ///     record = &lt;restore id&gt;   // restore: what a turn returned
    /// }
    /// </code>
    ///
    /// <para>The result carries the record id a turn returned, or the settled flag a
    /// restore returned, read back from the backend rather than assumed.</para>
    ///
    /// <para>No Sitrep type is referenced: the backend is found by reflection, as
    /// every other tool in this assembly reaches the mod.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevRetarget : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-retarget: ";
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
                _requestPath = Path.Combine(pluginData, "retarget-request.cfg");
                _resultPath = Path.Combine(pluginData, "retarget-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "retarget-applied.cfg"));
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

            var node = ConfigNode.Load(_requestPath)?.GetNode("RETARGET");
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
                var backend = FindBackend();
                if (backend == null)
                {
                    WriteResult(id, ok: false, "no elected comms backend turns dishes", null);
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                var action = node.GetValue("action") ?? "";
                if (string.Equals(action, "turn", StringComparison.OrdinalIgnoreCase))
                {
                    var record = backend.GetType().GetMethod("TurnDish", Any)!.Invoke(
                        backend,
                        new object[] { node.GetValue("node") ?? "", node.GetValue("dish") ?? "", node.GetValue("peer") ?? "", ut }) as string;
                    WriteResult(id, ok: record != null, record != null ? "turned" : "the dish would not turn", "record = " + (record ?? "null"));
                    return;
                }
                if (string.Equals(action, "restore", StringComparison.OrdinalIgnoreCase))
                {
                    var settled = (bool)backend.GetType().GetMethod("RestoreDish", Any)!.Invoke(
                        backend, new object[] { node.GetValue("record") ?? "", ut })!;
                    WriteResult(id, ok: settled, settled ? "settled" : "the write failed and will be tried again", "settled = " + settled);
                    return;
                }
                WriteResult(id, ok: false, "unknown action '" + action + "', expected turn or restore", null);
            }
            catch (Exception ex)
            {
                WriteResult(id, ok: false, "exception: " + (ex.InnerException ?? ex).Message, null);
            }
        }

        /// <summary>The elected comms backend as something that turns dishes, or null.</summary>
        private static object? FindBackend()
        {
            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            var addon = assemblies.Select(a => a.GetType("Gonogo.KSP.GonogoAddon", false)).FirstOrDefault(t => t != null);
            var election = assemblies.Select(a => a.GetType("Sitrep.Host.Comms.CommsElection", false)).FirstOrDefault(t => t != null);
            var engine = addon?.GetProperty("SharedEngine", Any)?.GetValue(null);
            var kernel = engine?.GetType().GetProperty("Kernel", Any)?.GetValue(engine);
            return kernel == null ? null : election?.GetMethod("RetargetBackend", Any)?.Invoke(null, new[] { kernel });
        }

        private void WriteResult(string id, bool ok, string message, string? detail)
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
                if (detail != null)
                {
                    sb.AppendLine("\t" + detail);
                }
                sb.AppendLine("\tut = " + Planetarium.GetUniversalTime().ToString("R", CultureInfo.InvariantCulture));
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
