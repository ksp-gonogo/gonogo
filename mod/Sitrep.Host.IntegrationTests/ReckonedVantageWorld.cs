using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A statement of the reckoned-vantage rule that the code does not meet:
    /// something reached a command centre sooner than light could have carried
    /// it there, or failed to reach it once light had.
    /// </summary>
    internal sealed class ReckonedVantageViolation : Exception
    {
        public ReckonedVantageViolation(string message)
            : base(message)
        {
        }
    }

    /// <summary>The assertions the reckoned-vantage tests state their rule with.</summary>
    internal static class Reckoned
    {
        public static void Same(string? expected, string? actual, string what)
        {
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                throw new ReckonedVantageViolation(what + ": it differs.\nexpected: " + Clip(expected) + "\nactual:   " + Clip(actual));
            }
        }

        public static void Differs(string? unexpected, string? actual, string what)
        {
            if (string.Equals(unexpected, actual, StringComparison.Ordinal))
            {
                throw new ReckonedVantageViolation(what + ": it has not moved.\nstill: " + Clip(actual));
            }
        }

        public static void True(bool condition, string what)
        {
            if (!condition)
            {
                throw new ReckonedVantageViolation(what);
            }
        }

        /// <summary>
        /// Runs a test of a rule the code is known not to meet yet, and passes
        /// only while it still fails on that rule. The landing that makes the
        /// rule true turns this red, and removes the call.
        ///
        /// <para>Set <c>RECKONED_SHOW</c> in the environment to see each rule
        /// fail on its own assertion instead.</para>
        /// </summary>
        /// <param name="until">The landing that is expected to make the rule true.</param>
        public static async Task StillViolatedAsync(string until, Func<Task> rule)
        {
            try
            {
                await rule();
            }
            catch (ReckonedVantageViolation) when (Environment.GetEnvironmentVariable("RECKONED_SHOW") == null)
            {
                return;
            }
            Assert.Fail("This rule now holds, which " + until + " was to bring about. Call the rule directly instead of through StillViolatedAsync.");
        }

        private static string Clip(string? text) =>
            text == null ? "(nothing)" : text.Length <= 600 ? text : text.Substring(0, 600) + "...";
    }

    /// <summary>
    /// A scripted game for the contact plan: two ground stations on Kerbin that
    /// are command centres, an active craft landed out of sight of both, and a
    /// far relay in orbit above all three. Every light-time is scripted rather
    /// than measured, so a test can put the relay ten light-minutes away and
    /// still plan its windows around one planet.
    /// </summary>
    internal sealed class ScriptedContactGame : IContactGame
    {
        public const string Home = "ground:Home";
        public const string Far = "ground:Far";
        public const string ActiveGuid = "A";
        public const string RelayGuid = "X";
        public const string Active = "vessel:" + ActiveGuid;
        public const string Relay = "vessel:" + RelayGuid;

        public const double KerbinMu = 3.5316e12;
        public const double KerbinRadius = 600_000.0;
        public const double KerbinSiderealDay = 21_549.425;
        public const double SunMu = 1.1723328e18;
        public const double KerbinSma = 13_599_840_256.0;
        public const int Sun = 0;
        public const int Kerbin = 1;

        /// <summary>The relay's orbit radius before any burn: high enough to see a third of the planet at once.</summary>
        public const double RelayRadius = 3_000_000.0;

        /// <summary>Where on its orbit the relay starts, in radians: midway between the home station and the active craft.</summary>
        public const double RelayStartAngle = Math.PI / 3.0;

        private static readonly IReadOnlyList<SystemBody> Bodies = new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
        };

        private readonly object _gate = new object();
        private OrbitElements _relayOrbit = new OrbitElements(RelayRadius, 0.0, 0.0, 0.0, 0.0, RelayStartAngle, 0.0, KerbinMu);
        private bool _relayExists = true;

        /// <summary>The relay's light-time from the home centre, in seconds.</summary>
        public double RelayFromHomeSeconds { get; set; } = 600.0;

        /// <summary>The relay's light-time from the far centre, in seconds.</summary>
        public double RelayFromFarSeconds { get; set; } = 300.0;

        /// <summary>The active craft's light-time from every centre, in seconds.</summary>
        public double ActiveSeconds { get; set; } = 1.0;

        /// <summary>Whether the active craft has a link home.</summary>
        public bool ActiveConnected { get; set; } = true;

        /// <summary>Whether the relay has a link home.</summary>
        public bool RelayConnected { get; set; } = true;

        public bool RelayExists
        {
            get
            {
                lock (_gate)
                {
                    return _relayExists;
                }
            }
        }

        /// <summary>
        /// The relay burns prograde at <paramref name="ut"/>: where it is becomes
        /// the periapsis of an eccentric orbit, so it is in the same place at that
        /// instant and somewhere else at every later one.
        /// </summary>
        public void BurnRelay(double ut)
        {
            lock (_gate)
            {
                var meanMotion = Math.Sqrt(KerbinMu / (RelayRadius * RelayRadius * RelayRadius));
                var angle = RelayStartAngle + (meanMotion * ut);
                const double ecc = 0.3;
                _relayOrbit = new OrbitElements(RelayRadius / (1.0 - ecc), ecc, 0.0, 0.0, angle, 0.0, ut, KerbinMu);
            }
        }

        /// <summary>The relay is gone from the game: crashed, or recovered.</summary>
        public void DestroyRelay()
        {
            lock (_gate)
            {
                _relayExists = false;
            }
        }

        public IReadOnlyList<string> Centres() => new[] { Home, Far };

        public ContactGameLook Look()
        {
            var nodes = new List<ContactGameNode>
            {
                ContactGameNode.LandedCraft(Active, Kerbin, Surface(120.0)),
                ContactGameNode.GroundStation(Home, Kerbin, Surface(0.0)),
                ContactGameNode.GroundStation(Far, Kerbin, Surface(20.0)),
            };
            lock (_gate)
            {
                if (_relayExists)
                {
                    nodes.Insert(0, ContactGameNode.OrbitingCraft(Relay, Kerbin, _relayOrbit));
                }
            }
            return new ContactGameLook(nodes, Bodies, Kerbin, (_, index) => index == Kerbin ? KerbinRadius : 0.0);
        }

        private static RotatingGroundStation Surface(double longitudeDeg) =>
            RotatingGroundStation.FromLatitudeLongitude(0.0, longitudeDeg, 0.0, KerbinSiderealDay, KerbinRadius, 0.0);
    }

    /// <summary>
    /// Registers the production <see cref="ContactPlanSource"/> over a
    /// <see cref="ScriptedContactGame"/>, and writes that game's light-times
    /// and links into the engine's ledger each tick, as the game's own Uplinks
    /// do in production.
    /// </summary>
    internal sealed class ScriptedContactUplink : ISitrepUplink
    {
        /// <summary>A delayed command whose subject is the relay's own node.</summary>
        public const string RelayCommand = "reckoned.relay";

        private const string RelayStateTopic = "fleet." + ScriptedContactGame.RelayGuid + ".state";

        private readonly ScriptedContactGame _game;
        private readonly ChannelEngine _engine;
        private readonly ContactPlanSource _source;
        private float _wall;
        private int _handled;

        public ScriptedContactUplink(ScriptedContactGame game, ChannelEngine engine)
        {
            _game = game;
            _engine = engine;
            // Every look is ten seconds of wall time after the last, so no tick is skipped for pacing.
            _source = new ContactPlanSource(game, () => _wall += 10f, planInline: true);
            var channels = ContactPlanSource.Channels();
            channels.Add(new ChannelDeclaration
            {
                Topic = RelayStateTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            });
            Manifest = new UplinkManifest
            {
                Id = "reckoned-vantage-test",
                Version = "1.0.0",
                Channels = channels,
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = RelayCommand, Delay = DelayRole.Delayed, Subject = RelayStateTopic },
                },
            };
        }

        public UplinkManifest Manifest { get; }

        /// <summary>How many times the relay's command has run aboard it.</summary>
        public int HandledCount => Volatile.Read(ref _handled);

        public UplinkHealth Health() => _source.Health();

        public void Register(IUplinkHost host)
        {
            _source.Register(host);
            host.AddChannelSource(RelayStateTopic, _ => null);
            host.AddCommandHandler<string, string>(RelayCommand, args =>
            {
                Interlocked.Increment(ref _handled);
                return "done:" + args;
            });
            host.SetSignalDelaySource(_ => new CommsDelay { OneWaySeconds = _game.ActiveSeconds, Source = CommsDelaySource.SignalDelay });
            host.SetConnectivitySource(_ => _game.ActiveConnected);
            host.AddSampledSource(_ => new Ledger(_game), captured => Apply((Ledger)captured!));
        }

        /// <summary>COURIER THREAD: the game's light-times and links, as its delay Uplinks would write them.</summary>
        private void Apply(Ledger ledger)
        {
            _engine.SetVesselDelay(ScriptedContactGame.ActiveGuid, ledger.ActiveSeconds);
            _engine.SetVesselConnectivity(ScriptedContactGame.ActiveGuid, ledger.ActiveConnected);
            _engine.SetActiveVesselDelays(new Dictionary<string, double> { [ScriptedContactGame.Far] = ledger.ActiveSeconds });
            var rows = new List<(string, string, double)>
            {
                (ScriptedContactGame.Far, ScriptedContactGame.ActiveGuid, ledger.ActiveSeconds),
            };
            // A craft that is gone is no longer measured, so its rows stop being written.
            if (ledger.RelayExists)
            {
                _engine.SetVesselDelay(ScriptedContactGame.RelayGuid, ledger.RelayFromHomeSeconds);
                _engine.SetVesselConnectivity(ScriptedContactGame.RelayGuid, ledger.RelayConnected);
                rows.Add((ScriptedContactGame.Far, ScriptedContactGame.RelayGuid, ledger.RelayFromFarSeconds));
            }
            _engine.SetAuthorityDelays(rows);
        }

        private sealed class Ledger
        {
            public Ledger(ScriptedContactGame game)
            {
                ActiveSeconds = game.ActiveSeconds;
                ActiveConnected = game.ActiveConnected;
                RelayExists = game.RelayExists;
                RelayConnected = game.RelayConnected;
                RelayFromHomeSeconds = game.RelayFromHomeSeconds;
                RelayFromFarSeconds = game.RelayFromFarSeconds;
            }

            public double ActiveSeconds { get; }

            public bool ActiveConnected { get; }

            public bool RelayExists { get; }

            public bool RelayConnected { get; }

            public double RelayFromHomeSeconds { get; }

            public double RelayFromFarSeconds { get; }
        }
    }

    /// <summary>What one command centre's screen holds: the last payload it received on each topic, as the bytes that crossed the socket.</summary>
    internal sealed class CentreView
    {
        private readonly Dictionary<string, string> _latest = new Dictionary<string, string>(StringComparer.Ordinal);

        public string? Contacts => _latest.TryGetValue(ContactPlanSource.ContactsTopic, out var payload) ? payload : null;

        public string? Routes => _latest.TryGetValue(ContactPlanSource.RouteTopic, out var payload) ? payload : null;

        public void Received(string topic, string payload) => _latest[topic] = payload;

        /// <summary>Whether the contact plan this centre holds has a pair between the two nodes.</summary>
        public bool PlansPair(string a, string b) => PairWindows(a, b) != null;

        /// <summary>Whether the contact plan this centre holds says the two nodes are in contact at <paramref name="ut"/>.</summary>
        public bool PlansContactAt(string a, string b, double ut)
        {
            var windows = PairWindows(a, b);
            if (windows == null)
            {
                return false;
            }
            foreach (var window in windows.Value.EnumerateArray())
            {
                var opens = window.TryGetProperty("openUt", out var open) && open.ValueKind == JsonValueKind.Number ? open.GetDouble() : double.NegativeInfinity;
                var closes = window.TryGetProperty("closeUt", out var close) && close.ValueKind == JsonValueKind.Number ? close.GetDouble() : double.PositiveInfinity;
                if (opens <= ut && ut < closes)
                {
                    return true;
                }
            }
            return false;
        }

        private JsonElement? PairWindows(string a, string b)
        {
            if (Contacts == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(Contacts);
            foreach (var pair in doc.RootElement.GetProperty("pairs").EnumerateArray())
            {
                var pa = pair.GetProperty("a").GetString();
                var pb = pair.GetProperty("b").GetString();
                if ((pa == a && pb == b) || (pa == b && pb == a))
                {
                    return pair.GetProperty("windows").Clone();
                }
            }
            return null;
        }
    }

    /// <summary>
    /// One real engine over one <see cref="ScriptedContactGame"/>, with a
    /// socket open at each of the two command centres.
    /// </summary>
    internal sealed class ReckonedVantageWorld : IAsyncDisposable
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private TestClient _home = null!;
        private TestClient _far = null!;

        private ReckonedVantageWorld(ChannelEngine engine, ScriptedContactGame game, ScriptedContactUplink uplink)
        {
            Engine = engine;
            Game = game;
            Uplink = uplink;
        }

        public ChannelEngine Engine { get; }

        public ScriptedContactGame Game { get; }

        public ScriptedContactUplink Uplink { get; }

        /// <summary>What the home centre's screen holds as of the last <see cref="SettleAsync"/>.</summary>
        public CentreView Home { get; } = new CentreView();

        /// <summary>What the far centre's screen holds as of the last <see cref="SettleAsync"/>.</summary>
        public CentreView Far { get; } = new CentreView();

        public static async Task<ReckonedVantageWorld> StartAsync()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var game = new ScriptedContactGame();
            engine.RegisterCommandCentreSource(new Grounds(ScriptedContactGame.Home, ScriptedContactGame.Far));
            var uplink = new ScriptedContactUplink(game, engine);
            engine.RegisterUplink(uplink);
            engine.Start();
            var world = new ReckonedVantageWorld(engine, game, uplink);
            world.Tick(0.0);
            world._home = await world.ConnectAtAsync(ScriptedContactGame.Home);
            world._far = await world.ConnectAtAsync(ScriptedContactGame.Far);
            return world;
        }

        public void Tick(double ut)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = ScriptedContactGame.ActiveGuid },
                },
            };
            Engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = values }, Timeout);
        }

        /// <summary>Waits for both sockets to go quiet and takes in everything that arrived.</summary>
        public async Task SettleAsync()
        {
            await Task.WhenAll(DrainAsync(_home, Home), DrainAsync(_far, Far));
        }

        private static async Task DrainAsync(TestClient client, CentreView view)
        {
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(Quiet);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var type) && type.GetString() == "stream-data"
                    && root.TryGetProperty("payload", out var payload))
                {
                    view.Received(root.GetProperty("topic").GetString()!, payload.GetRawText());
                }
            }
        }

        private async Task<TestClient> ConnectAtAsync(string centre)
        {
            var client = await TestClient.ConnectAsync(Engine.BoundPort, Timeout);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.ContactsTopic, Timeout)).Name);
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.RouteTopic, Timeout)).Name);
            return client;
        }

        public async ValueTask DisposeAsync()
        {
            await _home.DisposeAsync();
            await _far.DisposeAsync();
            Engine.Stop();
            Engine.Dispose();
        }

        /// <summary>Ground stations under the ids the scripted game plans for.</summary>
        private sealed class Grounds : ICommandCentreSource
        {
            private readonly string[] _ids;

            public Grounds(params string[] ids) => _ids = ids;

            public string ProviderId => "reckoned-vantage-test";

            public IEnumerable<ICommandCentre> Enumerate() => _ids.Select(id => (ICommandCentre)new Ground(id));

            private sealed class Ground : ICommandCentre
            {
                public Ground(string id) => Id = id;

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
