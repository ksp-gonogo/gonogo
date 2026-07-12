using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Gonogo.Kos;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Covers the three invariants local_docs/telemetry-mod/kos-migration-spec.md
    /// §2 demands of the main-thread dispatch spine: (1) actions enqueued
    /// from a background thread drain in FIFO order on the draining
    /// thread, (2) a throwing action never stops — or drops — the actions
    /// behind it, and (3) draining an empty queue is a safe no-op.
    ///
    /// Deliberately does NOT touch <c>KosExtension</c> or
    /// <c>KosMainThreadDispatcherAddon</c> — both create a real Unity
    /// <c>GameObject</c>, which throws outside a live KSP/Unity process.
    /// <see cref="MainThreadDispatcher"/> itself has zero UnityEngine
    /// dependency, which is exactly what makes it testable here.
    /// </summary>
    public class MainThreadDispatcherTests
    {
        [Fact]
        public void Drain_RunsQueuedActions_InFifoOrder()
        {
            var dispatcher = new MainThreadDispatcher();
            var order = new List<int>();

            dispatcher.Dispatch(() => order.Add(1));
            dispatcher.Dispatch(() => order.Add(2));
            dispatcher.Dispatch(() => order.Add(3));

            dispatcher.Drain();

            Assert.Equal(new[] { 1, 2, 3 }, order);
        }

        [Fact]
        public async Task Drain_RunsActionsEnqueuedFromABackgroundThread_InFifoOrder()
        {
            // Mirrors the real shape: a background "pump" thread calls
            // Dispatch (the only thread-safe entry point), and a separate
            // "main" thread later calls Drain.
            var dispatcher = new MainThreadDispatcher();
            var order = new ConcurrentQueue<int>();

            await Task.Run(() =>
            {
                for (var i = 0; i < 200; i++)
                {
                    var captured = i;
                    dispatcher.Dispatch(() => order.Enqueue(captured));
                }
            });

            dispatcher.Drain();

            Assert.Equal(200, order.Count);
            var expected = 0;
            foreach (var value in order)
            {
                Assert.Equal(expected, value);
                expected++;
            }
        }

        [Fact]
        public void Drain_OneThrowingAction_DoesNotStopOrDropSubsequentActions()
        {
            var dispatcher = new MainThreadDispatcher();
            var ran = new List<string>();

            dispatcher.Dispatch(() => ran.Add("first"));
            dispatcher.Dispatch(() => throw new InvalidOperationException("boom"));
            dispatcher.Dispatch(() => ran.Add("third"));

            var ex = Record.Exception(() => dispatcher.Drain());

            Assert.Null(ex);
            Assert.Equal(new[] { "first", "third" }, ran);
        }

        [Fact]
        public void Drain_OneThrowingAction_ReportsTheExceptionViaOnActionError()
        {
            var reported = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(reported.Add);
            var thrown = new InvalidOperationException("boom");

            dispatcher.Dispatch(() => throw thrown);

            dispatcher.Drain();

            var reportedException = Assert.Single(reported);
            Assert.Same(thrown, reportedException);
        }

        [Fact]
        public void Drain_WithNothingQueued_IsAnIdempotentNoOp()
        {
            var dispatcher = new MainThreadDispatcher();

            var firstDrain = Record.Exception(() => dispatcher.Drain());
            var secondDrain = Record.Exception(() => dispatcher.Drain());

            Assert.Null(firstDrain);
            Assert.Null(secondDrain);
            Assert.Equal(0, dispatcher.PendingCount);
        }

        [Fact]
        public void Drain_OnlyRunsActionsQueuedAsOfEntry_LeavingLaterDispatchesForTheNextDrain()
        {
            var dispatcher = new MainThreadDispatcher();
            var ran = new List<string>();

            dispatcher.Dispatch(() =>
            {
                ran.Add("a");
                // Enqueued mid-drain — should NOT run until the next Drain call.
                dispatcher.Dispatch(() => ran.Add("queued-during-drain"));
            });

            dispatcher.Drain();
            Assert.Equal(new[] { "a" }, ran);

            dispatcher.Drain();
            Assert.Equal(new[] { "a", "queued-during-drain" }, ran);
        }

        [Fact]
        public void Dispatch_NullAction_Throws()
        {
            var dispatcher = new MainThreadDispatcher();

            Assert.Throws<ArgumentNullException>(() => dispatcher.Dispatch(null!));
        }
    }
}
