// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.Kos
{
    /// <summary>
    /// One CPU screen the terminal can read, type into, and resize. The real
    /// implementation (<see cref="KosProcessorScreen"/>) wraps a live
    /// <c>kOSProcessor</c> + kOS's own <c>ScreenSnapShot</c>/<c>DiffFrom</c> +
    /// <c>TerminalXtermMapper</c>; headless tests supply a fake. Keeping this
    /// as an interface is what lets <see cref="KosTerminalManager"/> — all the
    /// lease/cadence/publish logic — stay free of any kOS/Unity type and run
    /// under the xunit headless runner.
    /// </summary>
    internal interface IKosTerminalScreen
    {
        /// <summary>
        /// Read the next output chunk. When <paramref name="forceReseed"/> is
        /// true, or the implementation detects a reboot / CPU rebind, the
        /// result is a self-contained full repaint
        /// (<see cref="TerminalReadResult.FullRepaint"/>). Returns
        /// <see cref="TerminalReadResult.None"/> when nothing changed.
        /// </summary>
        TerminalReadResult ReadChunk(bool forceReseed);

        /// <summary>Type input into the CPU. Returns false when the CPU can't currently accept input (no window / not booted).</summary>
        bool TypeChars(string chars);

        /// <summary>Resize the CPU screen to the given column/row count.</summary>
        void Resize(int cols, int rows);
    }

    /// <summary>Outcome of one <see cref="IKosTerminalScreen.ReadChunk"/> — either nothing, or an xterm-ready chunk.</summary>
    internal readonly struct TerminalReadResult
    {
        public bool HasOutput { get; }
        public string Chunk { get; }
        public bool FullRepaint { get; }

        public TerminalReadResult(bool hasOutput, string chunk, bool fullRepaint)
        {
            HasOutput = hasOutput;
            Chunk = chunk;
            FullRepaint = fullRepaint;
        }

        public static readonly TerminalReadResult None = new TerminalReadResult(false, "", false);

        public static TerminalReadResult Output(string chunk, bool fullRepaint) =>
            new TerminalReadResult(true, chunk, fullRepaint);
    }

    /// <summary>
    /// Owns the interactive terminal downlink + write-lease for every kOS CPU,
    /// replacing the standalone telnet proxy. All state lives on the KSP main
    /// thread: <see cref="Poll"/> is driven from the dispatcher addon's
    /// <c>Update</c>, and every command handler is marshalled to the same
    /// thread by <see cref="KosExtension.RunOnMainThread"/> — so no locking is
    /// needed. It has no kOS/Unity references (those are behind
    /// <see cref="IKosTerminalScreen"/> + injected delegates), so it is fully
    /// unit-testable headlessly.
    ///
    /// <para><b>Downlink:</b> each poll it walks the current CPU ids, and for
    /// every one currently subscribed (<c>host.IsAnyTopicSubscribed</c>, a
    /// main-thread-safe read of the engine's thread-safe subscribed-topics
    /// mirror — never the Courier-owned subscriber registry) reads the
    /// screen diff and publishes a <see cref="KosTerminalFrame"/>. A full
    /// repaint (<see cref="KosTerminalFrame.FullRepaint"/>) is forced for a
    /// CPU whenever <see cref="NotifySubscribed"/> was called for it since
    /// the last poll — the THREAD-SAFE seam the terminal's dynamic-namespace
    /// registration wires to <c>IDynamicChannelSource.OnSubscribed</c>,
    /// which the engine invokes on the COURIER thread for EVERY individual
    /// session subscribe (a first subscriber, a SECOND simultaneous viewer,
    /// or a resubscribe faster than one poll tick), never gated on whether
    /// some aggregate subscriber count merely stayed the same across a
    /// sampling window. So every late/reconnecting/new viewer — none of
    /// which get the sticky replay via <c>useStreamEvent</c> — resyncs from
    /// a clean screen rather than an orphaned diff. Because the downlink is
    /// a broadcast (one frame reaches every current subscriber of the
    /// topic), this repaint is necessarily shared: an existing viewer
    /// receives one redundant repaint whenever another viewer joins, which
    /// is harmless (a full repaint is just a bigger diff, not a correctness
    /// issue).</para>
    ///
    /// <para><b>Uplink lease:</b> one holder per CPU, keyed by the caller's
    /// opaque lease token (<see cref="KosTerminalOpenArgs.LeaseToken"/>). A
    /// second <c>open</c> by a different token is rejected
    /// (<see cref="CommandErrorCode.ModeUnavailable"/>) — never a silent steal;
    /// keystrokes/resizes from a non-holder are rejected the same way.</para>
    /// </summary>
    internal sealed class KosTerminalManager
    {
        private readonly Func<IReadOnlyList<int>> _knownCoreIds;
        private readonly Func<int, bool> _isSubscribed;
        private readonly Action<int, KosTerminalFrame, double> _publish;
        private readonly Func<int, IKosTerminalScreen?> _createScreen;
        private readonly Func<double> _nowUt;
        private readonly double _pollIntervalSeconds;
        private readonly double _keyframeIntervalSeconds;

        private sealed class Session
        {
            public IKosTerminalScreen? Screen;
            public bool PendingReseed;
            // UT of the last full-repaint (keyframe) published for this CPU.
            // Drives the periodic keyframe cadence: a fresh full repaint every
            // _keyframeIntervalSeconds resyncs the client from a self-contained
            // frame, so a single lost incremental diff (a comms-blip reveal-gate
            // drop, a quickload, any transit loss) self-heals within one
            // interval instead of corrupting the screen until the next
            // subscribe. null until the first frame is published.
            public double? LastKeyframeUt;
        }

        private readonly Dictionary<int, Session> _sessions = new Dictionary<int, Session>();
        // Current single-owner write-lease holder per CPU (coreId -> token).
        private readonly Dictionary<int, string> _leases = new Dictionary<int, string>();

        // THREAD-SAFE: the set of CPUs with an individual subscribe
        // transition pending a reseed, as reported by NotifySubscribed
        // (called from the Courier thread in production — see that
        // method's doc comment and the class doc comment's "Downlink"
        // paragraph). Poll (main thread) drains this every tick. This is
        // the Gap A fix's seam: it deliberately carries no subscriber
        // COUNT, just "this CPU had a subscribe transition since the last
        // drain" — Poll never reads any Courier-owned subscription state.
        private readonly ConcurrentDictionary<int, byte> _pendingReseeds = new ConcurrentDictionary<int, byte>();

        private double _accumulatedSeconds;

        /// <param name="knownCoreIds">Current CPU <c>KOSCoreId</c>s (main thread; real impl reads <c>kOSProcessor.AllInstances()</c>).</param>
        /// <param name="isSubscribed">Is <c>kos.terminal.&lt;coreId&gt;</c> CURRENTLY subscribed (e.g. <c>host.IsAnyTopicSubscribed</c>)? A pure "should I bother reading/publishing this CPU's screen at all" gate — the reseed decision is <see cref="NotifySubscribed"/>'s job, not this one.</param>
        /// <param name="publish">Publish a frame to <c>kos.terminal.&lt;coreId&gt;</c> at the given UT (the current clock read; the terminal channel is <c>Delivery.ReliableOrdered</c>, so the engine forwards each frame in order regardless of whether several share a <c>ValidAt</c>).</param>
        /// <param name="createScreen">Build (or resolve) the screen reader for a CPU; null when the CPU is gone.</param>
        /// <param name="nowUt">Current UT (main-thread clock read, e.g. <c>host.NowUt</c>). May return the SAME value across several consecutive polls — harmless: the ReliableOrdered lane forwards each frame per-sample, in order, so same-UT frames no longer coalesce.</param>
        /// <param name="pollIntervalSeconds">Downlink cadence (kOS's own screen loop is 20 Hz — 0.05s).</param>
        /// <param name="keyframeIntervalSeconds">
        /// Periodic full-repaint (keyframe) cadence per subscribed CPU. The
        /// read-back is a stream of non-idempotent cursor-relative diffs, so a
        /// single lost frame (a reveal-gate drop on a comms blip, a quickload,
        /// any transit loss) would otherwise corrupt the client screen until the
        /// next subscribe. Forcing a self-contained full repaint every interval
        /// lets the client re-sync from a clean frame — the video-I-frame model
        /// — so any drop self-heals within one interval. Default 1.0s.
        /// </param>
        public KosTerminalManager(
            Func<IReadOnlyList<int>> knownCoreIds,
            Func<int, bool> isSubscribed,
            Action<int, KosTerminalFrame, double> publish,
            Func<int, IKosTerminalScreen?> createScreen,
            Func<double> nowUt,
            double pollIntervalSeconds = 0.05,
            double keyframeIntervalSeconds = 1.0)
        {
            _knownCoreIds = knownCoreIds ?? throw new ArgumentNullException(nameof(knownCoreIds));
            _isSubscribed = isSubscribed ?? throw new ArgumentNullException(nameof(isSubscribed));
            _publish = publish ?? throw new ArgumentNullException(nameof(publish));
            _createScreen = createScreen ?? throw new ArgumentNullException(nameof(createScreen));
            _nowUt = nowUt ?? throw new ArgumentNullException(nameof(nowUt));
            _pollIntervalSeconds = pollIntervalSeconds;
            _keyframeIntervalSeconds = keyframeIntervalSeconds;
        }

        /// <summary>
        /// THREAD-SAFE — call from ANY thread (in production, the Courier
        /// thread, via the callback wired to
        /// <c>IDynamicChannelSource.OnSubscribed</c> for the
        /// <c>kos.terminal.</c> namespace) to record that <paramref name="coreId"/>
        /// just saw an individual subscribe transition. The next
        /// <see cref="Poll"/> drains this and forces a full repaint for
        /// every CPU it names — see the class doc comment's "Downlink"
        /// paragraph. Deliberately just a set of pending coreIds, not a
        /// count: every notification, however many arrive between polls,
        /// collapses to "reseed this CPU once" on the next drain, which is
        /// exactly the desired effect (one full-repaint baseline is enough
        /// to resync any number of transitions since the last poll).
        /// </summary>
        public void NotifySubscribed(int coreId) => _pendingReseeds[coreId] = 0;

        // ---- Downlink poll (main thread, from the dispatcher addon Update) ----

        /// <summary>
        /// Advance the ~20 Hz downlink loop by <paramref name="deltaSeconds"/>.
        /// Cheap on ticks that don't reach the interval; on a tick that does, it
        /// reads + publishes a diff for each subscribed CPU. Called every Unity
        /// frame — the accumulator decouples the publish cadence from the frame
        /// rate.
        /// </summary>
        public void Poll(double deltaSeconds)
        {
            _accumulatedSeconds += deltaSeconds;
            if (_accumulatedSeconds < _pollIntervalSeconds)
            {
                return;
            }
            _accumulatedSeconds = 0.0;

            var coreIds = _knownCoreIds();
            var present = new HashSet<int>(coreIds);

            foreach (var coreId in coreIds)
            {
                if (!_isSubscribed(coreId))
                {
                    continue;
                }

                var session = GetOrCreateSession(coreId);
                if (session.Screen == null)
                {
                    continue;
                }

                var now = _nowUt();

                // Drain this CPU's pending-reseed signal — set from
                // NotifySubscribed, possibly from another thread, possibly
                // several times since the last poll (each collapses to one
                // reseed here).
                var reseedEdge = _pendingReseeds.TryRemove(coreId, out _);

                // Periodic keyframe: read-back is a stream of non-idempotent
                // cursor-relative diffs, so a single lost frame corrupts the
                // client screen until the next subscribe. Force a self-contained
                // full repaint every _keyframeIntervalSeconds so any transit loss
                // (a reveal-gate drop on a comms blip, a quickload) self-heals
                // within one interval — the video-I-frame model.
                var keyframeDue = !session.LastKeyframeUt.HasValue
                    || now - session.LastKeyframeUt.Value >= _keyframeIntervalSeconds;

                var forceReseed = reseedEdge || session.PendingReseed || keyframeDue;
                session.PendingReseed = false;

                var result = session.Screen.ReadChunk(forceReseed);
                if (result.HasOutput)
                {
                    // A full repaint (whether from a subscribe/reseed edge or the
                    // periodic keyframe) re-bases the interval — one keyframe per
                    // interval, not one every poll once due.
                    if (result.FullRepaint)
                    {
                        session.LastKeyframeUt = now;
                    }
                    _publish(coreId, new KosTerminalFrame
                    {
                        CoreId = coreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    }, now);
                }
            }

            DropStaleSessions(present);
        }

        private Session GetOrCreateSession(int coreId)
        {
            if (!_sessions.TryGetValue(coreId, out var session))
            {
                session = new Session { PendingReseed = true };
                _sessions[coreId] = session;
            }
            session.Screen ??= _createScreen(coreId);
            return session;
        }

        private void DropStaleSessions(HashSet<int> present)
        {
            if (_sessions.Count == 0)
            {
                return;
            }
            List<int>? drop = null;
            foreach (var coreId in _sessions.Keys)
            {
                if (!present.Contains(coreId))
                {
                    (drop ??= new List<int>()).Add(coreId);
                }
            }
            if (drop == null)
            {
                return;
            }
            foreach (var coreId in drop)
            {
                _sessions.Remove(coreId);
                _leases.Remove(coreId);
                _pendingReseeds.TryRemove(coreId, out _);
            }
        }

        // ---- Uplink commands (main thread, via KosExtension.RunOnMainThread) ----

        /// <summary>Acquire the single-owner write lease. Reject (no steal) if held by a different token.</summary>
        public CommandResult Open(int coreId, string leaseToken)
        {
            if (string.IsNullOrEmpty(leaseToken))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (!CpuPresent(coreId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (_leases.TryGetValue(coreId, out var holder) && holder != leaseToken)
            {
                // Q-P3-2: reject-with-notification, never a silent steal.
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            _leases[coreId] = leaseToken;
            // Seed a clean full repaint to the opener on the next poll.
            GetOrCreateSession(coreId).PendingReseed = true;
            return CommandResult.Ok();
        }

        /// <summary>Type input into a CPU held by <paramref name="leaseToken"/>.</summary>
        public CommandResult Keystroke(int coreId, string leaseToken, string chars)
        {
            if (!HoldsLease(coreId, leaseToken))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            var screen = GetOrCreateSession(coreId).Screen;
            if (screen == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return screen.TypeChars(chars ?? "")
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        /// <summary>Resize a CPU screen held by <paramref name="leaseToken"/>.</summary>
        public CommandResult Resize(int coreId, string leaseToken, int cols, int rows)
        {
            if (!HoldsLease(coreId, leaseToken))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            var screen = GetOrCreateSession(coreId).Screen;
            if (screen == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (cols > 0 && rows > 0)
            {
                screen.Resize(cols, rows);
                // A dimension change invalidates the diff baseline — force a
                // clean full repaint on the next poll.
                GetOrCreateSession(coreId).PendingReseed = true;
            }
            return CommandResult.Ok();
        }

        /// <summary>Release the lease if the token matches; a mismatch is a harmless no-op ack.</summary>
        public CommandResult Close(int coreId, string leaseToken)
        {
            if (_leases.TryGetValue(coreId, out var holder) && holder == leaseToken)
            {
                _leases.Remove(coreId);
            }
            return CommandResult.Ok();
        }

        private bool HoldsLease(int coreId, string leaseToken) =>
            !string.IsNullOrEmpty(leaseToken)
            && _leases.TryGetValue(coreId, out var holder)
            && holder == leaseToken;

        private bool CpuPresent(int coreId)
        {
            foreach (var id in _knownCoreIds())
            {
                if (id == coreId)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
