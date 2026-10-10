using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Core.StoreAndForward
{
    /// <summary>
    /// Turns a node's dish, and puts it back. Implemented by the backend that owns
    /// the dishes; the network never sees an antenna.
    ///
    /// <para>Called outside the network's lock, from whichever thread drives the
    /// network, so an implementation may wait on the game's main thread.</para>
    /// </summary>
    public interface IDishActuator
    {
        /// <summary>
        /// Aims <paramref name="dishId"/> of <paramref name="node"/> at
        /// <paramref name="peer"/>, saving what it was aimed at first. Returns the id
        /// of the restore record, or null when the dish would not turn.
        /// </summary>
        string? Turn(string node, string dishId, string peer, double ut);

        /// <summary>
        /// Puts the dish back as the record says, only if it is still aimed where
        /// the turn put it. Idempotent: a record already restored, or a dish
        /// someone else has aimed since, is left alone. Returns whether the record
        /// is now settled.
        /// </summary>
        bool Restore(string recordId, double ut);
    }

    /// <summary>The limits a dish turn keeps to.</summary>
    public sealed class RetargetOptions
    {
        /// <summary>How long after the turn starts the live link is up: one network refresh.</summary>
        public double LinkUpSeconds { get; set; } = 2.0;

        /// <summary>How long the dish stays turned after its link is up, for the messages held for the peer to leave.</summary>
        public double SendSeconds { get; set; } = 10.0;

        /// <summary>The longest a dish may stay turned before the event ends and restores, however many messages still wait.</summary>
        public double AwayCapSeconds { get; set; } = 120.0;

        /// <summary>How long a dish rests after an event before it may be turned again.</summary>
        public double CooldownSeconds { get; set; } = 60.0;
    }

    /// <summary>Where a dish turn has got to.</summary>
    public enum RetargetPhase
    {
        /// <summary>Announced; the dish has not turned yet.</summary>
        Announced,

        /// <summary>The dish is aimed at the peer.</summary>
        Turned,

        /// <summary>The dish was put back.</summary>
        Restored,

        /// <summary>The event ended without turning, or the operator took the dish.</summary>
        Ended,
    }

    /// <summary>One dish turn: a node borrows an idle dish to carry what it holds for a peer.</summary>
    public sealed class RetargetEventRecord
    {
        public string Id { get; set; } = "";

        public string Node { get; set; } = "";

        public string Dish { get; set; } = "";

        public string Peer { get; set; } = "";

        public RetargetPhase Phase { get; set; }

        public double AnnouncedUt { get; set; }

        /// <summary>When the turn is planned to start.</summary>
        public double TurnUt { get; set; }

        /// <summary>When the dish is planned to be back.</summary>
        public double BackUt { get; set; }

        /// <summary>When the dish actually turned, or NaN.</summary>
        public double TurnedUt { get; set; } = double.NaN;

        /// <summary>When the event ended, or NaN while it lasts.</summary>
        public double EndedUt { get; set; } = double.NaN;

        /// <summary>The actuator's restore record, once the dish has turned.</summary>
        public string? Record { get; set; }

        /// <summary>The ids of the held messages waiting for this dish to carry them.</summary>
        public List<string> Waiting { get; set; } = new List<string>();
    }

    /// <summary>A dish's rest after an event, so it is not turned every few seconds.</summary>
    public sealed class RetargetRestRecord
    {
        public string Dish { get; set; } = "";

        public double UntilUt { get; set; }
    }

    /// <summary>Everything dish turning keeps, for saving with the game.</summary>
    public sealed class RetargetSnapshot
    {
        public List<RetargetEventRecord> Events { get; set; } = new List<RetargetEventRecord>();

        public List<RetargetRestRecord> Rests { get; set; } = new List<RetargetRestRecord>();
    }

    public sealed partial class DeliveryNetwork
    {
        private IDishActuator? _actuator;
        private RetargetOptions _retargetOptions = new RetargetOptions();
        private Func<string, bool> _autoRetarget = _ => true;
        private readonly List<RetargetEvent> _retargetEvents = new List<RetargetEvent>();
        private readonly Dictionary<string, double> _rests = new Dictionary<string, double>(StringComparer.Ordinal);
        private readonly HashSet<string> _failedDishes = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<Action> _actuations = new List<Action>();

        private sealed class RetargetEvent
        {
            public RetargetEventRecord Record = new RetargetEventRecord();
            public HashSet<string> Waiting = new HashSet<string>(StringComparer.Ordinal);
            public Action? CancelTurn;
            public Action? CancelCap;
            public bool Turning;
        }

        /// <summary>
        /// Lets a node that holds a message for a peer turn an idle dish to carry
        /// it. Without an actuator no dish is ever turned.
        /// </summary>
        /// <param name="actuator">Turns and restores dishes.</param>
        /// <param name="options">The limits a turn keeps to.</param>
        /// <param name="autoRetargetAllowed">Whether a node may turn a dish on its own; false for a craft whose operator has opted out.</param>
        public void SetRetargeting(IDishActuator actuator, RetargetOptions? options = null, Func<string, bool>? autoRetargetAllowed = null)
        {
            lock (_gate)
            {
                _actuator = actuator ?? throw new ArgumentNullException(nameof(actuator));
                _retargetOptions = options ?? new RetargetOptions();
                _autoRetarget = autoRetargetAllowed ?? (_ => true);
            }
        }

        /// <summary>The dish turns that are announced or under way, for display.</summary>
        public IReadOnlyList<RetargetEventRecord> ActiveRetargets()
        {
            lock (_gate)
            {
                return _retargetEvents
                    .Where(e => e.Record.Phase == RetargetPhase.Announced || e.Record.Phase == RetargetPhase.Turned)
                    .Select(e => Copy(e))
                    .ToList();
            }
        }

        /// <summary>Every event this network has run or planned in this timeline that has not been pruned, finished ones included.</summary>
        public IReadOnlyList<RetargetEventRecord> RetargetHistory()
        {
            lock (_gate)
            {
                return _retargetEvents.Select(e => Copy(e)).ToList();
            }
        }

        private static RetargetEventRecord Copy(RetargetEvent e)
        {
            var r = e.Record;
            return new RetargetEventRecord
            {
                Id = r.Id,
                Node = r.Node,
                Dish = r.Dish,
                Peer = r.Peer,
                Phase = r.Phase,
                AnnouncedUt = r.AnnouncedUt,
                TurnUt = r.TurnUt,
                BackUt = r.BackUt,
                TurnedUt = r.TurnedUt,
                EndedUt = r.EndedUt,
                Record = r.Record,
                Waiting = e.Waiting.ToList(),
            };
        }

        /// <summary>The plan changed: a dish that failed to turn may be tried again.</summary>
        private void PlanChangedRetargets() => _failedDishes.Clear();

        /// <summary>
        /// The operator aimed <paramref name="dishId"/> themselves. The event that
        /// had borrowed it ends where it stands, with no restore: the aim they
        /// declared is the one to keep. Anything held for the dish waits for a new
        /// plan.
        /// </summary>
        public void OperatorAimed(string dishId, double nowUt)
        {
            try
            {
                lock (_gate)
                {
                    foreach (var e in _retargetEvents.Where(e => string.Equals(e.Record.Dish, dishId, StringComparison.Ordinal) && Live(e)).ToList())
                    {
                        Finish(e, RetargetPhase.Ended, nowUt);
                    }
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>
        /// Whether <paramref name="node"/> may turn a dish on its own changed. A node
        /// that may no longer has every dish it has borrowed put back at once.
        /// </summary>
        public void AutoRetargetChanged(string node, double nowUt)
        {
            try
            {
                lock (_gate)
                {
                    if (_autoRetarget(node))
                    {
                        return;
                    }
                    foreach (var e in _retargetEvents.Where(e => string.Equals(e.Record.Node, node, StringComparison.Ordinal) && Live(e)).ToList())
                    {
                        RestoreEvent(e, nowUt);
                    }
                }
            }
            finally
            {
                RunQueued();
            }
        }

        /// <summary>
        /// Whether <paramref name="node"/> turns a dish for <paramref name="message"/>
        /// it holds: any node for a command or a cancel, and for a reply or a
        /// journey report only the node that made it. A span never starts a turn:
        /// its data is history, and no dish is worth turning for it, though it
        /// rides a turn something else needs. Anything else rides a turn and
        /// starts none.
        /// </summary>
        private static bool TurnsADish(DeliveryMessage message, string node) => message switch
        {
            CommandMessage _ => true,
            CancelMessage _ => true,
            ReportMessage report => string.Equals(report.At, node, StringComparison.Ordinal),
            _ => false,
        };

        private static bool Live(RetargetEvent e) => e.Record.Phase == RetargetPhase.Announced || e.Record.Phase == RetargetPhase.Turned;

        /// <summary>
        /// A held message's next hop needs <c>next.RetargetDish</c> turned to the
        /// hop's node. Starts an event for it unless one is already going, the dish
        /// is resting, a turn of it failed under this plan, or its node may not.
        /// </summary>
        private void NoteRetargetNeeded(string node, Held held, PlannedHop next, double nowUt)
        {
            if (_actuator == null || next.RetargetDish == null)
            {
                return;
            }
            var dish = next.RetargetDish;
            var existing = _retargetEvents.FirstOrDefault(e =>
                Live(e) && string.Equals(e.Record.Node, node, StringComparison.Ordinal)
                && string.Equals(e.Record.Dish, dish, StringComparison.Ordinal)
                && string.Equals(e.Record.Peer, next.To, StringComparison.Ordinal));
            if (existing != null)
            {
                existing.Waiting.Add(held.Message.Id);
                return;
            }
            if (_failedDishes.Contains(dish)
                || (_rests.TryGetValue(dish, out var rest) && nowUt < rest)
                || !_autoRetarget(node)
                || _retargetEvents.Any(e => Live(e) && string.Equals(e.Record.Dish, dish, StringComparison.Ordinal)))
            {
                return;
            }

            var options = _retargetOptions;
            var turn = double.IsNaN(next.TurnUt) ? nowUt : Math.Max(nowUt, next.TurnUt);
            var back = turn + options.LinkUpSeconds + options.SendSeconds;
            var record = new RetargetEventRecord
            {
                Id = MintId("retarget"),
                Node = node,
                Dish = dish,
                Peer = next.To,
                Phase = RetargetPhase.Announced,
                AnnouncedUt = nowUt,
                TurnUt = turn,
                BackUt = back,
            };
            var created = new RetargetEvent { Record = record };
            created.Waiting.Add(held.Message.Id);
            _retargetEvents.Add(created);
            ScheduleTurn(created, nowUt);
        }

        private void ScheduleTurn(RetargetEvent e, double nowUt)
        {
            var at = Math.Max(e.Record.TurnUt, nowUt);
            e.CancelTurn = at <= nowUt + Tolerance
                ? null
                : _clock.Schedule(at, () => Locked(() => StartTurn(e, at)));
            if (e.CancelTurn == null)
            {
                StartTurn(e, nowUt);
            }
        }

        /// <summary>
        /// The turn is due. A dish with light on its way to it is not turned: the
        /// event ends and the messages wait for another plan.
        /// </summary>
        private void StartTurn(RetargetEvent e, double nowUt)
        {
            if (e.Record.Phase != RetargetPhase.Announced || e.Turning)
            {
                return;
            }
            var arriving = _flights.Any(f =>
                string.Equals(f.ToDish, e.Record.Dish, StringComparison.Ordinal) && f.ArriveUt > nowUt - Tolerance);
            if (arriving)
            {
                _failedDishes.Add(e.Record.Dish);
                Finish(e, RetargetPhase.Ended, nowUt);
                return;
            }
            e.Turning = true;
            var actuator = _actuator!;
            var record = e.Record;
            _actuations.Add(() =>
            {
                string? restoreRecord;
                try
                {
                    restoreRecord = actuator.Turn(record.Node, record.Dish, record.Peer, nowUt);
                }
                catch (Exception)
                {
                    restoreRecord = null;
                }
                Locked(() => Turned(e, restoreRecord, nowUt));
            });
        }

        private void Turned(RetargetEvent e, string? restoreRecord, double nowUt)
        {
            e.Turning = false;
            if (e.Record.Phase != RetargetPhase.Announced)
            {
                // Ended while the actuator was working: put back what it turned.
                if (restoreRecord != null)
                {
                    var actuator = _actuator!;
                    _actuations.Add(() => actuator.Restore(restoreRecord, nowUt));
                }
                return;
            }
            if (restoreRecord == null)
            {
                _failedDishes.Add(e.Record.Dish);
                Finish(e, RetargetPhase.Ended, nowUt);
                return;
            }
            e.Record.Phase = RetargetPhase.Turned;
            e.Record.TurnedUt = nowUt;
            e.Record.Record = restoreRecord;
            ArmTurned(e, nowUt);
        }

        private void ArmTurned(RetargetEvent e, double nowUt)
        {
            var options = _retargetOptions;
            var node = e.Record.Node;
            var up = Math.Max(e.Record.TurnedUt + options.LinkUpSeconds, nowUt);
            if (up > nowUt + Tolerance)
            {
                _clock.Schedule(up, () => Locked(() =>
                {
                    if (Live(e))
                    {
                        Depart(node, up);
                    }
                }));
            }
            var cap = Math.Max(e.Record.TurnedUt + options.AwayCapSeconds, nowUt);
            e.CancelCap = _clock.Schedule(cap, () => Locked(() =>
            {
                if (e.Record.Phase == RetargetPhase.Turned)
                {
                    RestoreEvent(e, cap);
                }
            }));
        }

        /// <summary>Ends an event by putting its dish back.</summary>
        private void RestoreEvent(RetargetEvent e, double nowUt)
        {
            if (e.Record.Phase == RetargetPhase.Turned && e.Record.Record != null)
            {
                var actuator = _actuator!;
                var recordId = e.Record.Record;
                _actuations.Add(() => actuator.Restore(recordId, nowUt));
                Finish(e, RetargetPhase.Restored, nowUt);
                return;
            }
            Finish(e, RetargetPhase.Ended, nowUt);
        }

        private void Finish(RetargetEvent e, RetargetPhase phase, double nowUt)
        {
            e.CancelTurn?.Invoke();
            e.CancelCap?.Invoke();
            e.Record.Phase = phase;
            e.Record.EndedUt = nowUt;
            _rests[e.Record.Dish] = nowUt + _retargetOptions.CooldownSeconds;
        }

        /// <summary>A held message has gone; an event waiting only for it no longer has a reason to hold its dish.</summary>
        private void NoteLaunched(string node, Held held, double nowUt)
        {
            foreach (var e in _retargetEvents)
            {
                if (Live(e) && string.Equals(e.Record.Node, node, StringComparison.Ordinal))
                {
                    e.Waiting.Remove(held.Message.Id);
                }
            }
        }

        private bool IsRetargetedFlight(string node, string to) =>
            _retargetEvents.Any(x => x.Record.Phase == RetargetPhase.Turned
                && string.Equals(x.Record.Node, node, StringComparison.Ordinal)
                && string.Equals(x.Record.Peer, to, StringComparison.Ordinal));

        /// <summary>What a journey report of a departure says when the dish was turned to carry it.</summary>
        private string? RetargetDetail(string node, string to, double nowUt)
        {
            var e = _retargetEvents.FirstOrDefault(x =>
                x.Record.Phase == RetargetPhase.Turned
                && string.Equals(x.Record.Node, node, StringComparison.Ordinal)
                && string.Equals(x.Record.Peer, to, StringComparison.Ordinal));
            return e == null ? null : "turned dish " + e.Record.Dish + " to " + to;
        }

        /// <summary>
        /// Restores a turned dish once nothing is left waiting for it and its link
        /// has had time to carry what it carried, and ends an announced event whose
        /// messages have all gone another way.
        /// </summary>
        private void TickRetargets(double nowUt)
        {
            foreach (var e in _retargetEvents.Where(Live).ToList())
            {
                if (!_autoRetarget(e.Record.Node))
                {
                    RestoreEvent(e, nowUt);
                    continue;
                }
                var stillHeld = e.Waiting.Where(id => IsHeldAt(e.Record.Node, id)).ToList();
                e.Waiting = new HashSet<string>(stillHeld, StringComparer.Ordinal);
                if (e.Record.Phase == RetargetPhase.Turned
                    && nowUt >= e.Record.TurnedUt + _retargetOptions.LinkUpSeconds - Tolerance
                    && e.Waiting.Count == 0)
                {
                    RestoreEvent(e, nowUt);
                    continue;
                }
                if (e.Record.Phase == RetargetPhase.Turned && nowUt >= e.Record.TurnedUt + _retargetOptions.AwayCapSeconds - Tolerance)
                {
                    RestoreEvent(e, nowUt);
                    continue;
                }
                if (e.Record.Phase == RetargetPhase.Announced && !e.Turning && e.Waiting.Count == 0)
                {
                    Finish(e, RetargetPhase.Ended, nowUt);
                }
            }
            _retargetEvents.RemoveAll(e => !Live(e) && nowUt > e.Record.EndedUt + 3600.0);
        }

        /// <summary>Runs the dish turns and restores queued under the lock, outside it: an actuator may wait on the game's main thread, which may be waiting for a save to take the lock.</summary>
        private void RunActuations()
        {
            while (true)
            {
                Action next;
                lock (_gate)
                {
                    if (_actuations.Count == 0)
                    {
                        return;
                    }
                    next = _actuations[0];
                    _actuations.RemoveAt(0);
                }
                next();
            }
        }

        /// <summary>
        /// When a hop to <c>next.To</c> would land on a dish whose window a peer
        /// announced, and this node has heard the announcement, the hop waits until
        /// the window is over. Null when nothing blocks it.
        /// </summary>
        private double? AfterAnnouncedWindow(string node, PlannedHop next, double nowUt)
        {
            if (next.ToDish == null)
            {
                return null;
            }
            var flight = Math.Max(0.0, next.ArriveUt - next.DepartUt);
            var arrival = Math.Max(next.DepartUt, nowUt) + flight;
            foreach (var e in _retargetEvents)
            {
                var r = e.Record;
                if (!string.Equals(r.Dish, next.ToDish, StringComparison.Ordinal))
                {
                    continue;
                }
                var ended = !double.IsNaN(r.EndedUt);
                var back = ended && HeardAt(r.Node, node, r.EndedUt, nowUt) ? Math.Min(r.BackUt, r.EndedUt) : r.BackUt;
                if (!HeardAt(r.Node, node, r.AnnouncedUt, nowUt) || arrival < r.TurnUt - Tolerance || arrival >= back - Tolerance)
                {
                    continue;
                }
                return Math.Max(back - flight, nowUt + 1e-3);
            }
            return null;
        }

        /// <summary>Whether what <paramref name="from"/> said at <paramref name="saidUt"/> has reached <paramref name="viewer"/> by <paramref name="nowUt"/>, at light speed.</summary>
        private bool HeardAt(string from, string viewer, double saidUt, double nowUt)
        {
            if (string.Equals(from, viewer, StringComparison.Ordinal))
            {
                return true;
            }
            var light = _links.LivePath(from, viewer);
            return light != null && nowUt >= saidUt + light.Value - Tolerance;
        }

        private RetargetSnapshot SnapshotRetargets() => new RetargetSnapshot
        {
            Events = _retargetEvents.Select(e => Copy(e)).ToList(),
            Rests = _rests.Select(r => new RetargetRestRecord { Dish = r.Key, UntilUt = r.Value }).ToList(),
        };

        private void ResetRetargets()
        {
            foreach (var e in _retargetEvents)
            {
                e.CancelTurn?.Invoke();
                e.CancelCap?.Invoke();
            }
            _retargetEvents.Clear();
            _rests.Clear();
            _failedDishes.Clear();
            _actuations.Clear();
        }

        /// <summary>
        /// Brings back the events a save carried. A turn that had not started
        /// starts when it is due. A dish that was turned is put back at once if
        /// its time is up, and otherwise when it would have been.
        /// </summary>
        private void RestoreRetargets(RetargetSnapshot snapshot, double nowUt)
        {
            foreach (var rest in snapshot.Rests)
            {
                _rests[rest.Dish] = rest.UntilUt;
            }
            foreach (var record in snapshot.Events)
            {
                var e = new RetargetEvent { Record = record, Waiting = new HashSet<string>(record.Waiting, StringComparer.Ordinal) };
                e.Record.Waiting = new List<string>();
                _retargetEvents.Add(e);
                if (e.Record.Phase == RetargetPhase.Announced)
                {
                    ScheduleTurn(e, nowUt);
                    continue;
                }
                if (e.Record.Phase == RetargetPhase.Turned)
                {
                    ArmTurned(e, nowUt);
                }
            }
        }
    }
}
