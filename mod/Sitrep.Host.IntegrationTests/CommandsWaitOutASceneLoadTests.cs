using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command sent while the game is loading a scene waits for the scene to
    /// stand and then runs, where it used to wait out the main-thread timeout
    /// and fail. A switch to a craft that is not loaded reloads the flight
    /// scene, so every such switch is a load.
    /// </summary>
    public class CommandsWaitOutASceneLoadTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        /// <summary>
        /// The hold limit the bound test gives the engine. It is the setting
        /// under test and no deadline of the test's own: the test waits for the
        /// failure the limit brings, under <see cref="Timeout"/>, so a slow
        /// machine only makes that failure arrive later.
        /// </summary>
        private const double ShortHoldMilliseconds = 300;

        /// <summary>An engine whose commands run on a pump thread standing in for the game's main thread.</summary>
        private sealed class World : IDisposable
        {
            private readonly Thread _pump;
            private volatile bool _stop;

            public World()
            {
                Engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
                Engine.RegisterUplink(Probe);
                Engine.Start();
                Engine.SetGameState(GamePhase.Ready, "FLIGHT");
                _pump = new Thread(() =>
                {
                    while (!_stop)
                    {
                        Engine.RunPendingCommands();
                        Thread.Sleep(1);
                    }
                }) { IsBackground = true };
                _pump.Start();
            }

            public ChannelEngine Engine { get; }

            public CountingUplink Probe { get; } = new CountingUplink();

            /// <summary>What one dispatch came to: its result, its fault, and what the sender was told on acceptance.</summary>
            public sealed class Sent
            {
                public readonly ManualResetEventSlim Settled = new ManualResetEventSlim(false);
                public object? Result;
                public FaultCode? Fault;
                public string? FaultReason;
                public int Accepted;
                public double? ExpiresAtUt;
            }

            public Sent Send()
            {
                var sent = new Sent();
                Engine.DispatchCommand(
                    CountingUplink.Command,
                    null,
                    "vantage-1",
                    result =>
                    {
                        sent.Result = result;
                        sent.Settled.Set();
                    },
                    onRefused: (code, reason) =>
                    {
                        sent.Fault = code;
                        sent.FaultReason = reason;
                        sent.Settled.Set();
                    },
                    onAcceptedHeld: (oneWay, replyUt, expiresAtUt, warning) =>
                    {
                        sent.ExpiresAtUt = expiresAtUt;
                        Interlocked.Increment(ref sent.Accepted);
                    });
                return sent;
            }

            public void Dispose()
            {
                _stop = true;
                _pump.Join(Timeout);
                Engine.Stop();
                Engine.Dispose();
            }
        }

        private sealed class CountingUplink : ISitrepUplink
        {
            public const string Command = "probe.count";

            private int _ran;

            public int Ran => Volatile.Read(ref _ran);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "load-hold-probe",
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
                    Interlocked.Increment(ref _ran);
                    return CommandResult.Ok();
                });
            }
        }

        private static string Outcome(World.Sent sent) =>
            sent.Fault != null
                ? "fault " + sent.Fault
                : sent.Result is CommandResult result
                    ? "result ok=" + result.Success + " code=" + result.ErrorCode + " detail=" + result.Detail
                    : "result " + sent.Result;

        [Fact]
        public void ACommandSentMidLoadRunsOnceTheSceneStandsWithTheOutcomeOfOneSentAfter()
        {
            using var world = new World();
            world.Engine.SetGameState(GamePhase.Loading, "FLIGHT");

            var held = world.Send();
            var settled = held.Settled;

            Assert.False(settled.Wait(TimeSpan.FromMilliseconds(400)), "the command settled while the game was still loading");
            Assert.Equal(0, world.Probe.Ran);
            Assert.Equal(1, Volatile.Read(ref held.Accepted));
            Assert.NotNull(held.ExpiresAtUt);

            world.Engine.SetGameState(GamePhase.Ready, "FLIGHT");
            world.Engine.TickAndWait(10.0, null, Timeout);

            Assert.True(held.Settled.Wait(Timeout), "the command never ran after the scene stood");
            Assert.Equal(1, world.Probe.Ran);

            var after = world.Send();
            Assert.True(after.Settled.Wait(Timeout));
            Assert.Equal(Outcome(after), Outcome(held));
            Assert.Equal(2, world.Probe.Ran);
        }

        [Fact]
        public void AHeldCommandIsListedAsHeldAtTheCentreThatSentItAndLeavesTheListWhenItRuns()
        {
            using var world = new World();
            world.Engine.SetGameState(GamePhase.Loading, "FLIGHT");
            var held = world.Send();
            var settled = held.Settled;
            Assert.False(settled.Wait(TimeSpan.FromMilliseconds(200)));

            var loading = Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic));
            var entry = Assert.Single(loading.Pending);
            Assert.Equal(CountingUplink.Command, entry.Command);
            Assert.Equal("vantage-1", entry.PredictedHeldAt);
            Assert.Null(entry.PredictedHeldUntilUt);

            world.Engine.SetGameState(GamePhase.Ready, "FLIGHT");
            world.Engine.TickAndWait(10.0, null, Timeout);
            Assert.True(held.Settled.Wait(Timeout));

            Assert.Empty(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
        }

        [Fact]
        public void HeldCommandsRunInTheOrderTheyWereSent()
        {
            using var world = new World();
            world.Engine.SetGameState(GamePhase.Loading, "FLIGHT");
            var order = new List<int>();
            var done = new CountdownEvent(3);
            for (var i = 0; i < 3; i++)
            {
                var n = i;
                world.Engine.DispatchCommand(CountingUplink.Command, null, "vantage-1", _ =>
                {
                    lock (order)
                    {
                        order.Add(n);
                    }
                    done.Signal();
                });
            }
            Thread.Sleep(200);
            Assert.Equal(0, world.Probe.Ran);

            world.Engine.SetGameState(GamePhase.Ready, "FLIGHT");
            world.Engine.TickAndWait(10.0, null, Timeout);

            Assert.True(done.Wait(Timeout));
            Assert.Equal(new[] { 0, 1, 2 }, order);
        }

        [Fact]
        public void AHeldCommandRunsWithoutATickOnceTheLoadHasBeenOverAWhile()
        {
            using var world = new World();
            world.Engine.SetGameState(GamePhase.Loading, "SPACECENTER");
            var held = world.Send();
            var settled = held.Settled;
            Assert.False(settled.Wait(TimeSpan.FromMilliseconds(200)));

            world.Engine.SetGameState(GamePhase.Ready, "SPACECENTER");

            Assert.True(held.Settled.Wait(Timeout), "no tick came, and the command was never released");
            Assert.Null(held.Fault);
            Assert.Equal(1, world.Probe.Ran);
        }

        [Fact]
        public void ALoadThatNeverEndsFailsTheCommandAtTheBoundAndNeverRunsIt()
        {
            using var world = new World();
            world.Engine.LoadHoldLimit = TimeSpan.FromMilliseconds(ShortHoldMilliseconds);
            world.Engine.SetGameState(GamePhase.Loading, "FLIGHT");

            var held = world.Send();

            Assert.True(held.Settled.Wait(Timeout), "the command was held for ever");
            Assert.Equal(FaultCode.MainThreadTimeout, held.Fault);
            Assert.Equal(0, world.Probe.Ran);

            world.Engine.SetGameState(GamePhase.Ready, "FLIGHT");
            world.Engine.TickAndWait(10.0, null, Timeout);
            Thread.Sleep(100);
            Assert.Equal(0, world.Probe.Ran);
        }

        [Fact]
        public void ACommandSentWithNoLoadInProgressIsNeverHeld()
        {
            using var world = new World();

            var sent = world.Send();

            Assert.True(sent.Settled.Wait(Timeout));
            Assert.Null(sent.Fault);
            Assert.Equal(0, Volatile.Read(ref sent.Accepted));
            Assert.Equal(1, world.Probe.Ran);
            Assert.Empty(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
        }
    }
}
