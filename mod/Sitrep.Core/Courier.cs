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
    /// (`pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`) and re-run
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

        // node -> vantage -> the UT the link was marked down since (absent =
        // currently up). See MarkLinkDown/MarkLinkUp and ResolveStaleness --
        // the M2 seam a future M3 comms-capability provider calls into so a
        // late/reconnecting subscriber's catch-up sample is honestly labeled
        // instead of Fresh. Deliberately untouched by ResetTimeline: link
        // reachability is a NETWORK-topology fact, orthogonal to the
        // quickload timeline it resets (same rationale as _subscribers).
        private readonly Dictionary<string, Dictionary<string, double>> _linkDownSince =
            new Dictionary<string, Dictionary<string, double>>();

        // node -> topic -> the last REVEALED (i.e. already-Record()ed, so
        // already past whatever reveal gate the caller runs in front of this
        // Courier — see Record's isKeyframe parameter) sample explicitly
        // flagged as a self-contained "keyframe" for a cursor-relative diff
        // stream (Delivery.ReliableOrdered channels like the kOS terminal —
        // see ChannelDeclaration.IsKeyframe). C#-ONLY addition, no TS
        // reference (same class as ResetTimeline / the ReliableOrdered lane
        // itself): mirrors, for an event/diff stream, what Archive's plain
        // "latest recorded sample" ALREADY gives a value/LossyLatest channel
        // for free (see ReadAtVantage) -- a diff stream additionally needs
        // the catch-up to be specifically the last KEYFRAME, never a bare
        // diff with no baseline to apply it to. Empty unless a caller
        // explicitly passes isKeyframe:true to Record, so every existing
        // call site (including every golden-fixture conformance test) is
        // byte-for-byte unaffected.
        private readonly Dictionary<string, Dictionary<string, ArchiveSample>> _stickyKeyframes =
            new Dictionary<string, Dictionary<string, ArchiveSample>>();

        private long _seq;
        private CommandHandler _commandHandler = (_, __, ___) => null;

        // Generation counter for the current timeline -- see Meta.TimelineEpoch's
        // doc comment. Incremented once per ResetTimeline call (quickload/
        // rewind); stamped on every envelope Meta via MakeMeta, and threaded
        // into Archive.Record so every STORED point also carries the epoch
        // it was actually recorded under (not whatever epoch happens to be
        // current at delivery/catch-up time).
        private int _epoch;

        /// <summary>The current timeline generation -- see <see cref="Meta.TimelineEpoch"/>.</summary>
        public int CurrentEpoch => _epoch;

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
            Action<CommandResponse> onResponse,
            double? uplinkDelaySeconds = null)
        {
            if (!_network.Reachable(vantage, node))
            {
                return;
            }

            // uplinkDelaySeconds is a C#-ONLY extension (no TS reference, same
            // class as ResetTimeline / the ReliableOrdered lane): the caller
            // can override the one-way delay with a LIVE value — the host's
            // signal delay — so a delayed command reaches the craft at
            // t0 + signalDelay, symmetric with the downlink reveal gate, rather
            // than the fixed network hop. Omitted (every golden-fixture call
            // site) ⇒ the historical _network.DelayTo, byte-for-byte unchanged.
            var up = uplinkDelaySeconds ?? _network.DelayTo(vantage, node);
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
        ///
        /// ALSO resets every node's <see cref="Archive"/> (see
        /// <see cref="Archive.ResetTimeline"/>) — dropping this method's own
        /// pending callbacks is not enough on its own: the archive's
        /// per-(topic, vantage) cursor is a SEPARATE piece of state that
        /// survives a bare <see cref="IClock.Reset"/>, and its monotonic
        /// "never rewinds" clamp (valid only within one timeline) would
        /// otherwise keep pinning every post-reset read to the abandoned
        /// timeline's peak, serving stale data (or, once no sample above
        /// that pinned peak survives a prune, freezing outright) forever.
        /// This is what makes a rewind fully clean rather than merely
        /// stopping the wedge.
        ///
        /// Also prunes <see cref="_stickyKeyframes"/> the same way (a sticky
        /// keyframe recorded on the abandoned timeline, at a UT ahead of the
        /// rewind target, must never leak to a late subscriber's catch-up
        /// post-rewind — the same forever-erased guarantee
        /// <see cref="Archive.ResetTimeline"/> gives ordinary archived
        /// samples).
        /// </summary>
        public void ResetTimeline(double ut)
        {
            // Bump FIRST: every sample recorded from here on (the caller's
            // own immediately-following Record on the new timeline) must
            // carry the NEW epoch, and BroadcastTimelineReset-style
            // announcements built from CurrentEpoch right after this call
            // returns must already see it too.
            _epoch++;
            _pendingCommands.Clear();
            foreach (var archive in _archives.Values)
            {
                archive.ResetTimeline(ut);
            }
            foreach (var stickyByTopic in _stickyKeyframes.Values)
            {
                foreach (var topic in new List<string>(stickyByTopic.Keys))
                {
                    if (stickyByTopic[topic].ValidAt > ut)
                    {
                        stickyByTopic.Remove(topic);
                    }
                }
            }
            _clock.Reset(ut);
        }

        /// <summary>
        /// C#-ONLY seam for a future M3 comms-capability provider (not yet
        /// built — see <see cref="ResolveStaleness"/>'s doc comment): record
        /// that the link between <paramref name="vantage"/> and
        /// <paramref name="node"/> has been down since <paramref name="sinceUt"/>.
        /// Idempotent (a later call overwrites the recorded since-UT).
        /// </summary>
        public void MarkLinkDown(string node, string vantage, double sinceUt)
        {
            if (!_linkDownSince.TryGetValue(node, out var byVantage))
            {
                byVantage = new Dictionary<string, double>();
                _linkDownSince[node] = byVantage;
            }
            byVantage[vantage] = sinceUt;
        }

        /// <summary>Companion of <see cref="MarkLinkDown"/> — marks the link between <paramref name="vantage"/> and <paramref name="node"/> as currently up (a no-op if it wasn't marked down).</summary>
        public void MarkLinkUp(string node, string vantage)
        {
            if (_linkDownSince.TryGetValue(node, out var byVantage))
            {
                byVantage.Remove(vantage);
            }
        }

        /// <summary>
        /// Record a SCET-stamped sample and schedule its delayed delivery to
        /// every current subscriber.
        ///
        /// <para><paramref name="delivery"/> selects the scheduled-delivery
        /// LANE (a C#-ONLY addition, no TS reference — same class of
        /// extension as <see cref="ResetTimeline"/>/<see cref="Archive.Snapshot"/>).
        /// <see cref="Delivery.LossyLatest"/> (the default, and every existing
        /// call site incl. the golden-fixture conformance tests) keeps the
        /// exact historical behaviour: each scheduled delivery RE-READS the
        /// archive at fire time via <see cref="Deliver"/>/<see cref="Archive.ReadAtVantage"/>,
        /// resolving to the latest sample with <c>ValidAt &lt;= scene</c> —
        /// correct coalescing for a state topic. <see cref="Delivery.ReliableOrdered"/>
        /// instead FORWARDS the exact sample captured at schedule time,
        /// exactly once, in record order — the right semantics for a
        /// cursor-relative ORDERED DIFF stream (the kOS terminal), where two
        /// frames sharing a <c>ValidAt</c> must both be delivered rather than
        /// the earlier one being coalesced away by the state re-read. Delay,
        /// scheduling (<c>fireUt = validAt + delay</c>), and the rewind/
        /// quickload drop semantics are identical across both lanes — only
        /// WHAT the scheduled callback delivers differs.</para>
        ///
        /// <para><paramref name="isKeyframe"/> — a C#-ONLY addition, no TS
        /// reference (same class as <paramref name="delivery"/> above) —
        /// flags THIS sample as a self-contained sticky catch-up baseline for
        /// <paramref name="topic"/> (see <see cref="_stickyKeyframes"/> and
        /// <see cref="ChannelDeclaration.IsKeyframe"/>). Defaults to
        /// <c>false</c>: every existing call site is unaffected, and the
        /// sticky cache stays permanently empty for any topic no caller ever
        /// opts in for, leaving <see cref="SubscribeStream"/>'s catch-up on
        /// its original plain-archive-read path.</para>
        /// </summary>
        public void Record(string node, string topic, object? value, double validAtUt, Delivery delivery = Delivery.LossyLatest, bool isKeyframe = false)
        {
            ArchiveFor(node).Record(topic, value, validAtUt, _epoch);

            if (isKeyframe)
            {
                if (!_stickyKeyframes.TryGetValue(node, out var stickyByTopic))
                {
                    stickyByTopic = new Dictionary<string, ArchiveSample>();
                    _stickyKeyframes[node] = stickyByTopic;
                }
                stickyByTopic[topic] = new ArchiveSample(value, validAtUt, _epoch);
            }

            if (!_subscribers.TryGetValue(node, out var byTopic) || !byTopic.TryGetValue(topic, out var subs))
            {
                return;
            }

            // Capture the epoch this sample was recorded under, for the
            // ReliableOrdered forward path (see below) — mirrors what
            // Archive.Record itself stamps.
            var epoch = _epoch;

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
                if (delivery == Delivery.ReliableOrdered)
                {
                    // Ordered-diff lane: forward THIS specific sample, once, in
                    // record order — not a fire-time archive re-read (which
                    // would coalesce same-ValidAt frames to the latest). The
                    // captured value/validAt/epoch are pinned in the closure so
                    // the delivery is independent of any later Record on the
                    // same topic. A rewind still drops this scheduled callback
                    // wholesale (ManualClock.Reset), exactly as the re-read lane
                    // would have returned nothing for an abandoned sample.
                    var forwarded = new ArchiveSample(value, validAtUt, epoch);
                    _clock.Schedule(fireUt, () =>
                    {
                        if (!subs.Contains(subscriber))
                        {
                            return;
                        }
                        DeliverSample(node, topic, subscriber, forwarded, fireUt);
                    });
                }
                else
                {
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

            // Catch-up: deliver whatever has already "arrived" at this
            // vantage. isCatchUp:true is the ONLY delivery site that may
            // stamp Staleness other than Fresh (see ResolveStaleness) — a
            // late/reconnecting subscriber served an archived sample from
            // before a gap, per the M2 design's server-stampable half of
            // the staleness model.
            //
            // Sticky-keyframe override (C#-ONLY, no TS reference — see
            // _stickyKeyframes' doc comment): if this topic has an opted-in
            // sticky keyframe, catch-up on THAT specifically rather than
            // Archive's plain "latest recorded sample" read. For a
            // cursor-relative diff stream, the two can diverge — the latest
            // recorded sample may be an ordinary incremental diff (recorded
            // after the last keyframe, while some earlier subscriber was
            // watching), which has no baseline for a brand-new subscriber to
            // apply it to. The sticky cache is only ever populated with
            // already-Record()ed (i.e. already past whatever reveal gate the
            // caller runs) samples, so this is never a "reveal early" leak —
            // see Record's isKeyframe parameter.
            if (_stickyKeyframes.TryGetValue(node, out var stickyByTopic) && stickyByTopic.TryGetValue(topic, out var sticky))
            {
                subscriber.OnData(StreamDataFor(node, topic, vantage, sticky, now, isCatchUp: true));
            }
            else
            {
                Deliver(node, topic, subscriber, now, isCatchUp: true);
            }

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
        private void Deliver(string node, string topic, Subscriber subscriber, double fireUt, bool isCatchUp = false)
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
            subscriber.OnData(StreamDataFor(node, topic, subscriber.Vantage, sample.Value, fireUt, isCatchUp));
        }

        /// <summary>
        /// Deliver the SPECIFIC <paramref name="forwarded"/> sample captured
        /// when this delivery was scheduled — the <see cref="Delivery.ReliableOrdered"/>
        /// lane (see <see cref="Record"/>). Unlike <see cref="Deliver"/> this
        /// does NOT re-read the archive at fire time, so a burst of frames
        /// sharing a <c>ValidAt</c> each forwards its own value in record order
        /// instead of every scheduled read resolving the coalesced latest.
        /// Never a catch-up (the synchronous catch-up + in-flight reschedule in
        /// <see cref="SubscribeStream"/> deliberately stay on the re-read lane —
        /// a late joiner is reseeded, not replayed the whole diff history), so
        /// staleness is always <see cref="Staleness.Fresh"/>.
        /// </summary>
        private void DeliverSample(string node, string topic, Subscriber subscriber, ArchiveSample forwarded, double fireUt)
        {
            subscriber.OnData(StreamDataFor(node, topic, subscriber.Vantage, forwarded, fireUt, isCatchUp: false));
        }

        private StreamData StreamDataFor(string node, string topic, string vantage, ArchiveSample sample, double deliveredAt, bool isCatchUp)
        {
            var staleness = isCatchUp ? ResolveStaleness(node, vantage, sample) : Staleness.Fresh;
            return new StreamData
            {
                Topic = topic,
                Payload = sample.Value,
                Meta = MakeMeta(node, vantage, sample.ValidAt, deliveredAt, sample.Epoch, staleness),
            };
        }

        /// <summary>
        /// Resolves the wire <see cref="Staleness"/> for a CATCH-UP delivery
        /// only (see <see cref="Deliver"/>'s <c>isCatchUp</c> parameter and
        /// <see cref="SubscribeStream"/>'s doc comment) — every other
        /// delivery stays <see cref="Staleness.Fresh"/> unconditionally.
        /// Consults <see cref="MarkLinkDown"/>/<see cref="MarkLinkUp"/>'s
        /// per-(node, vantage) state, the M2 seam a future M3 comms-capability
        /// provider drives: no link marked down -> Fresh (the served sample
        /// is, by construction of <see cref="Archive.ReadAtVantage"/>, always
        /// the freshest available as of this vantage's scene — an old
        /// <c>validAt</c> on a change-gated channel is FRESH, never inferred
        /// stale from age alone, per the design doc §4.1). A link marked
        /// down -&gt; the served sample predates or coincides with the known
        /// blackout start (<c>ValidAt &lt;= sinceUt</c>): <see cref="Staleness.LastBeforeBlackout"/>
        /// — honestly "the last thing that got out before the blackout".
        /// The defensive fallback (link down but the served sample's
        /// <c>ValidAt</c> is somehow AFTER the known blackout start — should
        /// not happen if the link genuinely dropped every delivery, but
        /// costs nothing to guard) is <see cref="Staleness.HeldStale"/>.
        /// </summary>
        private Staleness ResolveStaleness(string node, string vantage, ArchiveSample sample)
        {
            if (_linkDownSince.TryGetValue(node, out var byVantage) && byVantage.TryGetValue(vantage, out var sinceUt))
            {
                return sample.ValidAt <= sinceUt ? Staleness.LastBeforeBlackout : Staleness.HeldStale;
            }
            return Staleness.Fresh;
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
                // Commands never touch the Archive, so there's no per-sample
                // epoch to read -- stamp the Courier's own current epoch
                // (accurate: a command can only mature/confirm on whatever
                // timeline is live at that moment) and always Fresh (a
                // command response is never a catch-up replay).
                Meta = MakeMeta(node, vantage, validAt, deliveredAt, _epoch, Staleness.Fresh),
            };
        }

        private Meta MakeMeta(string node, string vantage, double validAt, double deliveredAt, int epoch, Staleness staleness)
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
                Staleness = staleness,
                TimelineEpoch = epoch,
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
        /// Whether <paramref name="node"/>'s archive currently has ANY
        /// surviving tail sample (value or tombstone) for
        /// <paramref name="topic"/> — see <see cref="Archive.HasAnyTail"/>.
        /// Deliberately reads <see cref="_archives"/> directly (rather than
        /// through <see cref="ArchiveFor"/>) so querying a node/topic that
        /// has never recorded anything doesn't side-effect an empty
        /// <see cref="Archive"/> into existence. Exposed here because
        /// <c>ChannelEngine</c> only ever holds a <see cref="Courier"/>
        /// reference, never an <see cref="Archive"/> directly (one archive
        /// per node, private to this class).
        /// </summary>
        public bool HasAnyArchiveTail(string node, string topic)
        {
            return _archives.TryGetValue(node, out var archive) && archive.HasAnyTail(topic);
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
