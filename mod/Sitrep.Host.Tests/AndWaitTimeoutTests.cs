using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The engine's blocking test helpers must fail when the Courier never gets
    /// to their job. Every suite that says "this tick ran" or "this dispatch was
    /// processed" leans on them, so a helper that returned normally on timeout
    /// would make a wedged Courier indistinguishable from a working one.
    /// </summary>
    public class AndWaitTimeoutTests
    {
        private static readonly TimeSpan Short = TimeSpan.FromMilliseconds(200);
        private static readonly TimeSpan Generous = TimeSpan.FromSeconds(10);

        [Fact]
        public void TickAndWaitThrowsNamingTheUtAndTimeoutWhileTheCourierIsBlocked()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new BlockingCommandUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.DispatchCommand(BlockingCommandUplink.Command, null, "vantage-1", _ => { });
                Assert.True(uplink.Entered.Wait(Generous), "the blocking handler never ran, so the Courier was never parked");

                var ex = Assert.Throws<TimeoutException>(
                    () => engine.TickAndWait(7.5, new KspSnapshot { Ut = 7.5 }, Short));

                Assert.Contains("TickAndWait", ex.Message);
                Assert.Contains("ut=7.5", ex.Message);
                Assert.Contains("200 ms", ex.Message);
            }
            finally
            {
                uplink.Release.Set();
                engine.Stop();
            }
        }

        [Fact]
        public void DispatchCommandAndWaitThrowsNamingTheCommandWhileTheCourierIsBlocked()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new BlockingCommandUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.DispatchCommand(BlockingCommandUplink.Command, null, "vantage-1", _ => { });
                Assert.True(uplink.Entered.Wait(Generous), "the blocking handler never ran, so the Courier was never parked");

                var ex = Assert.Throws<TimeoutException>(
                    () => engine.DispatchCommandAndWait(BlockingCommandUplink.Command, null, "vantage-1", _ => { }, Short));

                Assert.Contains("DispatchCommandAndWait", ex.Message);
                Assert.Contains(BlockingCommandUplink.Command, ex.Message);
                Assert.Contains("200 ms", ex.Message);
            }
            finally
            {
                uplink.Release.Set();
                engine.Stop();
            }
        }

        /// <summary>
        /// The control for the two above: the same engine, once the Courier is
        /// free, completes both helpers without throwing, so the timeouts above
        /// are about the blocked Courier and not about the helper always failing.
        /// </summary>
        [Fact]
        public void BothHelpersReturnOnceTheCourierIsFree()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new BlockingCommandUplink();
            uplink.Release.Set();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                object? result = null;
                engine.DispatchCommandAndWait(BlockingCommandUplink.Command, null, "vantage-1", r => result = r, Generous);
                Assert.NotNull(result);

                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Generous);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class BlockingCommandUplink : ISitrepUplink
        {
            public const string Command = "and-wait-probe.block";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public ManualResetEventSlim Entered { get; } = new ManualResetEventSlim(false);

            public ManualResetEventSlim Release { get; } = new ManualResetEventSlim(false);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "and-wait-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, CommandResult>(Command, _ =>
                {
                    Entered.Set();
                    Release.Wait();
                    return CommandResult.Ok();
                });
            }
        }
    }
}
