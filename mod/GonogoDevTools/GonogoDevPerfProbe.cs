using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEngine;
using UnityEngine.Profiling;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls <c>PluginData/perf-request.cfg</c> (next to this
    /// assembly) and, while it names <c>enable = true</c>, writes one JSON line a
    /// second to <c>PluginData/perf-telemetry.jsonl</c>: main-thread and Courier
    /// phase milliseconds (average, latest, interval max, interval total, count),
    /// collections per generation, the slowest frame and the slowest frame a
    /// collection landed in, the managed heap, and bytes per second per topic.
    ///
    /// <code>
    /// PERFPROBE
    /// {
    ///     id = &lt;unique string&gt;
    ///     enable = true                 // false stops the report
    /// }
    /// </code>
    ///
    /// <para>Off until a request turns it on, and then it only ever runs in a
    /// development install. The engine's phase recorder is reached by reflection, as
    /// the other tools in this assembly reach the mod, and is switched off again when
    /// the report is.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevPerfProbe : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-perf: ";
        private const float PollIntervalSeconds = 1f;
        private const float ReportIntervalSeconds = 1f;
        private const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

        private readonly PerfFrameStats _frames = new PerfFrameStats();
        private float _sinceLastPoll;
        private float _sinceLastReport;
        private string? _requestPath;
        private PerfReportFile? _file;
        private DevRequestLedger? _ledger;
        private PropertyInfo? _enabledProperty;
        private MethodInfo? _takeInterval;

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
                _requestPath = Path.Combine(pluginData, "perf-request.cfg");
                _file = new PerfReportFile(Path.Combine(pluginData, "perf-telemetry.jsonl"));
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "perf-applied.cfg"));

                var telemetry = AppDomain.CurrentDomain.GetAssemblies()
                    .Select(a => a.GetType("Sitrep.Host.PerfTelemetry", false))
                    .FirstOrDefault(t => t != null);
                _enabledProperty = telemetry?.GetProperty("Enabled", Any);
                _takeInterval = telemetry?.GetMethod("TakeIntervalJson", Any);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void OnDestroy() => SwitchOff();

        private void LateUpdate()
        {
            try
            {
                var dt = Time.unscaledDeltaTime;
                _sinceLastPoll += dt;
                if (_sinceLastPoll >= PollIntervalSeconds)
                {
                    _sinceLastPoll = 0f;
                    Poll();
                }

                if (_file == null || !_file.Enabled)
                {
                    return;
                }

                _frames.Sample(
                    GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2),
                    dt * 1000.0, Profiler.GetMonoUsedSizeLong());
                _sinceLastReport += dt;
                if (_sinceLastReport >= ReportIntervalSeconds)
                {
                    _sinceLastReport = 0f;
                    WriteReport();
                }
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed: " + ex.Message);
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                return;
            }

            var node = ConfigNode.Load(_requestPath)?.GetNode("PERFPROBE");
            var id = node?.GetValue("id");
            if (node == null || string.IsNullOrEmpty(id))
            {
                return;
            }

            var decision = _ledger!.Admit(id!, File.GetLastWriteTimeUtc(_requestPath), out _);
            if (decision != DevRequestDecision.Apply)
            {
                return;
            }

            var on = string.Equals(node.GetValue("enable")?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
            if (on)
            {
                _enabledProperty?.SetValue(null, true);
                _file!.Enabled = true;
                _sinceLastReport = 0f;
                Debug.Log(LogPrefix + "id=" + id + " reporting to PluginData/perf-telemetry.jsonl");
            }
            else
            {
                SwitchOff();
                Debug.Log(LogPrefix + "id=" + id + " stopped");
            }
        }

        private void SwitchOff()
        {
            if (_file != null)
            {
                _file.Enabled = false;
            }
            _enabledProperty?.SetValue(null, false);
        }

        private void WriteReport()
        {
            var engine = (string?)_takeInterval?.Invoke(null, null);
            var members = _frames.TakeIntervalJson() + (string.IsNullOrEmpty(engine) ? "" : "," + engine);
            _file!.Append(DateTime.UtcNow, members);
        }
    }
}
