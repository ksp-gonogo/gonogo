using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host
{
    /// <summary>
    /// Store-and-forward delivery of delayed commands addressed to a craft:
    /// lanes, holds, custody, expiry, cancels and journey reports. Courier-thread
    /// state throughout, apart from the save snapshot, which is swapped whole.
    /// </summary>
    public sealed partial class ChannelEngine : ICentrePlanHost
    {
        /// <summary>The <c>comms.journey</c> channel topic.</summary>
        public const string JourneyTopic = "comms.journey";

        internal const string UplinkCancelCommand = "system.uplink.cancel";

        internal const string UplinkResendCommand = "system.uplink.resend";

        /// <summary>The most journey events kept per timeline; the oldest go first.</summary>
        private const int JourneyEventCap = 500;

        /// <summary>How long after its predicted reply, or its expiry, a pending entry is kept when no report has settled it.</summary>
        private const double PendingSettleMarginSeconds = 3.0;

        private static readonly PerfBudget DeliveryMessagesBudget = new PerfBudget(
            "ChannelEngine store-and-forward commands sent", threshold: 50, windowSec: 1.0, unit: "commands");

        private DeliveryInputs _deliveryInputs = new DeliveryInputs();
        private DeliveryNetwork _delivery = null!;
        private readonly Dictionary<string, DispatchCommandJob> _deliveryJobs = new Dictionary<string, DispatchCommandJob>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _laneCraftNodes = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly List<CommsJourneyEvent> _journey = new List<CommsJourneyEvent>();
        private int _seenPlanVersion;
        private Func<string, ContactPlan?>? _centrePlans;
        private Func<int>? _centrePlansVersion;
        private string? _activeCraftId;
        private DeliverySnapshot? _carriedBySave;
        private DeliverySnapshot? _reloadedSave;
        private int _gameLoaded;

        /// <summary>
        /// The live link graph and light scaling store-and-forward reads, written
        /// by the link capture. Set before <see cref="Start"/>.
        /// </summary>
        public void SetDeliveryInputs(DeliveryInputs inputs)
        {
            _deliveryInputs = inputs ?? throw new ArgumentNullException(nameof(inputs));
            CreateDelivery();
        }

        /// <summary>
        /// Hands the engine each command centre's own contact plan. From here on a
        /// centre sends on what its plan says and never on the live path; an
        /// engine nobody hands plans to keeps sending on the live path, having no
        /// belief to send on.
        /// </summary>
        public void SetCentrePlans(Func<string, ContactPlan?> planOf, Func<int> version)
        {
            _centrePlans = planOf ?? throw new ArgumentNullException(nameof(planOf));
            _centrePlansVersion = version ?? throw new ArgumentNullException(nameof(version));
        }

        public void NoteHeard(string centre, string nodeId) => _delivery.Heard(centre, nodeId);

        private Func<string, string, string?>? _nodeNames;

        public void SetNodeNames(Func<string, string, string?> nameAt) => _nodeNames = nameAt;

        /// <summary>The name <paramref name="centre"/> knows <paramref name="nodeId"/> by, or the id itself when it knows none.</summary>
        private string NameOfNode(string centre, string nodeId)
        {
            var name = _nodeNames?.Invoke(centre, nodeId);
            return string.IsNullOrEmpty(name) ? nodeId : name!;
        }

        /// <summary>Each centre's plan as routes, with light times scaled as the game is set to delay them.</summary>
        private sealed class EngineSenderPlans : ISenderPlans
        {
            private readonly ChannelEngine _engine;

            public EngineSenderPlans(ChannelEngine engine) => _engine = engine;

            public bool Reckons => _engine._centrePlans != null && _engine._deliveryInputs.NetworkModelled;

            public IDeliveryRoutes? PlanOf(string centre)
            {
                var plan = _engine._centrePlans?.Invoke(centre);
                if (plan == null)
                {
                    return null;
                }
                var home = _engine.HomeCentre();
                // Every ground station is home's own antenna, and no other centre's.
                return centre == home
                    ? new PlanRoutes(plan, _engine._deliveryInputs.LightFactor, home, _engine._activeGroundIds)
                    : new PlanRoutes(plan, _engine._deliveryInputs.LightFactor);
            }
        }

        private ISenderPlans SenderPlans => _senderPlans ??= new EngineSenderPlans(this);

        private ISenderPlans? _senderPlans;

        /// <summary>
        /// Everything held, in flight and settled right now, for saving with the
        /// game. While a loaded game's snapshot waits for the next tick to restore
        /// it, that snapshot is what the game holds. Callable from any thread.
        /// </summary>
        public DeliverySnapshot DeliverySnapshotNow() => Volatile.Read(ref _carriedBySave) ?? _delivery.Snapshot();

        /// <summary>
        /// A game was loaded, carrying <paramref name="carried"/>: the next tick
        /// starts a new timeline and restores what the save held. Callable from any
        /// thread.
        /// </summary>
        public void NoteGameLoaded(DeliverySnapshot? carried, HeardSnapshot? heard = null)
        {
            _heardLoaded?.Invoke(heard);
            Volatile.Write(ref _reloadedSave, null);
            Volatile.Write(ref _carriedBySave, carried ?? new DeliverySnapshot());
            Interlocked.Exchange(ref _gameLoaded, 1);
        }

        /// <summary>
        /// The game loaded this process's own latest save, as it does on every
        /// scene change, which starts no new timeline. Should a rewind start one
        /// anyway (a quickload of that same save), it restores what this save
        /// held rather than nothing. Callable from any thread.
        /// </summary>
        public void NoteSaveReloaded(DeliverySnapshot? carried, HeardSnapshot? heard = null)
        {
            _heardReloaded?.Invoke(heard);
            Volatile.Write(ref _reloadedSave, carried);
        }

        private Func<HeardSnapshot?>? _heardNow;
        private Action<HeardSnapshot?>? _heardLoaded;
        private Action<HeardSnapshot?>? _heardReloaded;

        public void SetHeardStore(Func<HeardSnapshot?> now, Action<HeardSnapshot?> loaded, Action<HeardSnapshot?> reloaded)
        {
            _heardNow = now;
            _heardLoaded = loaded;
            _heardReloaded = reloaded;
        }

        /// <summary>
        /// What every command centre has heard of every craft right now, for
        /// saving with the game, or null when nothing here keeps it. Callable
        /// from any thread.
        /// </summary>
        public HeardSnapshot? HeardSnapshotNow() => _heardNow?.Invoke();

        private void CreateDelivery()
        {
            _delivery = new DeliveryNetwork(
                _clock,
                new EngineDeliveryLinks(this),
                // No shared plan: an engine nobody hands plans to holds a command
                // with no live path until one opens.
                new PlanRoutes(null),
                ExecuteDelivered,
                OnJourneyReport,
                beliefs: SenderPlans);
        }

        private void DeclareDeliveryChannels()
        {
            CreateDelivery();
            _channelDeclarations[JourneyTopic] = new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = JourneyTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed to the centre that sent the command, and to no other.
                // Each report is true as of when it was made at its node, and
                // reaches its centre when its own journey through the network
                // landed, which is the delay it is recorded under.
                Delay = DelayRole.Delayed,
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            };
            _addressedTopics.Add(JourneyTopic);
            // A centre's journey is state, and an addressed sample is not kept for
            // whoever subscribes after it landed, so a session that has just sat
            // down is told its centre's journey again.
            OnAddressedSubscribed(JourneyTopic, centre => PublishJourney(centre, _clock.Now(), 0.0));

            _commandDeclarations[UplinkCancelCommand] = new CommandDeclaration { Command = UplinkCancelCommand };
            _commandArgTypes[UplinkCancelCommand] = typeof(UplinkCancelRequest);
            _commandDeclarations[UplinkResendCommand] = new CommandDeclaration { Command = UplinkResendCommand };
            _commandArgTypes[UplinkResendCommand] = typeof(UplinkResendRequest);
        }

        /// <summary>The journey reports that have reached <paramref name="centre"/>, about its own commands, oldest first.</summary>
        internal CommsJourney JourneyAt(string centre)
        {
            var mine = new CommsJourney { Epoch = _courier.CurrentEpoch };
            foreach (var e in _journey)
            {
                if (_journeyVantage.TryGetValue(e.Id, out var vantage) && string.Equals(vantage, centre, StringComparison.Ordinal))
                {
                    mine.Events.Add(e);
                }
            }
            return mine;
        }

        /// <summary>
        /// Sends <paramref name="centre"/> its journey, true as of
        /// <paramref name="validAtUt"/> and arriving
        /// <paramref name="afterSeconds"/> later, and sends it to nobody else.
        /// </summary>
        private void PublishJourney(string centre, double validAtUt, double afterSeconds)
        {
            PublishAddressedTo(
                JourneyTopic,
                JourneyAt(centre),
                validAtUt,
                new Dictionary<string, double>(StringComparer.Ordinal) { [centre] = Math.Max(0.0, afterSeconds) });
        }

        private readonly Dictionary<string, string> _journeyVantage = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>The craft id a courier node addresses, or null for one that is not a craft.</summary>
        private string? CraftIdFor(string node)
        {
            if (string.Equals(node, NodeId, StringComparison.Ordinal))
            {
                return _activeCraftId;
            }
            return node.StartsWith(FleetNodePrefix, StringComparison.Ordinal)
                ? "vessel:" + node.Substring(FleetNodePrefix.Length)
                : null;
        }

        /// <summary>
        /// Takes a delayed command onto store-and-forward when it is addressed to a
        /// craft and is not a continuous input; a throttle or a fly-by-wire axis is
        /// sent live, or accepted with a warning and dropped where it would have
        /// waited. A switch on a control channel, lights or gear, is a command like
        /// any other, held and forwarded. True when taken.
        /// </summary>
        private bool TryDispatchHeld(DispatchCommandJob job, string node)
        {
            var craft = CraftIdFor(node);
            if (craft == null)
            {
                return false;
            }
            // Only a command centre holds a plan to send on. A dispatch from the
            // delay exemption, or from a vantage that is no active centre, has
            // nothing to reckon from and takes the path it always did.
            if (SenderPlans.Reckons && !_activeCentreIds.Contains(job.Vantage))
            {
                return false;
            }
            if (IsContinuousInput(job))
            {
                return DroppedAsContinuousAcrossAHold(job, craft);
            }

            var now = _clock.Now();
            var lane = new LaneKey(_courier.CurrentEpoch, job.Vantage, craft);
            _laneCraftNodes[craft] = node;
            var requestId = NextRequestId();
            var arriveBefore = ArriveBeforeUt(job);
            var message = _delivery.SendCommand(lane, job.Command, job.Args, node, null, now, arriveBefore, requestId);
            DeliveryMessagesBudget.Record(1, now);
            _deliveryJobs[message.Id] = job;
            if (job.SessionId != null)
            {
                _pendingDispatcher[requestId] = job.SessionId;
            }

            var prediction = Predict(lane, now, message.DeleteAtUt);
            // No arrival predicted is no figure at all, never a figure of zero.
            var oneWay = prediction.ArrivalUt != null ? Math.Max(0.0, prediction.ArrivalUt.Value - now) : (double?)null;
            _pending.Add(new PendingUplink
            {
                Id = requestId,
                ClientRequestId = job.ClientRequestId,
                Command = job.Command,
                Label = job.Label ?? "",
                Topic = job.Topic ?? "",
                Vantage = job.Vantage,
                DispatchedAt = now,
                OneWaySeconds = oneWay,
                LaneSeq = message.LaneSeq,
                Craft = craft,
                ExpiresAtUt = message.DeleteAtUt,
                PredictedArrivalUt = prediction.ArrivalUt,
                PredictedReplyUt = prediction.ReplyUt,
                PredictedHeldAt = prediction.HeldAt,
                PredictedHeldUntilUt = prediction.HeldUntilUt,
                CancelDeadlineUt = prediction.CancelDeadlineUt,
                // What a switch on a control channel asked for, as the live path carries it for a throttle.
                CommandedValue = CommandedScalar(job),
                Attempts = 1,
                Members = new List<string> { requestId },
            });
            if (job.OnAcceptedHeld != null)
            {
                job.OnAcceptedHeld(oneWay, prediction.ReplyUt, message.DeleteAtUt, null);
            }
            else
            {
                job.OnAccepted?.Invoke(oneWay);
            }
            job.Done?.Set();
            return true;
        }

        /// <summary>What a journey report says of a continuous input dropped where it would have waited.</summary>
        internal const string ContinuousInputDropped = "it would have waited here, and a continuous input is not held";

        /// <summary>
        /// Takes a continuous input, a throttle or a fly-by-wire axis, whose
        /// sending centre's own plan says it would wait at a node on the way to
        /// the craft. It is accepted, with a warning that it will be lost where
        /// it waits, and it is dropped there: at the centre at once when the
        /// first hop is shut, or at the relay it would have reached, in which
        /// case the centre learns of it when a report from that relay could have
        /// come home. True when it was taken.
        ///
        /// <para>Sending it is the operator's call, not the instrument's: the
        /// centre and the pilot may have agreed a manoeuvre that opens the way.
        /// So it is never refused. It is never held either, because a held
        /// stream of stick positions arrives as a wall of stale ones.</para>
        ///
        /// <para>The centre's own plan decides, and never the live link, so
        /// nothing here tells the operator anything the centre has not heard. A
        /// plan that says the way is open leaves the write on the path it has
        /// always taken, as does a centre holding no plan at all, which has
        /// nothing to judge by. A wait no longer than a dish takes to turn is
        /// not a hold (<see cref="ContinuousInput.NotAHoldSeconds"/>).</para>
        /// </summary>
        private bool DroppedAsContinuousAcrossAHold(DispatchCommandJob job, string craft)
        {
            if (!SenderPlans.Reckons || string.Equals(job.Vantage, craft, StringComparison.Ordinal))
            {
                return false;
            }
            var plan = SenderPlans.PlanOf(job.Vantage);
            if (plan == null)
            {
                return false;
            }
            var now = _clock.Now();
            var route = plan.Route(job.Vantage, craft, now, now + DeliveryNetwork.CommandLifetimeSeconds);
            var hold = ContinuousInput.FirstHold(route, job.Vantage, now);
            if (hold == null)
            {
                return false;
            }

            var at = hold.Value.At;
            var droppedUt = hold.Value.ArrivesUt;
            // A report from the node it is dropped at takes as long to come home as the input took to get there.
            var knownUt = droppedUt + (droppedUt - now);
            var requestId = NextRequestId();
            var lane = new LaneKey(_courier.CurrentEpoch, job.Vantage, craft);
            _deliveryJobs[requestId] = job;
            if (job.SessionId != null)
            {
                _pendingDispatcher[requestId] = job.SessionId;
            }
            _pending.Add(new PendingUplink
            {
                Id = requestId,
                ClientRequestId = job.ClientRequestId,
                Command = job.Command,
                Label = job.Label ?? "",
                Topic = job.Topic ?? "",
                Vantage = job.Vantage,
                DispatchedAt = now,
                // It reaches no craft, so there is no light-time to the craft to quote.
                OneWaySeconds = null,
                Craft = craft,
                PredictedReplyUt = knownUt,
                PredictedHeldAt = at,
                CommandedValue = CommandedScalar(job),
                Attempts = 1,
                Members = new List<string> { requestId },
            });

            var warning = "A continuous input is lost if it has to wait, and this centre's plan says it would wait at "
                + NameOfNode(job.Vantage, at) + ". Fly this from a pilot aboard or leave it to automation on the craft.";
            if (job.OnAcceptedHeld != null)
            {
                job.OnAcceptedHeld(null, knownUt, null, warning);
            }
            else
            {
                job.OnAccepted?.Invoke(null);
                job.OnWarned?.Invoke(warning);
            }

            // What was sent on a timeline the game has since left never happened on this one.
            void Dropped()
            {
                if (_courier.CurrentEpoch != lane.Epoch)
                {
                    return;
                }
                // The pending backstop may have let the request go a moment before
                // the report it was waiting for; the report still settles it.
                _deliveryJobs[requestId] = job;
                OnJourneyReport(new ReportMessage
                {
                Id = requestId + "-dropped",
                To = job.Vantage,
                Kind = JourneyKind.Discarded,
                About = requestId,
                Lane = lane,
                At = at,
                AtUt = droppedUt,
                    LandedUt = knownUt,
                    Detail = ContinuousInputDropped,
                });
            }
            if (knownUt <= now)
            {
                Dropped();
            }
            else
            {
                _clock.Schedule(knownUt, Dropped);
            }
            job.Done?.Set();
            return true;
        }

        /// <summary>
        /// The light-time the sending centre's own plan gives a control-channel
        /// write that the plan lets through: the way to the craft open all the
        /// way, nothing waiting. Null for anything else, which is timed as it
        /// always was.
        ///
        /// <para>The accept frame and the pending entry carry this and never the
        /// live path's figure, because the live path knows whether the far link
        /// is up. A write the plan lets through is accepted on it whatever the
        /// link is really doing.</para>
        /// </summary>
        private double? PlannedLiveSeconds(DispatchCommandJob job, string node)
        {
            var craft = CraftIdFor(node);
            if (craft == null || !IsContinuousInput(job) || !SenderPlans.Reckons
                || !_activeCentreIds.Contains(job.Vantage)
                || string.Equals(job.Vantage, craft, StringComparison.Ordinal))
            {
                return null;
            }
            var now = _clock.Now();
            var route = SenderPlans.PlanOf(job.Vantage)?.Route(job.Vantage, craft, now, now + DeliveryNetwork.CommandLifetimeSeconds);
            if (route == null || route.Count == 0)
            {
                return null;
            }
            return Math.Max(0.0, route[route.Count - 1].ArriveUt - now);
        }

        /// <summary>The deadline a command's own declared arrive-before field carries, when it has one and the args set it.</summary>
        private double? ArriveBeforeUt(DispatchCommandJob job)
        {
            if (!_commandArgTypes.TryGetValue(job.Command, out var argsType))
            {
                return null;
            }
            var attribute = (SitrepCommandAttribute?)Attribute.GetCustomAttribute(argsType, typeof(SitrepCommandAttribute));
            if (attribute?.ArriveBefore == null || !(job.Args is IDictionary<string, object?> args))
            {
                return null;
            }
            var key = char.ToLowerInvariant(attribute.ArriveBefore[0]) + attribute.ArriveBefore.Substring(1);
            return args.TryGetValue(key, out var value) && value is double ut && !double.IsNaN(ut) && !double.IsInfinity(ut) ? ut : (double?)null;
        }

        private readonly struct DeliveryPrediction
        {
            public DeliveryPrediction(double? arrivalUt, double? replyUt, string? heldAt, double? heldUntilUt, double? cancelDeadlineUt)
            {
                ArrivalUt = arrivalUt;
                ReplyUt = replyUt;
                HeldAt = heldAt;
                HeldUntilUt = heldUntilUt;
                CancelDeadlineUt = cancelDeadlineUt;
            }

            public double? ArrivalUt { get; }

            public double? ReplyUt { get; }

            public string? HeldAt { get; }

            public double? HeldUntilUt { get; }

            public double? CancelDeadlineUt { get; }
        }

        /// <summary>
        /// What the sending centre predicts for a command sent now: when it arrives,
        /// where it first waits, when its reply comes back, and the last moment a
        /// cancel could still stop it.
        ///
        /// <para>From the centre's own plan, and so from nothing it has not heard.
        /// A prediction made from the live path would put the far end's link state
        /// on the sender's screen the instant it pressed send. Only an engine with
        /// no planner, which has no belief to predict from, reads the live path.</para>
        /// </summary>
        private DeliveryPrediction Predict(LaneKey lane, double now, double deleteAt)
        {
            if (string.Equals(lane.Vantage, lane.Craft, StringComparison.Ordinal))
            {
                return new DeliveryPrediction(now, now, null, null, null);
            }
            IDeliveryRoutes? routes;
            if (SenderPlans.Reckons)
            {
                routes = SenderPlans.PlanOf(lane.Vantage);
            }
            else
            {
                var links = new EngineDeliveryLinks(this);
                var live = links.LivePath(lane.Vantage, lane.Craft);
                if (live != null)
                {
                    var arrival = now + live.Value;
                    var back = links.LivePath(lane.Craft, lane.Vantage) ?? live.Value;
                    // Nothing waits, so the craft is the only stopping place: a cancel
                    // sent at t lands at t + light, which beats the command only if sent
                    // before it, which nothing can be on an unchanged plan.
                    return new DeliveryPrediction(arrival, arrival + back, null, null, null);
                }
                routes = new PlanRoutes(null);
            }
            var route = routes?.Route(lane.Vantage, lane.Craft, now, deleteAt);
            if (routes == null || route == null || route.Count == 0)
            {
                return new DeliveryPrediction(null, null, lane.Vantage, null, deleteAt);
            }
            var arrivalUt = route[route.Count - 1].ArriveUt;
            string? heldAt = null;
            double? heldUntil = null;
            var at = now;
            for (var i = 0; i < route.Count; i++)
            {
                if (route[i].DepartUt > at + 1e-6)
                {
                    heldAt = i == 0 ? lane.Vantage : route[i - 1].To;
                    heldUntil = route[i].DepartUt;
                    break;
                }
                at = route[i].ArriveUt;
            }
            var replyRoute = routes.Route(lane.Craft, lane.Vantage, arrivalUt, double.PositiveInfinity);
            var reply = replyRoute != null && replyRoute.Count > 0 ? replyRoute[replyRoute.Count - 1].ArriveUt : (double?)null;
            return new DeliveryPrediction(arrivalUt, reply, heldAt, heldUntil, CancelDeadline(lane, now, route, routes));
        }

        /// <summary>
        /// The latest send time at which a cancel still reaches a stopping place
        /// before the command leaves it: the sender while it is held there, each
        /// predicted hold, and the craft before the command can run.
        /// </summary>
        private static double? CancelDeadline(LaneKey lane, double now, IReadOnlyList<PlannedHop> route, IDeliveryRoutes routes)
        {
            double? best = null;
            void Consider(double? candidate)
            {
                if (candidate != null && candidate.Value >= now)
                {
                    best = best == null ? candidate : Math.Max(best.Value, candidate.Value);
                }
            }
            var at = now;
            for (var i = 0; i < route.Count; i++)
            {
                var holdNode = i == 0 ? lane.Vantage : route[i - 1].To;
                if (route[i].DepartUt > at + 1e-6)
                {
                    if (i == 0)
                    {
                        Consider(route[i].DepartUt);
                    }
                    else
                    {
                        Consider(LatestSendToReach(lane.Vantage, holdNode, now, route[i].DepartUt, routes));
                    }
                }
                at = route[i].ArriveUt;
            }
            Consider(LatestSendToReach(lane.Vantage, lane.Craft, now, route[route.Count - 1].ArriveUt, routes));
            return best;
        }

        /// <summary>The latest send time from <paramref name="from"/> that reaches <paramref name="to"/> by <paramref name="byUt"/>, from the travel time of a cancel sent now.</summary>
        private static double? LatestSendToReach(string from, string to, double now, double byUt, IDeliveryRoutes routes)
        {
            var route = routes.Route(from, to, now, byUt);
            if (route == null || route.Count == 0)
            {
                return null;
            }
            var travel = route[route.Count - 1].ArriveUt - now;
            return byUt - travel;
        }

        /// <summary>Runs a command that reached its craft. One sent to the active vessel runs only if that craft is still the active one.</summary>
        private object? ExecuteDelivered(CommandMessage message, double atUt)
        {
            if (string.Equals(message.ExecNode, NodeId, StringComparison.Ordinal)
                && !string.Equals(message.Lane.Craft, _activeCraftId, StringComparison.Ordinal))
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "the craft it was sent to is no longer the active vessel");
            }
            return InvokeCommandHandler(message.Command, message.Args, message.Lane.Vantage);
        }

        /// <summary>A journey report reached the centre that sent the command: record it, settle the client's request, and drop a settled pending entry.</summary>
        private void OnJourneyReport(ReportMessage report)
        {
            var kind = KindOf(report.Kind);
            var e = new CommsJourneyEvent
            {
                Id = report.Id,
                About = report.About,
                Craft = report.Lane.Craft,
                LaneSeq = report.LaneSeq,
                Kind = kind,
                At = report.At,
                AtUt = report.AtUt,
                UntilUt = report.UntilUt,
                Detail = report.Detail,
                Missing = report.Missing?.ToList() ?? new List<long>(),
            };
            _journey.Add(e);
            _journeyVantage[e.Id] = report.To;
            if (_journey.Count > JourneyEventCap)
            {
                _journeyVantage.Remove(_journey[0].Id);
                _journey.RemoveAt(0);
            }
            // True when it was made, here when its journey landed: never sooner
            // than light could carry it.
            PublishJourney(report.To, report.AtUt, report.LandedUt - report.AtUt);

            if (!_deliveryJobs.TryGetValue(report.About, out var job))
            {
                return;
            }
            switch (report.Kind)
            {
                case JourneyKind.Reply:
                    Settle(report.About);
                    Deliver(job, report.Result);
                    break;
                case JourneyKind.Expired when report.OtherCopiesOut:
                    // A copy sent again is still out there and may yet run, so the
                    // command is not finished: only this copy is. Its reply, or the
                    // last copy's end, settles the request.
                    break;
                case JourneyKind.Expired:
                    Settle(report.About);
                    job.OnRefused?.Invoke(FaultCode.CommandExpired, "It expired at " + report.At + " before it could run.");
                    break;
                case JourneyKind.Cancelled:
                    Settle(report.About);
                    job.OnRefused?.Invoke(FaultCode.CommandCancelled, "It was cancelled at " + report.At + ".");
                    break;
                case JourneyKind.Discarded when report.Detail == "its lane moved on" && report.OtherCopiesOut:
                    break;
                case JourneyKind.Discarded when report.Detail == "its lane moved on":
                    Settle(report.About);
                    job.OnRefused?.Invoke(FaultCode.CommandExpired, "Its place on the lane passed before it arrived.");
                    break;
                case JourneyKind.Discarded when report.Detail == ContinuousInputDropped:
                    Settle(report.About);
                    job.OnRefused?.Invoke(
                        FaultCode.ContinuousInputWouldWait,
                        "It was dropped at " + NameOfNode(report.To, report.At) + ": it would have waited there for its next window, and a continuous input is not held.");
                    break;
                case JourneyKind.Discarded when report.Detail == "cancelled":
                    Settle(report.About);
                    job.OnRefused?.Invoke(FaultCode.CommandCancelled, "It was cancelled at the craft.");
                    break;
            }
        }

        /// <summary>Forgets the client request of a pending entry the backstop pruned, so a report that never comes home holds nothing.</summary>
        private void ForgetDeliveryJobs(PendingUplink entry)
        {
            if (!_deliveryJobs.TryGetValue(entry.Id, out var job))
            {
                return;
            }
            foreach (var copy in _deliveryJobs.Where(j => ReferenceEquals(j.Value, job)).Select(j => j.Key).ToList())
            {
                _deliveryJobs.Remove(copy);
            }
        }

        /// <summary>Forgets a settled command's client request and pending entry, and every copy sent of it.</summary>
        private void Settle(string id)
        {
            if (!_deliveryJobs.TryGetValue(id, out var job))
            {
                return;
            }
            foreach (var copy in _deliveryJobs.Where(j => ReferenceEquals(j.Value, job)).Select(j => j.Key).ToList())
            {
                _deliveryJobs.Remove(copy);
                _pending.RemoveAll(p => string.Equals(p.Id, copy, StringComparison.Ordinal));
                _pendingDispatcher.Remove(copy);
            }
        }

        private static JourneyEventKind KindOf(JourneyKind kind) => kind switch
        {
            JourneyKind.Held => JourneyEventKind.Held,
            JourneyKind.Departed => JourneyEventKind.Departed,
            JourneyKind.Expired => JourneyEventKind.Expired,
            JourneyKind.Cancelled => JourneyEventKind.Cancelled,
            JourneyKind.Waiting => JourneyEventKind.Waiting,
            JourneyKind.Discarded => JourneyEventKind.Discarded,
            JourneyKind.CancelStored => JourneyEventKind.CancelStored,
            JourneyKind.CancelLate => JourneyEventKind.CancelLate,
            JourneyKind.CancelLateHere => JourneyEventKind.CancelLateHere,
            _ => JourneyEventKind.Ran,
        };

        /// <summary>
        /// Answers a cancel or a send again on the Courier thread, where the network
        /// lives, rather than on the game's main thread. True when the command was
        /// one of the two.
        /// </summary>
        private bool TryHandleUplinkAction(DispatchCommandJob job)
        {
            if (string.Equals(job.Command, UplinkCancelCommand, StringComparison.Ordinal))
            {
                job.OnResult(Cancel(BindCommandArgs(job.Args, typeof(UplinkCancelRequest)) as UplinkCancelRequest, job.Vantage));
                job.Done?.Set();
                return true;
            }
            if (string.Equals(job.Command, UplinkResendCommand, StringComparison.Ordinal))
            {
                job.OnResult(Resend(BindCommandArgs(job.Args, typeof(UplinkResendRequest)) as UplinkResendRequest, job.Vantage));
                job.Done?.Set();
                return true;
            }
            return false;
        }

        private object Cancel(UplinkCancelRequest? request, string vantage)
        {
            if (request == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "This cancel could not be read.");
            }
            if (request.Epoch != _courier.CurrentEpoch)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "That command belongs to an earlier timeline.");
            }
            var lane = new LaneKey(request.Epoch, vantage, request.Craft);
            var cancel = _delivery.Cancel(lane, request.LaneSeq, request.AndBehind, _clock.Now());
            if (cancel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "Nothing it names is still unresolved.");
            }
            return CommandResult<UplinkActionReply>.Ok(new UplinkActionReply { ThroughSeq = cancel.ThroughSeq, ExpiresAtUt = cancel.DeleteAtUt });
        }

        private object Resend(UplinkResendRequest? request, string vantage)
        {
            if (request == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "This send again could not be read.");
            }
            if (request.Epoch != _courier.CurrentEpoch)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "That command belongs to an earlier timeline.");
            }
            var lane = new LaneKey(request.Epoch, vantage, request.Craft);
            var entry = _pending.FirstOrDefault(p =>
                p.LaneSeq == request.LaneSeq
                && string.Equals(p.Vantage, vantage, StringComparison.Ordinal)
                && string.Equals(p.Craft, request.Craft, StringComparison.Ordinal));
            if (!HeldOrOverdue(entry, request, vantage, _clock.Now()))
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "That command is on its way and its reply is not late. It can be sent again once it is held somewhere or overdue.");
            }
            var copy = _delivery.SendAgain(lane, request.LaneSeq, _clock.Now(), NextRequestId());
            if (copy == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "That command is already settled, or too late to send again in its place.");
            }
            if (entry != null)
            {
                entry.Attempts = copy.Attempt;
                entry.ExpiresAtUt = Math.Max(entry.ExpiresAtUt ?? 0.0, copy.DeleteAtUt);
                if (_deliveryJobs.TryGetValue(entry.Id, out var job))
                {
                    _deliveryJobs[copy.Id] = job;
                }
            }
            return CommandResult<UplinkActionReply>.Ok(new UplinkActionReply { ThroughSeq = request.LaneSeq, Id = copy.Id, ExpiresAtUt = copy.DeleteAtUt });
        }

        /// <summary>
        /// Whether a command may be sent again, by what its own centre knows: the
        /// last report to reach the centre says it is held somewhere, or the
        /// reply the centre predicted is late. A command that is on its way and
        /// not yet due is left to arrive.
        /// </summary>
        private bool HeldOrOverdue(PendingUplink? entry, UplinkResendRequest request, string vantage, double now)
        {
            for (var i = _journey.Count - 1; i >= 0; i--)
            {
                var e = _journey[i];
                if (e.LaneSeq != request.LaneSeq
                    || !string.Equals(e.Craft, request.Craft, StringComparison.Ordinal)
                    || !_journeyVantage.TryGetValue(e.Id, out var to)
                    || !string.Equals(to, vantage, StringComparison.Ordinal))
                {
                    continue;
                }
                if (e.Kind == JourneyEventKind.Held)
                {
                    return true;
                }
                break;
            }
            // No prediction at all is a command the centre knew no way to send, which is held where it stands.
            return entry == null || entry.PredictedReplyUt == null || now > entry.PredictedReplyUt.Value;
        }

        /// <summary>Courier thread, before the clock advance: which craft is active on this tick.</summary>
        private void NoteActiveCraft(KspSnapshot? snapshot)
        {
            var active = snapshot != null ? VesselViewProvider.TryGetActiveVesselId(snapshot) : null;
            if (active != null)
            {
                _activeCraftId = "vessel:" + active;
            }
        }

        /// <summary>Courier thread, after the clock advance: sends on whatever can leave, expires and releases.</summary>
        private void TickDelivery(double ut)
        {
            var version = _centrePlansVersion?.Invoke() ?? 0;
            if (version != _seenPlanVersion)
            {
                _seenPlanVersion = version;
                _delivery.PlanChanged();
            }
            _delivery.Tick(ut);
        }

        /// <summary>Whether a game load asked for a new timeline since the last tick.</summary>
        private bool TakeGameLoaded() => Interlocked.Exchange(ref _gameLoaded, 0) == 1;

        /// <summary>A new timeline: drop everything in the network, then restore what a loaded save carried.</summary>
        private void ResetDelivery()
        {
            _delivery.Reset();
            _deliveryJobs.Clear();
            _journey.Clear();
            _journeyVantage.Clear();
            _laneCraftNodes.Clear();
            var carried = Interlocked.Exchange(ref _carriedBySave, null) ?? Interlocked.Exchange(ref _reloadedSave, null);
            if (carried != null)
            {
                _delivery.Restore(carried, _courier.CurrentEpoch);
                var commands = carried.SentCommands
                    .Concat(carried.Held.Select(h => h.Message))
                    .Concat(carried.Flights.Select(f => f.Message))
                    .OfType<CommandMessage>();
                foreach (var command in commands)
                {
                    _laneCraftNodes[command.Lane.Craft] = command.ExecNode;
                }
            }
        }

        /// <summary>
        /// Links as delivery sees them. Between a centre and a craft it has a lane
        /// to, the engine's own ledger decides, so a command with a live path is
        /// timed exactly as a command that is never held; between any other two
        /// nodes, the live link graph.
        /// </summary>
        private sealed class EngineDeliveryLinks : IDeliveryLinks
        {
            private readonly ChannelEngine _engine;

            public EngineDeliveryLinks(ChannelEngine engine) => _engine = engine;

            public double? LivePath(string from, string to)
            {
                if (_engine._laneCraftNodes.TryGetValue(to, out var toNode) && !_engine._laneCraftNodes.ContainsKey(from))
                {
                    return Ledger(from, toNode);
                }
                if (_engine._laneCraftNodes.TryGetValue(from, out var fromNode) && !_engine._laneCraftNodes.ContainsKey(to))
                {
                    return Ledger(to, fromNode);
                }
                var links = _engine._deliveryInputs.Links;
                return GroundNetwork.Shortest(from, to, _engine.HomeCentre(), _engine._activeGroundIds, links.LivePath);
            }

            public double? LiveLink(string from, string to)
            {
                var links = _engine._deliveryInputs.Links;
                return GroundNetwork.Shortest(from, to, _engine.HomeCentre(), _engine._activeGroundIds, links.LiveLink);
            }

            private double? Ledger(string vantage, string node) =>
                _engine.CanSend(vantage, node) ? _engine._network.DelayTo(vantage, node) : (double?)null;
        }
    }
}
