using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft goes out of contact holding telemetry and a command, a relay
    /// could turn a dish to it once it is back in sight, and the game then
    /// skips hours under rails warp. The game's main thread answers each dish
    /// turn a frame later, as the game does. One tick over the skipped stretch
    /// must not keep the Courier from the next subscribe.
    /// </summary>
    public class WarpAfterBlackoutTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        /*
         * How long the Courier waits for the main thread here: twice the
         * budget a save is given. A Courier that waited for the main thread
         * with the delivery network's lock held would keep the save, which
         * runs on that thread, waiting this whole time, so the save's wait is
         * told from a slow machine by being longer than the budget.
         */
        private static readonly double LockedWaitSeconds = TestBudgets.Op.TotalSeconds * 2.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Active = ScriptedContactGame.Active;
        private const string Relay = ScriptedContactGame.Relay;
        private const string RelayDish = Relay + "#1/0";
        private const string ActiveDish = Active + "#1/0";

        /// <summary>When the craft comes back into the relay's sight: what the reacquisition forecast names.</summary>
        private const double Reacquired = 300.0;

        /// <summary>A comms backend whose dishes turn when asked and whose links never change for it, as within one stretch of warp.</summary>
        private sealed class DishBackend : ICommsBackend, ICommsRetargetBackend
        {
            private readonly TestCommsCoreUplink.FakeCommsBackend _plain = new TestCommsCoreUplink.FakeCommsBackend("scripted-dishes", null);
            private int _turns;
            private int _restores;

            public int Turns => Volatile.Read(ref _turns);

            public int Restores => Volatile.Read(ref _restores);

            /// <summary>Whether a restore reports the dish still on loan, so it is asked again.</summary>
            public bool RestoresFail { get; set; }

            public string ProviderId => _plain.ProviderId;

            public IRetargetModel? RetargetModel(CommsNodeHandle? node, double ut) => null;

            public bool PeerCanReceive(string peerId, string nodeId, double ut) => true;

            public bool AutoRetargetAllowed(string nodeId) => true;

            public string? TurnDish(string nodeId, string dishId, string peerId, double ut)
            {
                return "record-" + Interlocked.Increment(ref _turns);
            }

            public bool RestoreDish(string recordId, double ut)
            {
                Interlocked.Increment(ref _restores);
                return !RestoresFail;
            }

            public CommsConnectivity Connectivity() => _plain.Connectivity();

            public CommsSignal Signal() => _plain.Signal();

            public CommsControl ControlState() => _plain.ControlState();

            public CommsPath Path(object? vessel) => new CommsPath();

            public CommsNetwork Network(object? vessel) => _plain.Network(vessel);

            public IReadOnlyList<CommsRouteHop>? RouteBetween(CommsNodeHandle? from, CommsNodeHandle? to) => null;

            public bool? StillCarriesTo(object? vessel, string nodeId) => null;

            public ICommsReachModel ReachModel(CommsNodeHandle? from, CommsNodeHandle? to) => CommsReachModels.Unknown;

            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;

            public CommsNodeHandle? ControlPathTerminus(object? vessel) => null;

            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;
        }

        /// <summary>
        /// Runs what the engine hands the game's main thread once a frame, as the
        /// game's update loop does, and each frame reads what a save would write,
        /// which takes the delivery network's lock as saving the game does.
        /// </summary>
        private sealed class MainThread : IDisposable
        {
            private readonly Thread _thread;
            private volatile bool _stop;
            private long _longestSaveTicks;

            /// <summary>The longest any frame waited for the delivery network's lock.</summary>
            public TimeSpan LongestSave => TimeSpan.FromSeconds(Volatile.Read(ref _longestSaveTicks) / (double)System.Diagnostics.Stopwatch.Frequency);

            public MainThread(ChannelEngine engine, int frameMs)
            {
                _thread = new Thread(() =>
                {
                    while (!_stop)
                    {
                        var started = System.Diagnostics.Stopwatch.GetTimestamp();
                        engine.DeliverySnapshotNow();
                        var took = System.Diagnostics.Stopwatch.GetTimestamp() - started;
                        if (took > _longestSaveTicks)
                        {
                            Volatile.Write(ref _longestSaveTicks, took);
                        }
                        engine.RunPendingCommands();
                        Thread.Sleep(frameMs);
                    }
                })
                { IsBackground = true, Name = "main-thread-stand-in" };
                _thread.Start();
            }

            public void Dispose()
            {
                _stop = true;
                _thread.Join(TestBudgets.Op);
            }
        }

        /// <summary>
        /// The plan each centre holds: the relay always reaches home; the craft and
        /// the relay have no dish on each other, and from <see cref="Reacquired"/>
        /// each could turn one to the other.
        /// </summary>
        private static ContactPlan Plan()
        {
            const double horizon = 10_000_000.0;
            const double step = 100_000.0;
            double[] Flat(double lightSeconds) =>
                Enumerable.Repeat(lightSeconds / ScriptedContactGame.LightFactor * PairPlan.SpeedOfLight, 101).ToArray();
            return new ContactPlan(0.0, horizon, step, new List<PairPlan>
            {
                new PairPlan(Relay, Home, horizon, new[] { new ContactWindow(0.0, null) }, 0.0, step, Flat(10)),
                new PairPlan(Active, Relay, horizon, new ContactWindow[0], 0.0, step, Flat(5), new[]
                {
                    new RetargetWindow(Active, ActiveDish, Relay, Reacquired, horizon),
                    new RetargetWindow(Relay, RelayDish, Active, Reacquired, horizon),
                }),
            }, 0, 0);
        }

        /// <summary>Flies the craft into the dark at UT 100 and sends it a command at 200, with a look at the game every second.</summary>
        private static void FlyIntoTheDark(ReckonedVantageWorld world)
        {
            for (var ut = 1.0; ut <= 250.0; ut += 1.0)
            {
                world.Game.ActiveConnected = ut < 100.0;
                world.Game.ActiveValue = ut;
                world.Tick(ut);
                if (ut == 200.0)
                {
                    world.Engine.DispatchCommandAndWait(ScriptedContactUplink.ActiveCommand, "x", Home, _ => { }, Timeout);
                }
            }
        }

        private static KspSnapshot SnapshotAt(ScriptedContactGame game, double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["targetAvailable"] = game.TargetsSnapshot(),
                ["activeValue"] = game.ActiveValue,
                ["vessel"] = new Dictionary<string, object?> { ["identity"] = new Dictionary<string, object?> { ["id"] = game.ActiveNow } },
                ["vessels"] = game.RosterSnapshot(),
            },
        };

        private static ScriptedContactGame Game() => new ScriptedContactGame
        {
            RelayFromHomeSeconds = 10, RelayFromFarSeconds = 20, ActiveSeconds = 1, RelayConnected = true, FarLinkedToRelay = false,
        };

        /// <summary>
        /// The relay holding the command turns its dish once for the stretch a
        /// tick skips, since no link can come up inside it, and not once every
        /// few minutes of the game time skipped.
        /// </summary>
        [Fact]
        public async Task ATickThatSkipsHoursTurnsTheDishAHeldCommandWaitsOnOnce()
        {
            var backend = new DishBackend();
            await using var world = await ReckonedVantageWorld.StartAsync(Game(), watchTelemetry: true, commandsOnMainThread: true, backend: () => backend, mainThreadTimeoutSeconds: LockedWaitSeconds);
            using var main = new MainThread(world.Engine, frameMs: 5);
            var plan = Plan();
            world.Engine.SetCentrePlans(_ => plan, () => 1);
            FlyIntoTheDark(world);
            Assert.Equal(0, backend.Turns);
            Assert.True(world.Engine.SpansInTheNetwork > 0, "the dark craft holds no telemetry");

            world.Engine.TickAndWait(250.0 + 5000.0, SnapshotAt(world.Game, 250.0 + 5000.0), Timeout);

            Assert.Equal(1, backend.Turns);
            Assert.Equal(1, backend.Restores);
            AssertTheSaveNeverWaitedOnTheCourier(main);
        }

        /// <summary>
        /// A Courier that waited for the main thread while holding the delivery
        /// network's lock would keep a save waiting for as long as that wait
        /// lasts, which is the whole main-thread timeout, and in the game the
        /// two would wait on each other.
        /// </summary>
        private static void AssertTheSaveNeverWaitedOnTheCourier(MainThread main) =>
            Assert.True(main.LongestSave < TestBudgets.Op, "a save waited " + main.LongestSave.TotalMilliseconds.ToString("F0") + " ms for the delivery network's lock");

        /// <summary>
        /// The dish the relay turned will not go back, so the skipped stretch
        /// holds a dozen restores, each a round trip to a main thread that
        /// answers once a frame. A screen that subscribes while the tick is
        /// working through them is answered between two of them, and the
        /// rest still happen with no further tick.
        /// </summary>
        [Fact]
        public async Task ASubscribeIsAnsweredWhileATickStillOwesMainThreadRoundTripsFromTheStretchItSkipped()
        {
            var backend = new DishBackend { RestoresFail = true };
            await using var world = await ReckonedVantageWorld.StartAsync(
                Game(), watchTelemetry: true, commandsOnMainThread: true, backend: () => backend, mainThreadTimeoutSeconds: LockedWaitSeconds,
                beforeStart: engine => engine.ClockAdvanceBudgetSeconds = 0.001);
            using var main = new MainThread(world.Engine, frameMs: 20);
            var plan = Plan();
            world.Engine.SetCentrePlans(_ => plan, () => 1);
            FlyIntoTheDark(world);
            await using var fresh = await TestClient.ConnectAsync(world.Engine.BoundPort, Timeout);

            world.Engine.Tick(250.0 + 5000.0, SnapshotAt(world.Game, 250.0 + 5000.0));
            var answer = await SubscribeAsync(fresh, ScriptedContactUplink.ActiveTelemetryTopic, Timeout);
            var restoresWhenAnswered = backend.Restores;

            Assert.Equal("subscribed", answer.Name);
            Assert.True(restoresWhenAnswered < RestoreAttempts, "the subscribe waited out all " + restoresWhenAnswered + " restores");
            Assert.True(
                SpinWait.SpinUntil(() => backend.Restores == RestoreAttempts, Timeout),
                "only " + backend.Restores + " of the restores the tick owed happened");
            AssertTheSaveNeverWaitedOnTheCourier(main);
        }

        /// <summary>How many times a dish that will not go back is asked to.</summary>
        private const int RestoreAttempts = 12;
    }
}
