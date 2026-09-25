using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a command handler that throws takes down with it: itself, and
    /// nothing else its uplink owns.
    ///
    /// <para>Found on the rig: <c>ksp.switchVessel</c> threw from the space
    /// centre, and from then on every <c>ksp.*</c> command (launch, recover,
    /// revert) was refused as unavailable until the game restarted, while the
    /// command that actually broke had reported success.</para>
    /// </summary>
    public class HandlerFailureScopeTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private sealed class Outcome
        {
            public bool Resolved;
            public object? Result;
            public string? Refusal;
        }

        private static Outcome Dispatch(ChannelEngine engine, string command, object? args = null)
        {
            var outcome = new Outcome();
            engine.DispatchCommandAndWait(
                command, args, "vantage-1",
                r => { outcome.Resolved = true; outcome.Result = r; },
                Timeout,
                onRefused: reason => outcome.Refusal = reason);
            return outcome;
        }

        [Fact]
        public void AThrowingHandlerIsRefusedAndItsSiblingsStillRun()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FlightOpsLikeUplink());
            engine.Start();
            try
            {
                var thrown = Dispatch(engine, FlightOpsLikeUplink.Switch);

                // The call that broke is refused, never reported as a result: a
                // null result reads as success on the client.
                Assert.False(thrown.Resolved);
                Assert.NotNull(thrown.Refusal);
                Assert.Contains(FlightOpsLikeUplink.Switch, thrown.Refusal);
                Assert.Contains(FlightOpsLikeUplink.Failure, thrown.Refusal);

                var launch = Dispatch(engine, FlightOpsLikeUplink.Launch);
                Assert.Null(launch.Refusal);
                Assert.Equal("launched", launch.Result);

                var recover = Dispatch(engine, FlightOpsLikeUplink.Recover);
                Assert.Null(recover.Refusal);
                Assert.Equal("recovered", recover.Result);

                Assert.True(engine.AvailabilityOf(FlightOpsLikeUplink.UplinkId).IsAvailable);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void TheCommandThatThrewStaysRefusedAndSaysWhy()
        {
            var uplink = new FlightOpsLikeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Dispatch(engine, FlightOpsLikeUplink.Switch);
                var again = Dispatch(engine, FlightOpsLikeUplink.Switch);

                Assert.False(again.Resolved);
                Assert.NotNull(again.Refusal);
                Assert.Contains(FlightOpsLikeUplink.Switch, again.Refusal);
                Assert.Contains(FlightOpsLikeUplink.Failure, again.Refusal);
                // Not run a second time: what the first run half-did is unknown.
                Assert.Equal(1, uplink.SwitchRuns);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// The production shape: handlers run on the main-thread pump, and a throw
        /// there is captured and re-raised on the Courier thread.
        /// </summary>
        [Fact]
        public void AThrowOnTheMainThreadPumpIsScopedTheSameWay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(new FlightOpsLikeUplink());
            engine.Start();

            using var stop = new ManualResetEventSlim(false);
            var pump = new Thread(() =>
            {
                while (!stop.IsSet)
                {
                    engine.RunPendingCommands();
                    Thread.Sleep(2);
                }
                engine.RunPendingCommands();
            })
            { IsBackground = true, Name = "test-main-thread-pump" };
            pump.Start();

            try
            {
                var thrown = Dispatch(engine, FlightOpsLikeUplink.Switch);
                Assert.NotNull(thrown.Refusal);
                Assert.Contains(FlightOpsLikeUplink.Switch, thrown.Refusal);

                var launch = Dispatch(engine, FlightOpsLikeUplink.Launch);
                Assert.Null(launch.Refusal);
                Assert.Equal("launched", launch.Result);
            }
            finally
            {
                stop.Set();
                pump.Join(Timeout);
                engine.Stop();
            }
        }

        /// <summary>
        /// A delayed command runs from the Courier's clock callback rather than on
        /// the dispatch step, and its answer comes back the same way.
        /// </summary>
        [Fact]
        public void AThrowOnTheDelayedPathIsRefusedRatherThanConfirmed()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            engine.RegisterUplink(new FlightOpsLikeUplink());
            engine.Start();
            try
            {
                var thrown = new Outcome();
                engine.DispatchCommandAndWait(
                    FlightOpsLikeUplink.DelayedSwitch, null, "vantage-1",
                    r => { thrown.Resolved = true; thrown.Result = r; },
                    Timeout,
                    onRefused: reason => thrown.Refusal = reason);
                engine.TickAndWait(20.0, null, Timeout);

                Assert.False(thrown.Resolved);
                Assert.NotNull(thrown.Refusal);
                Assert.Contains(FlightOpsLikeUplink.DelayedSwitch, thrown.Refusal);

                var launch = Dispatch(engine, FlightOpsLikeUplink.Launch);
                Assert.Equal("launched", launch.Result);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// A gate evaluator that throws holds its command as Unknown, the same
        /// answer as one that returns nothing, and leaves the uplink alone. It
        /// only reads, so the next ask may well answer.
        /// </summary>
        [Fact]
        public void AThrowingGateEvaluatorHoldsItsCommandWithoutTakingAnythingDown()
        {
            var uplink = new FlightOpsLikeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                uplink.GateThrows = true;
                var held = Dispatch(engine, FlightOpsLikeUplink.Gated);
                Assert.False(held.Resolved);
                Assert.NotNull(held.Refusal);
                Assert.Contains("threw", held.Refusal);

                Assert.True(engine.AvailabilityOf(FlightOpsLikeUplink.UplinkId).IsAvailable);
                Assert.Equal("launched", Dispatch(engine, FlightOpsLikeUplink.Launch).Result);

                uplink.GateThrows = false;
                Assert.Equal("gated-ran", Dispatch(engine, FlightOpsLikeUplink.Gated).Result);
            }
            finally { engine.Stop(); }
        }

        private sealed class FlightOpsLikeUplink : ISitrepUplink
        {
            public const string UplinkId = "test-flight-ops";
            public const string Switch = "test.switchVessel";
            public const string DelayedSwitch = "test.switchVesselDelayed";
            public const string Launch = "test.launch";
            public const string Recover = "test.recover";
            public const string Gated = "test.gated";
            public const string Topic = "test.flightOps.state";
            public const string GateKind = "test-throwing-gate";
            public const string Failure = "Object reference not set to an instance of an object";

            private int _switchRuns;

            public int SwitchRuns => Volatile.Read(ref _switchRuns);

            public volatile bool GateThrows;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Switch, Delay = DelayRole.TrueNow },
                    new CommandDeclaration { Command = DelayedSwitch, Delay = DelayRole.Delayed, Subject = Topic },
                    new CommandDeclaration { Command = Launch, Delay = DelayRole.TrueNow },
                    new CommandDeclaration { Command = Recover, Delay = DelayRole.TrueNow },
                    new CommandDeclaration
                    {
                        Command = Gated,
                        Delay = DelayRole.TrueNow,
                        Requires = new[] { new CommandRequirement { Kind = GateKind } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, string>(Switch, _ =>
                {
                    Interlocked.Increment(ref _switchRuns);
                    throw new NullReferenceException(Failure);
                });
                host.AddCommandHandler<object?, string>(DelayedSwitch, _ => throw new NullReferenceException(Failure));
                host.AddCommandHandler<object?, string>(Launch, _ => "launched");
                host.AddCommandHandler<object?, string>(Recover, _ => "recovered");
                host.AddCommandHandler<object?, string>(Gated, _ => "gated-ran");
                host.AddGateEvaluator(new Evaluator(this));
            }

            private sealed class Evaluator : ICommandGateEvaluator
            {
                private readonly FlightOpsLikeUplink _owner;

                public Evaluator(FlightOpsLikeUplink owner) => _owner = owner;

                public string Kind => GateKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    if (_owner.GateThrows) throw new NullReferenceException("no flight scene");
                    return GateVerdict.Pass();
                }
            }
        }
    }
}
