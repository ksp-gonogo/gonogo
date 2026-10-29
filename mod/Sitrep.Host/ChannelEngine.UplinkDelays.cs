using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// <c>system.uplink.delays</c>: the delay each delayed command takes to its
    /// own target, from each command centre, as that centre knows it.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        internal const string UplinkDelaysTopic = "system.uplink.delays";

        /// <summary>
        /// The most figures kept for one centre and target. A figure is kept only
        /// when it moves by <see cref="UplinkDelayStepSeconds"/>, so this is
        /// reached only by a delay that swings widely for a long time; past it the
        /// oldest go first, which can leave a pair unknown until a newer figure
        /// has had time to arrive.
        /// </summary>
        private const int UplinkDelayHistoryLimit = 4096;

        /// <summary>How far a figure must move from the last one kept before it is kept too.</summary>
        private const double UplinkDelayStepSeconds = 0.05;

        /*
         * Each (centre, target node) pair's figures as they held, oldest first,
         * finite only. Courier-thread-only, like the ledger they are read from.
         */
        private readonly Dictionary<(string Centre, string Node), List<(double Ut, double Seconds)>> _uplinkDelayHistory =
            new Dictionary<(string Centre, string Node), List<(double Ut, double Seconds)>>();

        private UplinkDelayReport? _uplinkDelayReport;

        private void DeclareUplinkDelays()
        {
            _channelDeclarations[UplinkDelaysTopic] = new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Topic = UplinkDelaysTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Each figure is already the one the centre could know, so holding
                // the report back as well would count the same delay twice.
                Delay = DelayRole.TrueNow,
                ViewerFilter = FilterUplinkDelaysForViewer,
                NullIsUnreadable = true,
            };
            _channelSources[UplinkDelaysTopic] = _ => _uplinkDelayReport;
            _engineStateTopics.Add(UplinkDelaysTopic);
        }

        /// <summary>
        /// Keep this tick's figure for every centre and every target a delayed
        /// command addresses, and rebuild the report from what each centre knows
        /// at <paramref name="ut"/>. Runs after the ledger is written for the tick.
        /// </summary>
        private void RememberUplinkDelays(double ut)
        {
            var centres = new HashSet<string>(_activeCentreIds, StringComparer.Ordinal);
            var fresh = _freshConnectionVantage;
            if (!string.IsNullOrEmpty(fresh))
            {
                centres.Add(fresh);
            }
            centres.Remove(MetaVantage);

            var report = new UplinkDelayReport();
            var known = new Dictionary<(string Centre, string Node), double?>();
            foreach (var entry in _commandDeclarations)
            {
                var command = entry.Key;
                if (!ResolveCommandDelay(command))
                {
                    continue;
                }
                var node = ResolveSubjectNode(command, null);
                if (node == NodeId)
                {
                    report.ActiveVessel.Add(command);
                    continue;
                }
                foreach (var centre in centres)
                {
                    var pair = (centre, node);
                    if (!known.TryGetValue(pair, out var seconds))
                    {
                        seconds = KnownUplinkDelay(pair, ut);
                        known[pair] = seconds;
                    }
                    report.Elsewhere.Add(new UplinkDelay { Command = command, Centre = centre, OneWaySeconds = seconds });
                }
            }
            report.ActiveVessel.Sort(StringComparer.Ordinal);
            report.Elsewhere.Sort((a, b) =>
            {
                var byCommand = string.CompareOrdinal(a.Command, b.Command);
                return byCommand != 0 ? byCommand : string.CompareOrdinal(a.Centre, b.Centre);
            });

            foreach (var pair in new List<(string Centre, string Node)>(_uplinkDelayHistory.Keys))
            {
                if (!known.ContainsKey(pair))
                {
                    _uplinkDelayHistory.Remove(pair);
                }
            }

            if (_uplinkDelayReport == null || !SameUplinkDelays(_uplinkDelayReport, report))
            {
                _uplinkDelayReport = report;
            }
        }

        /// <summary>
        /// Record the pair's figure at <paramref name="ut"/>, then answer with the
        /// newest figure that has had time to reach the centre: one held at a UT
        /// at least that figure before <paramref name="ut"/>. Null when none has.
        /// </summary>
        private double? KnownUplinkDelay((string Centre, string Node) pair, double ut)
        {
            if (!_uplinkDelayHistory.TryGetValue(pair, out var history))
            {
                history = new List<(double Ut, double Seconds)>();
                _uplinkDelayHistory[pair] = history;
            }

            var seconds = DelayKnown(pair.Centre, pair.Node) ? UplinkDelayTo(pair.Centre, pair.Node) : double.NaN;
            if (IsFiniteNonNegative(seconds)
                && (history.Count == 0 || Math.Abs(history[history.Count - 1].Seconds - seconds) >= UplinkDelayStepSeconds))
            {
                history.Add((ut, seconds));
                if (history.Count > UplinkDelayHistoryLimit)
                {
                    history.RemoveAt(0);
                }
            }

            for (var i = history.Count - 1; i >= 0; i--)
            {
                var figure = history[i];
                if (figure.Ut + figure.Seconds <= ut)
                {
                    // Nothing older can be the newest to have arrived again.
                    if (i > 0)
                    {
                        history.RemoveRange(0, i);
                    }
                    return figure.Seconds;
                }
            }
            return null;
        }

        private static bool SameUplinkDelays(UplinkDelayReport a, UplinkDelayReport b)
        {
            if (a.ActiveVessel.Count != b.ActiveVessel.Count || a.Elsewhere.Count != b.Elsewhere.Count)
            {
                return false;
            }
            for (var i = 0; i < a.ActiveVessel.Count; i++)
            {
                if (!string.Equals(a.ActiveVessel[i], b.ActiveVessel[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }
            for (var i = 0; i < a.Elsewhere.Count; i++)
            {
                var x = a.Elsewhere[i];
                var y = b.Elsewhere[i];
                if (!string.Equals(x.Command, y.Command, StringComparison.Ordinal)
                    || !string.Equals(x.Centre, y.Centre, StringComparison.Ordinal)
                    || x.OneWaySeconds != y.OneWaySeconds)
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// The <see cref="ChannelDeclaration.ViewerFilter"/> for
        /// <c>system.uplink.delays</c>: a session receives the delays from its own
        /// centre. Another centre's delay is what that centre knows, which this one
        /// has not been told.
        /// </summary>
        private static object FilterUplinkDelaysForViewer(object payload, ViewerContext viewer)
        {
            if (!(payload is UplinkDelayReport report))
            {
                return payload;
            }
            return new UplinkDelayReport
            {
                ActiveVessel = report.ActiveVessel,
                Elsewhere = report.Elsewhere.FindAll(entry => entry.Centre == viewer.Vantage),
            };
        }
    }
}
