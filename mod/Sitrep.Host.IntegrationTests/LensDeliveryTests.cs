using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
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
                Assert.Equal(ChannelEngine.UnplacedLensNode, engine.NodeFor("lens.nowhere.state"));
                Assert.Equal(ChannelEngine.UnplacedLensNode, engine.NodeFor("lens.broken.state"));
                Assert.Equal(ChannelEngine.UnplacedLensNode, engine.NodeFor("lens.station"));
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
                Tick(engine, 0.0);
                Assert.Null(engine.LensKnowledgeUt("scope"));
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
                Assert.Equal(95.0, engine.LensKnowledgeUt("scope"));

                Tick(engine, 317.0);
                Assert.Equal(95.0, engine.LensKnowledgeUt("scope"));

                Tick(engine, 318.0);
                Assert.Equal(310.0, engine.LensKnowledgeUt("scope"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ARouteWithNoMeasuredDelayDeliversNothingUntilTheDelayIsMeasured()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                engine.BindLensSite("scope", Remote, Commander);
                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>> { [Commander] = new[] { Remote } });
                Tick(engine, 100.0);
                Assert.Null(engine.LensKnowledgeUt("scope"));

                engine.SetCentreDelay(Commander, Remote, 5.0);
                Tick(engine, 110.0);
                Assert.Null(engine.LensKnowledgeUt("scope"));

                Tick(engine, 115.0);
                Assert.Equal(110.0, engine.LensKnowledgeUt("scope"));
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
                Tick(engine, 0.0);
                Tick(engine, 100.0);

                Assert.Equal(70.0, engine.LensKnowledgeUt("shared"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheCapabilityBindsALensAndReportsWhatHasReachedIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                ILensSites sites = new LensSitesSource(engine, () => new[] { new NamedGroundStation(Remote, "Woomerang") });
                var site = sites.GroundStationNamed("Woomerang");
                Assert.Equal(Remote, site);

                sites.Bind("scope", site!, Commander);
                Route(engine, Remote, 5.0);
                Tick(engine, 0.0);
                Tick(engine, 100.0);
                Assert.Equal(95.0, sites.KnowledgeUt("scope"));

                Assert.Null(sites.KnowledgeUt("nothing-bound"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AStationIsFoundOnlyByAUniqueNodeName()
        {
            var stations = new[]
            {
                new NamedGroundStation("ground:KSC", "KSC"),
                new NamedGroundStation("ground:Twin", "Twin"),
                new NamedGroundStation("ground:Twin#2", "Twin"),
                new NamedGroundStation("ground:unknown", null),
            };

            Assert.Equal("ground:KSC", LensSitesSource.StationNamed(stations, "KSC"));
            Assert.Null(LensSitesSource.StationNamed(stations, "Twin"));
            Assert.Null(LensSitesSource.StationNamed(stations, "Twin#2"));
            Assert.Null(LensSitesSource.StationNamed(stations, "ksc"));
            Assert.Null(LensSitesSource.StationNamed(stations, ""));
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
                        "broken" => throw new InvalidOperationException("no site snapshot yet"),
                        _ => null,
                    },
                });
            }
        }
    }
}
