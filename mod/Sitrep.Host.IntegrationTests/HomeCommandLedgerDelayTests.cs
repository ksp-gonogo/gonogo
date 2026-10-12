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
    /// and the new value has come back.
    ///
    /// <para>The rows are written by <see cref="AuthorityMatrixPass.PopulateHomeCommand"/>
    /// fed with <see cref="KscDelayPolicy"/>, the rule the award itself is timed by, so
    /// the round trip is asserted against the award's own seconds rather than a number
    /// chosen here.</para>
    /// </summary>
    public class HomeCommandLedgerDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string Vessel = "vessel:G";
        private const string Home = "ground:Cape";
        private const string OtherGround = "ground:Goldstone";

        /// <summary>The active craft's signal delay, deliberately far from the vessel centre's own.</summary>
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

        /// <summary>
        /// A centre the pass no longer names has no path home: it hears nothing
        /// held there, never the ledger at zero, and is heard again once a pass
        /// names it. A vantage that is no centre stays on the ground network.
        /// </summary>
        [Fact]
        public async Task ADroppedCentreHearsNothingHeldAtHomeUntilItIsListedAgain()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.LedgerTopic, Timeout);
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Home] = 0.0, [Vessel] = 5.0 });
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0), Timeout);
                engine.TickAndWait(10.0, HomeLedgerTestUplink.Snapshot(10.0, ledger: 10.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(10.0, Read(engine, Vessel, 10.0));

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Home] = 0.0 });
                engine.TickAndWait(20.0, HomeLedgerTestUplink.Snapshot(20.0, ledger: 30.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Equal(double.PositiveInfinity, engine.LedgerDelayFor(Vessel, ChannelEngine.HomeCommandNode));
                Assert.Equal(10.0, Read(engine, Vessel, 20.0));
                Assert.Equal(0.0, engine.LedgerDelayFor("ground:Unlisted", ChannelEngine.HomeCommandNode));

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Home] = 0.0, [Vessel] = 7.0 });
                Assert.Equal(7.0, engine.LedgerDelayFor(Vessel, ChannelEngine.HomeCommandNode));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An active crewed centre with no route home gets no row, and reads the
        /// ledger as silence rather than at zero.
        /// </summary>
        [Fact]
        public void AnActiveCentreWithNoRouteHomeHearsNothingHeldAtHome()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new FixedSource(
                new Centre(Home, CommandCentreKind.GroundStation),
                new Centre(Vessel, CommandCentreKind.CrewedVessel)));
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, null, Timeout);
                WriteHomeRows(engine, _ => null);
                engine.TickAndWait(1.0, null, Timeout);

                Assert.Equal(double.PositiveInfinity, engine.LedgerDelayFor(Vessel, ChannelEngine.HomeCommandNode));
                Assert.Equal(0.0, engine.LedgerDelayFor(Home, ChannelEngine.HomeCommandNode));
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class FixedSource : ICommandCentreSource
        {
            private readonly ICommandCentre[] _centres;

            public FixedSource(params ICommandCentre[] centres) => _centres = centres;

            public string ProviderId => "home-ledger-test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
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

        private static void WriteHomeRows(ChannelEngine engine, Func<ICommandCentre, double?> secondsToHome)
        {
            var rows = new Dictionary<string, double>();
            new AuthorityMatrixPass().PopulateHomeCommand(
                new ICommandCentre[]
                {
                    new Centre(Home, CommandCentreKind.GroundStation),
                    new Centre(OtherGround, CommandCentreKind.GroundStation),
                    new Centre(Vessel, CommandCentreKind.CrewedVessel),
                },
                Home,
                secondsToHome,
                (centre, seconds) => rows[centre] = seconds);
            engine.SetHomeCommandDelays(rows);
        }

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
                    { Kind = SampleKind.Continuous,
                        Topic = LedgerTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = trueNow ? DelayRole.TrueNow : DelayRole.Delayed,
                        HeldAtHome = true,
                    },
                    new ChannelDeclaration
                    { Kind = SampleKind.Continuous,
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
