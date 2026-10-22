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
