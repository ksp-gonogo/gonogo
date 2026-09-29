using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command from a centre that has no route to the craft it addresses is
    /// refused, even while that craft still reaches home, and the delay the
    /// centre was quoted while it had a route is gone with the route.
    /// </summary>
    public class CommandReachDispatchTests
    {
        private const string Forward = "vessel:F";
        private const string Ground = "ground:Cape";
        private const string Craft = "G";
        private const double ForwardSeconds = 4.0;

        [Fact]
        public void ACentreThatLostItsRouteToACraftIsRefusedNotQuotedItsLastDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new CraftCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetAuthorityDelays(new[] { (Forward, Craft, ForwardSeconds) });
                engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>());
                Tick(engine, 0.0);

                double? routed = null;
                engine.DispatchCommandAndWait(CraftCommandTestUplink.Command, "x", Forward, _ => { }, TestBudgets.Op, onAccepted: s => routed = s);
                Tick(engine, ForwardSeconds + 1.0);
                Assert.Equal(ForwardSeconds, routed);
                Assert.Equal(1, uplink.HandledCount);

                engine.SetAuthorityDelays(System.Array.Empty<(string, string, double)>());
                engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>
                {
                    [Forward] = new[] { AuthorityMatrixPass.FleetNode(Craft) },
                });
                Tick(engine, 10.0);

                double? quoted = null;
                engine.DispatchCommandAndWait(CraftCommandTestUplink.Command, "y", Forward, _ => { }, TestBudgets.Op, onAccepted: s => quoted = s);
                Tick(engine, 100.0);

                Assert.Null(quoted);
                Assert.Equal(1, uplink.HandledCount);
                Assert.NotEqual(ForwardSeconds, engine.LedgerDelayFor(Forward, AuthorityMatrixPass.FleetNode(Craft)));

                engine.DispatchCommandAndWait(CraftCommandTestUplink.Command, "z", Ground, _ => { }, TestBudgets.Op);
                Tick(engine, 200.0);
                Assert.Equal(2, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACentrePairThatLostItsRouteLosesItsDelayRow()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                engine.SetCentreDelay(Forward, Ground, 7.0);
                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>> { [Forward] = new[] { Ground } });
                Assert.Equal(7.0, engine.LedgerDelayFor(Forward, AuthorityMatrixPass.CentreNode(Ground)));

                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>>());

                Assert.NotEqual(7.0, engine.LedgerDelayFor(Forward, AuthorityMatrixPass.CentreNode(Ground)));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        /// <summary>One delayed command whose subject is a named craft's own node.</summary>
        private sealed class CraftCommandTestUplink : ISitrepUplink
        {
            public const string Command = "reach.craft";
            private const string Topic = "fleet." + Craft + ".state";

            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "command-reach-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
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
                host.AddChannelSource(Topic, _ => null);
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "done:" + args;
                });
            }
        }
    }
}
