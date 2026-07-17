using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKosUplink.Tests
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

        /// <summary>
        /// Regression for the kos-uplink-gap self-deadlock: every kos command
        /// (kos.run/kos.exec/kos.terminal.*) timed out with
        /// <see cref="CommandErrorCode.Timeout"/> (errorCode:6) after ~4s and
        /// its kOS side effect (TypeCommand/RUNPATH) never executed.
        ///
        /// <para>Root cause is a DOUBLE main-thread marshal. In production the
        /// <c>ChannelEngine</c> is built <c>executeCommandsOnMainThread:true</c>,
        /// so it already runs the command handler ON the KSP main thread
        /// (drained by <c>GonogoAddon.Update -&gt; ChannelEngine.RunPendingCommands</c>).
        /// <see cref="MainThreadDispatcher.Drain"/> runs on that SAME Unity main
        /// thread (<c>KosMainThreadDispatcherAddon.Update</c>). So by the time a
        /// kos handler body runs it is ALREADY on the dispatcher's drain thread —
        /// and every frame since startup has drained the dispatcher, establishing
        /// that thread. The buggy <see cref="KosExtension.RunOnMainThread"/> then
        /// <c>Dispatch</c>es to that same thread and blocks on <c>Done.Wait</c>,
        /// where the <c>Drain</c> that would run <c>work</c> can never run — the
        /// whole main thread wedges until the wait expires and the work is
        /// dropped.</para>
        ///
        /// <para>This test reproduces exactly that condition: it establishes the
        /// current thread as the dispatcher's drain thread (as the addon's
        /// per-frame Drain does long before any command), then invokes
        /// <see cref="KosExtension.RunOnMainThread"/> on it. With the bug the
        /// call self-deadlocks into a Timeout and the work never runs; the fix
        /// runs the work inline.</para>
        /// </summary>
        [Fact]
        public void RunOnMainThread_WhenAlreadyOnTheDispatcherDrainThread_RunsInlineInsteadOfDeadlocking()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var ext = new KosExtension(dispatcher, _ => { })
            {
                // Short so the buggy deadlock fails fast; production is 5s and
                // the engine's own 4s backstop is what the live client saw as
                // errorCode:6.
                CommandMainThreadTimeout = TimeSpan.FromMilliseconds(500),
            };

            // Establish THIS thread as the dispatcher's drain (main) thread —
            // exactly as KosMainThreadDispatcherAddon.Update's per-frame Drain
            // does, every frame since startup, before any command arrives.
            dispatcher.Drain();

            var ran = 0;
            var result = ext.RunOnMainThread(() =>
            {
                Interlocked.Increment(ref ran);
                return CommandResult.Ok();
            });

            Assert.True(result.Success,
                "a kos command invoked on the main thread must succeed, not self-deadlock into a Timeout");
            Assert.Equal(CommandErrorCode.None, result.ErrorCode);
            Assert.Equal(1, ran);
            Assert.Empty(drainErrors);
        }

        /// <summary>
        /// The same self-deadlock proven under the FULL production thread
        /// topology, pumped exactly as production pumps it: ONE "Unity main
        /// thread" drains BOTH the engine's marshalled-command mailbox
        /// (== <c>ChannelEngine.RunPendingCommands</c>, from <c>GonogoAddon.Update</c>)
        /// AND the kOS <see cref="MainThreadDispatcher"/>
        /// (== <c>KosMainThreadDispatcherAddon.Update</c>). A background "Courier"
        /// thread dispatches the command by marshalling the handler onto that
        /// mailbox and blocking on the result — the shape of
        /// <c>ChannelEngine.RunOnMainThread</c>. The handler body itself
        /// double-marshals via <see cref="KosExtension.RunOnMainThread"/>.
        ///
        /// <para>With the bug the main thread parks inside the handler's
        /// <c>Done.Wait</c> and never returns to drain the dispatcher, so the
        /// work is stranded and the command comes back <see cref="CommandErrorCode.Timeout"/>;
        /// the fix runs the work inline on the main thread and the command
        /// succeeds.</para>
        /// </summary>
        [Fact]
        public void KosCommand_UnderProductionThreadTopology_CompletesInsteadOfDeadlocking()
        {
            var dispatcher = new MainThreadDispatcher();
            var ext = new KosExtension(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromSeconds(2),
            };

            var engineMailbox = new ConcurrentQueue<Action>();
            using var stop = new ManualResetEventSlim(false);
            using var pumpDrainedOnce = new ManualResetEventSlim(false);

            // The single Unity main thread: every frame it drains the kOS
            // dispatcher (KosMainThreadDispatcherAddon.Update) AND runs any
            // command the engine marshalled onto the main thread
            // (GonogoAddon.Update -> ChannelEngine.RunPendingCommands).
            var pump = new Thread(() =>
            {
                while (!stop.IsSet)
                {
                    dispatcher.Drain();
                    pumpDrainedOnce.Set();
                    while (engineMailbox.TryDequeue(out var job))
                    {
                        job();
                    }
                    Thread.Sleep(2);
                }
            })
            { IsBackground = true, Name = "test-unity-main-thread" };
            pump.Start();
            Assert.True(pumpDrainedOnce.Wait(TimeSpan.FromSeconds(2)),
                "the main-thread pump never drained the dispatcher");

            var ran = 0;
            CommandResult? courierResult = null;
            using var courierDone = new ManualResetEventSlim(false);

            // The Courier thread: marshal the command handler onto the main
            // thread and block on its result, like ChannelEngine.RunOnMainThread.
            var courier = new Thread(() =>
            {
                using var handlerDone = new ManualResetEventSlim(false);
                CommandResult? handlerResult = null;
                engineMailbox.Enqueue(() =>
                {
                    // Runs ON the main thread — this IS the kos command handler
                    // body, which double-marshals via KosExtension.RunOnMainThread.
                    handlerResult = ext.RunOnMainThread(() =>
                    {
                        Interlocked.Increment(ref ran);
                        return CommandResult.Ok();
                    });
                    handlerDone.Set();
                });
                handlerDone.Wait(TimeSpan.FromSeconds(10));
                courierResult = handlerResult;
                courierDone.Set();
            })
            { IsBackground = true, Name = "test-courier" };
            courier.Start();

            var completed = courierDone.Wait(TimeSpan.FromSeconds(8));
            stop.Set();
            pump.Join(TimeSpan.FromSeconds(2));
            courier.Join(TimeSpan.FromSeconds(2));

            Assert.True(completed, "the command never completed");
            Assert.NotNull(courierResult);
            Assert.True(courierResult!.Success,
                "the kos command self-deadlocked: the main thread parked in RunOnMainThread and never drained the dispatcher");
            Assert.Equal(1, ran);
        }
    }
}
