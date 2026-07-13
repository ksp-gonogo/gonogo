// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
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
    /// every one with a live <c>kos.terminal.&lt;coreId&gt;</c> subscriber reads
    /// the screen diff and publishes a <see cref="KosTerminalFrame"/>. A CPU
    /// gaining its first subscriber (or a fresh <c>open</c>) forces a
    /// <see cref="KosTerminalFrame.FullRepaint"/> so a late/reconnecting viewer
    /// — which does not get the sticky replay via <c>useStreamEvent</c> —
    /// resyncs from a clean screen.</para>
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
        private const double UtEpsilon = 1e-6;

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
        // Which CPUs had a subscriber on the previous poll (for the reseed edge).
        private readonly HashSet<int> _wasSubscribed = new HashSet<int>();

        private double _accumulatedSeconds;

        /// <param name="knownCoreIds">Current CPU <c>KOSCoreId</c>s (main thread; real impl reads <c>kOSProcessor.AllInstances()</c>).</param>
        /// <param name="isSubscribed">Whether <c>kos.terminal.&lt;coreId&gt;</c> currently has a subscriber.</param>
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
                var subscribed = _isSubscribed(coreId);
                var reseedEdge = subscribed && !_wasSubscribed.Contains(coreId);
                if (subscribed)
                {
                    _wasSubscribed.Add(coreId);
                }
                else
                {
                    _wasSubscribed.Remove(coreId);
                    continue;
                }

                var session = GetOrCreateSession(coreId);
                if (session.Screen == null)
                {
                    continue;
                }

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
        /// </summary>
        private double NextUt(int coreId)
        {
            var candidate = _nowUt();
            if (_lastPublishedUt.TryGetValue(coreId, out var last) && candidate <= last)
            {
                candidate = last + UtEpsilon;
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
                _wasSubscribed.Remove(coreId);
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
