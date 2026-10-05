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
                File.AppendAllText(_logPath!, Snapshot());
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

        private static string Name(System.Collections.Generic.Dictionary<CommNet.CommNode, string> names, CommNet.CommNode node)
        {
            return names.TryGetValue(node, out var id) ? id : node.name;
        }
    }
}
