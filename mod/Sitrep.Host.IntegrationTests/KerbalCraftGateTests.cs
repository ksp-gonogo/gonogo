using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A vessel command refused because a kerbal is the craft is refused when it is sent, with one
    /// reason: it is not held at the command centre for a craft that is not there and run when
    /// that craft loads again.
    /// </summary>
    public class KerbalCraftGateTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const string Reason = "no vessel in range";

        [Fact]
        public void ACommandIsRefusedAtOnceWithTheReasonAndNeverRunsWhenTheLinkOrTheCraftReturns()
        {
            var uplink = new GatedVesselUplink { KerbalIsTheCraft = true };
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: false), Timeout);

                object? answer = null;
                engine.DispatchCommandAndWait(
                    GatedVesselUplink.Command, "x", "vantage-1",
                    r => answer = r,
                    Timeout);

                var result = Assert.IsType<CommandResult>(answer);
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
                Assert.Contains(Reason, result.Detail ?? "");

                // The craft loads again and the link returns: nothing was held to run.
                uplink.KerbalIsTheCraft = false;
                engine.TickAndWait(20.0, FreezeGateTestUplink.Snapshot(20.0, connected: true), Timeout);
                Assert.Equal(0, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheSameCommandRunsWhenNoKerbalIsTheCraft()
        {
            var uplink = new GatedVesselUplink { KerbalIsTheCraft = false };
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true), Timeout);

                engine.DispatchCommandAndWait(
                    GatedVesselUplink.Command, "x", "vantage-1", _ => { }, Timeout);
                engine.TickAndWait(5.0, FreezeGateTestUplink.Snapshot(5.0, connected: true), Timeout);

                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class GatedVesselUplink : ISitrepUplink
        {
            public const string Command = "probe.vessel.setSas";
            public const string GateKind = "kerbal-is-the-craft";
            public const string Topic = "probe.subject";
            private int _handled;

            public volatile bool KerbalIsTheCraft;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "kerbal-craft-gate-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Subject = Topic,
                        Delay = DelayRole.Delayed,
                        Requires = new[] { new CommandRequirement { Kind = GateKind } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "ok:" + args;
                });
                host.AddGateEvaluator(new Evaluator(this));
                host.SetSignalDelaySource(snapshot => new CommsDelay { OneWaySeconds = 0.0, Source = CommsDelaySource.SignalDelay });
                host.SetConnectivitySource(snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("connected", out var v) && v != null
                        ? Convert.ToBoolean(v)
                        : (bool?)null);
            }

            private sealed class Evaluator : ICommandGateEvaluator
            {
                private readonly GatedVesselUplink _owner;

                public Evaluator(GatedVesselUplink owner) => _owner = owner;

                public string Kind => GateKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _owner.KerbalIsTheCraft
                        ? GateVerdict.Fail(CommandErrorCode.NoVessel, Reason)
                        : GateVerdict.Pass();
            }
        }
    }
}
