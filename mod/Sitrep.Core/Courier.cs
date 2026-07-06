using System;
using System.Collections.Generic;
using Sitrep.Contract;

// Sitrep.Core has no reason to carry the TS StreamData<T>/CommandResponse<TResult>
// type parameter — Payload/Result are object?, matching how Archive already
// treats recorded values. These file-scoped aliases pin the closed generic
// form so the rest of this file (and Sitrep.Core.Tests, which declares the
// same aliases) can keep referring to the plain names StreamData /
// CommandResponse, exactly as before the Sitrep.Contract reconciliation.
using StreamData = Sitrep.Contract.StreamData<object?>;
using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core
{
    /// <summary>Executes a dispatched command on <c>node</c>; returns the result carried back in the confirmation.</summary>
    public delegate object? CommandHandler(string command, object? args, string node);

    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/courier.ts</c>'s <c>Courier</c> —
    /// the reference delay engine for both TELEMETRY (streams) and COMMANDS
    /// (round-trip request/response). Semantics MUST stay byte-for-byte
    /// identical to the TS reference — conformance is asserted by
    /// <c>Sitrep.Core.Tests</c> against the shared golden fixtures in
    /// <c>mod/golden-fixtures/courier.json</c>, not by re-deriving semantics
    /// here. If you touch this file, regenerate the fixture from the TS side
    /// (`pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`) and re-run
    /// `dotnet test` to confirm the two still agree.
    ///
    /// Streams: a sample recorded at UT <c>V</c> for a node/topic is
    /// delivered to a subscribing Vantage at UT
    /// <c>V + network.DelayTo(vantage, node)</c>, scheduled on the Clock and
    /// read back through that node's <see cref="Archive"/> at the vantage's
    /// own cursor.
    ///
    /// Commands: symmetric uplink/downlink. A command dispatched at
    /// <c>t0</c> travels uplink and executes on the node at <c>t0 + up</c>,
    /// then its confirmation travels downlink and is delivered back to the
    /// vantage at <c>t0 + up + down</c> (<c>up == down ==
    /// network.DelayTo(vantage, node)</c>). If the node is unreachable at
    /// dispatch time, the command is dropped with honest silence — no
    /// execute, no response.
    ///
    /// <see cref="SnapshotCommands"/> / <see cref="RestoreCommands"/> are a
    /// C#-ONLY addition (no TS reference), scoped to the IN-FLIGHT COMMAND
    /// QUEUE only, for M5b quicksave — see their doc comments.
    /// </summary>
    public sealed class Courier
    {
        private sealed class Subscriber
        {
            public string Vantage = string.Empty;
            public Action<StreamData> OnData = null!;
        }

        private sealed class PendingCommand
        {
            public string RequestId = string.Empty;
            public string Node = string.Empty;
            public string Command = string.Empty;
            public object? Args;
            public string Vantage = string.Empty;
            public double ExecuteUt;
            public double ConfirmUt;
            public Action<CommandResponse> OnResponse = null!;
        }

        private readonly IClock _clock;
        private readonly INetwork _network;

        // node -> Archive (one archive per node, shared across all topics on it).
        private readonly Dictionary<string, Archive> _archives = new Dictionary<string, Archive>();

        // node -> topic -> subscribers for that (node, topic) pair. Nested map
        // (rather than a string-concat key) so there's no collision risk
        // between e.g. node "a" topic "bc" and node "ab" topic "c".
        private readonly Dictionary<string, Dictionary<string, HashSet<Subscriber>>> _subscribers =
            new Dictionary<string, Dictionary<string, HashSet<Subscriber>>>();

        // requestId -> in-flight (dispatched, not-yet-confirmed) command.
        // This is the ONLY state SnapshotCommands / RestoreCommands touch.
        private readonly Dictionary<string, PendingCommand> _pendingCommands =
            new Dictionary<string, PendingCommand>();

        private long _seq;
        private CommandHandler _commandHandler = (_, __, ___) => null;

        public Courier(IClock clock, INetwork network)
        {
            _clock = clock;
            _network = network;
        }

        /// <summary>Set the handler invoked (on the vessel, at uplink UT) to execute a dispatched command.</summary>
        public void SetCommandHandler(CommandHandler fn)
        {
            _commandHandler = fn;
        }

        /// <summary>
        /// Expected wall-clock (UT) duration of a full command round trip
        /// between <paramref name="vantage"/> and <paramref name="node"/>:
        /// uplink + downlink, i.e. twice the one-way delay.
        /// </summary>
        public double RoundTripEta(string node, string vantage)
        {
            return 2 * _network.DelayTo(vantage, node);
        }

        /// <summary>
        /// Dispatch a command from <paramref name="vantage"/> to
        /// <paramref name="node"/>. Symmetric uplink/downlink: the command
        /// travels uplink and executes at <c>t0 + up</c>, then the
        /// confirmation travels downlink and is delivered at
        /// <c>t0 + up + down</c> (<c>up == down ==
        /// network.DelayTo(vantage, node)</c>).
        ///
        /// Honest silence on loss: if <paramref name="node"/> is unreachable
        /// from <paramref name="vantage"/> at dispatch time, the command is
        /// dropped entirely — the handler never runs and
        /// <paramref name="onResponse"/> never fires. The client is expected
        /// to infer loss via ETA timeout rather than an explicit error
        /// response.
        /// </summary>
        public void DispatchCommand(
            string node,
            string requestId,
            string command,
            object? args,
            string vantage,
            Action<CommandResponse> onResponse)
        {
            if (!_network.Reachable(vantage, node))
            {
                return;
            }

            var up = _network.DelayTo(vantage, node);
            var down = up;
            var t0 = _clock.Now();
            var executeUt = t0 + up;
            var confirmUt = executeUt + down;

            var pending = new PendingCommand
            {
                RequestId = requestId,
                Node = node,
                Command = command,
                Args = args,
                Vantage = vantage,
                ExecuteUt = executeUt,
                ConfirmUt = confirmUt,
                OnResponse = onResponse,
            };
            _pendingCommands[requestId] = pending;

            ScheduleCommand(pending);
        }

        /// <summary>
        /// Schedules the execute-then-confirm pair for an already-recorded
        /// <see cref="PendingCommand"/>. Shared by <see cref="DispatchCommand"/>
        /// and <see cref="RestoreCommands"/> so both paths reproduce the
        /// identical execute@ExecuteUt / confirm@ConfirmUt behavior.
        /// </summary>
        private void ScheduleCommand(PendingCommand pending)
        {
            _clock.Schedule(pending.ExecuteUt, () =>
            {
                var result = _commandHandler(pending.Command, pending.Args, pending.Node);
                _clock.Schedule(pending.ConfirmUt, () =>
                {
                    // Remove before invoking the callback: a re-entrant
                    // SnapshotCommands() from inside onResponse must not see
                    // an already-confirmed command as still in flight.
                    _pendingCommands.Remove(pending.RequestId);
                    pending.OnResponse(CommandResponseFor(
                        pending.RequestId,
                        result,
                        pending.Node,
                        pending.Vantage,
                        pending.ExecuteUt,
                        pending.ConfirmUt));
                });
            });
        }

        /// <summary>
        /// C#-ONLY addition (no TS reference), for the M5b quicksave
        /// UT-rewind fix: call this when the caller's own tick UT goes
        /// BACKWARD (an F9 quickload) rather than merely pausing or
        /// time-warping. See <c>Gonogo.KSP.GonogoBodiesServer.CourierLoop</c>
        /// (paired 1:1 with <c>Sitrep.Host.IntegrationTests.ReplayBodiesServer.CourierLoop</c>)
        /// for the call site that detects the backward tick and invokes this
        /// before recording at the new UT.
        ///
        /// Drops every in-flight COMMAND (<see cref="_pendingCommands"/>)
        /// and resets <see cref="_clock"/> to <paramref name="ut"/> via
        /// <see cref="IClock.Reset"/> -- which also drops every scheduled
        /// STREAM delivery, since <see cref="Record"/> and
        /// <see cref="SubscribeStream"/> both schedule deliveries on that
        /// same Clock's pending-callback list. Both are abandoned
        /// pre-quickload-timeline state that must never fire.
        ///
        /// Deliberately does NOT touch <see cref="_subscribers"/>: the WS
        /// clients are still connected and still want their stream: only the
        /// in-flight deliveries scheduled against the old timeline are
        /// abandoned, not the subscriptions themselves. The caller is
        /// expected to immediately follow this with a normal
        /// <see cref="Record"/> at the new UT so the stream resumes there
        /// for every surviving subscriber.
        /// </summary>
        public void ResetTimeline(double ut)
        {
            _pendingCommands.Clear();
            _clock.Reset(ut);
        }

        /// <summary>Record a SCET-stamped sample and schedule its delayed delivery to every current subscriber.</summary>
        public void Record(string node, string topic, object? value, double validAtUt)
        {
            ArchiveFor(node).Record(topic, value, validAtUt);

            if (!_subscribers.TryGetValue(node, out var byTopic) || !byTopic.TryGetValue(topic, out var subs))
            {
                return;
            }

            // Snapshot the current subscriber set: later subscribes/unsubscribes
            // must not affect delivery of this already-recorded sample.
            foreach (var subscriber in new List<Subscriber>(subs))
            {
                var delay = _network.DelayTo(subscriber.Vantage, node);
                // Capture this delivery's own fire-UT now: under a single large
                // AdvanceTo() jump, several deliveries can drain in the same
                // batch, and each must read/report its own arrival time rather
                // than whatever clock.Now() happens to be when it fires (see
                // Deliver()).
                var fireUt = validAtUt + delay;
                _clock.Schedule(fireUt, () =>
                {
                    if (!subs.Contains(subscriber))
                    {
                        // Unsubscribed before the delivery fired.
                        return;
                    }
                    Deliver(node, topic, subscriber, fireUt);
                });
            }
        }

        /// <summary>
        /// Subscribe a Vantage to a (node, topic) stream. Immediately
        /// delivers a catch-up of the latest already-arrived value (if any),
        /// schedules delivery of every sample still in flight to this
        /// vantage (recorded before the subscribe but not yet arrived), then
        /// returns an unsubscribe function.
        /// </summary>
        public Action SubscribeStream(string node, string topic, string vantage, Action<StreamData> onData)
        {
            var subscriber = new Subscriber { Vantage = vantage, OnData = onData };

            if (!_subscribers.TryGetValue(node, out var byTopic))
            {
                byTopic = new Dictionary<string, HashSet<Subscriber>>();
                _subscribers[node] = byTopic;
            }
            if (!byTopic.TryGetValue(topic, out var subs))
            {
                subs = new HashSet<Subscriber>();
                byTopic[topic] = subs;
            }
            subs.Add(subscriber);

            var delay = _network.DelayTo(vantage, node);
            var now = _clock.Now();

            // Catch-up: deliver whatever has already "arrived" at this vantage.
            Deliver(node, topic, subscriber, now);

            // Also schedule delivery for every sample recorded before this
            // subscribe that is still in flight (validAt + delay > now).
            // Without this, a subscriber joining mid-transit gets neither the
            // catch-up (which only returns already-arrived samples) nor a
            // record-time schedule (Record() only schedules for subscribers
            // present at the time it ran) — a permanent miss. "Arrived"
            // (<= now, handled by the catch-up above) and "in flight" (> now,
            // handled here) are disjoint, so this never double-delivers.
            foreach (var sample in ArchiveFor(node).Samples(topic))
            {
                var fireUt = sample.ValidAt + delay;
                if (fireUt <= now)
                {
                    continue;
                }
                _clock.Schedule(fireUt, () =>
                {
                    if (!subs.Contains(subscriber))
                    {
                        return;
                    }
                    Deliver(node, topic, subscriber, fireUt);
                });
            }

            return () => subs.Remove(subscriber);
        }

        /// <summary>
        /// Deliver to <paramref name="subscriber"/> as of
        /// <paramref name="fireUt"/> — the UT this delivery was scheduled to
        /// fire at (or <c>clock.Now()</c> for a synchronous catch-up).
        /// Callers MUST pass the delivery's own scheduled fire-UT rather than
        /// re-reading <c>clock.Now()</c>: <see cref="ManualClock.AdvanceTo"/>
        /// sets <c>Now</c> to the target UT before draining callbacks, so
        /// several deliveries firing within one AdvanceTo() call would
        /// otherwise all read the same <c>Now()</c> and compute the same
        /// scene, delivering the latest sample repeatedly and silently
        /// dropping earlier ones.
        /// </summary>
        private void Deliver(string node, string topic, Subscriber subscriber, double fireUt)
        {
            // Recomputed here rather than reusing the delay captured at
            // Record()/SubscribeStream() time — this assumes the delay is
            // unchanged between when the delivery was scheduled and when it
            // fires (true for M3's static point-to-point model).
            var delay = _network.DelayTo(subscriber.Vantage, node);
            var sample = ArchiveFor(node).ReadAtVantage(topic, subscriber.Vantage, delay, fireUt);
            if (sample == null)
            {
                return;
            }
            subscriber.OnData(StreamDataFor(node, topic, subscriber.Vantage, sample.Value, fireUt));
        }

        private StreamData StreamDataFor(string node, string topic, string vantage, ArchiveSample sample, double deliveredAt)
        {
            return new StreamData
            {
                Topic = topic,
                Payload = sample.Value,
                Meta = MakeMeta(node, vantage, sample.ValidAt, deliveredAt),
            };
        }

        private CommandResponse CommandResponseFor(
            string requestId,
            object? result,
            string node,
            string vantage,
            double validAt,
            double deliveredAt)
        {
            return new CommandResponse
            {
                RequestId = requestId,
                Result = result,
                Meta = MakeMeta(node, vantage, validAt, deliveredAt),
            };
        }

        private Meta MakeMeta(string node, string vantage, double validAt, double deliveredAt)
        {
            return new Meta
            {
                Source = node,
                ValidAt = validAt,
                Seq = NextSeq(),
                DeliveredAt = deliveredAt,
                Vantage = vantage,
                Quality = Quality.OnRails,
                Active = true,
                Staleness = Staleness.Fresh,
            };
        }

        private long NextSeq()
        {
            _seq += 1;
            return _seq;
        }

        private Archive ArchiveFor(string node)
        {
            if (!_archives.TryGetValue(node, out var archive))
            {
                archive = new Archive();
                _archives[node] = archive;
            }
            return archive;
        }

        /// <summary>
        /// Capture every in-flight (dispatched, not-yet-confirmed) command as
        /// a plain <see cref="CommandQueueState"/> POCO — requestId, node,
        /// command, args, vantage, and its scheduled execute/confirm UTs.
        /// C#-ONLY (no TS reference), for M5b quicksave.
        ///
        /// Deliberately scoped to the command queue alone: the
        /// <see cref="Archive"/> is persisted separately (Task 4's
        /// <see cref="Archive.Snapshot"/>/<see cref="Archive.Restore"/>), and
        /// telemetry subscriptions + their scheduled deliveries are
        /// runtime/derivable state, NOT persisted here — a reconnecting
        /// client is expected to re-subscribe (which re-triggers the
        /// catch-up + in-flight scheduling in <see cref="SubscribeStream"/>
        /// against the restored archive), rather than the Courier trying to
        /// resurrect closures across a save/load boundary.
        ///
        /// A command captured HERE is, by construction, always still
        /// pre-execute at snapshot time in the intended usage (the round
        /// trip is validated that way in
        /// <c>Sitrep.Core.Tests/CourierCommandQueueSnapshotRestoreTests.cs</c>):
        /// <see cref="RestoreCommands"/> re-schedules from scratch via the
        /// same execute-then-confirm path <see cref="DispatchCommand"/> uses.
        /// If a snapshot is taken AFTER a command's execute UT has already
        /// elapsed (but before its confirm), restoring on a clock whose
        /// current UT is at or past that execute UT will invoke the command
        /// handler again on the very next <c>AdvanceTo</c> — full
        /// exactly-once replay across an execute/confirm-straddling
        /// snapshot is an M5b integration concern, not solved here.
        /// </summary>
        public CommandQueueState SnapshotCommands()
        {
            var state = new CommandQueueState();
            foreach (var pending in _pendingCommands.Values)
            {
                state.Commands.Add(new PendingCommandState
                {
                    RequestId = pending.RequestId,
                    Node = pending.Node,
                    Command = pending.Command,
                    Args = pending.Args,
                    Vantage = pending.Vantage,
                    ExecuteUt = pending.ExecuteUt,
                    ConfirmUt = pending.ConfirmUt,
                });
            }
            return state;
        }

        /// <summary>
        /// Re-establish every command captured by <see cref="SnapshotCommands"/>
        /// against THIS Courier — re-scheduling each command's original
        /// execute UT and confirm UT on this Courier's Clock so it matures
        /// and confirms at the same UTs it would have without the
        /// save/load round trip.
        ///
        /// <paramref name="onResponse"/> is a SINGLE handler shared by every
        /// restored command (rather than one closure per command, which is
        /// exactly the state a save/load round trip cannot carry) — the
        /// realistic post-restore shape is a generic response router that
        /// dispatches to whoever is waiting on a given <c>requestId</c>, not
        /// a per-dispatch callback resurrected from before the save. Call
        /// <see cref="SetCommandHandler"/> on this Courier BEFORE calling
        /// this method if the restored commands' executeUt has already (or
        /// will imminently) elapse relative to the fresh clock's current UT.
        /// </summary>
        public void RestoreCommands(CommandQueueState state, Action<CommandResponse> onResponse)
        {
            foreach (var commandState in state.Commands)
            {
                var pending = new PendingCommand
                {
                    RequestId = commandState.RequestId,
                    Node = commandState.Node,
                    Command = commandState.Command,
                    Args = commandState.Args,
                    Vantage = commandState.Vantage,
                    ExecuteUt = commandState.ExecuteUt,
                    ConfirmUt = commandState.ConfirmUt,
                    OnResponse = onResponse,
                };
                _pendingCommands[pending.RequestId] = pending;
                ScheduleCommand(pending);
            }
        }
    }

    /// <summary>
    /// Plain BCL-only POCO snapshot of a <see cref="Courier"/>'s IN-FLIGHT
    /// COMMAND QUEUE (dispatched, not-yet-confirmed commands only) — see
    /// <see cref="Courier.SnapshotCommands"/> / <see cref="Courier.RestoreCommands"/>.
    /// Deliberately NOT serialization-aware, matching <see cref="ArchiveState"/>:
    /// <c>Sitrep.Core</c> has ZERO external dependencies, so this type
    /// carries no JSON attributes. Turning it into a persisted blob is an
    /// M5b concern, outside this project.
    /// </summary>
    public sealed class CommandQueueState
    {
        public List<PendingCommandState> Commands { get; set; } = new List<PendingCommandState>();
    }

    /// <summary>One in-flight command's state within a <see cref="CommandQueueState"/>.</summary>
    public sealed class PendingCommandState
    {
        public string RequestId { get; set; } = string.Empty;
        public string Node { get; set; } = string.Empty;
        public string Command { get; set; } = string.Empty;
        public object? Args { get; set; }
        public string Vantage { get; set; } = string.Empty;
        public double ExecuteUt { get; set; }
        public double ConfirmUt { get; set; }
    }
}
