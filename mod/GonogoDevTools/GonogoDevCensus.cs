using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;
using UnityEngine.Profiling;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls <c>PluginData/census-request.cfg</c> (next to this
    /// assembly) and, while it names a positive interval, has the engine log one
    /// <c>[gonogo-census]</c> line per interval: the managed heap, gen-0 collections,
    /// and the size of every long-lived collection the engine and the contact plan
    /// grow on their tick. Beside it, on the main thread, this tool logs one
    /// <c>[gonogo-census-process]</c> line: Unity's own heap figures, the process's
    /// resident and swapped memory, and how many GameEvents callbacks are registered
    /// in all and how many of them belong to a Gonogo assembly, so managed growth can
    /// be told from native and a subscription leak shows as a climbing count.
    ///
    /// <code>
    /// CENSUS
    /// {
    ///     interval = 60                 // real seconds between lines; 0 turns it off
    ///     collect = true                // optional: a full collection before each process line
    /// }
    /// </code>
    ///
    /// <para>With <c>collect</c> the process line also carries <c>kept=</c>, the managed
    /// heap after a forced collection, and its Mono figures are read after it: managed
    /// memory that keeps rising there is held by something, where resident memory that
    /// rises while it stays flat is heap padding, fragmentation or native memory. The
    /// collection stalls the game for as long as a full collection takes.</para>
    ///
    /// <para>The file is read every second and its interval applied whenever the
    /// engine holds a different one, so a census left on carries across scene loads
    /// and KSP restarts until the file says 0 or is deleted. Deleting the file turns
    /// it off. The engine's census is reached by reflection, as the other tools in
    /// this assembly reach the mod. Its result goes to <c>census-result.cfg</c>.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevCensus : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-census: ";
        private const string ProcessLinePrefix = "[gonogo-census-process]";
        private const float PollIntervalSeconds = 1f;
        private const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

        private float _sinceLastPoll;
        private float _sinceLastLine;
        private double _interval;
        private bool _collect;
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
                _requestPath = Path.Combine(pluginData, "census-request.cfg");
                _resultPath = Path.Combine(pluginData, "census-result.cfg");
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
            if (_sinceLastPoll >= PollIntervalSeconds)
            {
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

            if (_interval <= 0)
            {
                return;
            }
            _sinceLastLine += Time.unscaledDeltaTime;
            if (_sinceLastLine < _interval)
            {
                return;
            }
            _sinceLastLine = 0f;
            Debug.Log(ProcessLine(_collect));
        }

        private void Poll()
        {
            var wanted = ReadInterval(out _collect);
            var census = FindCensus();
            var property = census?.GetType().GetProperty("ReportIntervalSeconds", Any);
            if (census == null || property == null)
            {
                return;
            }

            var held = (double)property.GetValue(census)!;
            if (held == wanted && _interval == wanted)
            {
                return;
            }

            property.SetValue(census, wanted);
            var line = wanted > 0
                ? "on, one line every " + wanted.ToString("0.###", CultureInfo.InvariantCulture) + " s"
                : "off";
            if (wanted > 0 && _interval != wanted)
            {
                _sinceLastLine = float.MaxValue;
            }
            _interval = wanted;
            Debug.Log(LogPrefix + line);
            WriteResult(line);
        }

        /// <summary>The interval the request file names, or 0 when there is no file or no valid interval.</summary>
        private double ReadInterval(out bool collect)
        {
            collect = false;
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                return 0;
            }
            var node = ConfigNode.Load(_requestPath)?.GetNode("CENSUS");
            collect = string.Equals(node?.GetValue("collect"), "true", StringComparison.OrdinalIgnoreCase);
            var value = node?.GetValue("interval");
            return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
                && seconds > 0 && !double.IsInfinity(seconds)
                ? seconds
                : 0;
        }

        /// <summary>The running engine's <c>MemoryCensus</c>, or null.</summary>
        private static object? FindCensus()
        {
            var addon = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetType("Gonogo.KSP.GonogoAddon", false))
                .FirstOrDefault(t => t != null);
            var engine = addon?.GetProperty("SharedEngine", Any)?.GetValue(null);
            return engine?.GetType().GetProperty("Census", Any)?.GetValue(engine);
        }

        private static string ProcessLine(bool collect)
        {
            var line = new StringBuilder(ProcessLinePrefix);
            if (collect)
            {
                line.Append(" kept=").Append(GC.GetTotalMemory(true).ToString(CultureInfo.InvariantCulture));
            }
            line.Append(" monoUsed=").Append(Profiler.GetMonoUsedSizeLong().ToString(CultureInfo.InvariantCulture));
            line.Append(" monoHeap=").Append(Profiler.GetMonoHeapSizeLong().ToString(CultureInfo.InvariantCulture));
            line.Append(" unityAllocated=").Append(Profiler.GetTotalAllocatedMemoryLong().ToString(CultureInfo.InvariantCulture));
            line.Append(" unityReserved=").Append(Profiler.GetTotalReservedMemoryLong().ToString(CultureInfo.InvariantCulture));
            line.Append(" gcTotal=").Append(GC.GetTotalMemory(false).ToString(CultureInfo.InvariantCulture));
            line.Append(" gen0=").Append(GC.CollectionCount(0).ToString(CultureInfo.InvariantCulture));
            line.Append(" ut=").Append(Planetarium.GetUniversalTime().ToString("F1", CultureInfo.InvariantCulture));
            AppendGameEvents(line);
            AppendProcStatus(line);
            return line.ToString();
        }

        /// <summary>
        /// Every callback registered on a named GameEvents event, and those whose target
        /// (or, for a static method, whose declaring type) is in a Gonogo assembly. Every
        /// event registers itself by name in <c>BaseGameEvent.eventsByName</c>, and each
        /// keeps its callbacks in a private <c>events</c> list of entries with an
        /// <c>evt</c> delegate.
        /// </summary>
        private static void AppendGameEvents(StringBuilder line)
        {
            try
            {
                var byName = typeof(BaseGameEvent).GetField("eventsByName", Any)?.GetValue(null) as System.Collections.IDictionary;
                if (byName == null)
                {
                    line.Append(" gameEvents=!");
                    return;
                }
                long total = 0;
                long ours = 0;
                foreach (var gameEvent in byName.Values)
                {
                    if (gameEvent == null || !(EventsField(gameEvent.GetType())?.GetValue(gameEvent) is System.Collections.IList callbacks))
                    {
                        continue;
                    }
                    total += callbacks.Count;
                    foreach (var entry in callbacks)
                    {
                        var callback = entry?.GetType().GetField("evt", Any)?.GetValue(entry) as Delegate;
                        if (callback != null && IsOurs(callback))
                        {
                            ours++;
                        }
                    }
                }
                line.Append(" gameEvents=").Append(byName.Count.ToString(CultureInfo.InvariantCulture));
                line.Append(" gameEventCallbacks=").Append(total.ToString(CultureInfo.InvariantCulture));
                line.Append(" gameEventCallbacksOurs=").Append(ours.ToString(CultureInfo.InvariantCulture));
            }
            catch (Exception)
            {
                line.Append(" gameEvents=!");
            }
        }

        private static FieldInfo? EventsField(Type type)
        {
            for (var t = type; t != null; t = t.BaseType)
            {
                var field = t.GetField("events", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                if (field != null)
                {
                    return field;
                }
            }
            return null;
        }

        private static bool IsOurs(Delegate callback)
        {
            var type = callback.Target?.GetType() ?? callback.Method.DeclaringType;
            var assembly = type?.Assembly.GetName().Name ?? string.Empty;
            return assembly.StartsWith("Gonogo", StringComparison.Ordinal) || assembly.StartsWith("Sitrep", StringComparison.Ordinal);
        }

        /// <summary>Resident and swapped kilobytes from <c>/proc/self/status</c>, where there is one (Linux, so the Deck).</summary>
        private static void AppendProcStatus(StringBuilder line)
        {
            const string path = "/proc/self/status";
            try
            {
                if (!File.Exists(path))
                {
                    return;
                }
                foreach (var row in File.ReadAllLines(path))
                {
                    if (row.StartsWith("VmRSS:", StringComparison.Ordinal) || row.StartsWith("VmSwap:", StringComparison.Ordinal))
                    {
                        var parts = row.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            line.Append(' ').Append(parts[0].TrimEnd(':')).Append("Kb=").Append(parts[1]);
                        }
                    }
                }
            }
            catch (Exception)
            {
                line.Append(" proc=!");
            }
        }

        private void WriteResult(string message)
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
                File.WriteAllText(_resultPath,
                    "RESULT\n{\n\tcensus = " + message + "\n\ttime = "
                    + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) + "\n}\n");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }
    }
}
