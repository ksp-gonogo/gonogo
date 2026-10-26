using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A lens topic takes its delay from the place the lens stands, and the
    /// commanding centre's knowledge reaches a lens as a running maximum that
    /// the centre-to-centre delay rows and routes drive.
    /// </summary>
    public class LensDeliveryTests
    {
        private const string Commander = "ground:KSC";
        private const string Remote = "ground:Woomerang";
        private const string FarRemote = "ground:Dres";
        private const string Craft = "abc";

        [Fact]
        public void ALensTopicRoutesToTheNodeOfThePlaceItStands()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LensTestUplink());
            engine.Start();
            try
            {
                Assert.Equal(ChannelEngine.CentreNodePrefix + Remote, engine.NodeFor("lens.station.state"));
                Assert.Equal(ChannelEngine.FleetNodePrefix + Craft, engine.NodeFor("lens.probe.state"));
                Assert.Equal(ChannelEngine.NodeId, engine.NodeFor("lens.nowhere.state"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void KnowledgeFollowsTheCentrePathAndNeverUnlearnsWhenItLengthensOrIsLost()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                engine.BindLensSite("scope", Remote, Commander);
                Route(engine, Remote, 5.0);
                Tick(engine, 100.0);
                Assert.Equal(95.0, engine.LensKnowledgeUt("scope"));

                Route(engine, Remote, 60.0);
                Tick(engine, 110.0);
                Assert.Equal(95.0, engine.LensKnowledgeUt("scope"));

                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>>());
                Tick(engine, 300.0);
                Assert.Equal(95.0, engine.LensKnowledgeUt("scope"));

                Route(engine, Remote, 8.0);
                Tick(engine, 310.0);
                Assert.Equal(302.0, engine.LensKnowledgeUt("scope"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TwoSitesSharingAScopeAreAgedByTheLongestDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                engine.BindLensSite("shared", Remote, Commander);
                engine.BindLensSite("shared", FarRemote, Commander);
                engine.SetCentreDelay(Commander, Remote, 5.0);
                engine.SetCentreDelay(Commander, FarRemote, 30.0);
                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>>
                {
                    [Commander] = new[] { Remote, FarRemote },
                });
                Tick(engine, 100.0);

                Assert.Equal(70.0, engine.LensKnowledgeUt("shared"));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Route(ChannelEngine engine, string site, double seconds)
        {
            engine.SetCentreDelay(Commander, site, seconds);
            engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>> { [Commander] = new[] { site } });
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        private sealed class LensTestUplink : ISitrepUplink
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "lens-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.RegisterDynamicNamespace("lens.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    PerLensNode = true,
                    LensSiteForKey = key => key switch
                    {
                        "station" => Remote,
                        "probe" => "vessel:" + Craft,
                        _ => null,
                    },
                });
            }
        }
    }
}
