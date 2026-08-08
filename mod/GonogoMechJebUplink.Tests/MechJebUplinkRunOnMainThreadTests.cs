using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Gonogo.MechJebUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// Headless tests for <see cref="MechJebUplink.RunOnMainThread"/>: the
    /// drop-not-run-on-timeout discipline that stops a delayed
    /// <c>mechjeb.*</c> command from firing its MechJeb2 side effect after
    /// the client has already been told it timed out (copied from
    /// <c>GonogoKosUplink</c>'s identical M1 fix, see
    /// <c>KosExtensionRunOnMainThreadTests</c>). Uses the real
    /// <see cref="MainThreadDispatcher"/> and controls exactly when its
    /// <c>Drain</c> runs relative to the timeout, so the late-drain race is
    /// exercised deterministically. No MechJeb2/Unity involved.
    /// </summary>
    public class MechJebUplinkRunOnMainThreadTests
    {
        [Fact]
        public void RunOnMainThread_TimeoutThenLateDrain_DropsWork_NoException_NoDoubleFire()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var uplink = new MechJebUplink(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromMilliseconds(50),
            };

            var ran = 0;

            // Never drained before the wait expires -> the waiter times out.
            var result = uplink.RunOnMainThread(() =>
            {
                Interlocked.Increment(ref ran);
                return CommandResult.Ok();
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Timeout, result.ErrorCode);
            Assert.Equal(0, ran);

            // The dispatcher only now drains the deferred action (production: the
            // Unity main thread catches up after a scene-load stall). The job was
            // abandoned, so the MechJeb2 mutation must NOT run, a client retry
            // would otherwise double-fire the engage: and no Set()-after-dispose fault.
            dispatcher.Drain();

            Assert.Equal(0, ran);
            Assert.Empty(drainErrors);
        }

        [Fact]
        public async Task RunOnMainThread_DrainedInTime_RunsWorkOnce_ReturnsResult()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var uplink = new MechJebUplink(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromSeconds(5),
            };

            var ran = 0;

            // RunOnMainThread blocks the calling thread, so invoke it off-thread
            // and drain from the test thread once the action is queued.
            var call = Task.Run(() => uplink.RunOnMainThread(() =>
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
        /// Regression for the same self-deadlock <c>GonogoKosUplink</c> hit
        /// (kos-uplink-gap): in production the <c>ChannelEngine</c> is built
        /// <c>executeCommandsOnMainThread:true</c>, so a mechjeb.* command
        /// handler is frequently ALREADY running on the KSP main thread by
        /// the time this runs. <see cref="MainThreadDispatcher.Drain"/> runs
        /// on that SAME Unity main thread
        /// (<c>MechJebMainThreadDispatcherAddon.Update</c>). Without the
        /// reentrancy check, <see cref="MechJebUplink.RunOnMainThread"/> would
        /// <c>Dispatch</c> to that same thread and block on <c>Done.Wait</c>,
        /// where the <c>Drain</c> that would run <c>work</c> can never run:
        /// self-deadlock into a timeout with the engage side effect never
        /// running. This test establishes the current thread as the
        /// dispatcher's drain thread first, then invokes
        /// <see cref="MechJebUplink.RunOnMainThread"/> on it: the fix runs the
        /// work inline.
        /// </summary>
        [Fact]
        public void RunOnMainThread_WhenAlreadyOnTheDispatcherDrainThread_RunsInlineInsteadOfDeadlocking()
        {
            var drainErrors = new List<Exception>();
            var dispatcher = new MainThreadDispatcher(drainErrors.Add);
            var uplink = new MechJebUplink(dispatcher, _ => { })
            {
                // Short so the deadlock (if the reentrancy check regressed) fails fast.
                CommandMainThreadTimeout = TimeSpan.FromMilliseconds(500),
            };

            // Establish THIS thread as the dispatcher's drain (main) thread,
            // exactly as MechJebMainThreadDispatcherAddon.Update's per-frame
            // Drain does, every frame since startup, before any command
            // arrives.
            dispatcher.Drain();

            var ran = 0;
            var result = uplink.RunOnMainThread(() =>
            {
                Interlocked.Increment(ref ran);
                return CommandResult.Ok();
            });

            Assert.True(result.Success,
                "a mechjeb command invoked on the main thread must succeed, not self-deadlock into a Timeout");
            Assert.Equal(CommandErrorCode.None, result.ErrorCode);
            Assert.Equal(1, ran);
            Assert.Empty(drainErrors);
        }

        /// <summary>
        /// The same self-deadlock proven under the FULL production thread
        /// topology, pumped exactly as production pumps it (mirrors
        /// <c>KosExtensionRunOnMainThreadTests.KosCommand_UnderProductionThreadTopology_CompletesInsteadOfDeadlocking</c>):
        /// ONE "Unity main thread" drains BOTH the engine's marshalled-command
        /// mailbox (== <c>ChannelEngine.RunPendingCommands</c>) AND the
        /// MechJeb <see cref="MainThreadDispatcher"/> (==
        /// <c>MechJebMainThreadDispatcherAddon.Update</c>). A background
        /// "Courier" thread dispatches the command by marshalling the handler
        /// onto that mailbox and blocking on the result. The handler body
        /// itself double-marshals via <see cref="MechJebUplink.RunOnMainThread"/>.
        /// </summary>
        [Fact]
        public void MechJebCommand_UnderProductionThreadTopology_CompletesInsteadOfDeadlocking()
        {
            var dispatcher = new MainThreadDispatcher();
            var uplink = new MechJebUplink(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromSeconds(2),
            };

            var engineMailbox = new ConcurrentQueue<Action>();
            using var stop = new ManualResetEventSlim(false);
            using var pumpDrainedOnce = new ManualResetEventSlim(false);

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

            var courier = new Thread(() =>
            {
                using var handlerDone = new ManualResetEventSlim(false);
                CommandResult? handlerResult = null;
                engineMailbox.Enqueue(() =>
                {
                    handlerResult = uplink.RunOnMainThread(() =>
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
                "the mechjeb command self-deadlocked: the main thread parked in RunOnMainThread and never drained the dispatcher");
            Assert.Equal(1, ran);
        }

        [Fact]
        public void RunOnMainThread_WorkThrows_ReturnsUnknownFailure_NeverThrows()
        {
            var dispatcher = new MainThreadDispatcher();
            var uplink = new MechJebUplink(dispatcher, _ => { })
            {
                CommandMainThreadTimeout = TimeSpan.FromSeconds(2),
            };

            // Establish this thread as the drain thread so the call runs
            // inline (deterministic, no background pump needed).
            dispatcher.Drain();

            var result = uplink.RunOnMainThread(() => throw new InvalidOperationException("boom"));

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Unknown, result.ErrorCode);
        }
    }
}
