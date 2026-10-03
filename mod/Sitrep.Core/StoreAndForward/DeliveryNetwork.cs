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

    /// <summary>One hop the contact plan predicts.</summary>
    public readonly struct PlannedHop
    {
        public PlannedHop(string to, double departUt, double arriveUt)
        {
            To = to;
            DepartUt = departUt;
            ArriveUt = arriveUt;
        }

        public string To { get; }

        public double DepartUt { get; }

        public double ArriveUt { get; }
    }

    /// <summary>What the contact plan predicts about _routes.</summary>
    public interface IDeliveryRoutes
    {
        /// <summary>The whole earliest-arrival route from one node to another for a message ready at <paramref name="readyUt"/> that must arrive by <paramref name="deadlineUt"/>, or null when the plan predicts none.</summary>
        IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt);
    }

    /// <summary>
    /// Store-and-forward delivery of delayed commands, cancels and reports.
    ///
    /// <para>A message waits at a node until it can leave: along the backend's
    /// live path to its destination if there is one now, or else on the contact
    /// plan's next hop, but only when that hop's link is live now and the light
    /// lands before the message's own expiry. The sender keeps its copy until the
    /// light lands: a hop whose link is gone by then is caught, the message was
    /// never received, and it may leave again twice the hop's light time after it
    /// first did, never into the same next node until the plan changes.</para>
    ///
    /// <para>Commands run at the craft in lane order (<see cref="LaneCollector"/>).
    /// A cancel is stored at every node it passes and becomes a permanent mark on
    /// the craft's lane. Every way a command can end is reported back to its
    /// sender as a journey report, routed like any other message.</para>
    ///
    /// <para>One lock guards everything, so a save can snapshot it from another
    /// thread.</para>
    /// </summary>
    public sealed class DeliveryNetwork
    {
        /// <summary>The lifetime of every delayed command, in game seconds.</summary>
        public const double CommandLifetimeSeconds = 3600.0;

        private const double Tolerance = 1e-6;

        private readonly object _gate = new object();
        private readonly IClock _clock;
        private readonly IDeliveryLinks _links;
        private readonly IDeliveryRoutes _routes;
        private readonly Func<CommandMessage, double, object?> _execute;
        private readonly Action<ReportMessage> _deliverReport;
        private readonly Dictionary<string, List<Held>> _held = new Dictionary<string, List<Held>>(StringComparer.Ordinal);
        private readonly List<Flight> _flights = new List<Flight>();
        private readonly Dictionary<string, List<CancelMessage>> _storedCancels = new Dictionary<string, List<CancelMessage>>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<string>> _seen = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
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
        public DeliveryNetwork(
            IClock clock,
            IDeliveryLinks links,
            IDeliveryRoutes routes,
            Func<CommandMessage, double, object?> execute,
            Action<ReportMessage> deliverReport,
            ControlValueRelease release = ControlValueRelease.RunEvery)
        {
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _links = links ?? throw new ArgumentNullException(nameof(links));
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
                foreach (var held in _held.Values.SelectMany(h => h))
                {
                    held.Excluded = null;
                }
            }
        }

        /// <summary>
        /// Sends a delayed command from its lane's command centre: takes the next
        /// lane number and its gap expiry, and puts it on hold at the sender until
        /// it can leave. Returns the message as sent.
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
                        Id = MintId("cmd"),
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
        /// unknown or already settled at the sender.
        /// </summary>
        public CommandMessage? SendAgain(LaneKey lane, long seq, double nowUt)
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
                        Id = MintId("cmd"),
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
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>Everything held, in flight, stored and settled, for saving with the game.</summary>
        public DeliverySnapshot Snapshot()
        {
            lock (_gate)
            {
                return new DeliverySnapshot
                {
                    Held = _held.SelectMany(n => n.Value.Select(h => new HeldRecord
                    {
                        Node = n.Key,
                        Message = h.Message,
                        ArrivedUt = h.ArrivedUt,
                        EligibleUt = h.EligibleUt,
                        ReportedHeld = h.ReportedHeld,
                        CameFrom = h.CameFrom,
                    })).ToList(),
                    Flights = _flights.Select(f => new FlightRecord
                    {
                        Message = f.Message,
                        From = f.From,
                        To = f.To,
                        DepartUt = f.DepartUt,
                        ArriveUt = f.ArriveUt,
                        EndToEnd = f.EndToEnd,
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
                };
            }
        }

        /// <summary>Drops everything: a new timeline.</summary>
        public void Reset()
        {
            lock (_gate)
            {
                _held.Clear();
                foreach (var flight in _flights)
                {
                    flight.Cancel?.Invoke();
                }
                _flights.Clear();
                _storedCancels.Clear();
                _seen.Clear();
                _collectors.Clear();
                _senders.Clear();
                _sentCommands.Clear();
                _leftSender.Clear();
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
                    foreach (var held in snapshot.Held)
                    {
                        List(_held, held.Node).Add(new Held(Rekey(held.Message), held.ArrivedUt, held.CameFrom)
                        {
                            EligibleUt = held.EligibleUt,
                            ReportedHeld = held.ReportedHeld,
                        });
                    }
                    foreach (var flight in snapshot.Flights)
                    {
                        Fly(new Flight(Rekey(flight.Message), flight.From, flight.To, flight.DepartUt, flight.ArriveUt, flight.EndToEnd));
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
                    _nextId = Math.Max(_nextId, snapshot.NextId);
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>Where every message is right now, for tests and diagnostics.</summary>
        public IReadOnlyList<(string Node, DeliveryMessage Message)> HeldMessages()
        {
            lock (_gate)
            {
                return _held.SelectMany(n => n.Value.Select(h => (n.Key, h.Message))).ToList();
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
                    };
                    Route(next.Command.Lane.Craft, reply, next.AtUt);
                    Depart(next.Command.Lane.Craft, next.AtUt);
                }
            }
        }

        private void Land(Flight flight)
        {
            var stillLinked = flight.EndToEnd
                ? _links.LivePath(flight.From, flight.To) != null
                : _links.LiveLink(flight.From, flight.To) != null;
            if (!stillLinked)
            {
                // Caught: never received. The sender still has it, and may send it
                // again when its own custody timer would fire.
                var light = flight.ArriveUt - flight.DepartUt;
                var held = Hold(flight.From, flight.Message, flight.DepartUt, flight.CameFrom);
                if (held != null)
                {
                    held.EligibleUt = flight.DepartUt + (2 * light);
                    (held.Excluded ??= new HashSet<string>(StringComparer.Ordinal)).Add(flight.To);
                    held.ExcludedAtPlan = _planVersion;
                }
                return;
            }
            Deliver(flight.To, flight.Message, flight.ArriveUt, flight.From);
        }

        private void Deliver(string node, DeliveryMessage message, double atUt, string? cameFrom)
        {
            var seen = SeenAt(node);
            if (!seen.Add(message.Id))
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
                        Settle(report);
                        _deliverReport(report);
                    }
                    else
                    {
                        Hold(node, report, atUt, cameFrom);
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

        /// <summary>Stops every copy of lane number <paramref name="seq"/> held at <paramref name="node"/>. True when the node held one.</summary>
        private bool StopHeld(string node, LaneKey lane, long seq, double atUt)
        {
            if (!_held.TryGetValue(node, out var list))
            {
                return false;
            }
            var stopped = list.Where(h => h.Message is CommandMessage c && c.Lane.Equals(lane) && c.LaneSeq == seq).ToList();
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
            var own = _routes.Route(cancel.Lane.Vantage, cancel.Lane.Craft, nowUt, cancel.DeleteAtUt);
            var onOwnRoute = new HashSet<string>(own?.Select(h => h.To) ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            var targets = new HashSet<string>(StringComparer.Ordinal);
            foreach (var command in _sentCommands.Values.Where(c => c.Lane.Equals(cancel.Lane) && cancel.Names(c.LaneSeq)))
            {
                var predicted = _routes.Route(cancel.Lane.Vantage, cancel.Lane.Craft, command.SentUt, command.DeleteAtUt);
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
                    var toHold = _routes.Route(cancel.Lane.Vantage, holdAt, nowUt, leaves);
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
        };

        private void Depart(string node, double nowUt)
        {
            if (!_held.TryGetValue(node, out var list) || list.Count == 0)
            {
                return;
            }
            foreach (var held in list.OrderBy(Order).ToList())
            {
                if (nowUt < held.EligibleUt)
                {
                    continue;
                }
                var message = held.Message;
                var successor = _release == ControlValueRelease.LatestWins && message is CommandMessage value && value.Channel != null
                    ? list.Select(other => other.Message).OfType<CommandMessage>()
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

                var live = _links.LivePath(node, destination);
                if (live != null && nowUt + live.Value <= message.ExpiresUt && !IsExcluded(held, destination))
                {
                    Launch(node, held, destination, nowUt, live.Value, endToEnd: true);
                    continue;
                }

                var route = _routes.Route(node, destination, nowUt, message.ExpiresUt);
                var next = route != null && route.Count > 0 ? route[0] : (PlannedHop?)null;
                if (next != null && next.Value.DepartUt <= nowUt + Tolerance && !IsExcluded(held, next.Value.To))
                {
                    var light = _links.LiveLink(node, next.Value.To);
                    if (light != null && nowUt + light.Value <= message.ExpiresUt)
                    {
                        Launch(node, held, next.Value.To, nowUt, light.Value, endToEnd: false);
                        continue;
                    }
                }

                if (!held.ReportedHeld && message is CommandMessage command)
                {
                    held.ReportedHeld = true;
                    Report(node, command, JourneyKind.Held, nowUt, until: next?.DepartUt);
                }
            }
        }

        private void Launch(string node, Held held, string to, double nowUt, double light, bool endToEnd)
        {
            _held[node].Remove(held);
            if (held.Message is CommandMessage sent && string.Equals(node, sent.Lane.Vantage, StringComparison.Ordinal))
            {
                _leftSender.Add(sent.Id);
            }
            if (held.ReportedHeld && held.Message is CommandMessage command)
            {
                Report(node, command, JourneyKind.Departed, nowUt, until: nowUt + light);
            }
            Fly(new Flight(held.Message, node, to, nowUt, nowUt + light, endToEnd) { CameFrom = held.CameFrom });
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
                Depart(flight.From, flight.ArriveUt);
            }));
        }

        private static bool IsExcluded(Held held, string to) => held.Excluded != null && held.Excluded.Contains(to);

        /// <summary>Commands leave in lane order, ahead of cancels and reports.</summary>
        private static (int, long, string) Order(Held held) => held.Message switch
        {
            CommandMessage c => (0, c.LaneSeq, c.Id),
            CancelMessage x => (1, x.FromSeq, x.Id),
            _ => (2, 0, held.Message.Id),
        };

        private void Expire(double nowUt)
        {
            foreach (var entry in _held)
            {
                foreach (var held in entry.Value.Where(h => nowUt > h.Message.ExpiresUt).ToList())
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
        }

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
            };
            Route(node, report, atUt);
        }

        private void Route(string node, ReportMessage report, double atUt)
        {
            if (string.Equals(node, report.To, StringComparison.Ordinal))
            {
                Settle(report);
                _deliverReport(report);
                return;
            }
            Hold(node, report, atUt, null);
        }

        /// <summary>A report that settles a lane number tells the sender so.</summary>
        private void Settle(ReportMessage report)
        {
            switch (report.Kind)
            {
                case JourneyKind.Reply:
                case JourneyKind.Expired:
                case JourneyKind.Cancelled:
                case JourneyKind.CancelStored:
                case JourneyKind.CancelLate:
                    Sender(report.Lane).Resolve(report.LaneSeq);
                    break;
                case JourneyKind.Discarded when report.Detail != "a copy is already waiting":
                    Sender(report.Lane).Resolve(report.LaneSeq);
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
                    Route(lane.Craft, report, report.AtUt);
                },
                _release,
                (atUt, run) => _clock.Schedule(atUt, () => Locked(run)));

        private HashSet<string> SeenAt(string node)
        {
            if (!_seen.TryGetValue(node, out var seen))
            {
                seen = new HashSet<string>(StringComparer.Ordinal);
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

            public Action? Cancel { get; set; }
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
    }

    public sealed class HeldRecord
    {
        public string Node { get; set; } = "";

        public DeliveryMessage Message { get; set; } = null!;

        public double ArrivedUt { get; set; }

        public double EligibleUt { get; set; }

        public bool ReportedHeld { get; set; }

        public string? CameFrom { get; set; }
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
