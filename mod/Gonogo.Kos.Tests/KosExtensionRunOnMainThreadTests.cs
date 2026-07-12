using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Gonogo.Kos;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Headless tests for <see cref="KosExtension.RunOnMainThread"/> — the
    /// adversarial-review M1 fix (timed-out RUNPATH must be DROPPED, not run
    /// late, and the wait handle must never be <c>Set()</c> after disposal).
    /// Uses the real <see cref="MainThreadDispatcher"/> and controls exactly
    /// when its <c>Drain</c> runs relative to the timeout, so the late-drain
    /// race is exercised deterministically. No kOS/Unity involved.
    /// </summary>
    public class KosExtensionRunOnMainThreadTests
    {
        [Fact]
        public void RunOnMainThread_TimeoutThenLateDrain_DropsWork_NoException_NoDoubleFire()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var ext = new KosExtension(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromMilliseconds(50),
            };

            var ran = 0;

            // Never drained before the wait expires → the waiter times out.
            var result = ext.RunOnMainThread(() =>
            {
                Interlocked.Increment(ref ran);
                return CommandResult.Ok();
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Timeout, result.ErrorCode);
            Assert.Equal(0, ran);

            // The dispatcher only now drains the deferred action (production: the
            // Unity main thread catches up after a scene-load stall). The job was
            // abandoned, so the kOS mutation must NOT run — a client retry would
            // otherwise double-fire RUNPATH — and no Set()-after-dispose fault.
            dispatcher.Drain();

            Assert.Equal(0, ran);
            Assert.Empty(drainErrors);
        }

        [Fact]
        public async Task RunOnMainThread_DrainedInTime_RunsWorkOnce_ReturnsResult()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var ext = new KosExtension(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromSeconds(5),
            };

            var ran = 0;

            // RunOnMainThread blocks the calling thread, so invoke it off-thread
            // and drain from the test thread once the action is queued.
            var call = Task.Run(() => ext.RunOnMainThread(() =>
            {
                Interlocked.Increment(ref ran);
                return CommandResult.Ok();
            }));

            var spun = SpinWait.SpinUntil(() => dispatcher.PendingCount > 0, TimeSpan.FromSeconds(2));
            Assert.True(spun, "action was never enqueued");
            dispatcher.Drain();

            var result = await call;

            Assert.True(result.Success);
            Assert.Equal(1, ran);
            Assert.Empty(drainErrors);
        }
    }
}
