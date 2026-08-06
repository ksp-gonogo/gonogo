using System;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Threading;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Central wall-clock budgets for this suite, plus a thread-pool warm-up.
    ///
    /// Every test here drives a REAL Fleck WebSocket server + a real
    /// <c>ClientWebSocket</c>, and asserts on message delivery under a
    /// wall-clock deadline. The whole delivery path — accept, handshake,
    /// receive, Courier processing, send, client receive — runs either on the
    /// engine's single dedicated Courier thread or on .NET thread-pool
    /// continuations (Fleck's APM socket I/O + the client's receive pump). None
    /// of that is CPU-heavy; a subscribe ack or a tick barrier normally
    /// completes in milliseconds.
    ///
    /// The flake this file exists to kill: on a CPU-SATURATED host — a dev box
    /// or CI runner also running <c>turbo</c>/<c>vitest</c> under
    /// <c>--force</c>, plus the usual background load (security scanners, etc.)
    /// — the test process is repeatedly descheduled for seconds at a time. The
    /// operation is still correct and WOULD complete given CPU, but the
    /// wall-clock deadline advances anyway, so a too-tight budget expires and
    /// the op surfaces as an <see cref="OperationCanceledException"/> /
    /// <c>TimeoutException</c>. Because the starvation is stochastic, a
    /// DIFFERENT test trips each run — the classic "passes in isolation, fails
    /// under load, never the same one twice" signature. It is NOT intra-suite
    /// parallelism (that's already disabled — see <c>TestParallelization.cs</c>),
    /// NOT a product race (the transport path is fully async and non-blocking,
    /// and every engine/socket is disposed per test), and NOT a leaked thread
    /// (vendored Fleck keeps no per-connection thread).
    ///
    /// The fix therefore is not a code-path change — it is (a) removing the
    /// self-inflicted portion of the latency by warming the thread pool so a
    /// ready continuation never ALSO has to wait for the pool's slow
    /// hill-climb to inject a worker, and (b) sizing these budgets as genuine
    /// load HEADROOM rather than tight deadlines. Every value here is a
    /// "how long before we give up and call it hung", never a real timing
    /// assertion — correct ops finish in milliseconds and never pay it. All are
    /// env-overridable so a pathologically slow runner can be given even more
    /// headroom without a rebuild.
    /// </summary>
    internal static class TestBudgets
    {
        /// <summary>
        /// Per-operation deadline for a subscribe ack, a tick barrier, a
        /// command result, or a single frame receive. Was a bare 10s per test
        /// class; widened to load headroom.
        /// </summary>
        public static readonly TimeSpan Op =
            TimeSpan.FromSeconds(ReadDouble("SITREP_TEST_OP_TIMEOUT_SECONDS", 30.0));

        /// <summary>
        /// Quiet window for the "drain until the wire goes silent" helpers
        /// (<c>DrainToLatestStreamDataAsync</c> / <c>DrainAllStreamDataAsync</c>).
        /// This is the FRAGILE budget: a frame merely delayed by starvation past
        /// the window is misread as "stream finished", silently dropping it and
        /// failing a downstream assertion. A larger window can only ever avoid
        /// missing a real frame — it never invents one — so it is pure
        /// robustness at the cost of a little wall-clock. Was 500ms.
        /// </summary>
        public static readonly TimeSpan Quiet =
            TimeSpan.FromMilliseconds(ReadDouble("SITREP_TEST_QUIET_MS", 1500.0));

        /// <summary>
        /// Poll deadline the fixture-generator tests give their reader loop
        /// between ticks. Was 2s.
        /// </summary>
        public static readonly TimeSpan ReaderPoll =
            TimeSpan.FromSeconds(ReadDouble("SITREP_TEST_READER_POLL_SECONDS", 6.0));

        /// <summary>
        /// Settle delay the fixture-generator tests wait before the final drain
        /// so straggler frames land first. A fixed sleep, so a bigger value
        /// only makes the collection more complete. Was 750ms.
        /// </summary>
        public static readonly TimeSpan FinalDrain =
            TimeSpan.FromMilliseconds(ReadDouble("SITREP_TEST_FINAL_DRAIN_MS", 1500.0));

        [ModuleInitializer]
        internal static void WarmThreadPool()
        {
            // Give the pool a standing set of workers so a ready delivery
            // continuation runs the instant a core frees up, instead of waiting
            // on the pool's ~1-2-per-500ms hill-climb to inject one. Measured to
            // cut the load-flake rate on its own; the widened budgets above
            // cover the residual OS-level starvation that no thread count can.
            ThreadPool.GetMinThreads(out var worker, out var io);
            var target = Math.Max(64, Environment.ProcessorCount * 4);
            ThreadPool.SetMinThreads(Math.Max(worker, target), Math.Max(io, target));
        }

        private static double ReadDouble(string envVar, double fallback)
        {
            var raw = Environment.GetEnvironmentVariable(envVar);
            return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
                ? parsed
                : fallback;
        }
    }
}
