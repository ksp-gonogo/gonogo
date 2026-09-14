using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A fact held at the home command reaches each vantage after that vantage's
    /// delay to home, and the operator's own acceptance test: a vessel that transmits
    /// science does not see the new total until the science has reached the ledger
    /// AND the new value has come back.
    ///
    /// <para>The rows are written by <see cref="AuthorityMatrixPass.PopulateHomeCommand"/>
    /// fed with <see cref="KscDelayPolicy"/>, the rule the award itself is timed by, so
    /// the round trip is asserted against the award's own seconds rather than a number
    /// chosen here.</para>
    /// </summary>
    public class HomeCommandLedgerDelayTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private const string Vessel = "vessel:G";
        private const string Home = "ground:Cape";
        private const string OtherGround = "ground:Goldstone";

        /// <summary>The active craft's light-time, deliberately far from the vessel centre's own.</summary>
        private const double ActiveVesselDelay = 240.0;

        private static readonly SignalDelayConfig DelayOn = new SignalDelayConfig { Enabled = true };

        [Fact]
        public async Task AVesselLearnsTheNewTotalOnlyAfterTheAwardReachesHomeAndTheTotalComesBack()
        {
            const double pathHome = 37.5;
            var route = KscDelay.Routed(pathHome);

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.LedgerTopic, Timeout);
                WriteHomeRows(engine, _ => KscDelayPolicy.DelaySeconds(route, DelayOn));

                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, delay: ActiveVesselDelay), Timeout);

                // Leg 1: science transmitted at UT 100 is booked when it reaches the ledger.
                const double transmittedUt = 100.0;
                var bookedUt = KscDelayPolicy.RevealUt(route, transmittedUt, DelayOn);
                engine.TickAndWait(bookedUt, HomeLedgerTestUplink.Snapshot(bookedUt, ledger: 25.0, delay: ActiveVesselDelay), Timeout);
                // Reads below touch Courier-owned state, so let its queue go quiet first.
                await DrainAllStreamDataAsync(client, Quiet);

                // The ground network has it the instant it is booked, whatever the active craft's light-time.
                Assert.Equal(25.0, Read(engine, Home, bookedUt));
                Assert.Equal(25.0, Read(engine, OtherGround, bookedUt));

                // Leg 2: the vessel is still reading the old total until the new one has crossed back.
                Assert.Equal(10.0, Read(engine, Vessel, bookedUt));
                Assert.Equal(10.0, Read(engine, Vessel, bookedUt + pathHome - 0.5));
                Assert.Equal(25.0, Read(engine, Vessel, transmittedUt + 2 * pathHome));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The award's delay and the propagation delay for the same vessel are one
        /// number, in every state the award rule distinguishes.
        /// </summary>
        [Theory]
        [MemberData(nameof(Routes))]
        public void TheLedgerRowForAVesselIsTheSecondsItsAwardWaits(KscDelay route, bool delayEnabled)
        {
            var config = new SignalDelayConfig { Enabled = delayEnabled, SilenceDeclarationSeconds = 3600.0 };

            // Never started, so never disposed: Stop joins a thread that did not run.
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveVesselDelay);
            WriteHomeRows(engine, _ => KscDelayPolicy.DelaySeconds(route, config));

            var awardWait = KscDelayPolicy.RevealUt(route, 0.0, config);
            Assert.Equal(awardWait, engine.LedgerDelayFor(Vessel, ChannelEngine.HomeCommandNode));
        }

        public static IEnumerable<object[]> Routes() => new[]
        {
            new object[] { KscDelay.Routed(37.5), true },
            new object[] { KscDelay.Unroutable, true },
            new object[] { KscDelay.Instant, true },
            new object[] { KscDelay.Routed(37.5), false },
        };

        [Fact]
        public void AVantageWithNoRowReadsTheLedgerAtZeroNotTheActiveCraftsLightTime()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveVesselDelay);
            Assert.Equal(0.0, engine.LedgerDelayFor("ground:Unlisted", ChannelEngine.HomeCommandNode));
            Assert.Equal(0.0, engine.LedgerDelayFor(ChannelEngine.MetaVantage, ChannelEngine.HomeCommandNode));
        }

        [Fact]
        public void AHeldAtHomeTopicRecordsUnderTheHomeCommandNodeAndNotTheActiveCrafts()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new HomeLedgerTestUplink());

            Assert.Equal(ChannelEngine.HomeCommandNode, engine.NodeFor(HomeLedgerTestUplink.LedgerTopic));
            Assert.Equal(ChannelEngine.NodeId, engine.NodeFor(HomeLedgerTestUplink.CraftTopic));
        }

        /// <summary>
        /// The home command cannot lose contact with its own ledger, so an active craft
        /// going dark withholds its own telemetry and not the balance.
        /// </summary>
        [Fact]
        public async Task AnActiveCraftBlackoutDoesNotFreezeTheLedger()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.LedgerTopic, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);
                WriteHomeRows(engine, _ => 0.0);
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, craft: 1.0, connected: true), Timeout);
                engine.TickAndWait(5.0, HomeLedgerTestUplink.Snapshot(5.0, ledger: 20.0, craft: 2.0, connected: false), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Equal(20.0, Read(engine, Home, 5.0));
                Assert.Equal(1.0, Convert.ToDouble(engine.ReadTopicAtVantage(HomeLedgerTestUplink.CraftTopic, Home, 5.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DeclaringHeldAtHomeTogetherWithTrueNowRefusesTheUplink()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var contradiction = new HomeLedgerTestUplink(trueNow: true);
            engine.RegisterUplink(contradiction);

            var availability = engine.AvailabilityOf(contradiction.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(HomeLedgerTestUplink.LedgerTopic, availability.Reason!);
            Assert.NotEqual(ChannelEngine.HomeCommandNode, engine.NodeFor(HomeLedgerTestUplink.LedgerTopic));
        }

        private static void WriteHomeRows(ChannelEngine engine, Func<ICommandCentre, double?> secondsToHome) =>
            new AuthorityMatrixPass().PopulateHomeCommand(
                new ICommandCentre[]
                {
                    new Centre(Home, CommandCentreKind.GroundStation),
                    new Centre(OtherGround, CommandCentreKind.GroundStation),
                    new Centre(Vessel, CommandCentreKind.CrewedVessel),
                },
                Home,
                secondsToHome,
                engine.SetHomeCommandDelay);

        private static double? Read(ChannelEngine engine, string vantage, double nowUt)
        {
            var value = engine.ReadTopicAtVantage(HomeLedgerTestUplink.LedgerTopic, vantage, nowUt);
            return value == null ? (double?)null : Convert.ToDouble(value);
        }

        private sealed class Centre : ICommandCentre
        {
            public Centre(string id, CommandCentreKind kind)
            {
                Id = id;
                Kind = kind;
            }

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind { get; }
            public int? BodyIndex => null;
            public double? Latitude => null;
            public double? Longitude => null;
            public bool IsActiveNow() => true;
        }
    }

    /// <summary>
    /// One channel held at home beside one ordinary craft channel on the active
    /// craft's node, with the production-shape delay and connectivity sources.
    /// </summary>
    internal sealed class HomeLedgerTestUplink : ISitrepUplink
    {
        public const string LedgerTopic = "home.ledger";
        public const string CraftTopic = "home.craft";

        public HomeLedgerTestUplink(bool trueNow = false)
        {
            Manifest = new UplinkManifest
            {
                Id = trueNow ? "home-ledger-contradiction-test" : "home-ledger-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = LedgerTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = trueNow ? DelayRole.TrueNow : DelayRole.Delayed,
                        HeldAtHome = true,
                    },
                    new ChannelDeclaration
                    {
                        Topic = CraftTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
            };
        }

        public UplinkManifest Manifest { get; }

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(LedgerTopic, snapshot => Read(snapshot, "ledger"));
            host.AddChannelSource(CraftTopic, snapshot => Read(snapshot, "craft"));
            host.SetSignalDelaySource(snapshot => Read(snapshot, "delay") is double seconds
                ? new CommsDelay { OneWaySeconds = seconds, Source = CommsDelaySource.SignalDelay }
                : null);
            host.SetConnectivitySource(snapshot => Read(snapshot, "connected") as bool?);
        }

        private static object? Read(KspSnapshot? snapshot, string key) =>
            snapshot != null && snapshot.Values.TryGetValue(key, out var value) ? value : null;

        public static KspSnapshot Snapshot(double ut, double? ledger = null, double? craft = null, double? delay = null, bool? connected = null)
        {
            var values = new Dictionary<string, object?>();
            if (ledger.HasValue) values["ledger"] = ledger.Value;
            if (craft.HasValue) values["craft"] = craft.Value;
            if (delay.HasValue) values["delay"] = delay.Value;
            if (connected.HasValue) values["connected"] = connected.Value;
            return new KspSnapshot { Ut = ut, Values = values };
        }
    }
}
