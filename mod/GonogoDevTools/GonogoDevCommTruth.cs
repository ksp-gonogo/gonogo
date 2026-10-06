using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY ground truth for comms checks. While
    /// <c>PluginData/commtruth-enable.cfg</c> exists, appends one line per vessel
    /// per second of real time to <c>PluginData/commtruth.log</c>: the game's own
    /// UT, the vessel, whether the live CommNet says it is connected, its signal
    /// strength, and each hop of its control path with the hop's length. A rig
    /// check compares what each command centre was told against this, which is
    /// what the game itself believed at that instant, read straight off CommNet
    /// and owing nothing to the mod's delay engine.
    ///
    /// <para>A vessel's own path says nothing of a link it is not routed over.
    /// Each line of <c>PluginData/commtruth-pairs.cfg</c> names two vessels by
    /// the start of their ids, and for each such pair one more line is written
    /// per second: whether the network holds a link between the two at all,
    /// and if so its strength for each way it can be used, beside how far
    /// apart the two are. That tells a link the game
    /// never made from one it made and routed round.</para>
    ///
    /// With no enable file nothing here does anything.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevCommTruth : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-commtruth: ";
        private const float PollIntervalSeconds = 1f;

        private float _sinceLastPoll;
        private string? _enablePath;
        private string? _logPath;
        private string? _pairsPath;

        private void Start()
        {
            var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (string.IsNullOrEmpty(assemblyDir))
            {
                enabled = false;
                return;
            }

            var pluginData = Path.Combine(assemblyDir, "PluginData");
            _enablePath = Path.Combine(pluginData, "commtruth-enable.cfg");
            _logPath = Path.Combine(pluginData, "commtruth.log");
            _pairsPath = Path.Combine(pluginData, "commtruth-pairs.cfg");
        }

        private void Update()
        {
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            if (_enablePath == null || !File.Exists(_enablePath))
            {
                return;
            }

            try
            {
                File.AppendAllText(_logPath!, Snapshot() + Pairs(_pairsPath!));
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "write failed: " + ex.Message);
            }
        }

        private static string Snapshot()
        {
            var inv = CultureInfo.InvariantCulture;
            var ut = Planetarium.GetUniversalTime().ToString("F2", inv);
            var active = FlightGlobals.ActiveVessel;
            var text = new StringBuilder();
            var names = new System.Collections.Generic.Dictionary<CommNet.CommNode, string>();
            foreach (var each in FlightGlobals.Vessels)
            {
                var node = each?.connection?.Comm;
                if (node != null)
                {
                    names[node] = each!.id.ToString("N").Substring(0, 8);
                }
            }
            foreach (var vessel in FlightGlobals.Vessels)
            {
                var connection = vessel?.connection;
                if (vessel == null || connection == null)
                {
                    continue;
                }

                text.Append(ut).Append('\t')
                    .Append(vessel.id.ToString("N").Substring(0, 8)).Append('\t')
                    .Append(vessel == active ? "active" : "-").Append('\t')
                    .Append(connection.IsConnected ? "connected" : "dark").Append('\t')
                    .Append(connection.SignalStrength.ToString("F3", inv)).Append('\t');
                var path = connection.ControlPath;
                if (path != null)
                {
                    foreach (var link in path)
                    {
                        var length = (link.a.position - link.b.position).magnitude;
                        text.Append(Name(names, link.a)).Append(">").Append(Name(names, link.b))
                            .Append('@').Append(length.ToString("F0", inv)).Append(';');
                    }
                }
                text.Append('\n');
            }
            return text.ToString();
        }

        /// <summary>
        /// One line for each pair the pairs file names: the UT, the word
        /// <c>pair</c>, the two ids as written, then <c>link</c> or
        /// <c>nolink</c> (or <c>unknown</c> where either id matches no vessel
        /// with a radio), the link's strength with both ends relaying, with
        /// only the first relaying and with only the second,
        /// which ends can relay, and the distance between the two in metres.
        /// </summary>
        private static string Pairs(string pairsPath)
        {
            if (!File.Exists(pairsPath))
            {
                return string.Empty;
            }
            var inv = CultureInfo.InvariantCulture;
            var ut = Planetarium.GetUniversalTime().ToString("F2", inv);
            var text = new StringBuilder();
            foreach (var line in File.ReadAllLines(pairsPath))
            {
                var ids = line.Split(new[] { ' ', '\t', ',' }, StringSplitOptions.RemoveEmptyEntries);
                if (ids.Length != 2 || ids[0].StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }
                var a = NodeOf(ids[0]);
                var b = NodeOf(ids[1]);
                text.Append(ut).Append("\tpair\t").Append(ids[0]).Append('\t').Append(ids[1]).Append('\t');
                if (a == null || b == null)
                {
                    text.Append("unknown\n");
                    continue;
                }
                var distance = (a.position - b.position).magnitude.ToString("F0", inv);
                if (!a.TryGetValue(b, out var link) || link == null)
                {
                    text.Append("nolink\t\t\t\t\t").Append(distance).Append('\n');
                    continue;
                }
                // The link's own two ends may be the other way round from the pair as written.
                var swapped = link.a != a;
                text.Append("link\t")
                    .Append(link.strengthRR.ToString("F3", inv)).Append('\t')
                    .Append((swapped ? link.strengthBR : link.strengthAR).ToString("F3", inv)).Append('\t')
                    .Append((swapped ? link.strengthAR : link.strengthBR).ToString("F3", inv)).Append('\t')
                    .Append((swapped ? link.bCanRelay : link.aCanRelay) ? "relay" : "end").Append('>')
                    .Append((swapped ? link.aCanRelay : link.bCanRelay) ? "relay" : "end").Append('\t')
                    .Append(distance).Append('\n');
            }
            return text.ToString();
        }

        /// <summary>The radio of the vessel whose id starts with <paramref name="idStart"/>, dashes or not, or null.</summary>
        private static CommNet.CommNode? NodeOf(string idStart)
        {
            var wanted = idStart.Replace("-", string.Empty);
            foreach (var vessel in FlightGlobals.Vessels)
            {
                var node = vessel?.connection?.Comm;
                if (node != null && vessel!.id.ToString("N").StartsWith(wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return node;
                }
            }
            return null;
        }

        private static string Name(System.Collections.Generic.Dictionary<CommNet.CommNode, string> names, CommNet.CommNode node)
        {
            return names.TryGetValue(node, out var id) ? id : node.name;
        }
    }
}
