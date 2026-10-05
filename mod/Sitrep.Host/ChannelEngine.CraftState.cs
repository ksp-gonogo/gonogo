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
    public sealed partial class ChannelEngine : ICraftStateHost, IPlanAudienceHost
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

        /// <summary>The topic one craft's states are recorded under. A craft state is telemetry, held through a blackout like the rest of it.</summary>
        internal static string CraftStateTopic(string vesselId) => CraftStatePrefix + vesselId + ".craft";

        /// <summary>
        /// The topic the craft's link is reported under: whether its radio
        /// answers. Exempt from the freeze, as the other reports of a blackout
        /// are, so each centre hears of an outage at its own light-time.
        /// </summary>
        internal static string CraftLinkTopic(string vesselId) => CraftStatePrefix + vesselId + CraftLinkSuffix;

        internal const string CraftLinkSuffix = ".link";

        /// <summary>The game time of the tick being worked through. Courier thread only.</summary>
        private double _tickUt = double.NegativeInfinity;

        /// <summary>The link last reported of each craft, so only a change is said.</summary>
        private readonly Dictionary<string, bool> _craftLinkSaid = new Dictionary<string, bool>(StringComparer.Ordinal);

        /// <summary>Says a craft's link when it changes, on the craft's own node.</summary>
        private void SayCraftLink(string vesselId, bool connected)
        {
            if (_craftLinkSaid.TryGetValue(vesselId, out var said) && said == connected)
            {
                return;
            }
            _craftLinkSaid[vesselId] = connected;
            // The tick being worked through, not the clock, which this tick has not advanced yet.
            Emit(CraftLinkTopic(vesselId), connected, Math.Max(_tickUt, _clock.Now()));
        }

        internal const string CraftSightingSuffix = ".seen";

        /// <summary>
        /// The topic an object's sightings are recorded under. Never held by a
        /// blackout and never lost with a broken path: a sighting is light off
        /// the object itself, which no radio and no relay carries.
        /// </summary>
        internal static string CraftSightingTopic(string vesselId) => CraftStatePrefix + vesselId + CraftSightingSuffix;

        public void RecordCraftSighting(string vesselId, CraftSighting sighting, double ut, IReadOnlyDictionary<string, double> lightSeconds)
        {
            var topic = CraftSightingTopic(vesselId);
            _lastRecordedUt[topic] = ut;
            // A centre the sighting has no light-time to is never sent it.
            _courier.Record(NodeFor(topic), topic, sighting, ut, sentUnder: new DelayStamp(double.PositiveInfinity, lightSeconds));
        }

        public Action HearCraftSighting(string vesselId, string centre, Action<CraftSighting> seen)
        {
            var topic = CraftSightingTopic(vesselId);
            return _courier.SubscribeStream(NodeFor(topic), topic, centre, delivered =>
            {
                if (delivered.Payload is CraftSighting sighting)
                {
                    seen(sighting);
                }
            });
        }

        public Action HearCraftLink(string vesselId, string centre, Action<bool> heard)
        {
            var topic = CraftLinkTopic(vesselId);
            return _courier.SubscribeStream(NodeFor(topic), topic, centre, delivered =>
            {
                if (delivered.Payload is bool connected)
                {
                    heard(connected);
                }
            });
        }

        internal const string CraftRadioSuffix = ".radio";

        /// <summary>The topic a craft's radio readings are recorded under.</summary>
        internal static string CraftRadioTopic(string vesselId) => CraftStatePrefix + vesselId + CraftRadioSuffix;

        /// <summary>The delays each craft's last radio reading taken in contact was sent under, which is what the reading that says the link has gone is sent under too.</summary>
        private readonly Dictionary<string, DelayStamp> _craftRadioStamps = new Dictionary<string, DelayStamp>(StringComparer.Ordinal);

        /// <summary>
        /// Records a reading of a craft's radio on the craft's own node.
        ///
        /// <para>The reading is of a whole path, every hop of it as it stood at
        /// one instant, so it is sent to each centre under the longest of the
        /// light-times from the nodes on that path: a centre farther from a
        /// relay than from the craft does not learn through the craft's reading
        /// what the relay's own light has not yet told it.</para>
        ///
        /// <para>A reading that the link has gone is how each centre learns its
        /// strength is nothing, so it is sent under the delays of the last
        /// reading taken in contact, as the other reports of a blackout are. A
        /// craft that was never in contact has nothing to say.</para>
        /// </summary>
        public void RecordCraftRadio(string vesselId, ContactRadio radio, double ut)
        {
            DelayStamp? stamp;
            if (radio.Connected && SubjectConnected(FleetNodePrefix + vesselId))
            {
                stamp = WholePathStamp(vesselId, radio.Hops);
                _craftRadioStamps[vesselId] = stamp;
            }
            if (!_craftRadioStamps.TryGetValue(vesselId, out stamp))
            {
                return;
            }
            var topic = CraftRadioTopic(vesselId);
            _lastRecordedUt[topic] = ut;
            _courier.Record(NodeFor(topic), topic, radio, ut, sentUnder: stamp);
        }

        /// <summary>For every centre, the longest light-time to it from the craft or from any craft on <paramref name="hops"/>.</summary>
        private DelayStamp WholePathStamp(string vesselId, IReadOnlyList<RadioHop> hops)
        {
            var stamps = new List<DelayStamp> { _network.StampFor(FleetNodePrefix + vesselId) };
            foreach (var hop in hops)
            {
                if (hop.ToIsCraft)
                {
                    stamps.Add(_network.StampFor(FleetNodePrefix + hop.To));
                }
            }
            if (stamps.Count == 1)
            {
                return stamps[0];
            }
            var longest = double.NegativeInfinity;
            var byVantage = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var stamp in stamps)
            {
                longest = Math.Max(longest, stamp.BaseSeconds);
            }
            foreach (var centre in _activeCentreIds)
            {
                var slowest = double.NegativeInfinity;
                foreach (var stamp in stamps)
                {
                    slowest = Math.Max(slowest, stamp.For(centre));
                }
                byVantage[centre] = slowest;
            }
            return new DelayStamp(longest, byVantage);
        }

        public Action HearCraftRadio(string vesselId, string centre, Action<ContactRadio> heard)
        {
            var topic = CraftRadioTopic(vesselId);
            return _courier.SubscribeStream(NodeFor(topic), topic, centre, delivered =>
            {
                if (delivered.Payload is ContactRadio radio)
                {
                    heard(radio);
                }
            });
        }

        /// <summary>The last state recorded of each present craft, to say again to a centre that has just gained a route to it.</summary>
        private readonly Dictionary<string, CraftState> _craftStateSaid = new Dictionary<string, CraftState>(StringComparer.Ordinal);

        public void RecordCraftState(string vesselId, CraftState state, double ut)
        {
            _craftStateSaid[vesselId] = state;
            NoteCraftPresent(vesselId, ut);
            Emit(CraftStateTopic(vesselId), state, ut);
        }

        public void NoteCraftPresent(string vesselId, double ut)
        {
            var node = FleetNodePrefix + vesselId;
            if (!SubjectConnected(node))
            {
                _craftStateStamps.Remove(vesselId);
                return;
            }
            var stamp = _network.StampFor(node);
            var gained = _craftStateStamps.TryGetValue(vesselId, out var before) && GainedARoute(before, stamp);
            _craftStateStamps[vesselId] = stamp;
            /*
             * A state recorded while a centre had no route to the craft was
             * stamped as never arriving there. Now that it can hear the craft, it
             * hears where the craft is, one light-time from now, as it would hear
             * anything else the craft is sending.
             */
            if (gained && _craftStateSaid.TryGetValue(vesselId, out var said))
            {
                Emit(CraftStateTopic(vesselId), said, ut);
            }
        }

        /// <summary>Whether some centre that could not be reached under <paramref name="before"/> can be under <paramref name="now"/>.</summary>
        private static bool GainedARoute(DelayStamp before, DelayStamp now)
        {
            if (ReferenceEquals(before, now))
            {
                return false;
            }
            var was = before.ByVantage();
            if (was == null)
            {
                return false;
            }
            foreach (var row in was)
            {
                if (double.IsPositiveInfinity(row.Value) && !double.IsPositiveInfinity(now.For(row.Key)))
                {
                    return true;
                }
            }
            return false;
        }

        public void RecordCraftGone(string vesselId, double ut)
        {
            _craftStateSaid.Remove(vesselId);
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

        /// <summary>
        /// The centre the roster marks home: the claimant's answer, or the ground
        /// station standing in for it when the claimant names none, which is
        /// where a connection that has chosen no vantage stands.
        /// </summary>
        public string? HomeCentre()
        {
            var home = _freshConnectionVantage;
            return home == CommandCentres.FreshConnectionVantage.None ? null : home;
        }

        public double LightFactor() => _deliveryInputs.LightFactor;

        public bool NetworkModelled() => _deliveryInputs.NetworkModelled;

        public double? ControlRouteSeconds()
        {
            var home = HomeCentre();
            if (home == null || !SubjectConnected(NodeId))
            {
                return null;
            }
            var seconds = _network.DelayTo(home, NodeId);
            return double.IsNaN(seconds) || double.IsInfinity(seconds) ? (double?)null : seconds;
        }

        public double? LiveLinkSeconds(string from, string to) => _deliveryInputs.Links.LiveLink(from, to);

        public IReadOnlyCollection<string> PlanningCentres()
        {
            var centres = new HashSet<string>(StringComparer.Ordinal);
            var home = _homeCommand.CentreId;
            if (home != null)
            {
                centres.Add(home);
            }
            foreach (var session in _sessions.Values)
            {
                var vantage = VantageOf(session);
                if (vantage != CommandCentres.FreshConnectionVantage.None && vantage != MetaVantage)
                {
                    centres.Add(vantage);
                }
            }
            // A centre with a command still out has to keep a plan to send it by,
            // whether or not anyone is sitting there now.
            foreach (var entry in _pending)
            {
                if (entry.LaneSeq != null && _activeCentreIds.Contains(entry.Vantage))
                {
                    centres.Add(entry.Vantage);
                }
            }
            return centres;
        }

        /// <summary>Tells every listener the timeline was reset. A listener that throws is reported and the rest still hear.</summary>
        private void NotifyTimelineResetListeners()
        {
            _craftStateStamps.Clear();
            _craftStateSaid.Clear();
            _craftLinkSaid.Clear();
            _craftRadioStamps.Clear();
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
