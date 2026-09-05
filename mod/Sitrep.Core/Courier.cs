using System;
using System.Collections.Generic;
using Sitrep.Contract;

// Sitrep.Core has no reason to carry the TS StreamData<T>/CommandResponse<TResult>
// type parameter: Payload/Result are object?, matching how Archive already
// treats recorded values. These file-scoped aliases pin the closed generic
// form so the rest of this file (and Sitrep.Core.Tests, which declares the
// same aliases) can keep referring to the plain names StreamData /
// CommandResponse, exactly as before the Sitrep.Contract reconciliation.
using StreamData = Sitrep.Contract.StreamData<object?>;
using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core
{
    /// <summary>Executes a dispatched command on <c>node</c>; returns the result carried back in the confirmation.</summary>
    /// <summary>
    /// Runs a command that has arrived.
    ///
    /// <para><paramref name="vantage"/> is the command centre it was sent FROM, and
    /// it is carried through because some commands cannot be answered without it: a
    /// question like "where does this craft go" has a different correct answer at
    /// each vantage, since each has been told different things. Dropping it here
    /// meant a handler could only ever answer from the game's own state, which is
    /// every vantage's future.</para>
    /// </summary>
    public delegate object? CommandHandler(string command, object? args, string node, string vantage);

    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/courier.ts</c>'s <c>Courier</c>:
    /// the reference delay engine for both TELEMETRY (streams) and COMMANDS
    /// (round-trip request/response). Semantics MUST stay byte-for-byte
    /// identical to the TS reference: conformance is asserted by
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
    /// dispatch time, the command is dropped with honest silence, no
    /// execute, no response.
    ///
    /// <see cref="SnapshotCommands"/> / <see cref="RestoreCommands"/> are a
    /// C#-ONLY addition (no TS reference), scoped to the IN-FLIGHT COMMAND
    /// QUEUE only, for M5b quicksave: see their doc comments.
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
        // currently up). See MarkLinkDown/MarkLinkUp/MarkSubjectLinkDown and
        // ResolveStaleness -- what makes a late or reconnecting subscriber's
        // catch-up sample honestly labeled instead of Fresh. Driven by
        // Sitrep.Host.ChannelEngine's blackout authority (SetSubjectConnected),
        // which is the only thing that knows when a subject went dark; it sat
        // here with no production caller until then.
        // Deliberately untouched by ResetTimeline: link
        // reachability is a NETWORK-topology fact, orthogonal to the
        // quickload timeline it resets (same rationale as _subscribers).
        private readonly Dictionary<string, Dictionary<string, double>> _linkDownSince =
            new Dictionary<string, Dictionary<string, double>>();

        // node -> topic -> the ONE sample on that topic that opens a known break
        // in the record, as (its ValidAt, the ValidAt the break runs back to).
        // See Meta.GapSinceUt.
        //
        // Keyed by the sample's ValidAt rather than "the next delivery" because a
        // LossyLatest delivery is a fire-time archive RE-READ (see Deliver), so
        // WHICH sample a scheduled callback resolves to is not known when Record
        // runs, and there are as many deliveries of it as there are subscribed
        // vantages. Matching on ValidAt attaches the gap to that sample however
        // many times and by whatever route it is served (scheduled delivery,
        // catch-up, in-flight reschedule), and stops attaching it the moment a
        // newer sample supersedes it. Superseded entries are dropped by the next
        // higher-ValidAt Record for the same topic rather than accumulating.
        private readonly Dictionary<string, Dictionary<string, (double ValidAt, double GapSinceUt)>> _gapOpeningSample =
            new Dictionary<string, Dictionary<string, (double, double)>>();

        // node -> topic -> the last REVEALED (i.e. already-Record()ed, so
        // already past whatever reveal gate the caller runs in front of this
        // Courier: see Record's isKeyframe parameter) sample explicitly
        // flagged as a self-contained "keyframe" for a cursor-relative diff
        // stream (Delivery.ReliableOrdered channels like the kOS terminal,
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
        private CommandHandler _commandHandler = (_, __, ___, ____) => null;

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
        /// dropped entirely: the handler never runs and
        /// <paramref name="onResponse"/> never fires. The client is expected
        /// to infer loss via ETA timeout rather than an explicit error
        /// response.
        ///
        /// <para>Reachability is asked ONCE, here, and never again, so a command
        /// dispatched into a route that dies mid-flight still executes on the
        /// craft and still confirms. <see cref="INetwork.DropPath"/> is what
        /// could answer that, and the telemetry lanes consult it; this one does
        /// not. The uplink leg's geometry is the mirror of the downlink's, so
        /// the arithmetic is available, but a command reaching a dead route is
        /// visible to an operator through <c>system.uplink.pending</c> and
        /// changing when an entry leaves that queue is a wire decision rather
        /// than an internal one. Left deliberately, in the open, rather than
        /// guessed at.</para>
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
            // can override the one-way delay with a LIVE value, the host's
            // signal delay: so a delayed command reaches the craft at
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
                var result = _commandHandler(
                    pending.Command, pending.Args, pending.Node, pending.Vantage);
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
        /// <see cref="Archive.ResetTimeline"/>): dropping this method's own
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
        /// post-rewind: the same forever-erased guarantee
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
            // The clock drops every scheduled callback below, so nothing that was
            // owed on the abandoned timeline will ever be asked for. Left in place
            // it would hold retention at a scene no longer reachable, for the rest
            // of the run.
            _owedScenes.Clear();
            // UT has moved backwards, so a schedule set on the abandoned timeline
            // would sit in the future and suppress pruning for the rest of the run.
            _nextPruneUt = double.NegativeInfinity;
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
            // A gap is a statement about one abandoned timeline's record; the
            // sample it was pinned to is gone with the rewind, so nothing could
            // ever match it again. Dropped whole rather than pruned by UT, the
            // same treatment the reveal buffer gets in ChannelEngine.ProcessTick.
            _gapOpeningSample.Clear();
            // Same reasoning one layer over: a break is a statement about the
            // abandoned timeline, and left in place it would go on dooming light
            // sent before it on a timeline where the relay is still alive. See
            // INetwork.ForgetDrops.
            _network.ForgetDrops();
            _clock.Reset(ut);
        }

        /// <summary>
        /// Record that the link between <paramref name="vantage"/> and
        /// <paramref name="node"/> has been down since <paramref name="sinceUt"/>.
        /// Idempotent (a later call overwrites the recorded since-UT).
        ///
        /// <para>C#-ONLY, no TS reference. Driven per-subject by
        /// <see cref="MarkSubjectLinkDown"/>, which is what
        /// <c>Sitrep.Host.ChannelEngine</c> calls; reach for this one directly
        /// only where a single (node, vantage) pair is genuinely the subject,
        /// which nothing in production is yet.</para>
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

        /// <summary>Companion of <see cref="MarkLinkDown"/>: marks the link between <paramref name="vantage"/> and <paramref name="node"/> as currently up (a no-op if it wasn't marked down).</summary>
        public void MarkLinkUp(string node, string vantage)
        {
            if (_linkDownSince.TryGetValue(node, out var byVantage))
            {
                byVantage.Remove(vantage);
            }
        }

        /// <summary>
        /// Mark <paramref name="node"/>'s link down since <paramref name="sinceUt"/>
        /// for EVERY vantage that currently subscribes to it, the whole-subject
        /// twin of <see cref="MarkLinkDown"/>.
        ///
        /// <para>A blackout is a fact about the SUBJECT, not about one observer's
        /// choice of vantage, and the caller that knows about it
        /// (<c>Sitrep.Host.ChannelEngine</c>'s reveal gate) is keyed by node with
        /// no vantage in hand. Per-vantage remains the storage shape because
        /// <see cref="ResolveStaleness"/> answers per delivery, and a future
        /// relay where one vantage can hear a craft another cannot needs the axis
        /// to exist.</para>
        ///
        /// <para>Covers the vantages present NOW. A vantage that subscribes
        /// mid-outage is served through <see cref="SubscribeStream"/>'s catch-up
        /// and gets the honest grade a different way: its catch-up read resolves
        /// to a pre-outage sample because nothing from inside the outage has been
        /// recorded, and <c>MarkSubjectLinkDown</c> is re-applied on the next
        /// tick's connectivity refresh.</para>
        /// </summary>
        public void MarkSubjectLinkDown(string node, double sinceUt)
        {
            if (!_subscribers.TryGetValue(node, out var byTopic))
            {
                return;
            }
            foreach (var subs in byTopic.Values)
            {
                foreach (var subscriber in subs)
                {
                    MarkLinkDown(node, subscriber.Vantage, sinceUt);
                }
            }
        }

        /// <summary>Companion of <see cref="MarkSubjectLinkDown"/>: every vantage's link to <paramref name="node"/> is up again.</summary>
        public void MarkSubjectLinkUp(string node)
        {
            _linkDownSince.Remove(node);
        }

        /// <summary>
        /// Deliver a span of samples the SUBJECT recorded while out of contact,
        /// as one dump transmitted from <paramref name="dumpedAtUt"/>: the
        /// reacquisition instant, in the subject's own UT.
        ///
        /// <para>Each subscriber's copy is scheduled at
        /// <c>dumpedAtUt + DelayTo(vantage, node)</c>, so the dump arrives at the
        /// light-time of the REACQUISITION geometry rather than the geometry at
        /// loss of signal. That is the whole point of routing it through here:
        /// the two differ by however far the craft moved during the outage, and
        /// the recording did not travel until the link came back.</para>
        ///
        /// <para>Every delivered sample keeps its own <c>ValidAt</c> (the instant
        /// it describes) and is stamped <see cref="Staleness.Recorded"/> with
        /// <c>DeliveredAt</c> = its real arrival. Both matter to a client:
        /// <c>DeliveredAt</c> drives the heartbeat tracker and the
        /// <c>ViewClock</c>'s UT-to-wall anchor, and a dump stamped with
        /// <c>validAt + delay</c> would walk both of those backwards.</para>
        ///
        /// <para>The samples are archived at ARRIVAL, inside the scheduled
        /// callback, never at schedule time. Archiving on the way in would let a
        /// vantage that subscribes during the flight time read a blackout sample
        /// through <see cref="Archive.ReadAtVantage"/> before the dump carrying it
        /// has landed, which is a reveal leak of exactly the kind the reveal gate
        /// exists to prevent.</para>
        ///
        /// <para>Forwards each captured sample rather than re-reading the archive
        /// at fire time, the <see cref="Delivery.ReliableOrdered"/> discipline and
        /// for a stronger version of the same reason: a state re-read at one scene
        /// would coalesce the whole dump to its newest sample, which is precisely
        /// the outage window being deleted again one layer down.</para>
        ///
        /// <para><paramref name="gapSinceUt"/> rides the FIRST sample of the dump
        /// (see <see cref="Meta.GapSinceUt"/>): non-null when the recording
        /// overran its storage bound and its oldest span is missing.</para>
        /// </summary>
        public void ReplayRecorded(
            string node,
            string topic,
            IReadOnlyList<ArchiveSample> samples,
            double dumpedAtUt,
            double? gapSinceUt = null)
        {
            if (samples.Count == 0)
            {
                return;
            }
            if (!_subscribers.TryGetValue(node, out var byTopic) || !byTopic.TryGetValue(topic, out var subs))
            {
                return;
            }

            // The reacquisition geometry, pinned once for the whole dump. Each
            // archived copy is stamped with its own WAIT plus that light-time
            // (see DelayStamp.Plus), so a vantage subscribing afterwards reads
            // these as having arrived when the dump landed rather than back
            // inside the outage they describe.
            var dumpStamp = _network.StampFor(node);

            var archived = false;
            foreach (var subscriber in new List<Subscriber>(subs))
            {
                var fireUt = dumpedAtUt + dumpStamp.For(subscriber.Vantage);
                _clock.Schedule(fireUt, () =>
                {
                    // The whole dump left the node at dumpedAtUt, so one break
                    // catches all of it or none of it (INetwork.DropPath). A
                    // dump that never arrived does not become readable history
                    // either, so this refuses the archiving as well as the
                    // delivery.
                    if (_network.Lost(node, dumpedAtUt))
                    {
                        return;
                    }
                    if (!archived)
                    {
                        // Archived once, at the first arrival: the dump becomes
                        // readable history the moment any vantage has it, and
                        // re-archiving per subscriber would duplicate every
                        // sample in the node's archive.
                        archived = true;
                        var archive = ArchiveFor(node);
                        foreach (var sample in samples)
                        {
                            archive.Record(
                                topic,
                                sample.Value,
                                sample.ValidAt,
                                sample.Epoch,
                                dumpStamp.Plus(dumpedAtUt - sample.ValidAt));
                        }
                    }
                    if (!subs.Contains(subscriber))
                    {
                        return;
                    }
                    for (var i = 0; i < samples.Count; i++)
                    {
                        subscriber.OnData(StreamDataFor(
                            node,
                            topic,
                            subscriber.Vantage,
                            samples[i],
                            fireUt,
                            Staleness.Recorded,
                            i == 0 ? gapSinceUt : null));
                    }
                });
            }
        }

        /// <summary>
        /// Record a SCET-stamped sample and schedule its delayed delivery to
        /// every current subscriber.
        ///
        /// <para><paramref name="delivery"/> selects the scheduled-delivery
        /// LANE (a C#-ONLY addition, no TS reference, same class of
        /// extension as <see cref="ResetTimeline"/>/<see cref="Archive.Snapshot"/>).
        /// <see cref="Delivery.LossyLatest"/> (the default, and every existing
        /// call site incl. the golden-fixture conformance tests) keeps the
        /// exact historical behaviour: each scheduled delivery RE-READS the
        /// archive at fire time via <see cref="Deliver"/>/<see cref="Archive.ReadAtInstant"/>,
        /// resolving to the latest sample with <c>ValidAt &lt;= scene</c>,
        /// correct coalescing for a state topic (the scene is this sample's own
        /// ValidAt, from the delay stamped into the closure here, so several
        /// samples sharing a ValidAt still collapse to the latest). <see cref="Delivery.ReliableOrdered"/>
        /// instead FORWARDS the exact sample captured at schedule time,
        /// exactly once, in record order: the right semantics for a
        /// cursor-relative ORDERED DIFF stream (the kOS terminal), where two
        /// frames sharing a <c>ValidAt</c> must both be delivered rather than
        /// the earlier one being coalesced away by the state re-read. Delay,
        /// scheduling (<c>fireUt = validAt + delay</c>), and the rewind/
        /// quickload drop semantics are identical across both lanes, only
        /// WHAT the scheduled callback delivers differs.</para>
        ///
        /// <para><paramref name="isKeyframe"/>: a C#-ONLY addition, no TS
        /// reference (same class as <paramref name="delivery"/> above),
        /// flags THIS sample as a self-contained sticky catch-up baseline for
        /// <paramref name="topic"/> (see <see cref="_stickyKeyframes"/> and
        /// <see cref="ChannelDeclaration.IsKeyframe"/>). Defaults to
        /// <c>false</c>: every existing call site is unaffected, and the
        /// sticky cache stays permanently empty for any topic no caller ever
        /// opts in for, leaving <see cref="SubscribeStream"/>'s catch-up on
        /// its original plain-archive-read path.</para>
        /// </summary>
        public void Record(
            string node,
            string topic,
            object? value,
            double validAtUt,
            Delivery delivery = Delivery.LossyLatest,
            bool isKeyframe = false,
            double? gapSinceUt = null)
        {
            // The delay ledger as it stands right now, pinned to this sample and
            // to every delivery scheduled from it. This is the only instant at
            // which the route the sample rides is knowable: read later, from a
            // catch-up or an in-flight reschedule, the ledger answers for a
            // route the sample never took.
            var stamp = _network.StampFor(node);

            ArchiveFor(node).Record(topic, value, validAtUt, _epoch, stamp);
            NoteGapOpeningSample(node, topic, validAtUt, gapSinceUt);

            // Bound the archives as time moves, so a long session does not make
            // every later subscribe walk the whole session to find the few samples
            // still in flight.
            if (validAtUt >= _nextPruneUt)
            {
                PruneArchives();
                _nextPruneUt = validAtUt + PruneIntervalUt;
            }

            if (isKeyframe)
            {
                if (!_stickyKeyframes.TryGetValue(node, out var stickyByTopic))
                {
                    stickyByTopic = new Dictionary<string, ArchiveSample>();
                    _stickyKeyframes[node] = stickyByTopic;
                }
                stickyByTopic[topic] = new ArchiveSample(value, validAtUt, _epoch, stamp);
            }

            if (!_subscribers.TryGetValue(node, out var byTopic) || !byTopic.TryGetValue(topic, out var subs))
            {
                return;
            }

            // Capture the epoch this sample was recorded under, for the
            // ReliableOrdered forward path (see below): mirrors what
            // Archive.Record itself stamps.
            var epoch = _epoch;

            // Snapshot the current subscriber set: later subscribes/unsubscribes
            // must not affect delivery of this already-recorded sample.
            foreach (var subscriber in new List<Subscriber>(subs))
            {
                // The delay this sample is SENT under. Captured once here and
                // carried into the delivery closure: it is a property of this
                // sample's journey, not a question to re-ask the ledger when it
                // lands (see Deliver()).
                var delay = stamp.For(subscriber.Vantage);
                // Capture this delivery's own fire-UT now: under a single large
                // AdvanceTo() jump, several deliveries can drain in the same
                // batch, and each must read/report its own arrival time rather
                // than whatever clock.Now() happens to be when it fires (see
                // Deliver()).
                var fireUt = validAtUt + delay;
                if (delivery == Delivery.ReliableOrdered)
                {
                    // Ordered-diff lane: forward THIS specific sample, once, in
                    // record order: not a fire-time archive re-read (which
                    // would coalesce same-ValidAt frames to the latest). The
                    // captured value/validAt/epoch are pinned in the closure so
                    // the delivery is independent of any later Record on the
                    // same topic. A rewind still drops this scheduled callback
                    // wholesale (ManualClock.Reset), exactly as the re-read lane
                    // would have returned nothing for an abandoned sample.
                    var forwarded = new ArchiveSample(value, validAtUt, epoch, stamp);
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
                    NoteOwedScene(node, topic, validAtUt);
                    _clock.Schedule(fireUt, () =>
                    {
                        ClearOwedScene(node, topic, validAtUt);
                        if (!subs.Contains(subscriber))
                        {
                            // Unsubscribed before the delivery fired.
                            return;
                        }
                        Deliver(node, topic, subscriber, fireUt, delay);
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

            // The live ledger is the FALLBACK only, for a sample that carries no
            // record-time stamp of its own (Archive-level recording, which is
            // the golden-fixture conformance path). Everything recorded through
            // this Courier answers from its own stamp instead.
            var liveDelay = _network.DelayTo(vantage, node);
            var now = _clock.Now();
            var archived = ArchiveFor(node).Samples(topic);

            // Catch-up: deliver whatever has already "arrived" at this
            // vantage. isCatchUp:true is the ONLY delivery site that may
            // stamp Staleness other than Fresh (see ResolveStaleness), a
            // late/reconnecting subscriber served an archived sample from
            // before a gap, per the M2 design's server-stampable half of
            // the staleness model.
            //
            // Sticky-keyframe override (C#-ONLY, no TS reference: see
            // _stickyKeyframes' doc comment): if this topic has an opted-in
            // sticky keyframe, catch-up on THAT specifically rather than
            // Archive's plain "latest recorded sample" read. For a
            // cursor-relative diff stream, the two can diverge, the latest
            // recorded sample may be an ordinary incremental diff (recorded
            // after the last keyframe, while some earlier subscriber was
            // watching), which has no baseline for a brand-new subscriber to
            // apply it to. The sticky cache is only ever populated with
            // already-Record()ed (i.e. already past whatever reveal gate the
            // caller runs) samples, so this is never a "reveal early" leak,
            // see Record's isKeyframe parameter.
            if (_stickyKeyframes.TryGetValue(node, out var stickyByTopic) && stickyByTopic.TryGetValue(topic, out var sticky))
            {
                subscriber.OnData(StreamDataFor(node, topic, vantage, sticky, now, isCatchUp: true));
            }
            else
            {
                /*
                 * Which sample has genuinely reached this vantage by now, asked
                 * of each sample's own record-time stamp rather than of the
                 * ledger. "now minus whatever the delay currently is" is only
                 * the same question while the route has held still: after a
                 * reroute onto a SHORTER path it resolves to a sample whose
                 * light cannot have arrived yet, which is a future leak, and
                 * after a reroute onto a LONGER one it resolves behind samples
                 * the vantage already holds.
                 *
                 * The newest ARRIVAL wins, not the newest ValidAt. A shortened
                 * route lets a later sample overtake the tail still crossing the
                 * old path, and what a receiver holds is the last thing that
                 * actually came down the wire, which is the same rule the
                 * scheduled lane already delivers on.
                 *
                 * A sample a break caught never came down the wire at all, so it
                 * is not a candidate for "the last thing that did"
                 * (INetwork.DropPath). The scheduled lane gets the same refusal
                 * inside Deliver; here there is no later delivery to catch it.
                 */
                ArchiveSample? arrived = null;
                var arrivedAt = double.NegativeInfinity;
                foreach (var sample in archived)
                {
                    if (_network.Lost(node, sample.ValidAt))
                    {
                        continue;
                    }
                    var at = sample.ValidAt + DelayOf(sample, vantage, liveDelay);
                    if (at <= now && at >= arrivedAt)
                    {
                        arrived = sample;
                        arrivedAt = at;
                    }
                }

                if (arrived != null)
                {
                    // Delivered through the stamped lane, whose scene is exactly
                    // this sample's own ValidAt, so it also moves the vantage's
                    // retention cursor the way the ledger read used to.
                    Deliver(node, topic, subscriber, now, now - arrived.Value.ValidAt, isCatchUp: true);
                }
            }

            // Also schedule delivery for every sample recorded before this
            // subscribe that is still in flight (validAt + delay > now).
            // Without this, a subscriber joining mid-transit gets neither the
            // catch-up (which only returns already-arrived samples) nor a
            // record-time schedule (Record() only schedules for subscribers
            // present at the time it ran): a permanent miss. "Arrived"
            // (<= now, handled by the catch-up above) and "in flight" (> now,
            // handled here) are disjoint, so this never double-delivers.
            foreach (var sample in archived)
            {
                var sampleDelay = DelayOf(sample, vantage, liveDelay);
                var fireUt = sample.ValidAt + sampleDelay;
                if (fireUt <= now)
                {
                    continue;
                }
                var owedScene = sample.ValidAt;
                NoteOwedScene(node, topic, owedScene);
                _clock.Schedule(fireUt, () =>
                {
                    ClearOwedScene(node, topic, owedScene);
                    if (!subs.Contains(subscriber))
                    {
                        return;
                    }
                    Deliver(node, topic, subscriber, fireUt, sampleDelay);
                });
            }

            return () => subs.Remove(subscriber);
        }

        /// <summary>
        /// The delay <paramref name="sample"/>'s own journey to
        /// <paramref name="vantage"/> was sent under: its record-time stamp, or
        /// <paramref name="liveDelaySeconds"/> when it carries none.
        ///
        /// <para>An unstamped sample only reaches here from a direct
        /// <see cref="Archive.Record"/> (the golden-fixture conformance replays
        /// of the TS reference, which has no stamp concept), and falling back to
        /// the live ledger is exactly what this whole path did before stamps
        /// existed.</para>
        /// </summary>
        private static double DelayOf(ArchiveSample sample, string vantage, double liveDelaySeconds) =>
            sample.Stamp != null ? sample.Stamp.For(vantage) : liveDelaySeconds;

        /// <summary>
        /// Deliver to <paramref name="subscriber"/> as of
        /// <paramref name="fireUt"/>: the UT this delivery was scheduled to
        /// fire at (or <c>clock.Now()</c> for a synchronous catch-up).
        /// Callers MUST pass the delivery's own scheduled fire-UT rather than
        /// re-reading <c>clock.Now()</c>: <see cref="ManualClock.AdvanceTo"/>
        /// sets <c>Now</c> to the target UT before draining callbacks, so
        /// several deliveries firing within one AdvanceTo() call would
        /// otherwise all read the same <c>Now()</c> and compute the same
        /// scene, delivering the latest sample repeatedly and silently
        /// dropping earlier ones.
        ///
        /// <para><paramref name="stampedDelaySeconds"/> is the delay this
        /// delivery was SCHEDULED under, captured at
        /// <see cref="Record"/>/<see cref="SubscribeStream"/> time and carried
        /// here in the closure. A scheduled delivery MUST pass it. The archive
        /// then resolves at <c>fireUt - stamp</c>, which is exactly the
        /// sample's own ValidAt, so what lands is what was sent, whatever the
        /// route has done since.</para>
        ///
        /// <para><c>null</c> means "there is no journey to stamp", and nothing
        /// in <see cref="Courier"/> passes it any more: the subscribe-time
        /// catch-up used to, back when it asked the ledger "what is now minus
        /// the CURRENT delay". It now picks the sample with the newest ARRIVAL
        /// off the per-sample stamps and passes <c>now - that sample's ValidAt</c>,
        /// so it lands on this same stamped lane. The parameter stays nullable
        /// for the ledger-and-cursor read itself, which is what
        /// <see cref="Archive.ReadAtVantage"/> still answers for
        /// <see cref="DelayedStateReader"/>.</para>
        ///
        /// <para>Until this stamp existed the delay was re-read from the ledger
        /// here, which assumed it was unchanged between scheduling and firing.
        /// A relay going offline while the craft reroutes breaks that
        /// assumption without ever disconnecting the craft, so the reveal gate
        /// never sees it: the tail already in flight was re-resolved against
        /// the new route's light-time and came out skipped (shorter route) or
        /// replayed as duplicate frames with the tail lost (longer route). See
        /// <see cref="Archive.ReadAtInstant"/>.</para>
        ///
        /// <para>A sample caught by a break (<see cref="INetwork.DropPath"/>) is
        /// declined here rather than cancelled at the clock. This lane re-reads
        /// the archive at fire time anyway, so the delivery that cannot happen
        /// simply does not, which needs no cancellation plumbing and no second
        /// index of scheduled callbacks. The read runs FIRST and is allowed to
        /// move the vantage cursor: a sample that never arrived must not be
        /// served later as a catch-up either.</para>
        /// </summary>
        private void Deliver(
            string node,
            string topic,
            Subscriber subscriber,
            double fireUt,
            double? stampedDelaySeconds,
            bool isCatchUp = false)
        {
            var archive = ArchiveFor(node);
            var sample = stampedDelaySeconds != null
                ? archive.ReadAtInstant(topic, subscriber.Vantage, fireUt - stampedDelaySeconds.Value)
                : archive.ReadAtVantage(
                    topic, subscriber.Vantage, _network.DelayTo(subscriber.Vantage, node), fireUt);
            if (sample == null || _network.Lost(node, sample.Value.ValidAt))
            {
                return;
            }
            subscriber.OnData(StreamDataFor(node, topic, subscriber.Vantage, sample.Value, fireUt, isCatchUp));
        }

        /// <summary>
        /// Deliver the SPECIFIC <paramref name="forwarded"/> sample captured
        /// when this delivery was scheduled, the <see cref="Delivery.ReliableOrdered"/>
        /// lane (see <see cref="Record"/>). Unlike <see cref="Deliver"/> this
        /// does NOT re-read the archive at fire time, so a burst of frames
        /// sharing a <c>ValidAt</c> each forwards its own value in record order
        /// instead of every scheduled read resolving the coalesced latest.
        /// Never a catch-up (the synchronous catch-up + in-flight reschedule in
        /// <see cref="SubscribeStream"/> deliberately stay on the re-read lane,
        /// a late joiner is reseeded, not replayed the whole diff history), so
        /// staleness is always <see cref="Staleness.Fresh"/>.
        ///
        /// <para>Declines a sample caught by a break the same way
        /// <see cref="Deliver"/> does (<see cref="INetwork.DropPath"/>). This
        /// lane pins its value in the closure rather than re-reading, so the
        /// check is the only thing standing between a doomed frame and an
        /// ordered diff stream that would apply it.</para>
        /// </summary>
        private void DeliverSample(string node, string topic, Subscriber subscriber, ArchiveSample forwarded, double fireUt)
        {
            if (_network.Lost(node, forwarded.ValidAt))
            {
                return;
            }
            subscriber.OnData(StreamDataFor(node, topic, subscriber.Vantage, forwarded, fireUt, isCatchUp: false));
        }

        private StreamData StreamDataFor(string node, string topic, string vantage, ArchiveSample sample, double deliveredAt, bool isCatchUp)
        {
            var staleness = isCatchUp ? ResolveStaleness(node, vantage, sample) : Staleness.Fresh;
            return StreamDataFor(node, topic, vantage, sample, deliveredAt, staleness, GapFor(node, topic, sample.ValidAt));
        }

        /// <summary>
        /// Record that the sample at <paramref name="validAtUt"/> opens a known
        /// break in <paramref name="topic"/>'s record, and drop a superseded
        /// entry: see <see cref="_gapOpeningSample"/>. A <c>null</c>
        /// <paramref name="gapSinceUt"/> (every ordinary call site) only prunes.
        /// </summary>
        private void NoteGapOpeningSample(string node, string topic, double validAtUt, double? gapSinceUt)
        {
            if (!_gapOpeningSample.TryGetValue(node, out var byTopic))
            {
                if (gapSinceUt == null)
                {
                    return;
                }
                byTopic = new Dictionary<string, (double, double)>();
                _gapOpeningSample[node] = byTopic;
            }

            if (gapSinceUt != null)
            {
                byTopic[topic] = (validAtUt, gapSinceUt.Value);
                return;
            }

            if (byTopic.TryGetValue(topic, out var held) && validAtUt > held.ValidAt)
            {
                byTopic.Remove(topic);
            }
        }

        /// <summary><see cref="Meta.GapSinceUt"/> for the sample at <paramref name="validAtUt"/>, or null when it opens no known break.</summary>
        private double? GapFor(string node, string topic, double validAtUt)
        {
            if (_gapOpeningSample.TryGetValue(node, out var byTopic)
                && byTopic.TryGetValue(topic, out var held)
                && held.ValidAt == validAtUt)
            {
                return held.GapSinceUt;
            }
            return null;
        }

        /// <summary>
        /// As the <c>isCatchUp</c> overload, with the wire
        /// <see cref="Staleness"/> and <see cref="Meta.GapSinceUt"/> supplied by
        /// the caller rather than derived: the replay lane
        /// (<see cref="ReplayRecorded"/>) knows both outright, and neither is
        /// reachable from the catch-up/fresh choice the other overload makes.
        /// </summary>
        private StreamData StreamDataFor(
            string node,
            string topic,
            string vantage,
            ArchiveSample sample,
            double deliveredAt,
            Staleness staleness,
            double? gapSinceUt)
        {
            return new StreamData
            {
                Topic = topic,
                Payload = sample.Value,
                Meta = MakeMeta(node, vantage, sample.ValidAt, deliveredAt, sample.Epoch, staleness, gapSinceUt),
            };
        }

        /// <summary>
        /// Resolves the wire <see cref="Staleness"/> for a CATCH-UP delivery
        /// only (see <see cref="Deliver"/>'s <c>isCatchUp</c> parameter and
        /// <see cref="SubscribeStream"/>'s doc comment): every other
        /// delivery stays <see cref="Staleness.Fresh"/> unconditionally.
        /// Consults <see cref="MarkLinkDown"/>/<see cref="MarkLinkUp"/>'s
        /// per-(node, vantage) state, which the blackout authority in
        /// <c>Sitrep.Host.ChannelEngine.SetSubjectConnected</c> drives: no link
        /// marked down -> Fresh (the served sample
        /// is, by construction of <see cref="Archive.ReadAtVantage"/>, always
        /// the freshest available as of this vantage's scene, an old
        /// <c>validAt</c> on a change-gated channel is FRESH, never inferred
        /// stale from age alone, per the design doc §4.1). A link marked
        /// down -&gt; the served sample predates or coincides with the known
        /// blackout start (<c>ValidAt &lt;= sinceUt</c>): <see cref="Staleness.LastBeforeBlackout"/>,
        /// honestly "the last thing that got out before the blackout".
        /// The defensive fallback (link down but the served sample's
        /// <c>ValidAt</c> is somehow AFTER the known blackout start, should
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

        private Meta MakeMeta(
            string node,
            string vantage,
            double validAt,
            double deliveredAt,
            int epoch,
            Staleness staleness,
            double? gapSinceUt = null)
        {
            return new Meta
            {
                GapSinceUt = gapSinceUt,
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

        /// <summary>
        /// How often, in UT seconds, archives are pruned back to what their
        /// vantages can still reach.
        ///
        /// <para>Driven off recording rather than a timer because that is the call
        /// that grows the thing being bounded, and throttled because a prune walks
        /// each topic from its oldest sample: doing it per record would put an O(n)
        /// scan on the hot path to save an O(1) append.</para>
        ///
        /// <para>A minute of UT is chosen against the cost it removes rather than
        /// against tidiness. <see cref="SubscribeStream"/> walks a topic's whole
        /// history on every subscribe, so what matters is that the history is short
        /// by the time somebody subscribes, not that it is short at every instant.</para>
        /// </summary>
        private const double PruneIntervalUt = 60;

        private double _nextPruneUt = double.NegativeInfinity;

        /// <summary>
        /// Per (node, topic), the scene instant of every scheduled-but-unfired
        /// stamped delivery, as a multiset. The smallest key is the oldest sample
        /// this Courier still owes somebody on that topic, and retention is held at
        /// or below it (see <see cref="Archive.PruneToVantageCursors"/>).
        ///
        /// <para>A vantage cursor stopped bounding this on its own once a delivery
        /// began carrying its own record-time delay: a route that shortens mid-flight
        /// lets post-change samples overtake the tail still crossing the old path, so
        /// the cursor ratchets past a scene that is still owed. Pruning to it alone
        /// would then drop the sample the tail delivery is about to ask for, and the
        /// read would fall back to the retained birth sample: a very stale frame
        /// rather than the one that was sent.</para>
        ///
        /// <para>Keyed per topic rather than as one floor for the whole Courier,
        /// because retention already is: one distant fleet subject owing a
        /// twenty-minute-old sample would otherwise hold every other topic's history
        /// back with it.</para>
        /// </summary>
        private readonly Dictionary<string, Dictionary<string, SortedDictionary<double, int>>> _owedScenes =
            new Dictionary<string, Dictionary<string, SortedDictionary<double, int>>>();

        private void NoteOwedScene(string node, string topic, double sceneUt)
        {
            if (!_owedScenes.TryGetValue(node, out var byTopic))
            {
                byTopic = new Dictionary<string, SortedDictionary<double, int>>();
                _owedScenes[node] = byTopic;
            }
            if (!byTopic.TryGetValue(topic, out var scenes))
            {
                scenes = new SortedDictionary<double, int>();
                byTopic[topic] = scenes;
            }
            scenes[sceneUt] = scenes.TryGetValue(sceneUt, out var held) ? held + 1 : 1;
        }

        private void ClearOwedScene(string node, string topic, double sceneUt)
        {
            if (!_owedScenes.TryGetValue(node, out var byTopic)
                || !byTopic.TryGetValue(topic, out var scenes)
                || !scenes.TryGetValue(sceneUt, out var held))
            {
                return;
            }
            if (held <= 1)
            {
                scenes.Remove(sceneUt);
                if (scenes.Count == 0)
                {
                    byTopic.Remove(topic);
                    if (byTopic.Count == 0)
                    {
                        _owedScenes.Remove(node);
                    }
                }
            }
            else
            {
                scenes[sceneUt] = held - 1;
            }
        }

        /// <summary>
        /// The oldest scene still owed on each of <paramref name="node"/>'s topics,
        /// or null when nothing is owed on that node at all.
        /// </summary>
        private Dictionary<string, double>? OwedFloorsFor(string node)
        {
            if (!_owedScenes.TryGetValue(node, out var byTopic) || byTopic.Count == 0)
            {
                return null;
            }

            var floors = new Dictionary<string, double>();
            foreach (var entry in byTopic)
            {
                foreach (var scene in entry.Value.Keys)
                {
                    floors[entry.Key] = scene;
                    break;
                }
            }
            return floors;
        }

        /// <summary>
        /// Bound every archive to what its vantages can still read. Safe to call at
        /// any time: it only ever drops samples that no current vantage can reach,
        /// and a read that would have wanted one answers null rather than falling
        /// forward onto a newer sample.
        /// </summary>
        private void PruneArchives()
        {
            foreach (var entry in _archives)
            {
                entry.Value.PruneToVantageCursors(OwedFloorsFor(entry.Key));
            }
        }

        /// <summary>
        /// What <paramref name="vantage"/> currently knows about
        /// <paramref name="topic"/> on <paramref name="node"/>, as something a
        /// propagation can be seeded from.
        ///
        /// <para>Here rather than on the archive because the DELAY is the Courier's:
        /// the archive can read at a vantage given a delay, and only this knows what
        /// that delay is. Splitting the two across a caller is how a read ends up
        /// using a delay nobody checked.</para>
        /// </summary>
        public DelayedObservation ObserveAtVantage(
            string node,
            string topic,
            string vantage,
            double nowUt,
            Func<object?, StateAboutBody?> toState)
        {
            if (!_archives.TryGetValue(node, out var archive))
            {
                return DelayedObservation.Refused(
                    DelayedStateRefusal.NothingArrived,
                    "Nothing has been recorded for '" + node + "' at all, so this vantage has "
                        + "certainly not been told about '" + topic + "'.");
            }
            return DelayedStateReader.Read(
                archive, topic, vantage, _network.DelayTo(vantage, node), nowUt, toState);
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
        /// <paramref name="topic"/>: see <see cref="Archive.HasAnyTail"/>.
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
        /// a plain <see cref="CommandQueueState"/> POCO: requestId, node,
        /// command, args, vantage, and its scheduled execute/confirm UTs.
        /// C#-ONLY (no TS reference), for M5b quicksave.
        ///
        /// Deliberately scoped to the command queue alone: the
        /// <see cref="Archive"/> is persisted separately (Task 4's
        /// <see cref="Archive.Snapshot"/>/<see cref="Archive.Restore"/>), and
        /// telemetry subscriptions + their scheduled deliveries are
        /// runtime/derivable state, NOT persisted here: a reconnecting
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
        /// handler again on the very next <c>AdvanceTo</c>, full
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
        /// against THIS Courier: re-scheduling each command's original
        /// execute UT and confirm UT on this Courier's Clock so it matures
        /// and confirms at the same UTs it would have without the
        /// save/load round trip.
        ///
        /// <paramref name="onResponse"/> is a SINGLE handler shared by every
        /// restored command (rather than one closure per command, which is
        /// exactly the state a save/load round trip cannot carry), the
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
    /// COMMAND QUEUE (dispatched, not-yet-confirmed commands only): see
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
