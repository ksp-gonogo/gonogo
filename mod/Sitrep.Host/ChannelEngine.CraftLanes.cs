using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine : ICraftLaneHost
    {
        /// <summary>
        /// The namespace of craft lanes: <c>craft.&lt;guid&gt;.&lt;topic&gt;</c> is
        /// <c>&lt;topic&gt;</c> as craft <c>&lt;guid&gt;</c> reported it, recorded on
        /// that craft's own <c>fleet.&lt;guid&gt;</c> node whether or not it is the
        /// active craft. Same payload as the active-vessel topic it mirrors.
        /// </summary>
        public const string CraftLanePrefix = "craft.";

        private static readonly PerfBudget CraftLaneBudget = new PerfBudget(
            "ChannelEngine craft lane samples recorded", threshold: 300, windowSec: 1.0, unit: "samples");

        /// <summary>How often, in UT, every lane is trimmed to what a centre can still be owed.</summary>
        private const double LaneTrimIntervalUt = 10.0;

        // Written while registering, before Start, then only read.
        private readonly HashSet<string> _followsActiveCraft = new HashSet<string>(StringComparer.Ordinal);

        /*
         * The craft the current tick's snapshot was taken of, null on a tick with no
         * active craft in it. A reading the channel loop builds this tick is that
         * craft's, whatever the engine remembers as active. Courier-thread-only.
         */
        private string? _laneCraftThisTick;

        /*
         * Every lane topic that has had a reading. A lane nobody subscribes to has no
         * read cursor, and the cursor prune leaves such a topic whole, so these are
         * trimmed here instead. Courier-thread-only.
         */
        private readonly HashSet<string> _lanesWritten = new HashSet<string>(StringComparer.Ordinal);
        private double _nextLaneTrimUt = double.NegativeInfinity;

        /// <inheritdoc/>
        public void FollowActiveCraft(string topic)
        {
            if (string.IsNullOrEmpty(topic) || topic.StartsWith(CraftLanePrefix, StringComparison.Ordinal))
            {
                throw new ArgumentException("a craft lane follows an active-vessel topic, and \"" + topic + "\" is not one", nameof(topic));
            }
            if (OffTheRunningCourier())
            {
                EnqueueJob(new CourierActionJob(() => FollowActiveCraft(topic)));
                return;
            }
            if (!_dynamicNamespaces.ContainsKey(CraftLanePrefix))
            {
                /*
                 * Registered directly rather than through RegisterDynamicNamespace,
                 * which hands a prefix to the first Uplink that registers it: the
                 * lanes are the engine's own, whichever provider declares the first
                 * following topic.
                 */
                _dynamicNamespaces[CraftLanePrefix] = new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Requires = Requirement.None,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    PerVesselNode = true,
                };
                _dynamicNamespaceOwner[CraftLanePrefix] = "";
                _perVesselNamespacePrefixes.Add(CraftLanePrefix);
            }
            _followsActiveCraft.Add(topic);
        }

        /// <inheritdoc/>
        public void WriteCraftSnapshot(string vesselId, KspSnapshot snapshot)
        {
            if (string.IsNullOrEmpty(vesselId) || snapshot == null)
            {
                return;
            }
            if (OffTheRunningCourier())
            {
                EnqueueJob(new CourierActionJob(() => WriteCraftSnapshot(vesselId, snapshot)));
                return;
            }
            if (_followsActiveCraft.Count == 0 || _worldWait == WorldWait.Loading)
            {
                return;
            }
            foreach (var topic in _followsActiveCraft)
            {
                if (!_channelSources.TryGetValue(topic, out var map) || !IsChannelAvailable(topic))
                {
                    continue;
                }
                object? value;
                try
                {
                    value = map(snapshot);
                }
                catch (Exception ex)
                {
                    LogLimitedPerTopic("lane ", topic, "craft lane build of " + topic + " for " + vesselId + " threw, so this craft has no reading of it this time: " + ex.Message);
                    continue;
                }
                if (value != null)
                {
                    RecordInLane(vesselId, topic, value, snapshot.Ut);
                }
            }
        }

        /// <summary>The lane fact that holds a craft's tanks as its saved snapshot last wrote them.</summary>
        public const string SavedTanksFact = "savedTanks";

        /// <inheritdoc/>
        public void HoldCraftFact(string vesselId, string fact, object? value, double ut)
        {
            if (string.IsNullOrEmpty(vesselId) || string.IsNullOrEmpty(fact))
            {
                return;
            }
            if (OffTheRunningCourier())
            {
                EnqueueJob(new CourierActionJob(() => HoldCraftFact(vesselId, fact, value, ut)));
                return;
            }
            if (_followsActiveCraft.Count == 0
                || _followsActiveCraft.Contains(fact)
                || _worldWait == WorldWait.Loading)
            {
                return;
            }
            RecordInLane(vesselId, fact, value, ut);
        }

        /// <summary>
        /// An Uplink's reading of a following channel for a craft that is not the
        /// active one (see <see cref="ICraftReadingPublisher"/>), kept in that
        /// craft's lane whether or not any screen reads the channel. A reading
        /// stamped ahead of the clock belongs to a timeline a load abandoned and is
        /// taken as now, as an ordinary publish is.
        /// </summary>
        internal void PublishForCraft(string topic, string vesselId, object? payload, double ut)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return;
            }
            if (OffTheRunningCourier())
            {
                EnqueueJob(new CourierActionJob(() => PublishForCraft(topic, vesselId, payload, ut)));
                return;
            }
            if (!_followsActiveCraft.Contains(topic) || _worldWait == WorldWait.Loading)
            {
                return;
            }
            var now = _clock.Now();
            RecordInLane(vesselId, topic, payload, ut > now + PublishUtToleranceSeconds ? now : ut);
        }

        /// <summary>
        /// Courier thread, as an Uplink's publish is processed: keeps a reading of a
        /// following channel in the lane of the active craft, whose reading an
        /// ordinary publish is, before the publish is dropped for want of a
        /// subscriber.
        /// </summary>
        private void KeepPublishedReadingInLane(PublishJob publish, double nowUt)
        {
            if (publish.SaidBy != null
                || _lastActiveVesselId == null
                || _worldWait == WorldWait.Loading
                || !_followsActiveCraft.Contains(publish.Topic))
            {
                return;
            }
            var ut = publish.Ut > nowUt + PublishUtToleranceSeconds ? nowUt : publish.Ut;
            RecordInLane(_lastActiveVesselId, publish.Topic, publish.Payload, ut);
        }

        /// <summary>The lane topic that keeps <paramref name="topic"/> for the craft <paramref name="vesselId"/>.</summary>
        internal static string LaneTopic(string vesselId, string topic) => CraftLanePrefix + vesselId + "." + topic;

        /// <summary>Whether a screen reading <paramref name="topic"/> is shown the active craft's lane.</summary>
        internal bool FollowsActiveCraft(string topic) => _followsActiveCraft.Contains(topic);

        /*
         * The craft a screen's active-vessel topics show: the one the game says is
         * active, which it says at the switch, a tick before the active craft's own
         * vessel entry is read. Courier-thread-only.
         */
        private string? _laneViewCraft;

        private void NoteLaneViewCraft(KspSnapshot? snapshot, string? vesselEntryId)
        {
            var named = SystemViewProvider.BuildActiveVessel(snapshot) is IDictionary<string, object?> active
                && active.TryGetValue("vesselId", out var id)
                ? id as string
                : null;
            _laneViewCraft = named ?? vesselEntryId ?? _laneViewCraft;
        }

        /// <summary>
        /// The lane a screen subscribed to <paramref name="topic"/> reads now: the
        /// active craft's node and lane topic, or null for a topic that follows no
        /// craft or while no craft has been active.
        /// </summary>
        private (string Node, string Topic)? LaneViewFor(string topic)
        {
            if (!_followsActiveCraft.Contains(topic) || _laneViewCraft == null)
            {
                return null;
            }
            var lane = LaneTopic(_laneViewCraft, topic);
            return (NodeFor(lane), lane);
        }

        /// <summary>
        /// Courier thread, inside the channel loop: keeps a reading of a following
        /// topic in the lane of the craft this tick's snapshot was taken of.
        /// </summary>
        private void KeepActiveReadingInLane(string topic, object? value, double ut)
        {
            if (_laneCraftThisTick == null || !_followsActiveCraft.Contains(topic))
            {
                return;
            }
            RecordInLane(_laneCraftThisTick, topic, value, ut);
        }

        /*
         * Through the emitter and Emit, as any reading is, so a lane rides every
         * rule its craft's node has: the reveal gate, the freeze on a dark craft and
         * the hold while no delay to it is known. Not through ProcessPublish, which
         * drops a reading nobody subscribes to, and a lane is kept for the switch
         * that has not happened yet.
         */
        private void RecordInLane(string vesselId, string topic, object? value, double ut)
        {
            var lane = LaneTopic(vesselId, topic);
            DeclareLane(lane, topic);
            EmissionDecision decision;
            try
            {
                decision = _emitter.Decide(lane, value, ut);
            }
            catch (Exception ex)
            {
                LogLimitedPerTopic("lane ", lane, "craft lane " + lane + " could not be compared with its last reading: " + ex.Message);
                return;
            }
            if (!decision.ShouldEmit)
            {
                return;
            }
            CraftLaneBudget.Record(1, ut);
            _lanesWritten.Add(lane);
            Emit(lane, decision.Value, ut);
        }

        /// <summary>A lane is declared as the topic it keeps, so it is held, keyframed and recorded alike.</summary>
        private void DeclareLane(string lane, string topic)
        {
            if (_channelDeclarations.ContainsKey(lane))
            {
                return;
            }
            if (!_channelDeclarations.TryGetValue(topic, out var source))
            {
                EnsureDynamicTopicDeclared(CraftLanePrefix, lane);
                return;
            }
            _channelDeclarations[lane] = new ChannelDeclaration
            {
                Kind = source.Kind,
                Topic = lane,
                Delivery = source.Delivery,
                Emission = source.Emission,
                Delay = DelayRole.Delayed,
                IsKeyframe = source.IsKeyframe,
                Requires = source.Requires,
                AbsenceIsData = source.AbsenceIsData,
                NullIsUnreadable = source.NullIsUnreadable,
                Recordable = source.Recordable,
            };
            _channelOwner[lane] = _dynamicNamespaceOwner[CraftLanePrefix];
        }

        /// <summary>
        /// Records what a session's stream for <paramref name="topic"/> is bound to,
        /// so a later move of it can be found: the lane a following topic reads, or
        /// the node a key-routed topic records on. Nothing for any other topic.
        /// </summary>
        private void NoteStreamBinding(ClientSession session, string topic, string boundNode, string boundTopic)
        {
            if (FollowsActiveCraft(topic))
            {
                session.LaneViews[topic] = boundTopic;
                return;
            }
            if (RoutesByKeySegment(topic))
            {
                session.RoutedNodes[topic] = boundNode;
            }
        }

        /// <summary>
        /// Courier thread, each tick: re-points every screen reading a following
        /// topic at the active craft's lane when the active craft has changed, or
        /// when the first craft becomes active under a screen that subscribed with
        /// none (and so reads the active-vessel topic itself). The
        /// Courier then hands each one the newest reading of the new craft that has
        /// reached its centre by that reading's own delay.
        /// </summary>
        private void RepointLaneViews()
        {
            if (_followsActiveCraft.Count == 0)
            {
                return;
            }
            foreach (var session in _sessions.Values)
            {
                if (session.LaneViews.Count == 0)
                {
                    continue;
                }
                foreach (var bound in session.LaneViews.ToArray())
                {
                    if ((LaneViewFor(bound.Key)?.Topic ?? bound.Key) == bound.Value)
                    {
                        continue;
                    }
                    ProcessUnsubscribe(session, bound.Key);
                    ProcessSubscribe(session, bound.Key);
                }
            }
        }

        /// <summary>
        /// Courier thread, right after a screen's stream is bound to a lane: hands it
        /// the lane's readings it has not been shown, so a chart has no hole for the
        /// time the screen watched another craft. From the newest reading it was
        /// shown of this craft, or a short span back for a craft it has not been
        /// shown, up to the reading the subscribe just handed it. Only what has
        /// already reached the screen's centre by its own delay.
        /// </summary>
        private void ReplayLaneHistory(ClientSession session, string node, string lane, string vantage, double? shownThrough, Action<StreamData<object?>> deliver)
        {
            if (!session.LaneShownThrough.TryGetValue(lane, out var newest))
            {
                return;
            }
            var from = shownThrough ?? newest - CraftLanePolicy.Current.FirstViewHistoryUt;
            _courier.ReplayArrived(node, lane, vantage, from, newest, deliver);
        }

        /// <summary>
        /// Courier thread: drops from every lane what no centre can be owed any more
        /// and what is older than the history a returning screen is handed (see
        /// <see cref="CraftLanePolicy.HistoryUt"/>), keeping each lane's current
        /// reading.
        /// </summary>
        private void TrimLanes(double ut)
        {
            if (_lanesWritten.Count == 0 || ut < _nextLaneTrimUt)
            {
                return;
            }
            _nextLaneTrimUt = ut + LaneTrimIntervalUt;
            foreach (var lane in _lanesWritten)
            {
                var node = NodeFor(lane);
                var retain = Longest(_network.StampFor(node)) + 2 * WarmIntervalUt + CraftLanePolicy.Current.HistoryUt;
                _courier.TrimTopic(node, lane, ut - retain);
            }
        }

        /// <summary>
        /// Courier thread, last of the ledger writes: the active craft's lane is
        /// timed and frozen exactly as the active-vessel node is, so the two never
        /// disagree about one craft. Its link follows the active craft's own, and
        /// its delay the delay measured for it while the link is up. Neither is
        /// written while the craft just switched to has no measured path, when
        /// both still describe the craft left behind, or while no craft is loaded.
        /// </summary>
        private void TimeActiveLaneByActiveDelay()
        {
            if (_followsActiveCraft.Count == 0
                || _lastActiveVesselId == null
                || _awaitingFirstMeasuredPath
                || (_activeCraftKnown && !_activeCraftLoaded))
            {
                return;
            }
            var connected = SubjectConnected(NodeId);
            if (connected)
            {
                SetVesselDelay(_lastActiveVesselId, _signalDelaySeconds);
            }
            SetVesselConnectivity(_lastActiveVesselId, connected);
        }
    }
}
