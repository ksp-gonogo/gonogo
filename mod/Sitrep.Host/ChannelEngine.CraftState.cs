using System;
using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host.Comms;

namespace Sitrep.Host
{
    /// <summary>
    /// Each craft's <see cref="CraftState"/>, recorded on that craft's own
    /// node and heard at a command centre's vantage. Courier-thread state
    /// throughout.
    /// </summary>
    public sealed partial class ChannelEngine : ICraftStateHost
    {
        /// <summary>
        /// The prefix craft states are recorded under, one topic per craft. It is
        /// never declared as a channel or a dynamic namespace, so a subscribe
        /// naming one is refused as an unknown topic: a craft state reaches the
        /// contact planner and nothing else.
        /// </summary>
        internal const string CraftStatePrefix = "craftstate.";

        /// <summary>
        /// Each present craft's delays as of the last pass that found it in
        /// contact. A craft that goes takes its ledger rows with it on the same
        /// pass, so its going is sent under these.
        /// </summary>
        private readonly Dictionary<string, DelayStamp> _craftStateStamps = new Dictionary<string, DelayStamp>(StringComparer.Ordinal);

        private readonly List<Action> _timelineResetListeners = new List<Action>();

        /// <summary>
        /// The topic one craft's states are recorded under. The field is not
        /// <c>state</c> or <c>contact</c>: <see cref="IsFreezeExempt"/> reads
        /// those two suffixes on any per-vessel topic as a report of the
        /// blackout itself, and a craft state is telemetry held through one.
        /// </summary>
        internal static string CraftStateTopic(string vesselId) => CraftStatePrefix + vesselId + ".craft";

        public void RecordCraftState(string vesselId, CraftState state, double ut)
        {
            NoteCraftPresent(vesselId);
            Emit(CraftStateTopic(vesselId), state, ut);
        }

        public void NoteCraftPresent(string vesselId)
        {
            var node = FleetNodePrefix + vesselId;
            if (!SubjectConnected(node))
            {
                _craftStateStamps.Remove(vesselId);
                return;
            }
            _craftStateStamps[vesselId] = _network.StampFor(node);
        }

        public void RecordCraftGone(string vesselId, double ut)
        {
            if (!_craftStateStamps.TryGetValue(vesselId, out var stamp))
            {
                return;
            }
            _craftStateStamps.Remove(vesselId);
            var topic = CraftStateTopic(vesselId);
            _lastRecordedUt[topic] = ut;
            _courier.Record(NodeFor(topic), topic, CraftState.Gone("vessel:" + vesselId, ut), ut, sentUnder: stamp);
        }

        public Action HearCraftState(string vesselId, string centre, Action<CraftState> heard)
        {
            var topic = CraftStateTopic(vesselId);
            return _courier.SubscribeStream(NodeFor(topic), topic, centre, delivered =>
            {
                if (delivered.Payload is CraftState state)
                {
                    heard(state);
                }
            });
        }

        public void OnTimelineReset(Action reset) => _timelineResetListeners.Add(reset);

        /// <summary>Tells every listener the timeline was reset. A listener that throws is reported and the rest still hear.</summary>
        private void NotifyTimelineResetListeners()
        {
            _craftStateStamps.Clear();
            foreach (var listener in _timelineResetListeners)
            {
                try
                {
                    listener();
                }
                catch (Exception ex)
                {
                    LogHost("a timeline-reset listener threw: " + ex);
                }
            }
        }
    }
}
