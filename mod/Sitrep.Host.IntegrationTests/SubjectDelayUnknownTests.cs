using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command or a reading whose subject has no known delay from the centre
    /// concerned (a lens nothing has placed, a ground station with no route, a
    /// craft no link has been measured to) is never timed by the whole-network
    /// default, which is the active craft's delay. A command is refused with a
    /// reason; a reading is held until a delay is known, then released.
    /// </summary>
    public class SubjectDelayUnknownTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string Commander = "ground:KSC";
        private const string Remote = "ground:Woomerang";
        private const string Craft = "abc";
        private const double ActiveCraftSeconds = 30.0;

        [Fact]
        public void ACommandToALensAtAStationWithNoRouteIsRefusedNotSentOnTheActiveCraftsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveCraftSeconds);
            var uplink = new LensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Tick(engine, 0.0);

                var (result, accepted) = Dispatch(engine, "station", Commander);
                Tick(engine, 100.0);

                AssertRefusedAsUnknown(result);
                Assert.Null(accepted);
                Assert.Equal(0, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACommandToALensAtARoutedStationTakesThatStationsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveCraftSeconds);
            var uplink = new LensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetCentreDelay(Commander, Remote, 5.0);
                engine.SetCentreRoutes(new Dictionary<string, IReadOnlyCollection<string>> { [Commander] = new[] { Remote } });
                Tick(engine, 0.0);

                var (_, accepted) = Dispatch(engine, "station", Commander);
                Tick(engine, 6.0);

                Assert.Equal(5.0, accepted);
                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AStationCommandingALensAtItsOwnSiteHasNoDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveCraftSeconds);
            var uplink = new LensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Tick(engine, 0.0);

                var (result, accepted) = Dispatch(engine, "station", Remote);
                Tick(engine, 1.0);

                Assert.Null(result);
                Assert.Null(accepted);
                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACommandToALensNothingHasPlacedIsRefusedNotAimedAtTheActiveCraft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: ActiveCraftSeconds);
            var uplink = new LensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Assert.Equal(ChannelEngine.UnplacedLensNode, engine.NodeFor("lens.nowhere.state"));
                Tick(engine, 0.0);

                var (result, accepted) = Dispatch(engine, "nowhere", Commander);
                Tick(engine, 100.0);

                AssertRefusedAsUnknown(result);
                Assert.Null(accepted);
                Assert.Equal(0, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AReadingFromALensNothingHasPlacedIsHeldThenReleasedOnceItIsPlaced()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new LensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, LensUplink.MovableTopic, Timeout);

                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    Tick(engine, ut);
                }
                var unplaced = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(unplaced, f => f.Topic == LensUplink.MovableTopic);

                /*
                 * A stream is bound to its topic's node when it subscribes, so the
                 * reader that watched the unplaced lens stays on that node. One that
                 * subscribes once the lens is placed is the reader that can be sent
                 * what was held.
                 */
                engine.SetVesselDelay(Craft, 0.0);
                uplink.MovableSite = "vessel:" + Craft;
                await using var after = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(after, LensUplink.MovableTopic, Timeout);
                Tick(engine, 3.0);
                Tick(engine, 4.0);

                var placed = await DrainAllStreamDataAsync(after, Quiet);
                Assert.Contains(placed, f => f.Topic == LensUplink.MovableTopic && f.Meta.ValidAt <= 2.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AStationWhoseControllerHasNoMeasuredLinkIsHeldNotRevealedOnTheActiveCraftsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestBreakingGroundUplink());
            engine.Start();
            try
            {
                var topic = BreakingGroundViewProvider.StationPrefix + "lost" + BreakingGroundViewProvider.StationReportSuffix;
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, topic, Timeout);

                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Station(ut, oneWay: null), Timeout);
                }
                var unmeasured = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(unmeasured, f => f.Topic == topic);

                engine.TickAndWait(3.0, Station(3.0, oneWay: 0.0), Timeout);
                engine.TickAndWait(4.0, Station(4.0, oneWay: 0.0), Timeout);
                var measured = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(measured, f => f.Topic == topic && f.Meta.ValidAt <= 2.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void AssertRefusedAsUnknown(CommandResult? result)
        {
            Assert.NotNull(result);
            Assert.False(result!.Success);
            Assert.Equal(CommandErrorCode.NoConnection, result.ErrorCode);
            Assert.Equal("Not sent: this target's place on the network is not known", result.Detail);
        }

        private static (CommandResult? Result, double? Accepted) Dispatch(ChannelEngine engine, string key, string vantage)
        {
            CommandResult? result = null;
            double? accepted = null;
            engine.DispatchCommandAndWait(
                LensUplink.AimCommand,
                new LensAimArgs { Key = key },
                vantage,
                r => result = r as CommandResult,
                Timeout,
                onAccepted: s => accepted = s);
            return (result, accepted);
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, Timeout);

        /// <summary>
        /// One station whose controller reports a link only when
        /// <paramref name="oneWay"/> is given, the way a controller the game could
        /// not find reports none. The completion moves with the tick so the change
        /// gate never suppresses a sample.
        /// </summary>
        private static KspSnapshot Station(double ut, double? oneWay)
        {
            var entry = new Dictionary<string, object?>
            {
                ["stationId"] = "lost",
                ["stationName"] = "lost",
                ["partName"] = "Seismic Accelerometer",
                ["experimentId"] = "surfaceExperimentSeismicAccelerometer",
                ["scienceCompletedPercentage"] = 10.0 + ut,
                ["scienceTransmittedPercentage"] = 0.0,
                ["scienceValue"] = 5.0,
                ["scienceLimit"] = 30.0,
                ["storedData"] = ut,
                ["dataSendFailed"] = false,
                ["deployedOnGround"] = true,
            };
            if (oneWay is double seconds)
            {
                entry["stationOneWay"] = seconds;
                entry["stationConnected"] = true;
            }
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["deployedScience"] = new List<object?> { entry } },
            };
        }

        public sealed class LensAimArgs
        {
            public string Key { get; set; } = "";
        }

        /// <summary>
        /// A lens namespace with a delayed aim command named on each lens's own
        /// topic. "station" stands at <see cref="Remote"/>, "nowhere" is never
        /// placed, and "movable" stands wherever <see cref="MovableSite"/> says,
        /// publishing a reading every tick.
        /// </summary>
        private sealed class LensUplink : ISitrepUplink
        {
            public const string AimCommand = "lens.aim";
            public const string MovableTopic = "lens.movable.state";

            private int _handled;
            private IDynamicChannelSource? _lenses;
            private volatile string? _movableSite;

            public int HandledCount => Volatile.Read(ref _handled);

            public string? MovableSite
            {
                get => _movableSite;
                set => _movableSite = value;
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "lens-unknown-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = AimCommand, Delay = DelayRole.Delayed, Subject = "lens.{args.Key}.state" },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                _lenses = host.RegisterDynamicNamespace("lens.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    PerLensNode = true,
                    LensSiteForKey = key => key switch
                    {
                        "station" => Remote,
                        "movable" => _movableSite,
                        _ => null,
                    },
                });
                host.AddSampledSource(
                    snapshot => snapshot?.Ut,
                    captured =>
                    {
                        if (captured is double ut)
                        {
                            _lenses?.Publisher("movable.state").Publish(new Dictionary<string, object?> { ["ut"] = ut }, ut);
                        }
                    },
                    "lens.");
                host.AddCommandHandler<LensAimArgs, string>(AimCommand, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "aimed:" + args.Key;
                });
            }
        }
    }
}
