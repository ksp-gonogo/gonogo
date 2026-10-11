using System;
using System.Collections.Concurrent;
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

        /// <summary>The home station's name, which is not its id.</summary>
        public const string HomeName = "Home Station";
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

        /// <summary>Where on its orbit the relay starts unless a test says otherwise, in radians: midway between the home station and the active craft.</summary>
        public const double RelayStartAngle = Math.PI / 3.0;

        /// <summary>
        /// What a real light time is multiplied by in this game. The relay is ten
        /// light-minutes from home by decree and 2,800 km from it by geometry, and
        /// this is what makes the plan's light times agree with the decree to
        /// within a few percent.
        /// </summary>
        public const double LightFactor = 64_000.0;

        private static readonly IReadOnlyList<SystemBody> Bodies = new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
        };

        private readonly object _gate = new object();
        private readonly double _relayStartAngle;
        private OrbitElements _relayOrbit;
        private bool _relayExists = true;

        /// <param name="relayStartAngle">Where on its orbit the relay starts, in radians from the home station's meridian at UT 0.</param>
        public ScriptedContactGame(double relayStartAngle = RelayStartAngle)
        {
            _relayStartAngle = relayStartAngle;
            _relayOrbit = new OrbitElements(RelayRadius, 0.0, 0.0, 0.0, 0.0, relayStartAngle, 0.0, KerbinMu);
        }

        /// <summary>The relay's light-time from the home centre, in seconds.</summary>
        public double RelayFromHomeSeconds { get; set; } = 600.0;

        /// <summary>The relay's light-time from the far centre, in seconds.</summary>
        public double RelayFromFarSeconds { get; set; } = 300.0;

        /// <summary>The active craft's light-time from every centre, in seconds.</summary>
        public double ActiveSeconds { get; set; } = 1.0;

        /// <summary>Whether the active craft's light-time reads as none while it has no link, as the game's own does, rather than holding its figure.</summary>
        public bool DarkMeasuresNoDelay { get; set; }

        private double? _break;

        /// <summary>The hop the active craft was routed through stops carrying, this many light-seconds out from it: reported once, on the next tick.</summary>
        public void BreakActivePath(double lightSecondsOut)
        {
            lock (_gate)
            {
                _break = lightSecondsOut;
            }
        }

        /// <summary>The break to report this tick, if one is waiting.</summary>
        public double? TakeBreak()
        {
            lock (_gate)
            {
                var taken = _break;
                _break = null;
                return taken;
            }
        }

        /// <summary>Whether the active craft has a link home.</summary>
        public bool ActiveConnected { get; set; } = true;

        /// <summary>What the active craft's own telemetry topic reads, which a test moves each tick.</summary>
        public double ActiveValue { get; set; }

        /// <summary>Whether the relay has a link home.</summary>
        public bool RelayConnected { get; set; } = true;

        /// <summary>Whether the far station has a link to the relay. Without one the home station's link is what the relay reaches the ground by.</summary>
        public bool FarLinkedToRelay { get; set; } = true;

        /// <summary>Whether the far centre has a route to the relay. Without one it is listed as unable to reach it.</summary>
        public bool FarRoutedToRelay { get; set; } = true;

        /// <summary>
        /// The route the game carries the active craft's samples to a centre by,
        /// as a comms backend solves it, keyed by centre. A centre listed here is
        /// timed by its route's light-time, as the delay ledger times it; one left
        /// out keeps the plain light-times above.
        /// </summary>
        public Dictionary<string, IReadOnlyList<CommsHop>> GameRoutes { get; } = new Dictionary<string, IReadOnlyList<CommsHop>>();

        /// <summary>The light-time of a route as the game is set to model it.</summary>
        public static double SecondsOver(IReadOnlyList<CommsHop> route) =>
            SignalDelay.Compute(
                new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 / LightFactor },
                new CommsPath { Hops = new List<CommsHop>(route) },
                "").OneWaySeconds!.Value;

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
        /// <param name="ut">When it burns.</param>
        /// <param name="ecc">The eccentricity the burn leaves it on.</param>
        public void BurnRelay(double ut, double ecc = 0.3)
        {
            lock (_gate)
            {
                var meanMotion = Math.Sqrt(KerbinMu / (RelayRadius * RelayRadius * RelayRadius));
                var angle = _relayStartAngle + (meanMotion * ut);
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

        /// <summary>
        /// How long the relay's light takes to reach the home centre in a
        /// straight line, in seconds, or null for as long as its radio's route
        /// takes, which makes seeing it and hearing it the same.
        /// </summary>
        public double? RelaySeenFromHomeSeconds { get; set; }

        /// <summary>How long the spent stage's light takes to reach either centre, in seconds.</summary>
        public double DebrisSeenSeconds { get; set; }

        /// <summary>Whether the tracking station can place anything by sight. Without it every craft is known by its radio alone.</summary>
        public bool TracksBySight { get; set; } = true;

        private IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? Sight()
        {
            if (!TracksBySight)
            {
                return null;
            }
            static IReadOnlyDictionary<string, double> Row(double home, double far) =>
                new Dictionary<string, double> { [Home] = home, [Far] = far };
            return new Dictionary<string, IReadOnlyDictionary<string, double>>
            {
                [Active] = Row(ActiveSeconds, ActiveSeconds),
                [Relay] = Row(RelaySeenFromHomeSeconds ?? RelayFromHomeSeconds, RelayFromFarSeconds),
                ["vessel:" + DebrisGuid] = Row(DebrisSeenSeconds, DebrisSeenSeconds),
            };
        }

        /// <summary>Whether the relay is a command centre: crewed, and on the roster.</summary>
        public bool RelayIsCentre { get; set; }

        /// <summary>The relay's roster entry while it is a command centre.</summary>
        public static CommandCentreEntry RelayCentre => new CommandCentreEntry
        {
            Id = Relay, DisplayName = "Relay", Kind = nameof(CommandCentreKind.CrewedVessel), Active = true, DelayQuality = "routed",
        };

        private static CommandCentreEntry Station(string id) => new CommandCentreEntry
        {
            Id = id, DisplayName = id, Kind = nameof(CommandCentreKind.GroundStation), BodyIndex = Kerbin, Active = true, DelayQuality = "routed",
        };

        /// <summary>What the active craft's radio says of its link, or null for a game that reads none.</summary>
        public ContactRadio? Radio { get; set; }

        /// <summary>
        /// What the comms backend says a link between two nodes is worth, by
        /// their node ids, or null for a world whose backend states no
        /// strength. Set before the world starts: it decides whether a backend
        /// is elected at all.
        /// </summary>
        public System.Func<string, string, double?>? LinkStrengths { get; set; }

        /// <summary>The craft the game has active now, which a test can switch.</summary>
        public string ActiveNow { get; set; } = ActiveGuid;

        /// <summary>A spent stage with no radio, in the game from the start.</summary>
        public const string DebrisGuid = "D";

        /// <summary>Whether the spent stage is still in the game.</summary>
        public bool DebrisExists { get; set; } = true;

        /// <summary>How many crew the relay carries.</summary>
        public int RelayCrew { get; set; }

        /// <summary>
        /// Every craft in the game as the snapshot's roster lists it, which is
        /// what the game shows of each right now: the relay's orbit as it
        /// stands, burn included.
        /// </summary>
        /// <summary>Whether the relay is within physics range of the active craft, loaded beside it.</summary>
        public bool RelayInRange { get; set; }

        /// <summary>The light-time of a direct radio link between the active craft and the home centre, in seconds, or null for none.</summary>
        public double? ActiveLinkedToHomeSeconds { get; set; }

        /// <summary>The light-time of a direct radio link between the active craft and the relay, in seconds, or null for none.</summary>
        public double? ActiveLinkedToRelaySeconds { get; set; }

        /// <summary>The game's own target list for the active craft: the relay as it stands this instant, and one body.</summary>
        public Dictionary<string, object?> TargetsSnapshot()
        {
            var entries = new List<object?>
            {
                new Dictionary<string, object?> { ["kind"] = "Body", ["name"] = "Mun", ["bodyIndex"] = 2, ["distance"] = 1.2e7, ["isCurrent"] = false },
            };
            lock (_gate)
            {
                if (_relayExists)
                {
                    var relay = new Dictionary<string, object?>
                    {
                        ["kind"] = "Vessel",
                        ["name"] = "Relay",
                        ["vesselId"] = RelayGuid,
                        ["vesselType"] = "Relay",
                        ["situation"] = "ORBITING",
                        ["distance"] = 2500.0,
                        ["isCurrent"] = true,
                        ["inRange"] = RelayInRange,
                    };
                    // The game reads a craft's orbit as it stands only for one the active craft sees.
                    if (RelayInRange)
                    {
                        relay["sma"] = _relayOrbit.Sma;
                        relay["ecc"] = _relayOrbit.Ecc;
                        relay["epoch"] = _relayOrbit.Epoch;
                    }
                    entries.Add(relay);
                }
            }
            return new Dictionary<string, object?> { ["entries"] = entries };
        }

        /// <summary>Whether the game is in a scene other than flight, where it lists no craft at all.</summary>
        public bool OutOfFlight { get; set; }

        public List<object?> RosterSnapshot()
        {
            var roster = new List<object?>
            {
                new Dictionary<string, object?> { ["id"] = ActiveGuid, ["name"] = "Lander", ["vesselType"] = "Lander", ["situation"] = "LANDED" },
            };
            lock (_gate)
            {
                if (_relayExists)
                {
                    roster.Add(new Dictionary<string, object?>
                    {
                        ["id"] = RelayGuid,
                        ["name"] = "Relay",
                        ["vesselType"] = "Relay",
                        ["situation"] = "ORBITING",
                        ["crewCount"] = RelayCrew,
                        ["commsConnected"] = RelayConnected,
                        ["sma"] = _relayOrbit.Sma,
                        ["ecc"] = _relayOrbit.Ecc,
                        ["epoch"] = _relayOrbit.Epoch,
                    });
                }
            }
            if (DebrisExists)
            {
                roster.Add(new Dictionary<string, object?> { ["id"] = DebrisGuid, ["name"] = "Spent stage", ["vesselType"] = "Debris", ["situation"] = "ORBITING" });
            }
            return roster;
        }

        /// <summary>Whether the game's vessel list is still being filled, as it is for a few seconds after a load: nothing can be read from it.</summary>
        public bool ListNotStanding { get; set; }

        public ContactGameLook? Look()
        {
            if (ListNotStanding)
            {
                // What the game can still name with no vessel list to read: its ground stations.
                return new ContactGameLook(
                    new List<ContactGameNode>
                    {
                        ContactGameNode.GroundStation(Home, Kerbin, Surface(0.0), null, HomeName),
                        ContactGameNode.GroundStation(Far, Kerbin, Surface(20.0), null),
                    },
                    Bodies,
                    Kerbin,
                    (_, index) => index == Kerbin ? KerbinRadius : 0.0)
                {
                    Roster = new List<CommandCentreEntry> { Station(Home), Station(Far) },
                    VesselsUnread = true,
                };
            }
            // A node's radio is its own id where a backend is elected, so the backend can tell the pair it is asked about.
            CommsNodeHandle? Antenna(string id) => LinkStrengths == null ? null : CommsNodeHandle.Of(id);
            var nodes = new List<ContactGameNode>
            {
                ContactGameNode.LandedCraft(Active, Kerbin, Surface(120.0), Antenna(Active), "Lander"),
                ContactGameNode.GroundStation(Home, Kerbin, Surface(0.0), Antenna(Home), HomeName),
                ContactGameNode.GroundStation(Far, Kerbin, Surface(20.0), Antenna(Far)),
            };
            var roster = new List<CommandCentreEntry> { Station(Home), Station(Far) };
            lock (_gate)
            {
                if (_relayExists)
                {
                    var relay = ContactGameNode.OrbitingCraft(Relay, Kerbin, _relayOrbit, Antenna(Relay), "Relay");
                    if (RelayIsCentre)
                    {
                        relay.Centre = RelayCentre;
                        roster.Add(RelayCentre);
                    }
                    nodes.Insert(0, relay);
                }
            }
            var vessels = new List<string> { ActiveGuid };
            lock (_gate)
            {
                if (_relayExists)
                {
                    vessels.Add(RelayGuid);
                }
            }
            if (DebrisExists)
            {
                vessels.Add(DebrisGuid);
            }
            return new ContactGameLook(nodes, Bodies, Kerbin, (_, index) => index == Kerbin ? KerbinRadius : 0.0)
            {
                Radio = Radio, Roster = roster, Sight = Sight(), Vessels = vessels,
            };
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
    internal sealed class ScriptedContactUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        /// <summary>Elects a comms backend that states strengths, where the scripted game has any to state.</summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            if (_game.LinkStrengths != null)
            {
                CommsElection.RegisterCapability(kernel, _ => new StatedStrengthBackend(_game));
            }
        }

        /// <summary>A backend with nothing to say but what each link is worth, and that a path is worth the least of its links.</summary>
        private sealed class StatedStrengthBackend : ICommsBackend, ICommsPathStrength, ILinkStrengthRestorer
        {
            private readonly ScriptedContactGame _game;
            private readonly TestCommsCoreUplink.FakeCommsBackend _plain = new TestCommsCoreUplink.FakeCommsBackend("scripted-strength", null);

            public StatedStrengthBackend(ScriptedContactGame game) => _game = game;

            public string ProviderId => _plain.ProviderId;

            public IContactLinkStrength? LinkStrength(CommsNodeHandle? from, CommsNodeHandle? to, double ut)
            {
                var stated = from?.As<string>() is string a && to?.As<string>() is string b ? _game.LinkStrengths?.Invoke(a, b) : null;
                return stated == null ? null : new Flat(stated.Value);
            }

            public double Combine(IReadOnlyList<double> hopStrengths) => PathStrengths.Weakest(hopStrengths);

            public IContactLinkStrength? RestoreLinkStrength(string modelId, IReadOnlyDictionary<string, object?> data) =>
                modelId == Flat.Id && data.TryGetValue("strength", out var strength) && strength is double s ? new Flat(s) : null;

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

            private sealed class Flat : IPersistableLinkStrength
            {
                public const string Id = "scripted.flat.v1";

                private readonly double _strength;

                public Flat(double strength) => _strength = strength;

                public string ModelId => Id;

                public Dictionary<string, object?> Describe() => new Dictionary<string, object?> { ["strength"] = _strength };

                public ContactHopFacts FactsAt(double ut, double separationMeters) =>
                    new ContactHopFacts(_strength, SignalQuantity.RangeFraction, new Dictionary<string, object?> { ["scripted"] = new Dictionary<string, object?> { ["worth"] = _strength } });
            }
        }

        /// <summary>A delayed command whose subject is the relay's own node.</summary>
        public const string RelayCommand = "reckoned.relay";

        private const string RelayStateTopic = "fleet." + ScriptedContactGame.RelayGuid + ".state";

        /// <summary>A telemetry topic of the active craft: Delayed, recordable, and read off the game's <see cref="ScriptedContactGame.ActiveValue"/>.</summary>
        public const string ActiveTelemetryTopic = "reckoned.active.value";

        /// <summary>A control-channel write, a throttle, whose subject here is the relay.</summary>
        public const string ThrottleCommand = "vessel.control.setThrottle";

        /// <summary>A switch on a control channel, the lights, whose subject here is the relay.</summary>
        public const string LightsCommand = "vessel.control.setLights";

        /// <summary>A delayed command whose subject is whichever craft is active.</summary>
        public const string ActiveCommand = "reckoned.active";

        private int _activeHandled;

        /// <summary>How many times the active craft's command has run.</summary>
        public int ActiveHandledCount => Volatile.Read(ref _activeHandled);

        /// <summary>The fly-by-wire axes, a continuous input, whose subject here is the active craft.</summary>
        public const string AxesCommand = "vessel.control.setAxes";

        private int _lit;
        private int _steered;
        private readonly ScriptedContactGame _game;
        private readonly ChannelEngine _engine;
        private readonly ContactPlanSource _source;
        private readonly DeliveryInputs _inputs = new DeliveryInputs();
        private int _throttled;
        private readonly ConcurrentDictionary<(string Centre, string VesselId), CraftState> _heard =
            new ConcurrentDictionary<(string, string), CraftState>();
        private float _wall;
        private int _handled;
        private bool _listening;

        public ScriptedContactUplink(ScriptedContactGame game, ChannelEngine engine)
        {
            _game = game;
            _engine = engine;
            // Every look is ten seconds of wall time after the last, so no tick is skipped for pacing.
            _source = new ContactPlanSource(game, () => _wall += 10f, planInline: true);
            _inputs.SetLightFactor(ScriptedContactGame.LightFactor);
            engine.SetDeliveryInputs(_inputs);
            var channels = ContactPlanSource.Channels();
            channels.Add(new ChannelDeclaration
            {
                // The active craft's link report, as the comms Uplink declares it: Delayed, and exempt from the freeze by its topic.
                Topic = ChannelEngine.ConnectivityMetaTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            });
            channels.Add(new ChannelDeclaration
            {
                Topic = ActiveTelemetryTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 100000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
                Recordable = true,
            });
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
                    new CommandDeclaration { Command = ThrottleCommand, Delay = DelayRole.Delayed, Subject = RelayStateTopic },
                    new CommandDeclaration { Command = LightsCommand, Delay = DelayRole.Delayed, Subject = RelayStateTopic },
                    new CommandDeclaration { Command = ActiveCommand, Delay = DelayRole.Delayed, Subject = ChannelEngine.ConnectivityMetaTopic },
                    // The axes fly the ACTIVE craft, which reaches the ground through the relay.
                    new CommandDeclaration { Command = AxesCommand, Delay = DelayRole.Delayed, Subject = ChannelEngine.ConnectivityMetaTopic },
                },
            };
        }

        public UplinkManifest Manifest { get; }

        /// <summary>What store-and-forward reads of the live game here.</summary>
        public DeliveryInputs Inputs => _inputs;

        /// <summary>How many times the relay's command has run aboard it.</summary>
        public int HandledCount => Volatile.Read(ref _handled);

        /// <summary>How many throttle writes have run aboard the relay.</summary>
        public int ThrottledCount => Volatile.Read(ref _throttled);

        /// <summary>How many times the lights have been switched aboard the relay.</summary>
        public int LitCount => Volatile.Read(ref _lit);

        /// <summary>How many axis writes have run aboard the active craft.</summary>
        public int SteeredCount => Volatile.Read(ref _steered);

        /// <summary>The newest state of a craft that has reached <paramref name="centre"/>, or null when it has heard nothing of it.</summary>
        public CraftState? Heard(string centre, string vesselId) =>
            _heard.TryGetValue((centre, vesselId), out var state) ? state : null;

        public UplinkHealth Health() => _source.Health();

        public void Register(IUplinkHost host)
        {
            // Before the plan's own sources, as the delay Uplinks are registered
            // before the contact plan's in the game: what is recorded on a tick
            // is sent under that tick's light-times.
            host.AddSampledSource(_ => new Ledger(_game), captured => Apply((Ledger)captured!));
            _source.Register(host);
            host.AddChannelSource(RelayStateTopic, _ => null);
            host.AddChannelSource(ActiveTelemetryTopic, snapshot => snapshot != null && snapshot.Values.TryGetValue("activeValue", out var value) ? value : null);
            host.AddChannelSource(ChannelEngine.ConnectivityMetaTopic, _ => new CommsLink { Connected = _game.ActiveConnected });
            host.AddCommandHandler<string, string>(RelayCommand, args =>
            {
                Interlocked.Increment(ref _handled);
                return "done:" + args;
            });
            host.AddCommandHandler<Dictionary<string, object?>, string>(ThrottleCommand, _ =>
            {
                Interlocked.Increment(ref _throttled);
                return "throttled";
            });
            host.AddCommandHandler<string, string>(ActiveCommand, args =>
            {
                Interlocked.Increment(ref _activeHandled);
                return "active:" + args;
            });
            // Bound to the args type the game's six switches share, as the vessel Uplink binds it.
            host.AddCommandHandler<SetEnabledArgs, string>(LightsCommand, _ =>
            {
                Interlocked.Increment(ref _lit);
                return "lit";
            });
            host.AddCommandHandler<Dictionary<string, object?>, string>(AxesCommand, _ =>
            {
                Interlocked.Increment(ref _steered);
                return "steered";
            });
            host.SetSignalDelaySource(_ => new CommsDelay
            {
                // A craft with no path measures no light-time at all, as the live read does.
                OneWaySeconds = _game.ActiveConnected || !_game.DarkMeasuresNoDelay ? _game.ActiveSeconds : (double?)null,
                Source = CommsDelaySource.SignalDelay,
            });
            host.SetPathBreakSource((_, ut) =>
            {
                var at = _game.TakeBreak();
                // The active craft's break names both of its nodes, as the game's own watcher does.
                return at == null
                    ? null
                    : new[]
                    {
                        new PathBreak(ChannelEngine.NodeId, ut, at.Value),
                        new PathBreak(ChannelEngine.FleetNodePrefix + ScriptedContactGame.ActiveGuid, ut, at.Value),
                    };
            });
            host.SetConnectivitySource(_ => _game.ActiveConnected);
        }

        /// <summary>COURIER THREAD: the game's light-times and links, as its delay Uplinks would write them.</summary>
        private void Apply(Ledger ledger)
        {
            if (!_listening)
            {
                _listening = true;
                foreach (var centre in new[] { ScriptedContactGame.Home, ScriptedContactGame.Far })
                {
                    foreach (var vesselId in new[] { ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid })
                    {
                        _engine.HearCraftState(vesselId, centre, state => _heard[(centre, vesselId)] = state);
                    }
                }
            }
            _engine.SetVesselDelay(ScriptedContactGame.ActiveGuid, ledger.ActiveSeconds);
            _engine.SetVesselConnectivity(ScriptedContactGame.ActiveGuid, ledger.ActiveConnected);
            var activeRows = new Dictionary<string, double> { [ScriptedContactGame.Far] = ledger.ActiveSeconds };
            foreach (var route in ledger.GameRoutes)
            {
                activeRows[route.Key] = ScriptedContactGame.SecondsOver(route.Value);
            }
            _engine.SetActiveVesselDelays(activeRows);
            _engine.SetActiveVesselRoutes(ledger.GameRoutes);
            var rows = new List<(string, string, double)>
            {
                (ScriptedContactGame.Far, ScriptedContactGame.ActiveGuid, ledger.ActiveSeconds),
            };
            // A craft that is gone is no longer measured, so its rows stop being written.
            if (ledger.RelayExists)
            {
                _engine.SetVesselDelay(ScriptedContactGame.RelayGuid, ledger.RelayFromHomeSeconds);
                _engine.SetVesselConnectivity(ScriptedContactGame.RelayGuid, ledger.RelayConnected);
                if (ledger.FarRoutedToRelay)
                {
                    rows.Add((ScriptedContactGame.Far, ScriptedContactGame.RelayGuid, ledger.RelayFromFarSeconds));
                }
            }
            _engine.SetAuthorityDelays(rows);
            var unroutable = new Dictionary<string, IReadOnlyCollection<string>>();
            if (ledger.RelayExists && !ledger.FarRoutedToRelay)
            {
                unroutable[ScriptedContactGame.Far] = new[] { ChannelEngine.FleetNodePrefix + ScriptedContactGame.RelayGuid };
            }
            _engine.SetUnroutable(unroutable);

            // The live links, for whether light that was sent lands and for a
            // relay's own link: the relay to each centre while it has one.
            var links = new List<(string, string, double)>();
            if (ledger.ActiveLinkedToHomeSeconds != null)
            {
                links.Add((ScriptedContactGame.Home, ScriptedContactGame.Active, ledger.ActiveLinkedToHomeSeconds.Value));
            }
            if (ledger.RelayExists && ledger.ActiveLinkedToRelaySeconds != null)
            {
                links.Add((ScriptedContactGame.Active, ScriptedContactGame.Relay, ledger.ActiveLinkedToRelaySeconds.Value));
            }
            if (ledger.RelayExists && ledger.RelayConnected)
            {
                links.Add((ScriptedContactGame.Home, ScriptedContactGame.Relay, ledger.RelayFromHomeSeconds));
                if (ledger.FarLinkedToRelay)
                {
                    links.Add((ScriptedContactGame.Far, ScriptedContactGame.Relay, ledger.RelayFromFarSeconds));
                }
            }
            _inputs.SetLinks(new LiveLinkGraph(links));
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
                FarLinkedToRelay = game.FarLinkedToRelay;
                ActiveLinkedToRelaySeconds = game.ActiveLinkedToRelaySeconds;
                ActiveLinkedToHomeSeconds = game.ActiveLinkedToHomeSeconds;
                FarRoutedToRelay = game.FarRoutedToRelay;
                GameRoutes = new Dictionary<string, IReadOnlyList<CommsHop>>(game.GameRoutes);
            }

            public Dictionary<string, IReadOnlyList<CommsHop>> GameRoutes { get; }

            public bool FarRoutedToRelay { get; }

            public double ActiveSeconds { get; }

            public bool ActiveConnected { get; }

            public bool RelayExists { get; }

            public bool RelayConnected { get; }

            public double RelayFromHomeSeconds { get; }

            public double RelayFromFarSeconds { get; }

            public bool FarLinkedToRelay { get; }

            public double? ActiveLinkedToRelaySeconds { get; }

            public double? ActiveLinkedToHomeSeconds { get; }
        }
    }

    /// <summary>What one command centre's screen holds: the last payload it received on each topic, as the bytes that crossed the socket.</summary>
    internal sealed class CentreView
    {
        private readonly Dictionary<string, string> _latest = new Dictionary<string, string>(StringComparer.Ordinal);

        public string? Contacts => _latest.TryGetValue(ContactPlanSource.ContactsTopic, out var payload) ? payload : null;

        public string? Routes => _latest.TryGetValue(ContactPlanSource.RouteTopic, out var payload) ? payload : null;

        public string? Vessels => Latest(SystemViewProvider.VesselsTopic);

        /// <summary>One craft's entry in the roster this centre holds, or null when the roster does not list it.</summary>
        public JsonElement? Vessel(string vesselId)
        {
            if (Vessels == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(Vessels);
            foreach (var entry in doc.RootElement.GetProperty("vessels").EnumerateArray())
            {
                if (entry.GetProperty("vesselId").GetString() == vesselId)
                {
                    return entry.Clone();
                }
            }
            return null;
        }

        public string? Path => Latest(ContactPlanSource.PathTopic);

        public string? Network => Latest(ContactPlanSource.NetworkTopic);

        public string? CommandCentre => Latest(ContactPlanSource.CommandCentreTopic);

        /// <summary>The last payload received on <paramref name="topic"/>, or null when none has been.</summary>
        public string? Latest(string topic) => _latest.TryGetValue(topic, out var payload) ? payload : null;

        /// <summary>When the last frame on each topic was valid and when it was delivered.</summary>
        public Dictionary<string, (double ValidAt, double DeliveredAt)> Stamps { get; } = new Dictionary<string, (double, double)>(StringComparer.Ordinal);

        /// <summary>How many contact plans this centre has been sent.</summary>
        public int ContactsFrames { get; private set; }

        /// <summary>When the last contact plan this centre was sent was made, and when it arrived.</summary>
        public (double ValidAt, double DeliveredAt, string Vantage)? ContactsMeta { get; private set; }

        /// <summary>Every frame of the active craft's telemetry topic this screen has received, in order.</summary>
        public List<(double Value, double ValidAt, double DeliveredAt, Staleness Staleness, double? GapSinceUt)> Telemetry { get; } =
            new List<(double, double, double, Staleness, double?)>();

        /// <summary>Every report of the active craft's link this screen has received, in order: whether it said connected, when it was true and when it arrived.</summary>
        public List<(bool Connected, double ValidAt, double DeliveredAt, Staleness Staleness)> LinkReports { get; } =
            new List<(bool, double, double, Staleness)>();

        /// <summary>The topics this screen has been sent at least one frame of as a recording, which is how a held span arrives.</summary>
        public HashSet<string> RecordedTopics { get; } = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>The strength of every <c>comms.signal</c> frame this screen has received, in order.</summary>
        public List<double> SignalStrengths { get; } = new List<double>();

        public void Received(string topic, string payload, double validAt, double deliveredAt, string vantage)
        {
            _latest[topic] = payload;
            if (topic == ContactPlanSource.SignalTopic)
            {
                using var signal = JsonDocument.Parse(payload);
                SignalStrengths.Add(signal.RootElement.GetProperty("strength").GetDouble());
            }
            Stamps[topic] = (validAt, deliveredAt);
            if (topic == ContactPlanSource.ContactsTopic)
            {
                ContactsFrames++;
                ContactsMeta = (validAt, deliveredAt, vantage);
            }
        }

        /// <summary>Whether the contact plan this centre holds marks the pair as low confidence, or null when it has no such pair.</summary>
        public bool? LowConfidence(string a, string b)
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
                    return pair.GetProperty("lowConfidence").GetBoolean();
                }
            }
            return null;
        }

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

        private bool _watchTelemetry;
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

        /// <param name="watchTelemetry">Whether each screen also takes the active craft's telemetry topic and its link report, which a test about what arrives when has to see.</param>
        public static async Task<ReckonedVantageWorld> StartAsync(ScriptedContactGame? scripted = null, bool watchTelemetry = false)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var wall = 0.0;
            engine.SetReleaseClockForTests(() => wall += 0.05);
            var game = scripted ?? new ScriptedContactGame();
            engine.RegisterCommandCentreSource(new Grounds(ScriptedContactGame.Home, ScriptedContactGame.Far));
            var uplink = new ScriptedContactUplink(game, engine);
            if (game.LinkStrengths != null)
            {
                // Only where the script elects a backend: every other world runs with none, as it always has.
                uplink.DeclareCapabilities(engine.Kernel);
                engine.ResolveCapabilities();
            }
            engine.RegisterUplink(uplink);
            engine.Start();
            var world = new ReckonedVantageWorld(engine, game, uplink) { _watchTelemetry = watchTelemetry };
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
                    ["identity"] = new Dictionary<string, object?> { ["id"] = Game.ActiveNow },
                },
                ["targetAvailable"] = Game.TargetsSnapshot(),
                ["activeValue"] = Game.ActiveValue,
            };
            if (!Game.OutOfFlight)
            {
                values["vessels"] = Game.RosterSnapshot();
            }
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
                    var meta = root.GetProperty("meta");
                    var staleness = (Staleness)meta.GetProperty("staleness").GetInt32();
                    if (staleness == Staleness.Recorded)
                    {
                        view.RecordedTopics.Add(root.GetProperty("topic").GetString()!);
                    }
                    if (root.GetProperty("topic").GetString() == ChannelEngine.ConnectivityMetaTopic && payload.TryGetProperty("connected", out var connected))
                    {
                        view.LinkReports.Add((
                            connected.GetBoolean(),
                            meta.GetProperty("validAt").GetDouble(),
                            meta.GetProperty("deliveredAt").GetDouble(),
                            staleness));
                    }
                    if (root.GetProperty("topic").GetString() == ScriptedContactUplink.ActiveTelemetryTopic && payload.ValueKind == JsonValueKind.Number)
                    {
                        view.Telemetry.Add((
                            payload.GetDouble(),
                            meta.GetProperty("validAt").GetDouble(),
                            meta.GetProperty("deliveredAt").GetDouble(),
                            (Staleness)meta.GetProperty("staleness").GetInt32(),
                            meta.TryGetProperty("gapSinceUt", out var gap) && gap.ValueKind == JsonValueKind.Number ? gap.GetDouble() : (double?)null));
                    }
                    view.Received(
                        root.GetProperty("topic").GetString()!,
                        payload.GetRawText(),
                        meta.GetProperty("validAt").GetDouble(),
                        meta.GetProperty("deliveredAt").GetDouble(),
                        meta.GetProperty("vantage").GetString()!);
                }
            }
        }

        /// <summary>A further session sitting down at <paramref name="centre"/> now, and what its screen comes to hold.</summary>
        public async Task<(TestClient Client, CentreView View)> SitDownAtAsync(string centre, params string[] alsoSubscribe)
        {
            var client = await ConnectAtAsync(centre);
            foreach (var topic in alsoSubscribe)
            {
                Assert.Equal("subscribed", (await SubscribeAsync(client, topic, Timeout)).Name);
            }
            return (client, new CentreView());
        }

        /// <summary>Waits for <paramref name="client"/>'s socket to go quiet and takes in everything that arrived.</summary>
        public static Task SettleAsync(TestClient client, CentreView view) => DrainAsync(client, view);

        private async Task<TestClient> ConnectAtAsync(string centre)
        {
            var client = await TestClient.ConnectAsync(Engine.BoundPort, Timeout);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.ContactsTopic, Timeout)).Name);
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.RouteTopic, Timeout)).Name);
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.PathTopic, Timeout)).Name);
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.NetworkTopic, Timeout)).Name);
            Assert.Equal("subscribed", (await SubscribeAsync(client, ContactPlanSource.CommandCentreTopic, Timeout)).Name);
            if (_watchTelemetry)
            {
                Assert.Equal("subscribed", (await SubscribeAsync(client, ScriptedContactUplink.ActiveTelemetryTopic, Timeout)).Name);
                Assert.Equal("subscribed", (await SubscribeAsync(client, ChannelEngine.ConnectivityMetaTopic, Timeout)).Name);
            }
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
