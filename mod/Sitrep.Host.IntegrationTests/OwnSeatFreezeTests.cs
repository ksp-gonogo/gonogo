using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The crew aboard a craft are no distance from it: a subscriber whose vantage
    /// is the craft reads the craft's own topics as the craft says them, with its
    /// link down, while every other vantage still reads the freeze.
    /// </summary>
    public class OwnSeatFreezeTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Craft = "seat1";
        private const string Seat = "vessel:" + Craft;

        private static KspSnapshot Snapshot(double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["reading"] = 100.0 + ut,
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = Craft },
                },
            },
        };

        private static ChannelEngine Engine()
        {
            var uplink = new CommNetDisabledTestUplink(modelPresent: true);
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            engine.RegisterCommandCentreSource(new SeatSource());
            engine.Start();
            engine.TickAndWait(0.0, Snapshot(0.0), Timeout);
            return engine;
        }

        private static void Tick(ChannelEngine engine)
        {
            for (var ut = 1.0; ut <= 5.0; ut += 1.0)
            {
                engine.TickAndWait(ut, Snapshot(ut), Timeout);
            }
        }

        [Fact]
        public async Task TheSeatOfAnUnconnectedCraftReadsItsOwnDelayedTopicLive()
        {
            using var engine = Engine();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Seat }));
                await SubscribeAsync(client, CommNetDisabledTestUplink.DelayedTopic, Timeout);

                Tick(engine);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == CommNetDisabledTestUplink.DelayedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnotherVantageStillReadsTheFreeze()
        {
            using var engine = Engine();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CommNetDisabledTestUplink.DelayedTopic, Timeout);

                Tick(engine);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(frames, f => f.Topic == CommNetDisabledTestUplink.DelayedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A break in the craft's route catches light crossing it, and what the
        /// craft sends until word of the break reaches it, for every centre. The
        /// crew aboard read the craft over no route, so the seat reads straight
        /// through the cut with no stall.
        /// </summary>
        [Fact]
        public async Task TheSeatReadsStraightThroughABreakInTheCraftsRoute()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.RegisterCommandCentreSource(new SeatSource());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, BreakSnapshot(0.0, connected: true, breakOut: null), Timeout);
                engine.SetActiveVesselDelays(new Dictionary<string, double> { [Seat] = 0.0 });
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Seat }));
                await SubscribeAsync(client, ConnectivityHorizonTestUplink.DelayedTopic, Timeout);

                for (var ut = 1.0; ut <= 10.0; ut += 1.0)
                {
                    TickAndWaitForOutboxes(engine, ut, BreakSnapshot(ut, connected: true, breakOut: null), Timeout);
                }
                TickAndWaitForOutboxes(engine, 11.0, BreakSnapshot(11.0, connected: false, breakOut: 5.0), Timeout);
                for (var ut = 12.0; ut <= 20.0; ut += 1.0)
                {
                    TickAndWaitForOutboxes(engine, ut, BreakSnapshot(ut, connected: false, breakOut: null), Timeout);
                }

                var read = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == ConnectivityHorizonTestUplink.DelayedTopic && f.Payload != null)
                    .Select(f => Convert.ToDouble(f.Payload))
                    .ToList();
                for (var ut = 1.0; ut <= 20.0; ut += 1.0)
                {
                    Assert.Contains(ut, read);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        private static KspSnapshot BreakSnapshot(double ut, bool connected, double? breakOut)
        {
            var snapshot = ConnectivityHorizonTestUplink.Snapshot(ut, connected, delay: connected ? 5.0 : 0.0, delayed: ut, breakOut: breakOut);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = Craft },
            };
            return snapshot;
        }

        private sealed class SeatSource : ICommandCentreSource
        {
            public string ProviderId => "seat-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre();
            }

            private sealed class Centre : ICommandCentre
            {
                public string Id => Seat;
                public string DisplayName => "Seat";
                public CommandCentreKind Kind => CommandCentreKind.CrewedVessel;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
