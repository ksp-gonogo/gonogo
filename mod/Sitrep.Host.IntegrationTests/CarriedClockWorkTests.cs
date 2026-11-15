using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Propagation.Contacts;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A clock advance that stops at its budget and carries the rest to later
    /// jobs changes when things happen by the real clock and nothing else.
    /// Each script is flown twice through the engine, once with every advance
    /// run whole and once with every advance stopped after a single callback,
    /// and everything a screen or the game is handed must be the same, at the
    /// same game time and in the same order.
    /// </summary>
    public class CarriedClockWorkTests
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

        private readonly ITestOutputHelper _output;

        public CarriedClockWorkTests(ITestOutputHelper output) => _output = output;

        /// <summary>A dish backend that writes down each turn and restore it is asked for, with the game time it was asked for.</summary>
        private sealed class LoggingDishes : ICommsBackend, ICommsRetargetBackend
        {
            private readonly TestCommsCoreUplink.FakeCommsBackend _plain = new TestCommsCoreUplink.FakeCommsBackend("scripted-dishes", null);
            private int _records;

            public ConcurrentQueue<string> Log { get; } = new ConcurrentQueue<string>();

            public bool RestoresFail { get; set; }

            public string ProviderId => _plain.ProviderId;

            public IRetargetModel? RetargetModel(CommsNodeHandle? node, double ut) => null;

            public bool PeerCanReceive(string peerId, string nodeId, double ut) => true;

            public bool AutoRetargetAllowed(string nodeId) => true;

            public string? TurnDish(string nodeId, string dishId, string peerId, double ut)
            {
                Log.Enqueue("turn " + dishId + " to " + peerId + " at " + ut.ToString("0.###", CultureInfo.InvariantCulture));
                return "record-" + Interlocked.Increment(ref _records);
            }

            public bool RestoreDish(string recordId, double ut)
            {
                Log.Enqueue("restore " + recordId + " at " + ut.ToString("0.###", CultureInfo.InvariantCulture));
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

        /// <summary>Runs what the engine hands the game's main thread, and each frame reads what a save would write, which takes the delivery network's lock.</summary>
        private sealed class MainThread : IDisposable
        {
            private readonly Thread _thread;
            private volatile bool _stop;
            private long _longestSaveTicks;

            public TimeSpan LongestSave => TimeSpan.FromSeconds(Volatile.Read(ref _longestSaveTicks) / (double)System.Diagnostics.Stopwatch.Frequency);

            public MainThread(ChannelEngine engine)
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
                        Thread.Sleep(1);
                    }
                })
                { IsBackground = true };
                _thread.Start();
            }

            public void Dispose()
            {
                _stop = true;
                _thread.Join(TestBudgets.Op);
            }
        }

        /// <summary>One flight: when the craft is dark, what the plan holds, when commands are sent, and the game time of each tick.</summary>
        private sealed class Flight
        {
            public string Name = "";
            public double DarkFrom = 100.0;
            public double LinkedAgainFrom = double.PositiveInfinity;
            public bool DishTurns;
            public bool RestoresFail;
            public double[] CommandsAt = new double[0];
            public List<double> Ticks = new List<double>();

            public override string ToString() => Name;
        }

        private static ContactPlan Plan(Flight flight)
        {
            const double horizon = 10_000_000.0;
            const double step = 100_000.0;
            double[] Flat(double lightSeconds) =>
                Enumerable.Repeat(lightSeconds / ScriptedContactGame.LightFactor * PairPlan.SpeedOfLight, 101).ToArray();
            var pairs = new List<PairPlan>
            {
                new PairPlan(Relay, Home, horizon, new[] { new ContactWindow(0.0, null) }, 0.0, step, Flat(10)),
                new PairPlan(
                    Active, Relay, horizon, new ContactWindow[0], 0.0, step, Flat(5),
                    flight.DishTurns
                        ? new[]
                        {
                            new RetargetWindow(Active, Active + "#1/0", Relay, 300.0, horizon),
                            new RetargetWindow(Relay, Relay + "#1/0", Active, 300.0, horizon),
                        }
                        : new RetargetWindow[0]),
            };
            if (!double.IsInfinity(flight.LinkedAgainFrom))
            {
                pairs.Add(new PairPlan(Active, Home, horizon, new[] { new ContactWindow(flight.LinkedAgainFrom, null) }, 0.0, step, Flat(1)));
            }
            return new ContactPlan(0.0, horizon, step, pairs, 0, 0);
        }

        /// <summary>Flies <paramref name="flight"/> and returns everything the game and the home screen were handed.</summary>
        /// <param name="carried">Whether every clock advance stops after one callback and the rest is carried, with ticks handed over unwaited as the game hands them.</param>
        private static async Task<List<string>> FlyAsync(Flight flight, bool carried)
        {
            var dishes = new LoggingDishes { RestoresFail = flight.RestoresFail };
            var game = new ScriptedContactGame
            {
                RelayFromHomeSeconds = 10, RelayFromFarSeconds = 20, ActiveSeconds = 1, RelayConnected = true, FarLinkedToRelay = false,
            };
            await using var world = await ReckonedVantageWorld.StartAsync(
                game, watchTelemetry: true, commandsOnMainThread: true, backend: () => dishes, mainThreadTimeoutSeconds: LockedWaitSeconds,
                beforeStart: engine => engine.ClockAdvanceBudgetSeconds = carried ? 0.0 : double.PositiveInfinity);
            using var main = new MainThread(world.Engine);
            var plan = Plan(flight);
            world.Engine.SetCentrePlans(_ => plan, () => 1);

            var answers = new ConcurrentQueue<string>();
            var sent = 0;
            foreach (var ut in flight.Ticks)
            {
                var linked = ut < flight.DarkFrom || ut >= flight.LinkedAgainFrom;
                game.ActiveConnected = linked;
                game.ActiveLinkedToHomeSeconds = ut >= flight.LinkedAgainFrom ? 1.0 : (double?)null;
                game.ActiveValue = ut;
                world.Tick(ut, waited: !carried);
                if (flight.CommandsAt.Contains(ut))
                {
                    var number = ++sent;
                    world.Engine.DispatchCommandAndWait(
                        ScriptedContactUplink.ActiveCommand, "x" + number, Home,
                        result => answers.Enqueue("command " + number + " answered " + Json(result)),
                        Timeout,
                        onRefused: (code, detail) => answers.Enqueue("command " + number + " refused " + code + " " + detail));
                    if (carried)
                    {
                        world.Engine.WaitForTicksForTests(Timeout);
                    }
                }
            }
            if (carried)
            {
                world.Engine.WaitForTicksForTests(Timeout);
            }
            await world.SettleAsync();
            // A Courier that waited for the main thread while holding the delivery network's lock would have kept a save waiting that long.
            Assert.True(main.LongestSave < TestBudgets.Op, "a save waited " + main.LongestSave.TotalMilliseconds.ToString("F0") + " ms for the delivery network's lock");

            var log = new List<string>();
            log.AddRange(dishes.Log);
            log.AddRange(answers);
            log.Add("craft ran " + world.Uplink.ActiveHandledCount + " commands");
            log.AddRange(world.Home.Telemetry.Select(f =>
                "telemetry " + f.Value.ToString("0.###", CultureInfo.InvariantCulture) + " valid " + f.ValidAt.ToString("0.###", CultureInfo.InvariantCulture)
                + " delivered " + f.DeliveredAt.ToString("0.###", CultureInfo.InvariantCulture) + " " + f.Staleness + " gap " + f.GapSinceUt));
            /* The link report is sent again unchanged on a real-time floor, so how
               often a state repeats is the machine's doing. Each change of state is
               the game's, with the game time it was true at and landed at. */
            bool? lastSaid = null;
            foreach (var report in world.Home.LinkReports)
            {
                if (lastSaid == report.Connected)
                {
                    continue;
                }
                log.Add(lastSaid == null
                    ? "link starts " + report.Connected
                    : "link " + report.Connected + " valid " + report.ValidAt.ToString("0.###", CultureInfo.InvariantCulture)
                        + " delivered " + report.DeliveredAt.ToString("0.###", CultureInfo.InvariantCulture));
                lastSaid = report.Connected;
            }
            log.Add("pending " + Json(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)));
            log.Add("journey " + Json(world.Engine.JourneyAt(Home)));
            return log;
        }

        private static readonly System.Text.Json.JsonSerializerOptions Lenient = new System.Text.Json.JsonSerializerOptions
        {
            NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
            IncludeFields = true,
        };

        private static string Json(object? value) => value == null ? "null" : System.Text.Json.JsonSerializer.Serialize(value, value.GetType(), Lenient);

        public static IEnumerable<object[]> Flights()
        {
            foreach (var step in new[] { 1.0, 5.0, 50.0, 500.0, 5000.0, 21_600.0 })
            {
                foreach (var dishTurns in new[] { false, true })
                {
                    foreach (var regains in new[] { false, true })
                    {
                        var flight = new Flight
                        {
                            Name = "step " + step + (dishTurns ? ", dish turns" : ", no dish turns") + (regains ? ", contact regained" : ", dark to the end"),
                            DishTurns = dishTurns,
                            RestoresFail = dishTurns && step >= 500.0,
                            CommandsAt = new[] { 60.0, 150.0, 200.0 },
                        };
                        for (var ut = 1.0; ut <= 250.0; ut += 1.0)
                        {
                            flight.Ticks.Add(ut);
                        }
                        var at = 250.0;
                        for (var i = 0; i < (step < 50.0 ? 60 : 8); i++)
                        {
                            flight.Ticks.Add(at += step);
                        }
                        if (regains)
                        {
                            flight.LinkedAgainFrom = at - (3.0 * step) + 0.5;
                        }
                        for (var i = 0; i < 20; i++)
                        {
                            flight.Ticks.Add(at += 1.0);
                        }
                        yield return new object[] { flight };
                    }
                }
            }
        }

        [Theory]
        [MemberData(nameof(Flights))]
        public async Task CarryingWhatAnAdvanceLeftChangesNothingTheGameOrAScreenIsHanded(object scripted)
        {
            var flight = (Flight)scripted;

            var whole = await FlyAsync(flight, carried: false);
            var carried = await FlyAsync(flight, carried: true);

            _output.WriteLine(flight.Name + ": " + whole.Count + " lines");
            Assert.True(whole.Count > 100, "the flight recorded too little to compare: " + whole.Count + " lines");
            Assert.Equal(whole, carried);
        }
    }
}
