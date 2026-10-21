using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A dynamic namespace declared HeldAtHome records every topic under it on
    /// the home command node: it reaches a command centre at that centre's delay
    /// home, and never waits on the active vessel's signal delay or its blackout.
    /// The space center, where no vessel is flying, is the case that needs it.
    /// </summary>
    public class HeldAtHomeNamespaceTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Home = "ground:Cape";
        private const double ActiveVesselDelay = 240.0;

        [Fact]
        public void ATopicUnderAHeldAtHomeNamespaceRecordsOnTheHomeNodeNeverTheActiveCrafts()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new HeldNamespaceUplink());

            Assert.Equal(ChannelEngine.HomeCommandNode, engine.NodeFor(HeldNamespaceUplink.Topic));
            Assert.NotEqual(ChannelEngine.NodeId, engine.NodeFor(HeldNamespaceUplink.Topic));
            Assert.DoesNotContain("fleet.", engine.NodeFor(HeldNamespaceUplink.Topic));
            Assert.Equal(ChannelEngine.NodeId, engine.NodeFor("home.other"));
        }

        [Fact]
        public async Task ItArrivesAtTheSpaceCenterWhileTheActiveCraftIsFarAndDark()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HeldNamespaceUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HeldNamespaceUplink.Topic, Timeout);
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Home] = 0.0 });

                engine.TickAndWait(0.0, HeldNamespaceUplink.Snapshot(0.0, delay: ActiveVesselDelay, connected: true), Timeout);
                engine.TickAndWait(5.0, HeldNamespaceUplink.Snapshot(5.0, delay: ActiveVesselDelay, connected: false), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // At UT 5 the ground centre already holds the value published at UT 5, with the active craft 240 s away and out of contact.
                Assert.Equal(5.0, Convert.ToDouble(engine.ReadTopicAtVantage(HeldNamespaceUplink.Topic, Home, 5.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DeclaringHeldAtHomeWithTrueNowOrPerVesselNodeIsRefused()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var trueNow = new HeldNamespaceUplink(DelayRole.TrueNow, perVessel: false, id: "held-ns-truenow");
            var perVessel = new HeldNamespaceUplink(DelayRole.Delayed, perVessel: true, id: "held-ns-pervessel");
            engine.RegisterUplink(trueNow);
            engine.RegisterUplink(perVessel);

            Assert.False(engine.AvailabilityOf(trueNow.Manifest.Id).IsAvailable);
            Assert.False(engine.AvailabilityOf(perVessel.Manifest.Id).IsAvailable);
        }

        private sealed class HeldNamespaceUplink : ISitrepUplink
        {
            public const string Prefix = "home.craftfile.";
            public const string Topic = Prefix + "VAB.Wave.parts";

            private readonly DelayRole _delay;
            private readonly bool _perVessel;
            private IDynamicChannelSource? _source;

            public HeldNamespaceUplink(DelayRole delay = DelayRole.Delayed, bool perVessel = false, string id = "held-namespace-test")
            {
                _delay = delay;
                _perVessel = perVessel;
                Manifest = new UplinkManifest { Id = id, Version = "1.0.0", Channels = new List<ChannelDeclaration>() };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                _source = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Requires = Requirement.None,
                    Delay = _delay,
                    HeldAtHome = true,
                    PerVesselNode = _perVessel,
                });
                host.SetSignalDelaySource(snapshot => Read(snapshot, "delay") is double seconds
                    ? new CommsDelay { OneWaySeconds = seconds, Source = CommsDelaySource.SignalDelay }
                    : null);
                host.SetConnectivitySource(snapshot => Read(snapshot, "connected") as bool?);
                host.AddSampledSource(snapshot => snapshot, captured =>
                {
                    if (captured is KspSnapshot snapshot)
                    {
                        _source!.Publisher("VAB.Wave.parts").Publish(snapshot.Ut, snapshot.Ut);
                    }
                });
            }

            private static object? Read(KspSnapshot? snapshot, string key) =>
                snapshot != null && snapshot.Values.TryGetValue(key, out var value) ? value : null;

            public static KspSnapshot Snapshot(double ut, double? delay = null, bool? connected = null)
            {
                var values = new Dictionary<string, object?>();
                if (delay.HasValue) values["delay"] = delay.Value;
                if (connected.HasValue) values["connected"] = connected.Value;
                return new KspSnapshot { Ut = ut, Values = values };
            }
        }
    }
}
