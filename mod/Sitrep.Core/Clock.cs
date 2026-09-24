using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace Sitrep.Core
{
    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/clock.ts</c>. Semantics MUST stay
    /// byte-for-byte identical to the TS reference: conformance is asserted by
    /// <c>Sitrep.Core.Tests</c> against the shared golden fixtures in
    /// <c>mod/golden-fixtures/clock.json</c>, not by re-deriving semantics here.
    /// If you touch this file, regenerate the fixture from the TS side
    /// (`pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`) and re-run
    /// `dotnet test` to confirm the two still agree.
    ///
    /// Time is measured in UT seconds (KSP's universal time).
    /// </summary>
    public interface IClock
    {
        /// <summary>Current UT, in seconds.</summary>
        double Now();

        /// <summary>
        /// Fire <paramref name="fn"/> once UT reaches <paramref name="atUt"/>.
        /// Returns a cancel action that removes the pending callback if invoked
        /// before it fires; invoking it after the callback has already fired is
        /// a no-op.
        /// </summary>
        Action Schedule(double atUt, Action fn);

        /// <summary>
        /// C#-ONLY addition (no TS reference), added for M5b's quicksave
        /// UT-rewind fix (see <see cref="Courier.ResetTimeline"/>). Force the
        /// clock's current UT to <paramref name="ut"/> UNCONDITIONALLY --
        /// including backward -- and drop every pending scheduled callback
        /// without firing it. This is deliberately different from
        /// <see cref="Schedule"/>'s counterpart <c>AdvanceTo</c>: that method
        /// only ever moves forward and fires due callbacks along the way,
        /// because normal play never rewinds. <see cref="Reset"/> is for the
        /// one case that genuinely does: the caller has independently
        /// decided the OLD timeline is abandoned (e.g. a quickload), not
        /// merely paused, and wants a clean slate at the new UT.
        /// </summary>
        void Reset(double ut);
    }

    /// <summary>
    /// Pure virtual clock. Time only moves when <see cref="AdvanceTo"/> is
    /// called, and it never reads a wall clock, that's the whole point: tests
    /// (and the real engine under time-warp) drive it explicitly.
    /// </summary>
    public sealed class ManualClock : IClock
    {
        private sealed class PendingCallback
        {
            public double AtUt;
            public long Seq;
            public Action Fn = null!;
            public bool Cancelled;
        }

        private double _currentUt;
        private long _nextSeq;

        /*
         * A binary min-heap on (AtUt, Seq), so the next due callback is found
         * in log time rather than by scanning every pending one. Seq is the
         * insertion order, which is what breaks a tie. A delayed reveal
         * releasing a long buffer schedules one delivery per sample per
         * subscriber in a single tick, and a scan per fire made that drain
         * quadratic in the size of the release.
         */
        private readonly List<PendingCallback> _pending = new List<PendingCallback>();

        public ManualClock(double startUt = 0)
        {
            _currentUt = startUt;
        }

        public double Now() => _currentUt;

        public Action Schedule(double atUt, Action fn)
        {
            // A NaN instant has no place in the order, so it is due at once.
            var callback = new PendingCallback
            {
                AtUt = double.IsNaN(atUt) ? double.NegativeInfinity : atUt,
                Seq = _nextSeq++,
                Fn = fn,
                Cancelled = false,
            };
            Push(callback);
            return () => callback.Cancelled = true;
        }

        /// <summary>
        /// Advance current UT to <paramref name="ut"/>, firing all
        /// non-cancelled pending callbacks with <c>AtUt &lt;= ut</c>, in
        /// ascending AtUt order (ties broken by insertion order). Advancing to
        /// a UT strictly before the current UT is a no-op (time never
        /// rewinds, nothing fires): advancing to the SAME UT is allowed and
        /// still processes any callbacks due at that UT.
        ///
        /// This drains rather than snapshotting the due batch up front: a
        /// firing callback may itself <see cref="Schedule"/> a new callback at
        /// <c>AtUt &lt;= ut</c> (e.g. a zero-delay re-entrant delivery). The
        /// loop takes the next due callback afresh after every fire so that
        /// newly-scheduled, already-due callbacks are picked up and fired
        /// within the same <see cref="AdvanceTo"/> call, instead of getting
        /// stranded until a later advance. A callback that perpetually
        /// reschedules itself at <c>AtUt &lt;= ut</c> will loop forever here,
        /// that's an author-side bug (equivalent to recursive
        /// <c>setTimeout(0)</c>), not something this clock should paper over.
        /// </summary>
        public void AdvanceTo(double ut)
        {
            if (ut < _currentUt)
            {
                return;
            }

            _currentUt = ut;

            while (_pending.Count > 0 && !(_pending[0].AtUt > ut))
            {
                var due = Pop();
                if (!due.Cancelled)
                {
                    due.Fn();
                }
            }
        }

        private static bool Before(PendingCallback a, PendingCallback b) =>
            a.AtUt < b.AtUt || (a.AtUt == b.AtUt && a.Seq < b.Seq);

        private void Push(PendingCallback callback)
        {
            _pending.Add(callback);
            var i = _pending.Count - 1;
            while (i > 0)
            {
                var parent = (i - 1) / 2;
                if (!Before(_pending[i], _pending[parent]))
                {
                    break;
                }
                (_pending[i], _pending[parent]) = (_pending[parent], _pending[i]);
                i = parent;
            }
        }

        private PendingCallback Pop()
        {
            var top = _pending[0];
            var last = _pending.Count - 1;
            _pending[0] = _pending[last];
            _pending.RemoveAt(last);
            var i = 0;
            while (true)
            {
                var left = 2 * i + 1;
                if (left >= _pending.Count)
                {
                    break;
                }
                var right = left + 1;
                var child = right < _pending.Count && Before(_pending[right], _pending[left]) ? right : left;
                if (!Before(_pending[child], _pending[i]))
                {
                    break;
                }
                (_pending[i], _pending[child]) = (_pending[child], _pending[i]);
                i = child;
            }
            return top;
        }

        /// <summary>
        /// See <see cref="IClock.Reset"/>. Clears every pending callback
        /// (WITHOUT firing them -- they belong to the abandoned timeline)
        /// and jumps <see cref="_currentUt"/> straight to <paramref name="ut"/>,
        /// forward or backward.
        /// </summary>
        public void Reset(double ut)
        {
            _pending.Clear();
            _currentUt = ut;
        }
    }

    /// <summary>
    /// Wall-clock-backed Clock. Kept minimal: the delay-engine model and its
    /// tests run entirely on <see cref="ManualClock"/>; this exists so
    /// production code has a real implementation to construct. Not exercised
    /// by the golden fixtures (there is nothing deterministic to assert about
    /// wall-clock timing).
    /// </summary>
    public sealed class RealClock : IClock
    {
        private readonly Func<double> _timeFn;

        public RealClock(Func<double>? timeFn = null)
        {
            _timeFn = timeFn ?? DefaultTimeFn;
        }

        private static readonly Stopwatch WallClockStopwatch = Stopwatch.StartNew();

        private static double DefaultTimeFn() => WallClockStopwatch.Elapsed.TotalSeconds;

        public double Now() => _timeFn();

        public Action Schedule(double atUt, Action fn)
        {
            var delayMs = Math.Max(0, (atUt - Now()) * 1000);
            var timer = new Timer(
                _ => fn(),
                null,
                (long)delayMs,
                Timeout.Infinite);
            return () => timer.Dispose();
        }

        /// <summary>
        /// Not supported: a wall-clock-backed Clock cannot be forced
        /// backward, and unlike <see cref="ManualClock"/> it doesn't
        /// centrally track outstanding <see cref="Schedule"/> timers to drop.
        /// <see cref="IClock.Reset"/> is a C#-only addition scoped to
        /// <see cref="ManualClock"/>'s quicksave/UT-rewind use case (the only
        /// Clock any production server actually constructs); RealClock
        /// exists purely so production code has a real Clock to construct
        /// and is never exercised by that path.
        /// </summary>
        public void Reset(double ut)
        {
            throw new NotSupportedException(
                "RealClock.Reset is not supported -- see the doc comment on this method.");
        }
    }
}
