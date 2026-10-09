using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Core.StoreAndForward
{
    /// <summary>What the game reports about links right now. The backend's live network decides what actually gets through.</summary>
    public interface IDeliveryLinks
    {
        /// <summary>The light time of a live path from one node to another right now, relays included, or null when there is none.</summary>
        double? LivePath(string from, string to);

        /// <summary>The light time of a direct live link between two nodes right now, or null when there is none.</summary>
        double? LiveLink(string from, string to);
    }

    /// <summary>
    /// A links source that can also say whether a peer can receive light from a
    /// node that has since turned its dish away. Light already emitted travels on
    /// whatever its sender then aims at, so the landing of a hop sent on a turned
    /// dish is judged on the receiver alone. A links source without it lets such
    /// a hop land.
    /// </summary>
    public interface IReceiveCheck
    {
        /// <summary>Whether <paramref name="to"/> can receive light a node <paramref name="from"/> sent it, with nothing changed on the receiving end.</summary>
        bool PeerCanReceive(string from, string to);
    }

    /// <summary>One hop the contact plan predicts.</summary>
    public readonly struct PlannedHop
    {
        public PlannedHop(
            string to,
            double departUt,
            double arriveUt,
            string? fromDish = null,
            string? toDish = null,
            string? retargetDish = null,
            double turnUt = double.NaN)
        {
            To = to;
            DepartUt = departUt;
            ArriveUt = arriveUt;
            FromDish = fromDish;
            ToDish = toDish;
            RetargetDish = retargetDish;
            TurnUt = turnUt;
        }

        public string To { get; }

        /// <summary>The dish the hop leaves on, when the plan names one.</summary>
        public string? FromDish { get; }

        /// <summary>The dish the light lands on, when the plan names one.</summary>
        public string? ToDish { get; }

        /// <summary>The idle dish of the sending node that must be turned to the next node to carry this hop, or null for a hop on a dish's own aim.</summary>
        public string? RetargetDish { get; }

        /// <summary>When that turn is planned to start, or NaN.</summary>
        public double TurnUt { get; }

        public double DepartUt { get; }

        public double ArriveUt { get; }
    }

    /// <summary>
    /// What each command centre believes: the contact plan it holds, made from
    /// what it has heard. A sender decides when to send from its own, and never
    /// from what the far end of the link is really doing.
    /// </summary>
    public interface ISenderPlans
    {
        /// <summary>
        /// Whether centres plan at all here. False for a network with no contact
        /// planner behind it, which has no belief to send on and sends on the
        /// live path as it always did.
        /// </summary>
        bool Reckons { get; }

        /// <summary>The routes <paramref name="centre"/>'s own plan predicts now, or null when it holds no plan.</summary>
        IDeliveryRoutes? PlanOf(string centre);
    }

    /// <summary>The routes the contact plan predicts.</summary>
    public interface IDeliveryRoutes
    {
        /// <summary>The whole earliest-arrival route from one node to another for a message ready at <paramref name="readyUt"/> that must arrive by <paramref name="deadlineUt"/>, or null when the plan predicts none.</summary>
        /// <param name="turnsOnTheWay">
        /// Whether nodes past <paramref name="from"/> may turn an idle dish for the
        /// message: true for a command or a cancel, which any node holding one
        /// turns a dish for. A reply, a journey report or a span turns none past
        /// the node it starts from; at <paramref name="from"/> itself a route may
        /// always use a dish turned to the next node, which a message rides
        /// whoever started the turn.
        /// </param>
        IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false);
    }

    /// <summary>
    /// The links a network reads, remembering each answer while one sweep over
    /// held messages runs, so a node holding thousands of messages for the same
    /// few peers asks the game once per pair and not once per message. Outside a
    /// sweep every question goes through.
    /// </summary>
    internal sealed class SweepLinks : IDeliveryLinks, IReceiveCheck
    {
        private readonly IDeliveryLinks _inner;
        private readonly Dictionary<(string, string), double?> _paths = new Dictionary<(string, string), double?>();
        private readonly Dictionary<(string, string), double?> _links = new Dictionary<(string, string), double?>();
        private int _depth;

        internal SweepLinks(IDeliveryLinks inner)
        {
            _inner = inner;
        }

        internal void BeginSweep() => _depth++;

        internal void EndSweep()
        {
            if (--_depth == 0)
            {
                _paths.Clear();
                _links.Clear();
            }
        }

        public double? LivePath(string from, string to) => Remember(_paths, from, to, _inner.LivePath);

        public double? LiveLink(string from, string to) => Remember(_links, from, to, _inner.LiveLink);

        public bool PeerCanReceive(string from, string to) => !(_inner is IReceiveCheck check) || check.PeerCanReceive(from, to);

        private double? Remember(Dictionary<(string, string), double?> known, string from, string to, Func<string, string, double?> ask)
        {
            if (_depth == 0)
            {
                return ask(from, to);
            }
            if (!known.TryGetValue((from, to), out var answer))
            {
                answer = ask(from, to);
                known[(from, to)] = answer;
            }
            return answer;
        }
    }

    /// <summary>
    /// Store-and-forward delivery of delayed commands, cancels and reports.
    ///
    /// <para><b>Who decides a departure, and from what.</b> A command centre
    /// sends when its own plan says the way is open, and that is all it knows:
    /// it cannot see whether the far end is really listening. A relay or a craft
    /// follows the plan the message carries, the sending centre's as it stood
    /// when the command left, and sends on when its own link to the next node is
    /// up, which is the one thing it can sense. Nobody reads the state of a link
    /// that is not its own. Whether light that was sent actually lands is physics,
    /// and is asked of the live network when it lands.</para>
    ///
    /// <para><b>Custody.</b> A node that sends keeps its copy until twice the
    /// hop's light time after it left, which is the soonest it could know the
    /// hop failed. Until then the copy can be neither sent again nor stopped:
    /// a cancel pressed in that window goes after the command and says no more
    /// than that it was sent. A hop whose link was gone when the light landed
    /// is caught, the message was never received, and at the end of custody the
    /// copy waits again, never for the same next node until the plan changes.</para>
    ///
    /// <para>A network with no <see cref="ISenderPlans"/> that reckons sends as
    /// it did before centres planned: along the backend's live path when there is
    /// one, or else on the one shared plan's next hop.</para>
    ///
    /// <para>Commands run at the craft in lane order (<see cref="LaneCollector"/>).
    /// A cancel is stored at every node it passes and becomes a permanent mark on
    /// the craft's lane. Every way a command can end is reported back to its
    /// sender as a journey report, routed like any other message.</para>
    ///
    /// <para>One lock guards everything, so a save can snapshot it from another
    /// thread.</para>
    /// </summary>
    public sealed partial class DeliveryNetwork
    {
        /// <summary>The lifetime of every delayed command, in game seconds.</summary>
        public const double CommandLifetimeSeconds = 3600.0;

        private const double Tolerance = 1e-6;

        /// <summary>
        /// How much sooner, in game seconds, a new plan must say a held span
        /// arrives before the span leaves the plan it carries. Plans move a little
        /// every round, and a span that changed route for every small gain would
        /// flap between two nearly equal ways and leave by neither.
        /// </summary>
        public const double SpanRerouteGainSeconds = 60.0;

        private readonly object _gate = new object();
        private readonly IClock _clock;
        private readonly SweepLinks _links;
        private readonly Dictionary<string, double> _spanSweepUt = new Dictionary<string, double>(StringComparer.Ordinal);
        private readonly IDeliveryRoutes _routes;
        private readonly ISenderPlans? _beliefs;
        private readonly Func<CommandMessage, double, object?> _execute;
        private readonly Action<ReportMessage> _deliverReport;
        private readonly Action<SpanMessage, double>? _deliverSpan;
        private readonly Dictionary<string, List<Held>> _held = new Dictionary<string, List<Held>>(StringComparer.Ordinal);
        private readonly List<Flight> _flights = new List<Flight>();
        private readonly Dictionary<string, List<CancelMessage>> _storedCancels = new Dictionary<string, List<CancelMessage>>(StringComparer.Ordinal);
        // What each node has taken in, and when, so a second arrival of the same message is told from the first.
        private readonly Dictionary<string, Dictionary<string, double>> _seen = new Dictionary<string, Dictionary<string, double>>(StringComparer.Ordinal);

        // The copies of each lane number its centre has sent and not yet had word of.
        private readonly Dictionary<(LaneKey Lane, long Seq), HashSet<string>> _copiesOut = new Dictionary<(LaneKey, long), HashSet<string>>();
        private readonly Dictionary<LaneKey, LaneCollector> _collectors = new Dictionary<LaneKey, LaneCollector>();
        private readonly Dictionary<LaneKey, LaneSender> _senders = new Dictionary<LaneKey, LaneSender>();
        private readonly Dictionary<string, CommandMessage> _sentCommands = new Dictionary<string, CommandMessage>(StringComparer.Ordinal);
        private readonly HashSet<string> _leftSender = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<(CommandMessage Command, double AtUt)> _toRun = new List<(CommandMessage, double)>();
        private bool _running;
        private ControlValueRelease _release;
        private long _nextId;
        private int _planVersion;

        /// <param name="clock">The clock each light is scheduled on, so it lands at its own instant rather than at the next tick.</param>
        /// <param name="links">What the game reports about links, asked whenever a message could leave or a light lands.</param>
        /// <param name="routes">What the contact plan predicts.</param>
        /// <param name="execute">Runs a command on its craft and returns the result to report back.</param>
        /// <param name="deliverReport">Takes each report as it reaches its command centre.</param>
        /// <param name="beliefs">What each command centre believes, or null for a network that sends on the live path.</param>
        /// <param name="deliverSpan">Takes each span as it reaches its command centre, with the instant it arrived; null for a network that carries none.</param>
        public DeliveryNetwork(
            IClock clock,
            IDeliveryLinks links,
            IDeliveryRoutes routes,
            Func<CommandMessage, double, object?> execute,
            Action<ReportMessage> deliverReport,
            ControlValueRelease release = ControlValueRelease.RunEvery,
            ISenderPlans? beliefs = null,
            Action<SpanMessage, double>? deliverSpan = null)
        {
            _beliefs = beliefs;
            _deliverSpan = deliverSpan;
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _links = new SweepLinks(links ?? throw new ArgumentNullException(nameof(links)));
            _routes = routes ?? throw new ArgumentNullException(nameof(routes));
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
            _deliverReport = deliverReport ?? throw new ArgumentNullException(nameof(deliverReport));
            _release = release;
        }

        /// <summary>What the craft does with superseded control values.</summary>
        public ControlValueRelease Release
        {
            get { lock (_gate) return _release; }
            set { lock (_gate) _release = value; }
        }

        /// <summary>The plan changed: every hop excluded after a catch may be tried again.</summary>
        public void PlanChanged()
        {
            lock (_gate)
            {
                _planVersion++;
                PlanChangedRetargets();
                foreach (var held in _held.Values.SelectMany(h => h))
                {
                    held.Excluded = null;
                }
                RerouteHeldSpans(_clock.Now());
            }
        }

        /// <summary>
        /// News of <paramref name="node"/> has reached <paramref name="centre"/>:
        /// whatever the centre holds that was caught on its way there may be
        /// tried again. Hearing from a node is the one sign a centre gets that
        /// the node is listening.
        /// </summary>
        public void Heard(string centre, string node)
        {
            lock (_gate)
            {
                if (!_held.TryGetValue(centre, out var list))
                {
                    return;
                }
                foreach (var held in list)
                {
                    held.Excluded?.Remove(node);
                }
            }
        }

        /// <summary>
        /// Sends a delayed command from its lane's command centre: takes the next
        /// lane number and its gap expiry, and puts it on hold at the sender until
        /// it can leave. <paramref name="id"/> names the message, or a fresh id is
        /// minted when it is null. Returns the message as sent.
        /// </summary>
        public CommandMessage SendCommand(
            LaneKey lane,
            string command,
            object? args,
            string execNode,
            string? channel,
            double nowUt,
            double? arriveBeforeUt,
            string? id = null)
        {
            try
            {
                lock (_gate)
                {
                    var deleteAt = nowUt + CommandLifetimeSeconds;
                    if (arriveBeforeUt != null)
                    {
                        deleteAt = Math.Min(deleteAt, arriveBeforeUt.Value);
                    }
                    var (seq, gap) = Sender(lane).Assign(nowUt, deleteAt);
                    var message = new CommandMessage
                    {
                        Id = id ?? MintId("cmd"),
                        Lane = lane,
                        LaneSeq = seq,
                        GapExpiresUt = gap,
                        SentUt = nowUt,
                        DeleteAtUt = deleteAt,
                        Command = command,
                        Args = args,
                        ExecNode = execNode,
                        Channel = channel,
                    };
                    _sentCommands[message.Id] = message;
                    CopiesOut(lane, seq).Add(message.Id);
                    Hold(lane.Vantage, message, nowUt, null);
                    Depart(lane.Vantage, nowUt);
                    return message;
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>
        /// Sends a lane number again, in its own place: a new copy of the command
        /// with the same lane number and a fresh lifetime, which must arrive before
        /// the commands behind it stop waiting for it. Null when the number is
        /// unknown or already settled at the sender. <paramref name="id"/> names
        /// the copy, or a fresh id is minted when it is null.
        /// </summary>
        public CommandMessage? SendAgain(LaneKey lane, long seq, double nowUt, string? id = null)
        {
            try
            {
                lock (_gate)
                {
                    var sender = Sender(lane);
                    var original = _sentCommands.Values
                        .Where(c => c.Lane.Equals(lane) && c.LaneSeq == seq)
                        .OrderByDescending(c => c.Attempt)
                        .FirstOrDefault();
                    if (original == null || !sender.IsUnresolved(seq))
                    {
                        return null;
                    }
                    var deleteAt = Math.Min(nowUt + CommandLifetimeSeconds, original.DeleteAtUt);
                    if (deleteAt <= nowUt)
                    {
                        return null;
                    }
                    var copy = new CommandMessage
                    {
                        Id = id ?? MintId("cmd"),
                        Lane = lane,
                        LaneSeq = seq,
                        GapExpiresUt = sender.GapBefore(seq, nowUt),
                        SentUt = nowUt,
                        DeleteAtUt = deleteAt,
                        Command = original.Command,
                        Args = original.Args,
                        ExecNode = original.ExecNode,
                        Channel = original.Channel,
                        Attempt = original.Attempt + 1,
                    };
                    sender.AddCopy(seq, deleteAt);
                    _sentCommands[copy.Id] = copy;
                    CopiesOut(lane, seq).Add(copy.Id);
                    Hold(lane.Vantage, copy, nowUt, null);
                    Depart(lane.Vantage, nowUt);
                    return copy;
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>
        /// Cancels lane number <paramref name="seq"/>, or it and every later number
        /// the sender has assigned so far. Anything still at the sender is stopped
        /// at once; for the rest a cancel goes to the craft by its own fastest
        /// route, with a second copy to any predicted hold it can reach before the
        /// command leaves it. Returns the cancel, or null when nothing it names is
        /// still unresolved.
        /// </summary>
        public CancelMessage? Cancel(LaneKey lane, long seq, bool andBehind, double nowUt)
        {
            try
            {
                lock (_gate)
                {
                    var sender = Sender(lane);
                    var through = andBehind ? Math.Max(seq, sender.NewestSeq) : seq;
                    var named = sender.Unresolved.Where(e => e.Key >= seq && e.Key <= through).ToList();
                    if (named.Count == 0)
                    {
                        return null;
                    }
                    var cancel = new CancelMessage
                    {
                        Id = MintId("cancel"),
                        Lane = lane,
                        FromSeq = seq,
                        ThroughSeq = through,
                        SentUt = nowUt,
                        DeleteAtUt = named.Max(e => e.Value),
                    };

                    // The sender is local to the operator: anything still here stops now.
                    // Whether a copy ever left is the sender's own knowledge, so when
                    // none did there is nothing anywhere else to chase.
                    var anyLeft = false;
                    foreach (var entry in named)
                    {
                        StopHeld(lane.Vantage, lane, entry.Key, nowUt);
                        anyLeft |= _sentCommands.Values.Any(c => c.Lane.Equals(lane) && c.LaneSeq == entry.Key && _leftSender.Contains(c.Id));
                    }
                    if (!anyLeft)
                    {
                        return cancel;
                    }

                    StoreCancel(lane.Vantage, cancel);
                    Hold(lane.Vantage, cancel, nowUt, null);
                    SendSecondCopies(cancel, nowUt);
                    Depart(lane.Vantage, nowUt);
                    return cancel;
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>Advances the network to <paramref name="nowUt"/>: lands every light due, expires what has outlived its lifetime, releases gaps and sends on whatever can leave.</summary>
        public void Tick(double nowUt)
        {
            try
            {
                lock (_gate)
                {
                    Expire(nowUt);
                    foreach (var collector in _collectors.Values.ToList())
                    {
                        collector.Tick(nowUt);
                    }
                    foreach (var node in _held.Keys.ToList())
                    {
                        Depart(node, nowUt);
                    }
                    TickRetargets(nowUt);
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>
        /// Puts a span on hold at <paramref name="node"/>, the node whose history
        /// it carries, to leave for its centre by the plan that centre holds as it
        /// stands now. It goes the moment that node's own link to the next hop is
        /// up, and otherwise waits.
        /// </summary>
        public void AddSpan(string node, SpanMessage span)
        {
            lock (_gate)
            {
                var nowUt = _clock.Now();
                span.Id = MintId("span");
                span.Plan = PlanAt(span.Centre);
                var held = Hold(node, span, nowUt, null);
                if (held == null)
                {
                    return;
                }
                // The first span added to a node at an instant sends on everything
                // the node holds; the rest of that instant's batch sends only itself.
                var swept = _spanSweepUt.TryGetValue(node, out var sweptUt) && sweptUt == nowUt;
                _spanSweepUt[node] = nowUt;
                Depart(node, nowUt, swept ? held : null);
            }
        }

        /// <summary>
        /// A held span takes up its centre's plan as it stands now when that plan
        /// gets it there <see cref="SpanRerouteGainSeconds"/> sooner than the plan
        /// it carries, or gets it there at all where the carried plan does not. A
        /// node holds a span for the way it was told, and a way that has opened
        /// since is one it could not otherwise know. One route is worked out per
        /// node and centre, however many spans wait there.
        /// </summary>
        private void RerouteHeldSpans(double nowUt)
        {
            var fresh = new Dictionary<(string Node, string Centre), (IDeliveryRoutes? Plan, IReadOnlyList<PlannedHop>? Route)>();
            foreach (var entry in _held)
            {
                foreach (var held in entry.Value)
                {
                    if (held.Away != null || !(held.Message is SpanMessage span))
                    {
                        continue;
                    }
                    var key = (entry.Key, span.Centre);
                    if (!fresh.TryGetValue(key, out var now))
                    {
                        var plan = PlanAt(span.Centre);
                        now = (plan, plan?.Route(entry.Key, span.Centre, nowUt, double.PositiveInfinity));
                        fresh[key] = now;
                    }
                    if (now.Plan == null || now.Route == null || now.Route.Count == 0)
                    {
                        continue;
                    }
                    var carried = span.Plan?.Route(entry.Key, span.Centre, nowUt, double.PositiveInfinity);
                    var carriedArrival = carried == null || carried.Count == 0 ? double.PositiveInfinity : carried[carried.Count - 1].ArriveUt;
                    if (now.Route[now.Route.Count - 1].ArriveUt + SpanRerouteGainSeconds < carriedArrival)
                    {
                        span.Plan = now.Plan;
                        span.Route = now.Route.ToList();
                    }
                }
            }
        }

        /// <summary>The bytes of every span payload held at a node, a copy in custody of a hop included, each payload once however many spans carry it.</summary>
        public long HeldSpanBytes()
        {
            lock (_gate)
            {
                var seen = new HashSet<SpanPayload>();
                long total = 0;
                foreach (var held in _held.Values.SelectMany(h => h))
                {
                    if (held.Message is SpanMessage span)
                    {
                        foreach (var sample in span.Samples)
                        {
                            if (seen.Add(sample.Payload))
                            {
                                total += sample.Payload.Bytes;
                            }
                        }
                    }
                }
                return total;
            }
        }

        /// <summary>
        /// Drops the oldest samples of the spans held at nodes, across every span,
        /// until at least <paramref name="bytes"/> are freed or nothing is left to
        /// drop, and says what went. A span in custody of a hop is on its way and
        /// stays. A span emptied is let go.
        /// </summary>
        public IReadOnlyList<SpanShed> ShedSpans(long bytes)
        {
            lock (_gate)
            {
                var shed = new List<SpanShed>();
                long freed = 0;
                while (freed < bytes)
                {
                    SpanMessage? oldest = null;
                    string? at = null;
                    Held? oldestHeld = null;
                    var oldestUt = double.PositiveInfinity;
                    foreach (var entry in _held)
                    {
                        foreach (var held in entry.Value)
                        {
                            if (held.Away == null && held.Message is SpanMessage span && span.Samples.Count > 0 && span.Samples[0].Ut < oldestUt)
                            {
                                oldestUt = span.Samples[0].Ut;
                                oldest = span;
                                at = entry.Key;
                                oldestHeld = held;
                            }
                        }
                    }
                    if (oldest == null)
                    {
                        break;
                    }

                    var dropped = oldest.Samples[0];
                    oldest.Samples.RemoveAt(0);
                    oldest.StartsAfterAHole = true;
                    dropped.Payload.Carriers--;
                    if (dropped.Payload.Carriers <= 0)
                    {
                        freed += dropped.Payload.Bytes;
                    }
                    shed.Add(new SpanShed(oldest.Craft, oldest.Centre, oldest.Topic, dropped.Ut, dropped.Payload));
                    if (oldest.Samples.Count == 0)
                    {
                        _held[at!].Remove(oldestHeld!);
                        oldestHeld!.EndWatch?.Invoke();
                        oldestHeld.CancelWake?.Invoke();
                    }
                }
                return shed;
            }
        }

        /// <summary>The instant the oldest sample of any span held at a node describes, or null when none is held.</summary>
        public double? OldestHeldSpanUt()
        {
            lock (_gate)
            {
                double? oldest = null;
                foreach (var held in _held.Values.SelectMany(h => h))
                {
                    if (held.Away == null && held.Message is SpanMessage span && span.Samples.Count > 0 && (oldest == null || span.Samples[0].Ut < oldest))
                    {
                        oldest = span.Samples[0].Ut;
                    }
                }
                return oldest;
            }
        }

        /// <summary>
        /// Lets go of every span held at <paramref name="node"/>, a craft that no
        /// longer exists and took its history with it, and returns the payloads
        /// that lost a carrier. Spans already handed on stay with their holders.
        /// </summary>
        public IReadOnlyList<SpanPayload> DiscardSpansHeldAt(string node)
        {
            lock (_gate)
            {
                var freed = new List<SpanPayload>();
                if (!_held.TryGetValue(node, out var list))
                {
                    return freed;
                }
                foreach (var held in list.Where(h => h.Away == null && h.Message is SpanMessage).ToList())
                {
                    list.Remove(held);
                    held.EndWatch?.Invoke();
                    held.CancelWake?.Invoke();
                    foreach (var sample in ((SpanMessage)held.Message).Samples)
                    {
                        sample.Payload.Carriers--;
                        freed.Add(sample.Payload);
                    }
                }
                return freed;
            }
        }

        /// <summary>The spans held at nodes and in flight, for tests and diagnostics.</summary>
        public IReadOnlyList<(string Node, SpanMessage Span, bool InFlight)> Spans()
        {
            lock (_gate)
            {
                var spans = _held
                    .SelectMany(n => n.Value.Where(h => h.Away == null && h.Message is SpanMessage).Select(h => (n.Key, (SpanMessage)h.Message, false)))
                    .ToList();
                spans.AddRange(_flights.Where(f => f.Message is SpanMessage).Select(f => (f.To, (SpanMessage)f.Message, true)));
                return spans;
            }
        }

        /// <summary>Everything held, in flight, stored and settled, for saving with the game.</summary>
        public DeliverySnapshot Snapshot()
        {
            lock (_gate)
            {
                return new DeliverySnapshot
                {
                    // A copy whose light is still on its way is saved once, as its
                    // flight, which restores both. One whose light has landed or
                    // been lost is saved as the custody it still is.
                    Held = _held.SelectMany(n => n.Value
                        .Where(h => !(h.Message is SpanMessage))
                        .Where(h => h.Away == null || !_flights.Any(f => ReferenceEquals(f.Custody, h)))
                        .Select(h => new HeldRecord
                        {
                            Node = n.Key,
                            Message = h.Message,
                            ArrivedUt = h.ArrivedUt,
                            EligibleUt = h.EligibleUt,
                            ReportedHeld = h.ReportedHeld,
                            CameFrom = h.CameFrom,
                            Away = h.Away,
                            CustodyUntilUt = h.Away == null ? (double?)null : h.CustodyUntilUt,
                            Landed = h.Landed,
                            Excluded = h.Excluded == null ? null : h.Excluded.ToList(),
                        })).ToList(),
                    Flights = _flights.Where(f => !(f.Message is SpanMessage)).Select(f => new FlightRecord
                    {
                        Message = f.Message,
                        From = f.From,
                        To = f.To,
                        DepartUt = f.DepartUt,
                        ArriveUt = f.ArriveUt,
                        EndToEnd = f.EndToEnd,
                        ReportedHeld = f.Custody != null && f.Custody.ReportedHeld,
                        ToDish = f.ToDish,
                        Retargeted = f.Retargeted,
                    }).ToList(),
                    StoredCancels = _storedCancels.SelectMany(n => n.Value.Select(c => new StoredCancelRecord { Node = n.Key, Cancel = c })).ToList(),
                    Senders = _senders.Select(s => new SenderRecord { Lane = s.Key, NextSeq = s.Value.NextSeq, Unresolved = s.Value.Unresolved.ToList() }).ToList(),
                    Collectors = _collectors.Select(c => new CollectorRecord
                    {
                        Lane = c.Key,
                        Next = c.Value.Next,
                        Cancelled = c.Value.Cancelled.ToList(),
                        Ran = c.Value.Ran.ToList(),
                        Waiting = c.Value.Waiting.Values.ToList(),
                        Expired = c.Value.Expired.ToList(),
                        Scheduled = c.Value.Scheduled.Select(d => new ScheduledRecord { Command = d.Command, AtUt = d.AtUt }).ToList(),
                        LastRunUt = c.Value.Cadence.RunUt,
                        LastSentUt = c.Value.Cadence.SentUt,
                    }).ToList(),
                    SentCommands = _sentCommands.Values.ToList(),
                    NextId = _nextId,
                    Retargets = SnapshotRetargets(),
                };
            }
        }

        /// <summary>Drops everything: a new timeline.</summary>
        public void Reset()
        {
            lock (_gate)
            {
                foreach (var held in _held.Values.SelectMany(h => h))
                {
                    held.EndWatch?.Invoke();
                    held.CancelWake?.Invoke();
                }
                _held.Clear();
                foreach (var flight in _flights)
                {
                    flight.Cancel?.Invoke();
                }
                _flights.Clear();
                _storedCancels.Clear();
                _seen.Clear();
                _copiesOut.Clear();
                _collectors.Clear();
                _senders.Clear();
                _sentCommands.Clear();
                _leftSender.Clear();
                ResetRetargets();
            }
        }

        /// <summary>
        /// Replaces everything with what a save carried, moved into the timeline
        /// <paramref name="epoch"/>: every load is a new timeline, and the messages
        /// it carried belong to it.
        /// </summary>
        public void Restore(DeliverySnapshot snapshot, long epoch)
        {
            try
            {
                lock (_gate)
                {
                    Reset();
                    LaneKey Move(LaneKey lane) => new LaneKey(epoch, lane.Vantage, lane.Craft);
                    DeliveryMessage Rekey(DeliveryMessage message)
                    {
                        switch (message)
                        {
                            case CommandMessage c:
                                c.Lane = Move(c.Lane);
                                break;
                            case CancelMessage x:
                                x.Lane = Move(x.Lane);
                                break;
                            case ReportMessage r:
                                r.Lane = Move(r.Lane);
                                break;
                        }
                        return message;
                    }
                    foreach (var record in snapshot.Held)
                    {
                        var held = new Held(Rekey(record.Message), record.ArrivedUt, record.CameFrom)
                        {
                            EligibleUt = record.EligibleUt,
                            ReportedHeld = record.ReportedHeld,
                            Away = record.Away,
                            CustodyUntilUt = record.CustodyUntilUt ?? 0.0,
                            Landed = record.Landed,
                            Excluded = record.Excluded == null ? null : new HashSet<string>(record.Excluded, StringComparer.Ordinal),
                            ExcludedAtPlan = _planVersion,
                        };
                        List(_held, record.Node).Add(held);
                        if (held.Away != null)
                        {
                            WatchCustody(record.Node, held);
                        }
                    }
                    foreach (var record in snapshot.Flights)
                    {
                        var message = Rekey(record.Message);
                        var custody = new Held(message, record.DepartUt, null)
                        {
                            Away = record.To,
                            CustodyUntilUt = record.DepartUt + (2 * (record.ArriveUt - record.DepartUt)),
                            ReportedHeld = record.ReportedHeld,
                        };
                        List(_held, record.From).Add(custody);
                        Fly(new Flight(message, record.From, record.To, record.DepartUt, record.ArriveUt, record.EndToEnd) { Custody = custody, ToDish = record.ToDish, Retargeted = record.Retargeted });
                        WatchCustody(record.From, custody);
                    }
                    foreach (var stored in snapshot.StoredCancels)
                    {
                        List(_storedCancels, stored.Node).Add((CancelMessage)Rekey(stored.Cancel));
                    }
                    foreach (var sender in snapshot.Senders)
                    {
                        _senders[Move(sender.Lane)] = LaneSender.Restore(sender.NextSeq, sender.Unresolved);
                    }
                    foreach (var record in snapshot.Collectors)
                    {
                        var lane = Move(record.Lane);
                        var collector = NewCollector(lane);
                        collector.Restore(
                            record.Next,
                            record.Cancelled,
                            record.Ran,
                            record.Waiting.Select(w => (CommandMessage)Rekey(w)),
                            record.Expired,
                            record.Scheduled.Select(d => ((CommandMessage)Rekey(d.Command), d.AtUt)),
                            (record.LastRunUt, record.LastSentUt));
                        _collectors[lane] = collector;
                    }
                    foreach (var sent in snapshot.SentCommands)
                    {
                        _sentCommands[sent.Id] = (CommandMessage)Rekey(sent);
                    }
                    foreach (var sent in _sentCommands.Values)
                    {
                        var atSender = _held.TryGetValue(sent.Lane.Vantage, out var waiting) && waiting.Any(h => h.Away == null && h.Message.Id == sent.Id);
                        if (!atSender)
                        {
                            _leftSender.Add(sent.Id);
                        }
                    }
                    // A copy the save still held somewhere is one its centre has had no last word of.
                    var stillOut = snapshot.Held.Select(h => h.Message)
                        .Concat(snapshot.Flights.Select(f => f.Message))
                        .Concat(snapshot.Collectors.SelectMany(c => c.Waiting))
                        .Concat(snapshot.Collectors.SelectMany(c => c.Scheduled.Select(d => d.Command)))
                        .OfType<CommandMessage>();
                    foreach (var copy in stillOut)
                    {
                        CopiesOut(copy.Lane, copy.LaneSeq).Add(copy.Id);
                    }
                    _nextId = Math.Max(_nextId, snapshot.NextId);
                    RestoreRetargets(snapshot.Retargets ?? new RetargetSnapshot(), _clock.Now());
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>Whether <paramref name="id"/> names a command this network has sent and still keeps.</summary>
        public bool Carries(string id)
        {
            lock (_gate)
            {
                return _sentCommands.ContainsKey(id);
            }
        }

        /// <summary>Where every message is right now, for tests and diagnostics.</summary>
        public IReadOnlyList<(string Node, DeliveryMessage Message)> HeldMessages()
        {
            lock (_gate)
            {
                return _held.SelectMany(n => n.Value.Where(h => h.Away == null).Select(h => (n.Key, h.Message))).ToList();
            }
        }

        /// <summary>Every copy a node has sent and still keeps, not yet knowing whether it was received, for tests and diagnostics.</summary>
        public IReadOnlyList<(string Node, string To, DeliveryMessage Message, double UntilUt)> InCustody()
        {
            lock (_gate)
            {
                return _held.SelectMany(n => n.Value.Where(h => h.Away != null).Select(h => (n.Key, h.Away!, h.Message, h.CustodyUntilUt))).ToList();
            }
        }

        /// <summary>Every light on its way, for tests and diagnostics.</summary>
        public IReadOnlyList<(string From, string To, DeliveryMessage Message, double ArriveUt)> InFlight()
        {
            lock (_gate)
            {
                return _flights.Select(f => (f.From, f.To, f.Message, f.ArriveUt)).ToList();
            }
        }

        /// <summary>
        /// Runs <paramref name="action"/> under the lock, then runs every command it
        /// released OUTSIDE the lock, reporting each reply as its result comes back.
        /// A command's handler can wait on another thread, which must be free to
        /// take the lock meanwhile.
        /// </summary>
        private void Locked(Action action)
        {
            lock (_gate)
            {
                action();
            }
            RunQueued();
        }

        private void RunQueued()
        {
            RunActuations();
            RunQueuedCommands();
            RunActuations();
        }

        private void RunQueuedCommands()
        {
            while (true)
            {
                (CommandMessage Command, double AtUt) next;
                lock (_gate)
                {
                    if (_running || _toRun.Count == 0)
                    {
                        return;
                    }
                    next = _toRun[0];
                    _toRun.RemoveAt(0);
                    _running = true;
                }
                object? result;
                try
                {
                    result = _execute(next.Command, next.AtUt);
                }
                finally
                {
                    lock (_gate)
                    {
                        _running = false;
                    }
                }
                lock (_gate)
                {
                    var reply = new ReportMessage
                    {
                        Id = MintId("report"),
                        To = next.Command.Lane.Vantage,
                        Kind = JourneyKind.Reply,
                        About = next.Command.Id,
                        Lane = next.Command.Lane,
                        LaneSeq = next.Command.LaneSeq,
                        At = next.Command.Lane.Craft,
                        AtUt = next.AtUt,
                        Result = result,
                        Plan = next.Command.Plan,
                    };
                    Route(next.Command.Lane.Craft, reply, next.AtUt);
                    Depart(next.Command.Lane.Craft, next.AtUt);
                }
            }
        }

        /// <summary>
        /// The light arrives. Whether it is received is physics, asked of the live
        /// network now: a hop whose link is gone is caught, and nothing happens
        /// here, since the node that sent it cannot know yet. It learns when its
        /// custody ends.
        /// </summary>
        private void Land(Flight flight)
        {
            var stillLinked = string.Equals(flight.From, flight.To, StringComparison.Ordinal)
                || (flight.EndToEnd
                    ? _links.LivePath(flight.From, flight.To) != null
                    : _links.LiveLink(flight.From, flight.To) != null);
            if (!stillLinked && flight.Retargeted)
            {
                // The sender has put its dish back since: the light left on the turned one and travels on.
                stillLinked = !(_links is IReceiveCheck check) || check.PeerCanReceive(flight.From, flight.To);
            }
            if (!stillLinked)
            {
                return;
            }
            if (flight.Custody != null)
            {
                flight.Custody.Landed = true;
            }
            Deliver(flight.To, flight.Message, flight.ArriveUt, flight.From);
        }

        private void Deliver(string node, DeliveryMessage message, double atUt, string? cameFrom)
        {
            // A node acts once on a message that is for it. One only passing
            // through, come round again because the plan changed under it, is held
            // again like any other arrival: dropped here it would be gone, with the
            // node that sent it sure it had been received.
            var seen = SeenAt(node);
            var again = seen.ContainsKey(message.Id);
            seen[message.Id] = atUt;
            if (again && (IsFor(node, message) || IsHeldAt(node, message.Id)))
            {
                return;
            }
            switch (message)
            {
                case CommandMessage command:
                    DeliverCommand(node, command, atUt, cameFrom);
                    break;
                case CancelMessage cancel:
                    DeliverCancel(node, cancel, atUt, cameFrom);
                    break;
                case ReportMessage report:
                    if (string.Equals(node, report.To, StringComparison.Ordinal))
                    {
                        report.LandedUt = atUt;
                        Settle(report);
                        _deliverReport(report);
                    }
                    else
                    {
                        Hold(node, report, atUt, cameFrom);
                    }
                    break;
                case SpanMessage span:
                    if (string.Equals(node, span.Centre, StringComparison.Ordinal))
                    {
                        _deliverSpan?.Invoke(span, atUt);
                    }
                    else
                    {
                        Hold(node, span, atUt, cameFrom);
                    }
                    break;
            }
        }

        private void DeliverCommand(string node, CommandMessage command, double atUt, string? cameFrom)
        {
            if (atUt > command.DeleteAtUt)
            {
                Report(node, command, JourneyKind.Expired, atUt);
                return;
            }
            if (StoredCancelFor(node, command) != null)
            {
                Report(node, command, JourneyKind.Cancelled, atUt);
                return;
            }
            if (string.Equals(node, command.Destination, StringComparison.Ordinal))
            {
                Collector(command.Lane).Arrive(command, atUt);
                return;
            }
            Hold(node, command, atUt, cameFrom);
        }

        private void DeliverCancel(string node, CancelMessage cancel, double atUt, string? cameFrom)
        {
            if (string.Equals(node, cancel.Destination, StringComparison.Ordinal))
            {
                Collector(cancel.Lane).Cancel(cancel, atUt);
                return;
            }
            StoreCancel(node, cancel);
            for (var seq = cancel.FromSeq; seq <= cancel.ThroughSeq; seq++)
            {
                StopHeld(node, cancel.Lane, seq, atUt);
                foreach (var flight in _flights.Where(f => f.Message is CommandMessage c && c.Lane.Equals(cancel.Lane) && c.LaneSeq == seq
                                                           && string.Equals(f.From, node, StringComparison.Ordinal)).ToList())
                {
                    // Left already: follow it to where it lands, where it may still be held.
                    var command = (CommandMessage)flight.Message;
                    Report(node, command, JourneyKind.CancelLateHere, atUt, detail: "departed " + flight.DepartUt.ToString(System.Globalization.CultureInfo.InvariantCulture), until: flight.DepartUt);
                    var copy = CopyOf(cancel, flight.To);
                    Hold(node, copy, atUt, cameFrom);
                }
            }
            if (cancel.TargetNode == null || !string.Equals(cancel.TargetNode, node, StringComparison.Ordinal))
            {
                Hold(node, cancel, atUt, cameFrom);
            }
        }

        /// <summary>Whether <paramref name="node"/> is where <paramref name="message"/> is going: the craft for a command, the craft or the node it is aimed at for a cancel, the centre for a report.</summary>
        private static bool IsFor(string node, DeliveryMessage message) =>
            string.Equals(node, message.Destination, StringComparison.Ordinal)
            || (message is CancelMessage cancel && cancel.TargetNode != null && string.Equals(node, cancel.TargetNode, StringComparison.Ordinal));

        private bool IsHeldAt(string node, string id) =>
            _held.TryGetValue(node, out var list) && list.Any(h => string.Equals(h.Message.Id, id, StringComparison.Ordinal));

        private HashSet<string> CopiesOut(LaneKey lane, long seq)
        {
            if (!_copiesOut.TryGetValue((lane, seq), out var copies))
            {
                copies = new HashSet<string>(StringComparer.Ordinal);
                _copiesOut[(lane, seq)] = copies;
            }
            return copies;
        }

        /// <summary>Stops every copy of lane number <paramref name="seq"/> held at <paramref name="node"/>. True when the node held one.</summary>
        private bool StopHeld(string node, LaneKey lane, long seq, double atUt)
        {
            if (!_held.TryGetValue(node, out var list))
            {
                return false;
            }
            // A copy in custody is on its way: this node cannot stop what it has
            // already sent, and does not yet know whether it was received.
            var stopped = list.Where(h => h.Away == null && h.Message is CommandMessage c && c.Lane.Equals(lane) && c.LaneSeq == seq).ToList();
            foreach (var held in stopped)
            {
                list.Remove(held);
                Report(node, (CommandMessage)held.Message, JourneyKind.Cancelled, atUt);
            }
            return stopped.Count > 0;
        }

        /// <summary>
        /// A second copy of the cancel to each predicted hold of a command it names
        /// that it can reach before the command leaves, and that is not on its own
        /// route to the craft.
        /// </summary>
        private void SendSecondCopies(CancelMessage cancel, double nowUt)
        {
            var plan = PlanAt(cancel.Lane.Vantage);
            if (plan == null)
            {
                return;
            }
            var own = plan.Route(cancel.Lane.Vantage, cancel.Lane.Craft, nowUt, cancel.DeleteAtUt, turnsOnTheWay: true);
            var onOwnRoute = new HashSet<string>(own?.Select(h => h.To) ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            var targets = new HashSet<string>(StringComparer.Ordinal);
            foreach (var command in _sentCommands.Values.Where(c => c.Lane.Equals(cancel.Lane) && cancel.Names(c.LaneSeq)))
            {
                var predicted = plan.Route(cancel.Lane.Vantage, cancel.Lane.Craft, command.SentUt, command.DeleteAtUt, turnsOnTheWay: true);
                if (predicted == null)
                {
                    continue;
                }
                for (var i = 0; i < predicted.Count - 1; i++)
                {
                    var holdAt = predicted[i].To;
                    var leaves = predicted[i + 1].DepartUt;
                    if (leaves <= predicted[i].ArriveUt + Tolerance || onOwnRoute.Contains(holdAt) || !targets.Add(holdAt))
                    {
                        continue;
                    }
                    var toHold = plan.Route(cancel.Lane.Vantage, holdAt, nowUt, leaves, turnsOnTheWay: true);
                    if (toHold != null && toHold.Count > 0 && toHold[toHold.Count - 1].ArriveUt <= leaves)
                    {
                        Hold(cancel.Lane.Vantage, CopyOf(cancel, holdAt), nowUt, null);
                    }
                }
            }
        }

        private CancelMessage CopyOf(CancelMessage cancel, string target) => new CancelMessage
        {
            Id = cancel.Id + "@" + target,
            Lane = cancel.Lane,
            FromSeq = cancel.FromSeq,
            ThroughSeq = cancel.ThroughSeq,
            SentUt = cancel.SentUt,
            DeleteAtUt = cancel.DeleteAtUt,
            TargetNode = target,
            Plan = cancel.Plan,
        };

        private void Depart(string node, double nowUt, Held? only = null)
        {
            if (!_held.TryGetValue(node, out var list) || list.Count == 0)
            {
                return;
            }
            _links.BeginSweep();
            try
            {
                Depart(node, list, nowUt, only);
            }
            finally
            {
                _links.EndSweep();
            }
        }

        private void Depart(string node, List<Held> list, double nowUt, Held? only)
        {
            foreach (var held in only != null ? new List<Held> { only } : list.OrderBy(Order).ToList())
            {
                if (held.Away != null || nowUt < held.EligibleUt)
                {
                    continue;
                }
                var message = held.Message;
                var successor = _release == ControlValueRelease.LatestWins && message is CommandMessage value && value.Channel != null
                    ? list.Where(other => other.Away == null).Select(other => other.Message).OfType<CommandMessage>()
                        .Where(later => later.Lane.Equals(value.Lane) && later.LaneSeq > value.LaneSeq && string.Equals(later.Channel, value.Channel, StringComparison.Ordinal))
                        .OrderBy(later => later.LaneSeq)
                        .FirstOrDefault()
                    : null;
                if (successor != null && message is CommandMessage superseded)
                {
                    list.Remove(held);
                    successor.Supersedes.Add(superseded.LaneSeq);
                    successor.Supersedes.AddRange(superseded.Supersedes);
                    Report(node, superseded, JourneyKind.Discarded, nowUt, detail: "superseded by a later " + superseded.Channel + " value");
                    continue;
                }
                var destination = message is CancelMessage c && c.TargetNode != null ? c.TargetNode : message.Destination;
                if (held.ExcludedAtPlan != _planVersion)
                {
                    held.Excluded = null;
                }

                var waitsUntil = Reckoning
                    ? LeaveOnBelief(node, held, destination, nowUt)
                    : LeaveOnTheLivePath(node, held, destination, nowUt);
                if (held.Away != null)
                {
                    continue;
                }
                if (!held.ReportedHeld && message is CommandMessage command)
                {
                    held.ReportedHeld = true;
                    Report(node, command, JourneyKind.Held, nowUt, until: waitsUntil);
                }
                WakeAt(node, held, waitsUntil, nowUt);
            }
        }

        /// <summary>
        /// Has a message that is waiting for a window looked again at the instant
        /// the window is planned to open, rather than at whichever tick comes
        /// next. Under warp a tick spans many seconds, and a window shorter than
        /// that opens and shuts between two of them.
        /// </summary>
        private void WakeAt(string node, Held held, double? opensUt, double nowUt)
        {
            if (opensUt == null || opensUt.Value <= nowUt + Tolerance || held.WakeUt == opensUt.Value)
            {
                return;
            }
            held.CancelWake?.Invoke();
            var at = opensUt.Value;
            held.WakeUt = at;
            held.CancelWake = _clock.Schedule(at, () => Locked(() =>
            {
                held.WakeUt = double.NaN;
                held.CancelWake = null;
                if (_held.TryGetValue(node, out var waiting) && waiting.Contains(held))
                {
                    Depart(node, at);
                }
            }));
        }

        /// <summary>Whether command centres here plan from what they have heard, and send on that.</summary>
        private bool Reckoning => _beliefs != null && _beliefs.Reckons;

        /// <summary>The plan a command centre sends by: its own when centres plan, the one shared plan when they do not.</summary>
        private IDeliveryRoutes? PlanAt(string centre) => Reckoning ? _beliefs!.PlanOf(centre) : _routes;

        /// <summary>
        /// Sends <paramref name="held"/> on if the backend has a live path to its
        /// destination, or else on the shared plan's next hop when that link is
        /// live. Returns when the plan next expects it to leave, for a message
        /// that stays.
        /// </summary>
        private double? LeaveOnTheLivePath(string node, Held held, string destination, double nowUt)
        {
            var message = held.Message;
            var live = _links.LivePath(node, destination);
            if (live != null && nowUt + live.Value <= message.ExpiresUt && !IsExcluded(held, destination))
            {
                Launch(node, held, destination, nowUt, live.Value, endToEnd: true);
                return null;
            }

            var route = _routes.Route(node, destination, nowUt, message.ExpiresUt);
            var next = route != null && route.Count > 0 ? route[0] : (PlannedHop?)null;
            if (next != null && next.Value.DepartUt <= nowUt + Tolerance && !IsExcluded(held, next.Value.To))
            {
                var light = _links.LiveLink(node, next.Value.To);
                if (light != null && nowUt + light.Value <= message.ExpiresUt)
                {
                    Launch(node, held, next.Value.To, nowUt, light.Value, endToEnd: false);
                }
            }
            return next?.DepartUt;
        }

        /// <summary>
        /// Sends <paramref name="held"/> on if whoever holds it believes it can
        /// go. A command centre sending its own command or cancel goes by its own
        /// plan as it stands now and by nothing else. Any other node goes by the
        /// plan the message carries, and only when its own link to the next node
        /// is up. Returns when the plan next expects it to leave, for a message
        /// that stays.
        /// </summary>
        private double? LeaveOnBelief(string node, Held held, string destination, double nowUt)
        {
            var message = held.Message;
            if (string.Equals(node, destination, StringComparison.Ordinal))
            {
                // A centre aboard the craft it is commanding is no distance from it.
                Launch(node, held, destination, nowUt, 0.0, endToEnd: true);
                return null;
            }
            var own = IsItsOwnCentre(node, message);
            if (own)
            {
                message.Plan = _beliefs!.PlanOf(node);
            }
            if (message is SpanMessage && !IsExcluded(held, destination))
            {
                // A craft that has a path to the centre right now sends its history
                // down it, whatever the plan expected, as one flight with the
                // light time the path really has.
                var live = _links.LivePath(node, destination);
                if (live != null)
                {
                    Launch(node, held, destination, nowUt, live.Value, endToEnd: true);
                    return null;
                }
            }

            var turnsOnTheWay = message is CommandMessage || message is CancelMessage;
            var route = message.Plan?.Route(node, destination, nowUt, message.ExpiresUt, turnsOnTheWay);
            if ((route == null || route.Count == 0) && !own && message.Plan == null)
            {
                route = CarriedFrom(message, node);
            }
            if ((route == null || route.Count == 0) && !own && message.Plan == null)
            {
                // No plan and no hops left to follow: one a game load carried
                // without either. A load is where every centre starts again from
                // nothing heard, and the message starts again with its centre's
                // plan as it stands, rather than waiting for ever.
                message.Plan = _beliefs!.PlanOf(CentreOf(message));
                route = message.Plan?.Route(node, destination, nowUt, message.ExpiresUt, turnsOnTheWay);
            }
            if (route == null || route.Count == 0)
            {
                // Nothing here knows a way. A relay left without one still sends
                // straight to the destination the moment it can see it.
                if (!own)
                {
                    TryOwnLink(node, held, destination, nowUt, new[] { new PlannedHop(destination, nowUt, nowUt) });
                }
                return null;
            }

            var next = route[0];
            if (IsExcluded(held, next.To))
            {
                return next.DepartUt > nowUt + Tolerance ? next.DepartUt : (double?)null;
            }
            var clearAt = AfterAnnouncedWindow(node, next, nowUt);
            if (clearAt != null)
            {
                return clearAt;
            }
            if (next.RetargetDish != null && TurnsADish(message, node))
            {
                NoteRetargetNeeded(node, held, next, nowUt);
            }
            if (!own)
            {
                TryOwnLink(node, held, next.To, nowUt, route);
                return next.DepartUt > nowUt + Tolerance ? next.DepartUt : (double?)null;
            }

            if (next.DepartUt > nowUt + Tolerance)
            {
                return next.DepartUt;
            }
            message.Route = route.ToList();
            if (IsLive(route, nowUt))
            {
                // Believed open all the way: one flight to the destination, as a
                // command with a live path has always travelled. The real path,
                // when there is one, sets how long the light takes; when there is
                // none the light is lost, and the centre finds out by hearing
                // nothing back.
                var believed = route[route.Count - 1].ArriveUt - nowUt;
                var real = _links.LivePath(node, destination);
                Launch(node, held, destination, nowUt, real ?? believed, endToEnd: true, expectedLight: believed, toDish: route[route.Count - 1].ToDish);
                return null;
            }
            var hopBelieved = next.ArriveUt - next.DepartUt;
            Launch(node, held, next.To, nowUt, _links.LiveLink(node, next.To) ?? hopBelieved, endToEnd: false, expectedLight: hopBelieved, toDish: next.ToDish);
            return null;
        }

        /// <summary>Sends <paramref name="held"/> to <paramref name="to"/> if this node's own link there is up and the light lands in time.</summary>
        private void TryOwnLink(string node, Held held, string to, double nowUt, IReadOnlyList<PlannedHop> route)
        {
            var light = _links.LiveLink(node, to);
            if (light == null || nowUt + light.Value > held.Message.ExpiresUt)
            {
                return;
            }
            held.Message.Route = route.ToList();
            Launch(node, held, to, nowUt, light.Value, endToEnd: false, toDish: route.Count > 0 && string.Equals(route[0].To, to, StringComparison.Ordinal) ? route[0].ToDish : null);
        }

        /// <summary>Whether <paramref name="node"/> is the command centre that sent <paramref name="message"/>: true only for a command or a cancel still at its own lane's centre.</summary>
        private static bool IsItsOwnCentre(string node, DeliveryMessage message) => message switch
        {
            CommandMessage command => string.Equals(node, command.Lane.Vantage, StringComparison.Ordinal),
            CancelMessage cancel => string.Equals(node, cancel.Lane.Vantage, StringComparison.Ordinal),
            _ => false,
        };

        /// <summary>The command centre a message is from, or for a report, going to.</summary>
        private static string CentreOf(DeliveryMessage message) => message switch
        {
            CommandMessage command => command.Lane.Vantage,
            CancelMessage cancel => cancel.Lane.Vantage,
            ReportMessage report => report.To,
            SpanMessage span => span.Centre,
            _ => "",
        };

        /// <summary>Whether nothing on <paramref name="route"/> waits: each hop leaves as the one before it lands.</summary>
        private static bool IsLive(IReadOnlyList<PlannedHop> route, double nowUt)
        {
            var at = nowUt;
            foreach (var hop in route)
            {
                if (hop.DepartUt > at + Tolerance)
                {
                    return false;
                }
                at = hop.ArriveUt;
            }
            return true;
        }

        /// <summary>
        /// What is left of the route <paramref name="message"/> carries, from
        /// <paramref name="node"/> on, or null when it names no hop after this
        /// node: for a message whose plan a game load did not keep.
        /// </summary>
        private static IReadOnlyList<PlannedHop>? CarriedFrom(DeliveryMessage message, string node)
        {
            for (var i = 0; i < message.Route.Count; i++)
            {
                if (string.Equals(message.Route[i].To, node, StringComparison.Ordinal))
                {
                    var rest = message.Route.Skip(i + 1).ToList();
                    return rest.Count > 0 ? rest : null;
                }
            }
            return null;
        }

        /// <summary>
        /// Sends <paramref name="held"/> on its way. The node keeps its copy, in
        /// custody, until twice the light time has passed: see
        /// <see cref="EndCustody"/>.
        /// </summary>
        /// <param name="light">How long the light really takes, which is when it lands and what custody is timed by.</param>
        /// <param name="expectedLight">How long the node sending it expects the light to take, which is all its report may say: a centre sending on its plan knows only what the plan says. Null when the node measured the link itself.</param>
        private void Launch(string node, Held held, string to, double nowUt, double light, bool endToEnd, double? expectedLight = null, string? toDish = null)
        {
            if (held.Message is CommandMessage sent && string.Equals(node, sent.Lane.Vantage, StringComparison.Ordinal))
            {
                _leftSender.Add(sent.Id);
            }
            if (held.ReportedHeld && held.Message is CommandMessage command)
            {
                Report(node, command, JourneyKind.Departed, nowUt, detail: RetargetDetail(node, to, nowUt), until: nowUt + (expectedLight ?? light));
            }
            var retargeted = IsRetargetedFlight(node, to);
            NoteLaunched(node, held, nowUt);
            var flight = new Flight(held.Message, node, to, nowUt, nowUt + light, endToEnd) { CameFrom = held.CameFrom, Custody = held, ToDish = toDish, Retargeted = retargeted };
            held.Away = to;
            held.Landed = false;
            // Twice the time the light really takes where there is a real path,
            // since an answer cannot be back sooner, and twice what the node
            // expected where there is none. Either way the node learns nothing
            // before light could have told it.
            held.CustodyUntilUt = nowUt + (2 * light);
            Fly(flight);
            WatchCustody(node, held);
        }

        /// <summary>Puts a light on its way and schedules its landing on the clock.</summary>
        private void Fly(Flight flight)
        {
            _flights.Add(flight);
            flight.Cancel = _clock.Schedule(flight.ArriveUt, () => Locked(() =>
            {
                if (!_flights.Remove(flight))
                {
                    return;
                }
                Land(flight);
                // Whatever landed may leave again at once: a relay forwarding on a live link holds nothing.
                Depart(flight.To, flight.ArriveUt);
            }));
        }

        /// <summary>Schedules the end of <paramref name="held"/>'s custody at <paramref name="node"/>.</summary>
        private void WatchCustody(string node, Held held)
        {
            var until = held.CustodyUntilUt;
            held.EndWatch = _clock.Schedule(until, () => Locked(() => EndCustody(node, held, until)));
        }

        /// <summary>
        /// Twice the light time after a copy left: the soonest its node could know
        /// whether the hop was received. A copy that landed is let go. A copy that
        /// was caught is the node's again: it is stopped if a cancel has been
        /// stored here since, and otherwise waits to leave, never for the node it
        /// was caught on the way to until the plan changes.
        /// </summary>
        private void EndCustody(string node, Held held, double atUt)
        {
            if (held.Away == null || !_held.TryGetValue(node, out var list) || !list.Contains(held))
            {
                return;
            }
            var to = held.Away;
            held.Away = null;
            held.EndWatch = null;
            if (held.Landed)
            {
                list.Remove(held);
                return;
            }
            held.EligibleUt = atUt;
            (held.Excluded ??= new HashSet<string>(StringComparer.Ordinal)).Add(to);
            held.ExcludedAtPlan = _planVersion;
            if (held.Message is CommandMessage command && StoredCancelFor(node, command) != null)
            {
                list.Remove(held);
                Report(node, command, JourneyKind.Cancelled, atUt);
                return;
            }
            Depart(node, atUt);
        }

        private static bool IsExcluded(Held held, string to) => held.Excluded != null && held.Excluded.Contains(to);

        /// <summary>Commands leave in lane order, ahead of cancels and reports, and a node's spans leave last, oldest first.</summary>
        private static (int, long, string) Order(Held held) => held.Message switch
        {
            CommandMessage c => (0, c.LaneSeq, c.Id),
            CancelMessage x => (1, x.FromSeq, x.Id),
            SpanMessage span => (3, span.Samples.Count == 0 ? 0 : (long)Math.Floor(span.Samples[0].Ut * 1000.0), span.Id),
            _ => (2, 0, held.Message.Id),
        };

        private void Expire(double nowUt)
        {
            foreach (var entry in _held)
            {
                foreach (var held in entry.Value.Where(h => h.Away == null && nowUt > h.Message.ExpiresUt).ToList())
                {
                    entry.Value.Remove(held);
                    if (held.Message is CommandMessage command)
                    {
                        Report(entry.Key, command, JourneyKind.Expired, nowUt);
                    }
                }
            }
            foreach (var entry in _storedCancels)
            {
                entry.Value.RemoveAll(c => nowUt > c.DeleteAtUt);
            }
            Forget(nowUt);
        }

        /// <summary>
        /// Lets go of what nothing can still need. A sent command is kept so it
        /// can be sent again, chased by a cancel, and so a report about it can
        /// find the plan it went by: all of that is over a lifetime after the
        /// last instant it could have run. What a node has seen is kept to tell a
        /// second arrival from the first, which is over after two.
        /// </summary>
        private void Forget(double nowUt)
        {
            List<string>? finished = null;
            foreach (var sent in _sentCommands.Values)
            {
                if (nowUt > sent.DeleteAtUt + CommandLifetimeSeconds && !StillSomewhere(sent.Id))
                {
                    (finished ??= new List<string>()).Add(sent.Id);
                }
            }
            if (finished != null)
            {
                foreach (var id in finished)
                {
                    var sent = _sentCommands[id];
                    _sentCommands.Remove(id);
                    _leftSender.Remove(id);
                    if (_copiesOut.TryGetValue((sent.Lane, sent.LaneSeq), out var copies) && copies.Remove(id) && copies.Count == 0)
                    {
                        _copiesOut.Remove((sent.Lane, sent.LaneSeq));
                    }
                }
            }

            var longAgo = nowUt - (2.0 * CommandLifetimeSeconds);
            foreach (var seen in _seen.Values)
            {
                List<string>? old = null;
                foreach (var entry in seen)
                {
                    if (entry.Value < longAgo)
                    {
                        (old ??= new List<string>()).Add(entry.Key);
                    }
                }
                if (old != null)
                {
                    foreach (var id in old)
                    {
                        seen.Remove(id);
                    }
                }
            }
        }

        /// <summary>Whether a copy is still held at a node or on its way to one.</summary>
        private bool StillSomewhere(string id) =>
            _held.Values.Any(list => list.Any(h => string.Equals(h.Message.Id, id, StringComparison.Ordinal)))
            || _flights.Any(f => string.Equals(f.Message.Id, id, StringComparison.Ordinal));

        private Held? Hold(string node, DeliveryMessage message, double atUt, string? cameFrom)
        {
            var list = List(_held, node);
            if (list.Any(h => string.Equals(h.Message.Id, message.Id, StringComparison.Ordinal)))
            {
                return null;
            }
            var held = new Held(message, atUt, cameFrom);
            list.Add(held);
            return held;
        }

        private void StoreCancel(string node, CancelMessage cancel)
        {
            var list = List(_storedCancels, node);
            if (!list.Any(c => string.Equals(c.Id, cancel.Id, StringComparison.Ordinal)))
            {
                list.Add(cancel);
            }
        }

        private CancelMessage? StoredCancelFor(string node, CommandMessage command) =>
            _storedCancels.TryGetValue(node, out var list)
                ? list.FirstOrDefault(c => c.Lane.Equals(command.Lane) && c.Names(command.LaneSeq))
                : null;

        /// <summary>Reports from <paramref name="node"/> back to the command's sender, at once when the node is the sender.</summary>
        private void Report(string node, CommandMessage command, JourneyKind kind, double atUt, string? detail = null, double? until = null)
        {
            var report = new ReportMessage
            {
                Id = MintId("report"),
                To = command.Lane.Vantage,
                Kind = kind,
                About = command.Id,
                Lane = command.Lane,
                LaneSeq = command.LaneSeq,
                At = node,
                AtUt = atUt,
                Detail = detail,
                UntilUt = until,
                Plan = command.Plan,
            };
            Route(node, report, atUt);
        }

        private void Route(string node, ReportMessage report, double atUt)
        {
            if (string.Equals(node, report.To, StringComparison.Ordinal))
            {
                report.LandedUt = atUt;
                Settle(report);
                _deliverReport(report);
                return;
            }
            Hold(node, report, atUt, null);
        }

        /// <summary>A report that settles a lane number tells the sender so.</summary>
        private void Settle(ReportMessage report)
        {
            var key = (report.Lane, report.LaneSeq);
            switch (report.Kind)
            {
                case JourneyKind.Reply:
                case JourneyKind.Cancelled:
                case JourneyKind.CancelStored:
                case JourneyKind.CancelLate:
                    _copiesOut.Remove(key);
                    Sender(report.Lane).Resolve(report.LaneSeq);
                    break;
                case JourneyKind.Expired:
                case JourneyKind.Discarded:
                    // One copy is accounted for. A copy sent again may still be out
                    // there and may still run, and while it is the number is not
                    // settled: its own expiry closes it if nothing else does.
                    if (_copiesOut.TryGetValue(key, out var copies))
                    {
                        copies.Remove(report.About);
                        report.OtherCopiesOut = copies.Count > 0;
                        if (copies.Count == 0)
                        {
                            _copiesOut.Remove(key);
                        }
                    }
                    if (!report.OtherCopiesOut && report.Detail != "a copy is already waiting")
                    {
                        Sender(report.Lane).Resolve(report.LaneSeq);
                    }
                    break;
            }
        }

        private LaneSender Sender(LaneKey lane)
        {
            if (!_senders.TryGetValue(lane, out var sender))
            {
                sender = new LaneSender();
                _senders[lane] = sender;
            }
            return sender;
        }

        private LaneCollector Collector(LaneKey lane)
        {
            if (!_collectors.TryGetValue(lane, out var collector))
            {
                collector = NewCollector(lane);
                _collectors[lane] = collector;
            }
            return collector;
        }

        private LaneCollector NewCollector(LaneKey lane) =>
            new LaneCollector(
                lane,
                (command, atUt) =>
                {
                    _toRun.Add((command, atUt));
                    return null;
                },
                report =>
                {
                    // A run's reply waits for its result, which the run queue supplies.
                    if (report.Kind == JourneyKind.Reply)
                    {
                        return;
                    }
                    report.Id = MintId("report");
                    // It goes home by the plan the command it is about came by; a
                    // report about a cancel, by the plan of the command it named.
                    report.Plan = _sentCommands.TryGetValue(report.About, out var about)
                        ? about.Plan
                        : _sentCommands.Values.FirstOrDefault(c => c.Lane.Equals(lane) && c.LaneSeq == report.LaneSeq && c.Plan != null)?.Plan;
                    Route(lane.Craft, report, report.AtUt);
                },
                _release,
                (atUt, run) => _clock.Schedule(atUt, () => Locked(run)));

        private Dictionary<string, double> SeenAt(string node)
        {
            if (!_seen.TryGetValue(node, out var seen))
            {
                seen = new Dictionary<string, double>(StringComparer.Ordinal);
                _seen[node] = seen;
            }
            return seen;
        }

        private string MintId(string kind) => kind + "-" + (++_nextId).ToString(System.Globalization.CultureInfo.InvariantCulture);

        private static List<T> List<T>(Dictionary<string, List<T>> map, string key)
        {
            if (!map.TryGetValue(key, out var list))
            {
                list = new List<T>();
                map[key] = list;
            }
            return list;
        }

        private sealed class Held
        {
            public Held(DeliveryMessage message, double arrivedUt, string? cameFrom)
            {
                Message = message;
                ArrivedUt = arrivedUt;
                CameFrom = cameFrom;
            }

            public DeliveryMessage Message { get; }

            public double ArrivedUt { get; }

            public string? CameFrom { get; }

            public double EligibleUt { get; set; } = double.NegativeInfinity;

            public bool ReportedHeld { get; set; }

            public HashSet<string>? Excluded { get; set; }

            public int ExcludedAtPlan { get; set; }

            /// <summary>The node this copy was sent to, while its own node still has custody of it; null for a copy that is waiting here.</summary>
            public string? Away { get; set; }

            /// <summary>When custody ends: twice the hop's light time after it left.</summary>
            public double CustodyUntilUt { get; set; }

            /// <summary>Whether the copy that was sent was received. The node holding custody does not know this until custody ends.</summary>
            public bool Landed { get; set; }

            /// <summary>Cancels the scheduled end of custody.</summary>
            public Action? EndWatch { get; set; }

            /// <summary>When this copy is next due to look for its window, or NaN when no look is scheduled.</summary>
            public double WakeUt { get; set; } = double.NaN;

            /// <summary>Cancels that scheduled look.</summary>
            public Action? CancelWake { get; set; }
        }

        private sealed class Flight
        {
            public Flight(DeliveryMessage message, string from, string to, double departUt, double arriveUt, bool endToEnd)
            {
                Message = message;
                From = from;
                To = to;
                DepartUt = departUt;
                ArriveUt = arriveUt;
                EndToEnd = endToEnd;
            }

            public DeliveryMessage Message { get; }

            public string From { get; }

            public string To { get; }

            public double DepartUt { get; }

            public double ArriveUt { get; }

            public bool EndToEnd { get; }

            public string? CameFrom { get; set; }

            /// <summary>The dish the light lands on, when the route names one: an arrival booked onto it.</summary>
            public string? ToDish { get; set; }

            /// <summary>Whether the light left on a dish turned for it.</summary>
            public bool Retargeted { get; set; }

            public Action? Cancel { get; set; }

            /// <summary>The copy the sending node keeps until custody ends.</summary>
            public Held? Custody { get; set; }
        }
    }

    /// <summary>Everything the delivery network carries, for saving with the game.</summary>
    public sealed class DeliverySnapshot
    {
        public List<HeldRecord> Held { get; set; } = new List<HeldRecord>();

        public List<FlightRecord> Flights { get; set; } = new List<FlightRecord>();

        public List<StoredCancelRecord> StoredCancels { get; set; } = new List<StoredCancelRecord>();

        public List<SenderRecord> Senders { get; set; } = new List<SenderRecord>();

        public List<CollectorRecord> Collectors { get; set; } = new List<CollectorRecord>();

        public List<CommandMessage> SentCommands { get; set; } = new List<CommandMessage>();

        public long NextId { get; set; }

        /// <summary>The dish turns under way and the windows announced for them.</summary>
        public RetargetSnapshot Retargets { get; set; } = new RetargetSnapshot();

        /// <summary>
        /// The commands sent on the live path rather than held, which the
        /// <see cref="Courier"/> carries: see <see cref="Courier.SnapshotCommands"/>.
        /// </summary>
        public CommandQueueState LivePath { get; set; } = new CommandQueueState();
    }

    public sealed class HeldRecord
    {
        public string Node { get; set; } = "";

        public DeliveryMessage Message { get; set; } = null!;

        public double ArrivedUt { get; set; }

        public double EligibleUt { get; set; }

        public bool ReportedHeld { get; set; }

        public string? CameFrom { get; set; }

        /// <summary>Where the copy was sent, for one its node still has custody of after its light landed or was lost; null for a copy that is waiting.</summary>
        public string? Away { get; set; }

        /// <summary>When that custody ends.</summary>
        public double? CustodyUntilUt { get; set; }

        /// <summary>Whether the copy that was sent was received.</summary>
        public bool Landed { get; set; }

        /// <summary>The nodes a caught copy may not be sent to again until the plan changes; null when none.</summary>
        public List<string>? Excluded { get; set; }
    }

    /// <summary>A light on its way: the sender's custody copy and the arrival it carries, one record, so a restore never yields both.</summary>
    public sealed class FlightRecord
    {
        public DeliveryMessage Message { get; set; } = null!;

        public string From { get; set; } = "";

        public string To { get; set; } = "";

        public double DepartUt { get; set; }

        public double ArriveUt { get; set; }

        public bool EndToEnd { get; set; }

        /// <summary>Whether the node it left had reported holding it.</summary>
        public bool ReportedHeld { get; set; }

        /// <summary>The dish the light lands on, when the route named one.</summary>
        public string? ToDish { get; set; }

        /// <summary>Whether the light left on a dish turned for it.</summary>
        public bool Retargeted { get; set; }
    }

    public sealed class StoredCancelRecord
    {
        public string Node { get; set; } = "";

        public CancelMessage Cancel { get; set; } = null!;
    }

    public sealed class SenderRecord
    {
        public LaneKey Lane { get; set; }

        public long NextSeq { get; set; }

        public List<KeyValuePair<long, double>> Unresolved { get; set; } = new List<KeyValuePair<long, double>>();
    }

    public sealed class CollectorRecord
    {
        public LaneKey Lane { get; set; }

        public long Next { get; set; }

        public List<long> Cancelled { get; set; } = new List<long>();

        public List<KeyValuePair<long, double>> Ran { get; set; } = new List<KeyValuePair<long, double>>();

        public List<CommandMessage> Waiting { get; set; } = new List<CommandMessage>();

        public List<long> Expired { get; set; } = new List<long>();

        /// <summary>Commands due to run later in a replayed span.</summary>
        public List<ScheduledRecord> Scheduled { get; set; } = new List<ScheduledRecord>();

        public double LastRunUt { get; set; } = double.NaN;

        public double LastSentUt { get; set; } = double.NaN;
    }

    public sealed class ScheduledRecord
    {
        public CommandMessage Command { get; set; } = null!;

        public double AtUt { get; set; }
    }
}
