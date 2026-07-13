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
        // Smallest bump that still survives the double comparisons in
        // Archive.ReadAtVantage/Courier — see NextUt's doc comment.
        //
        // Deliberately NOT a locally-hardcoded literal: this MUST stay at or
        // below ChannelEngine.ProcessPublish's own stale-ut clamp tolerance
        // (Sitrep.Host.ChannelEngine.PublishUtToleranceSeconds), or every
        // epsilon-bumped frame gets clamped straight back to clock.Now(),
        // colliding with the frame it was meant to stay ahead of and
        // reproducing the original same-ValidAt garble with no test
        // catching it. Both constants derive from the one shared value —
        // see EnginePublishTolerance's doc comment for the full invariant,
        // and Sitrep.Host.IntegrationTests.ChannelEngineTests
        // .AnEpsilonBumpedSameTickPublishSurvivesTheStaleUtClampAndDeliversTwoDistinctFrames
        // for the spanning test that exercises it end-to-end.
        private const double UtEpsilon = EnginePublishTolerance.Seconds;

        // How far BELOW the tracked baseline nowUt has to read before
        // NextUt treats it as a genuine backward clock jump (an F9
        // quickload) rather than this manager's own epsilon-bumped
        // baseline running fractionally ahead of a nowUt clock that simply
        // hasn't ticked forward yet. Same-tick bumps only ever accumulate
        // at UtEpsilon scale — even a very long same-tick burst within one
        // poll window comes nowhere near this — while a genuine rewind
        // moves UT by real mission time (seconds at least). See NextUt's
        // doc comment (Gap B).
        private const double RewindThreshold = 1.0;

        private readonly Func<IReadOnlyList<int>> _knownCoreIds;
        private readonly Func<int, bool> _isSubscribed;
        private readonly Action<int, KosTerminalFrame, double> _publish;
        private readonly Func<int, IKosTerminalScreen?> _createScreen;
        private readonly Func<double> _nowUt;
        private readonly double _pollIntervalSeconds;

        // Last UT this manager published on behalf of each CPU — the seam
        // that guarantees every kos.terminal.<coreId> frame gets a STRICTLY
        // increasing ValidAt (see NextUt).
        private readonly Dictionary<int, double> _lastPublishedUt = new Dictionary<int, double>();

        private sealed class Session
        {
            public IKosTerminalScreen? Screen;
            public bool PendingReseed;
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
        /// <param name="publish">Publish a frame to <c>kos.terminal.&lt;coreId&gt;</c> at the given UT — see <see cref="NextUt"/> for why the manager computes that UT itself rather than taking the caller's raw clock read.</param>
        /// <param name="createScreen">Build (or resolve) the screen reader for a CPU; null when the CPU is gone.</param>
        /// <param name="nowUt">Current UT (main-thread clock read, e.g. <c>host.NowUt</c>). May return the SAME value across several consecutive calls — see <see cref="NextUt"/>.</param>
        /// <param name="pollIntervalSeconds">Downlink cadence (kOS's own screen loop is 20 Hz — 0.05s).</param>
        public KosTerminalManager(
            Func<IReadOnlyList<int>> knownCoreIds,
            Func<int, bool> isSubscribed,
            Action<int, KosTerminalFrame, double> publish,
            Func<int, IKosTerminalScreen?> createScreen,
            Func<double> nowUt,
            double pollIntervalSeconds = 0.05)
        {
            _knownCoreIds = knownCoreIds ?? throw new ArgumentNullException(nameof(knownCoreIds));
            _isSubscribed = isSubscribed ?? throw new ArgumentNullException(nameof(isSubscribed));
            _publish = publish ?? throw new ArgumentNullException(nameof(publish));
            _createScreen = createScreen ?? throw new ArgumentNullException(nameof(createScreen));
            _nowUt = nowUt ?? throw new ArgumentNullException(nameof(nowUt));
            _pollIntervalSeconds = pollIntervalSeconds;
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

                // Drain this CPU's pending-reseed signal — set from
                // NotifySubscribed, possibly from another thread, possibly
                // several times since the last poll (each collapses to one
                // reseed here). This is the ONLY source of the reseed
                // decision; Poll never reads a subscriber count.
                var reseedEdge = _pendingReseeds.TryRemove(coreId, out _);
                var forceReseed = reseedEdge || session.PendingReseed;
                session.PendingReseed = false;

                var result = session.Screen.ReadChunk(forceReseed);
                if (result.HasOutput)
                {
                    _publish(coreId, new KosTerminalFrame
                    {
                        CoreId = coreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    }, NextUt(coreId));
                }
            }

            DropStaleSessions(present);
        }

        /// <summary>
        /// The <c>kos.terminal.&lt;coreId&gt;</c> downlink is a cursor-relative
        /// DIFF stream, but it rides the shared Courier/Archive delay engine,
        /// which resolves a subscriber's read to the LATEST sample with
        /// <c>ValidAt &lt;= scene</c> (<see cref="Sitrep.Core.Archive.ReadAtVantage"/>)
        /// — correct for state topics, but fatal for a diff stream if two
        /// frames ever share a <c>ValidAt</c>: the earlier one is silently
        /// dropped and the later one is delivered as if it applied cleanly,
        /// corrupting every subsequent cursor-relative render.
        ///
        /// <see cref="Poll"/> runs at ~20Hz on the main thread, but the
        /// injected <c>nowUt</c> clock (the Courier thread's ~50ms cadence in
        /// production) advances independently — so a burst
        /// of several frames published within one Poll-tick window can read
        /// the exact same UT. This returns a UT that is STRICTLY greater
        /// than the last one this manager published for
        /// <paramref name="coreId"/>: the real clock reading when it has
        /// already advanced, or the previous UT nudged forward by the
        /// smallest bump that still survives the double comparisons in
        /// Archive/Courier otherwise. The bump is negligible against reveal
        /// timing (light-seconds) while guaranteeing no two frames collide,
        /// and Courier's AdvanceTo drains scheduled deliveries in ascending
        /// fire-UT order, so distinct, increasing ValidAt stamps are
        /// sufficient for complete, in-order delivery.
        ///
        /// Deliberately CONTAINED to this one publish site — it does not
        /// touch Archive/Courier's shared semantics, which every other
        /// (state) topic still relies on.
        ///
        /// <para><b>Rewind-aware (Gap B, adversarial review of Fix #1):</b>
        /// an F9 quickload drops <c>nowUt</c> back to an earlier UT than the
        /// pre-rewind peak this manager already published. A same-tick
        /// COLLISION (<c>candidate &lt;= last</c>, within
        /// <see cref="RewindThreshold"/> — either the clock hasn't ticked
        /// since the last publish, or <paramref name="coreId"/>'s tracked
        /// baseline is only fractionally ahead from a PRIOR epsilon bump)
        /// still just gets nudged forward by <see cref="UtEpsilon"/>. A
        /// genuine backward JUMP (<c>candidate</c> more than
        /// <see cref="RewindThreshold"/> below <c>last</c> — the clock
        /// itself rewound, not this manager's own bump) instead RESETS the
        /// tracked baseline to the new, lower UT rather than manufacturing
        /// a ghost <c>last + epsilon</c> stamp that stays pinned above the
        /// stale pre-rewind peak — which would otherwise keep re-colliding
        /// with Archive/Courier's own stale-UT clamp (forcing every
        /// post-rewind frame back to <c>_clock.Now()</c> without this
        /// manager ever learning the new baseline) for the whole recovery
        /// window until real UT climbed back past the old peak.</para>
        /// </summary>
        private double NextUt(int coreId)
        {
            var candidate = _nowUt();
            if (_lastPublishedUt.TryGetValue(coreId, out var last))
            {
                if (candidate < last - RewindThreshold)
                {
                    // Genuine backward jump — trust the new, lower UT.
                    _lastPublishedUt[coreId] = candidate;
                    return candidate;
                }
                if (candidate <= last)
                {
                    // Same-tick collision (or this manager's own prior
                    // epsilon bump still sitting fractionally above a flat
                    // clock) — nudge forward by the smallest margin that
                    // still survives Archive/Courier's double comparisons.
                    candidate = last + UtEpsilon;
                }
            }
            _lastPublishedUt[coreId] = candidate;
            return candidate;
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
                _lastPublishedUt.Remove(coreId);
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
