using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A delayed command whose Subject is a static channel of the active craft, the shape of
    /// the camera aim and zoom commands, runs no sooner than the one-way signal delay after
    /// the press, however far the press falls from the last sampled tick (one UT second at
    /// ordinary rates).
    /// </summary>
    public class CameraCommandDelayTests
    {
        private const double OneWay = 3.0;
        private const double Step = 0.02;
        private const int TicksEvery = 50;
        private const string Ground = "ground:Kerbin: KSC";

        [Theory]
        [InlineData(0)]
        [InlineData(37)]
        [InlineData(99)]
        public void ACameraCommandRunsNoSoonerThanTheOneWayDelayAfterThePress(int hundredthsAfterATick)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new CameraLikeUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var step = 0;
                void Advance()
                {
                    step++;
                    var ut = 100.0 + step * Step;
                    engine.NoteGameUt(ut);
                    uplink.CurrentUt = ut;
                    if (step % TicksEvery == 0)
                    {
                        Tick(engine, ut);
                    }
                }

                Tick(engine, 100.0);
                while (step < hundredthsAfterATick / 2)
                {
                    Advance();
                }
                var pressed = 100.0 + step * Step;

                double? quoted = null;
                engine.DispatchCommandAndWait(CameraLikeUplink.Command, "x", Ground, _ => { }, TestBudgets.Op, onAccepted: s => quoted = s);

                for (var i = 0; i < 1000 && uplink.RanAtUt == null; i++)
                {
                    Advance();
                }

                Assert.NotNull(uplink.RanAtUt);
                Assert.Equal(OneWay, quoted);
                Assert.True(
                    uplink.RanAtUt!.Value - pressed >= OneWay - 1e-6,
                    "ran " + (uplink.RanAtUt.Value - pressed).ToString("0.000") + " s after a press quoted " + quoted + " s");
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Tick(ChannelEngine engine, double ut)
        {
            var snapshot = HomeLedgerTestUplink.Snapshot(ut, craft: 1.0, delay: OneWay, connected: true);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = "G" },
            };
            engine.TickAndWait(ut, snapshot, TestBudgets.Op);
        }

        private sealed class CameraLikeUplink : ISitrepUplink
        {
            public const string Command = "cam.aim";
            private const string Topic = "cam.cameras";

            private double? _ranAt;

            public double CurrentUt;

            public double? RanAtUt => _ranAt;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "camera-delay-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    { Kind = SampleKind.Discrete,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, snapshot => snapshot != null && snapshot.Values.TryGetValue("craft", out var v) ? v : null);
                host.SetSignalDelaySource(snapshot => snapshot != null && snapshot.Values.TryGetValue("delay", out var v) && v is double seconds
                    ? new CommsDelay { OneWaySeconds = seconds, Source = CommsDelaySource.SignalDelay }
                    : null);
                host.SetConnectivitySource(snapshot => snapshot != null && snapshot.Values.TryGetValue("connected", out var v) ? v as bool? : null);
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    _ranAt = CurrentUt;
                    return "done";
                });
            }
        }
    }
}
