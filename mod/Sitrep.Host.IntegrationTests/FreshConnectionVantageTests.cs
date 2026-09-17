using System;
using System.Collections.Generic;
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
    /// Where a connection that has never sent set-vantage observes and dispatches
    /// from: home, as the elected claimant names it; otherwise the first ground
    /// station by id, with the absence of a home logged; otherwise nowhere. Each
    /// is read off the wire, through the vantage a command response is stamped with.
    /// </summary>
    public class FreshConnectionVantageTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task AFreshConnection_StartsAtTheHomeTheClaimantNames_NotTheFirstStationById()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var log = new List<string>();
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            var homes = new[]
            {
                new HomeNodeFacts(false, "A Station"),
                new HomeNodeFacts(true, "Kerbal Space Center"),
            };
            var ids = HomeCentreIds.Mint(homes);
            engine.RegisterCommandCentreSource(new GroundSource(ids));
            HomeCommandElection.RegisterCapability(engine.Kernel, () => homes);
            engine.RegisterUplink(new EchoUplink());
            engine.ResolveCapabilities();
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                var response = await DispatchAsync(client, "r0");

                Assert.Equal("ground:Kerbal Space Center", response.Meta.Vantage);
                lock (log)
                {
                    Assert.Contains(log, m => m.Contains("home command is 'ground:Kerbal Space Center'"));
                    Assert.DoesNotContain(log, m => m.Contains("not identified"));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The comms-mod shape: every station flagged, so the stock claimant names none.
        /// The connection still stands somewhere real, the same somewhere every time, and
        /// the operator can see in the log that it is a fallback rather than home.
        /// </summary>
        [Fact]
        public async Task NoHomeIdentified_AFreshConnectionStartsAtTheFirstGroundStationById_AndTheLogSaysSo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var log = new List<string>();
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            var homes = new[]
            {
                new HomeNodeFacts(true, "DSS 63 - Madrid"),
                new HomeNodeFacts(true, "DSS 14 - Goldstone"),
                new HomeNodeFacts(true, "DSS 43 - Canberra"),
            };
            engine.RegisterCommandCentreSource(new GroundSource(HomeCentreIds.Mint(homes)));
            HomeCommandElection.RegisterCapability(engine.Kernel, () => homes);
            engine.RegisterUplink(new EchoUplink());
            engine.ResolveCapabilities();
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            engine.TickAndWait(1.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                var response = await DispatchAsync(client, "r0");

                Assert.Same(HomeCommand.NotIdentified, engine.CurrentHomeCommand);
                Assert.Equal("ground:DSS 14 - Goldstone", response.Meta.Vantage);
                lock (log)
                {
                    var notice = Assert.Single(log, m => m.Contains("not identified"));
                    Assert.Contains("'ground:DSS 14 - Goldstone'", notice);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The socket is up from the main menu, before any centre exists. A connection made
        /// there, which subscribed at no vantage, must be re-pointed at home once a save
        /// loads, or everything it subscribed to stays delayed from nowhere.
        /// </summary>
        [Fact]
        public async Task AConnectionMadeBeforeAnyCentreExists_IsRepointedAtHomeWhenOneAppears()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var source = new GroundSource();
            var homes = new List<HomeNodeFacts>();
            engine.RegisterCommandCentreSource(source);
            HomeCommandElection.RegisterCapability(engine.Kernel, () => homes);
            engine.RegisterUplink(new EchoUplink());
            engine.ResolveCapabilities();
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var ack = await SubscribeAsync(client, EchoUplink.DelayedTopic, Timeout);
                Assert.Equal("", ack.Meta.Vantage);
                Assert.Equal("", (await DispatchAsync(client, "r0")).Meta.Vantage);

                homes.Add(new HomeNodeFacts(false, "A Station"));
                homes.Add(new HomeNodeFacts(true, "Kerbal Space Center"));
                source.Ids = HomeCentreIds.Mint(homes);
                engine.TickAndWait(1.0, null, Timeout);

                var reAck = await ReceiveTypedAsync<EventMsg>(client, Timeout);
                Assert.Equal("subscribed", reAck.Name);
                Assert.Equal(EchoUplink.DelayedTopic, reAck.Topic);
                Assert.Equal("ground:Kerbal Space Center", reAck.Meta.Vantage);
                Assert.Equal("ground:Kerbal Space Center", (await DispatchAsync(client, "r1")).Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A connection that chose a centre stays there when home moves.</summary>
        [Fact]
        public async Task AConnectionThatChose_IsNotRepointedWhenHomeMoves()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var homes = new List<HomeNodeFacts>
            {
                new HomeNodeFacts(false, "A Station"),
                new HomeNodeFacts(false, "Kerbal Space Center"),
            };
            var source = new GroundSource(HomeCentreIds.Mint(homes));
            engine.RegisterCommandCentreSource(source);
            HomeCommandElection.RegisterCapability(engine.Kernel, () => homes);
            engine.RegisterUplink(new EchoUplink());
            engine.ResolveCapabilities();
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:A Station" }));
                Assert.Equal("ground:A Station", (await DispatchAsync(client, "r0")).Meta.Vantage);

                homes[1] = new HomeNodeFacts(true, "Kerbal Space Center");
                engine.TickAndWait(1.0, null, Timeout);

                Assert.Equal("ground:A Station", (await DispatchAsync(client, "r1")).Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<CommandResponse<object?>> DispatchAsync(TestClient client, string requestId)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = EchoUplink.Command,
                Args = null,
                SentAt = 0.0,
            }));
            return await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
        }

        private sealed class EchoUplink : ISitrepUplink
        {
            public const string Command = "fresh.echo";
            public const string DelayedTopic = "fresh.delayed";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-fresh-connection-vantage",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = DelayedTopic,
                        Delay = DelayRole.Delayed,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, object?>(Command, _ => null);
                host.Publisher(DelayedTopic);
            }
        }

        /// <summary>Ground stations under whatever ids the test last set, re-read every pass.</summary>
        private sealed class GroundSource : ICommandCentreSource
        {
            public GroundSource(params string[] ids) => Ids = ids;

            public volatile string[] Ids;

            public string ProviderId => "fresh-connection-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                foreach (var id in Ids)
                {
                    yield return new Centre(id);
                }
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
