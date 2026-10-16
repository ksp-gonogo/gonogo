using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A career command is an order on the home command's ledger and rides the delay
    /// from the centre it is sent from to home: none from a ground centre, the pilot's
    /// own path home from a crewed craft. Sent from the program vantage (<c>"meta"</c>)
    /// it runs at once whichever centre is selected.
    /// </summary>
    public class CareerCommandDelayTests
    {
        private const double PathHomeSeconds = 5.0;
        private const string Ground = "ground:Crater Rim Station";
        private const string Pilot = "vessel:G";

        [Fact]
        public void ACareerCommandRidesTheCentresPathHomeAndRunsAtOnceFromMeta()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new CareerTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Tick(engine, 0.0);
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);

                Dispatch(engine, Ground);
                Tick(engine, 1.5);
                Assert.Equal(1, uplink.HandledCount);

                Dispatch(engine, Pilot);
                Tick(engine, 2.0);
                Assert.Equal(1, uplink.HandledCount);
                Tick(engine, 1.0 + PathHomeSeconds + 1.0);
                Assert.Equal(2, uplink.HandledCount);

                Dispatch(engine, ChannelEngine.MetaVantage);
                Tick(engine, 8.5);
                Assert.Equal(3, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Dispatch(ChannelEngine engine, string vantage)
        {
            string? refusal = null;
            engine.DispatchCommandAndWait(
                CareerTestUplink.Command,
                new Dictionary<string, object?>(),
                vantage,
                _ => { },
                TestBudgets.Op,
                onRefused: (code, reason) => refusal = code.Id + ": " + reason);
            Assert.True(refusal == null, refusal);
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        private sealed class CareerTestUplink : ISitrepUplink
        {
            public const string Command = "career.tech.unlock";
            private const string Topic = "career.status";

            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "career-delay-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                        HeldAtHome = true,
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
                host.AddChannelSource(Topic, _ => null);
                host.AddCommandHandler<Dictionary<string, object?>, string>(Command, _ =>
                {
                    Interlocked.Increment(ref _handled);
                    return "done";
                });
                host.SetConnectivitySource(_ => true);
            }
        }
    }
}
