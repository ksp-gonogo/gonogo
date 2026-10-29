using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Commcast;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Every channel the engine has registered keeps a current reading through every
    /// transition the game puts a session through, when its value does not change.
    ///
    /// <para>The channels are read off an engine holding the bundled Uplinks and
    /// <see cref="RoutingKindsUplink"/>, then each declaration is registered again
    /// on a sweep engine whose sources all publish one fixed value, so a channel
    /// declared tomorrow is swept with no new case. A subscriber is current when
    /// the last frame it holds carries that value from the node the topic routes to
    /// now, and that frame was sampled after the transition whenever the
    /// transition gave it cause to doubt the one it held before: a timeline that
    /// started again, anything else said on the topic meanwhile, or an addressed
    /// sample, which is heard once rather than held.</para>
    /// </summary>
    public class TransitionSweepTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string CraftA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string CraftB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const string StagedOff = "cccccccc-0000-0000-0000-000000000000";
        private const string ProcessorKey = "core1";
        private const string LensKey = "scope";
        private const string Centre = "ground:sweep";
        private const string Save = "sweep";
        private const double Value = 7.0;
        private static readonly byte[] OpaqueValue = { 7 };

        public enum Transition
        {
            Stage,
            CraftSwitch,
            Revert,
            Quickload,
            SaveChange,
            LinkLossAndReturn,
        }

        public static IEnumerable<object[]> Transitions() =>
            Enum.GetValues(typeof(Transition)).Cast<Transition>().Select(t => new object[] { t });

        [Theory]
        [MemberData(nameof(Transitions))]
        public async Task EveryChannelKeepsACurrentReadingThroughTheTransition(Transition transition)
        {
            var swept = SweptChannels.Discover();
            Assert.NotEmpty(swept.Broadcast);
            Assert.NotEmpty(swept.Addressed);

            var failures = await Task.WhenAll(
                SweepAsync(transition, swept.Broadcast, addressed: false),
                SweepAsync(transition, swept.Addressed, addressed: true));

            var all = failures.SelectMany(f => f).ToList();
            Assert.True(all.Count == 0, transition + ":\n" + string.Join("\n", all));
        }

        private static async Task<List<string>> SweepAsync(Transition transition, IReadOnlyList<SweptChannel> channels, bool addressed)
        {
            var world = new SweepWorld();
            var mirror = new MirrorUplink(channels, world, addressed);
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            if (addressed)
            {
                engine.RegisterCommandCentreSource(new OneCentre());
            }
            engine.RegisterUplink(mirror);
            engine.Start();
            try
            {
                Assert.True(engine.AvailabilityOf(MirrorUplink.Id).IsAvailable, "the mirror Uplink was refused");
                engine.NoteSave(Save);
                /* Two holders, so no repoint ever takes a topic's subscriber count through zero. */
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var clients = new[] { first, second };
                foreach (var client in clients)
                {
                    if (addressed)
                    {
                        await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Centre }));
                    }
                    foreach (var topic in mirror.Topics)
                    {
                        await SubscribeAsync(client, topic, Timeout);
                    }
                }

                var script = Script(transition);
                foreach (var step in script.Setup)
                {
                    Run(engine, world, step);
                }
                var before = await Task.WhenAll(clients.Select(DrainAsync));

                var currentFromUt = double.NaN;
                foreach (var step in script.Transition)
                {
                    Run(engine, world, step);
                    if (step.CurrentFrom)
                    {
                        currentFromUt = step.Ut;
                    }
                }
                var after = await Task.WhenAll(clients.Select(DrainAsync));

                /* An inert mirror publishes nothing, which a transition that needs no new frame would read as a pass. */
                var availability = engine.AvailabilityOf(MirrorUplink.Id);
                if (!availability.IsAvailable)
                {
                    return new List<string> { "the mirror Uplink stopped: " + availability.Reason };
                }
                var mustHearAgain = script.RestartsTheTimeline || addressed;
                return Enumerable.Range(0, clients.Length)
                    .SelectMany(holder => mirror.Topics.Select(topic =>
                        Judge(topic, engine.NodeFor(topic), before[holder], after[holder], currentFromUt, mustHearAgain) is string failure
                            ? "holder " + (holder + 1) + ", " + failure
                            : null))
                    .Where(failure => failure != null)
                    .Select(failure => failure!)
                    .ToList();
            }
            finally
            {
                engine.Stop();
            }
        }

        private static string? Judge(string topic, string nodeNow, List<Frame> before, List<Frame> after, double currentFromUt, bool mustHearAgain)
        {
            var heldBefore = before.LastOrDefault(f => f.Topic == topic);
            if (heldBefore == null || !heldBefore.Carries)
            {
                return topic + ": no reading of the value before the transition, so the sweep did not set it up";
            }
            var heard = after.Where(f => f.Topic == topic).ToList();
            var held = heard.LastOrDefault() ?? heldBefore;
            if (!held.Carries)
            {
                return topic + ": the last frame holds " + held.Shown + " (sampled at UT " + held.ValidAt + ")";
            }
            if (held.Source != nodeNow)
            {
                return topic + ": the last frame came from " + held.Source + " but the topic routes to " + nodeNow;
            }
            var doubted = mustHearAgain || heard.Any(f => !f.Carries);
            if (doubted && (heard.Count == 0 || held.ValidAt < currentFromUt))
            {
                return topic + ": nothing sampled at or after UT " + currentFromUt + " was heard; the last frame was sampled at UT "
                    + held.ValidAt + ", " + heard.Count + " frame(s) after the transition began";
            }
            return null;
        }

        /// <summary>One frame a subscriber was sent, from either lane.</summary>
        private sealed class Frame
        {
            public Frame(string topic, Meta meta, bool carries, string shown)
            {
                Topic = topic;
                Source = meta.Source;
                ValidAt = meta.ValidAt;
                Carries = carries;
                Shown = shown;
            }

            public string Topic { get; }
            public string Source { get; }
            public double ValidAt { get; }

            /// <summary>Whether the frame holds the value the sweep feeds.</summary>
            public bool Carries { get; }

            public string Shown { get; }
        }

        /* The two lanes are drained over the same quiet window at once, so the binary lane costs no extra time. */
        private static async Task<List<Frame>> DrainAsync(TestClient client)
        {
            var text = DrainAllStreamDataAsync(client, Quiet);
            var binary = DrainBinaryAsync(client);
            var frames = (await text)
                .Select(f => new Frame(f.Topic, f.Meta, CarriesTheValue(f.Payload), f.Payload?.ToString() ?? "null"))
                .ToList();
            frames.AddRange(await binary);
            return frames;
        }

        private static async Task<List<Frame>> DrainBinaryAsync(TestClient client)
        {
            var frames = new List<Frame>();
            while (true)
            {
                byte[] raw;
                try
                {
                    raw = await client.ReceiveBinaryAsync(Quiet);
                }
                catch (OperationCanceledException)
                {
                    return frames;
                }
                Assert.True(BinaryFrameCodec.TryParseStreamBinary(raw, 0, raw.Length, out var header, out var segments, out var reason), reason);
                var carries = segments.Count == 1 && segments[0].SequenceEqual(OpaqueValue);
                frames.Add(new Frame(header.Topic, header.Meta, carries, segments.Count + " segment(s)"));
            }
        }

        private static bool CarriesTheValue(object? payload) =>
            payload is IDictionary<string, object?> fields
            && fields.TryGetValue("sweep", out var raw)
            && raw != null
            && Convert.ToDouble(raw) == Value;

        private static void Run(ChannelEngine engine, SweepWorld world, Step step)
        {
            step.Change?.Invoke(engine, world);
            world.Ut = step.Ut;
            engine.TickAndWait(step.Ut, world.Snapshot(), Timeout);
        }

        private sealed class Step
        {
            public Step(double ut, Action<ChannelEngine, SweepWorld>? change = null, bool currentFrom = false)
            {
                Ut = ut;
                Change = change;
                CurrentFrom = currentFrom;
            }

            public double Ut { get; }
            public Action<ChannelEngine, SweepWorld>? Change { get; }
            /// <summary>Whether a reading sampled on this tick or later is current once the transition is over.</summary>
            public bool CurrentFrom { get; }
        }

        private sealed class TransitionScript
        {
            public List<Step> Setup { get; } = new List<Step>();
            public List<Step> Transition { get; } = new List<Step>();
            public bool RestartsTheTimeline { get; set; }
        }

        /*
         * Every script settles on craft A for five ticks first, and ends one tick
         * after the tick its path is known on, which is how "within one tick" is
         * held: the drain that follows sees nothing a later tick produced. The
         * step marked currentFrom is the first whose sample is current: the craft
         * switched to is sampled on the switch tick and held until its path is
         * measured, while a link that drops is current again only from its return.
         */
        private static TransitionScript Script(Transition transition)
        {
            var script = new TransitionScript();
            foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
            {
                script.Setup.Add(new Step(ut));
            }
            switch (transition)
            {
                case Transition.Stage:
                    script.Transition.Add(new Step(6.0, (_, w) => w.StageOff(), currentFrom: true));
                    script.Transition.Add(new Step(7.0));
                    break;
                case Transition.CraftSwitch:
                    script.Transition.Add(new Step(6.0, (_, w) =>
                    {
                        w.Active = CraftB;
                        w.ActiveDelay = null;
                    }, currentFrom: true));
                    script.Transition.Add(new Step(7.0, (_, w) => w.ActiveDelay = 0.0));
                    script.Transition.Add(new Step(8.0));
                    break;
                case Transition.Revert:
                    script.Setup.Add(new Step(6.0, (_, w) => w.StageOff()));
                    script.Setup.Add(new Step(7.0));
                    script.Transition.Add(new Step(3.0, (e, w) =>
                    {
                        w.UndoStaging();
                        e.NoteSaveReloaded(null, savedUt: 3.0, save: Save);
                    }, currentFrom: true));
                    script.Transition.Add(new Step(4.0));
                    script.RestartsTheTimeline = true;
                    break;
                case Transition.Quickload:
                    script.Transition.Add(new Step(3.0, (e, _) => e.NoteSaveReloaded(null, savedUt: 3.0, save: Save), currentFrom: true));
                    script.Transition.Add(new Step(4.0));
                    script.RestartsTheTimeline = true;
                    break;
                case Transition.SaveChange:
                    script.Transition.Add(new Step(500.0, (e, _) =>
                    {
                        e.NoteSave("sweep-other");
                        e.NoteGameLoaded(null, savedUt: 500.0, save: "sweep-other");
                    }, currentFrom: true));
                    script.Transition.Add(new Step(501.0));
                    script.RestartsTheTimeline = true;
                    break;
                case Transition.LinkLossAndReturn:
                    script.Transition.Add(new Step(6.0, (_, w) => w.Connected = false));
                    script.Transition.Add(new Step(7.0));
                    script.Transition.Add(new Step(8.0, (_, w) => w.Connected = true, currentFrom: true));
                    script.Transition.Add(new Step(9.0));
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(transition), transition, null);
            }
            return script;
        }

        /// <summary>
        /// The game the sweep plays: an active craft, a fleet, one processor and one
        /// lens that ride the active craft until it stages them off, and the link
        /// every craft talks home over.
        /// </summary>
        private sealed class SweepWorld
        {
            private readonly object _gate = new object();
            private string _active = CraftA;
            private string _carrier = CraftA;
            private double? _activeDelay = 0.0;
            private bool _connected = true;
            private readonly List<string> _fleet = new List<string> { CraftA, CraftB };

            public double Ut { get; set; }

            public string Active
            {
                get { lock (_gate) { return _active; } }
                set { lock (_gate) { _active = value; } }
            }

            public double? ActiveDelay
            {
                get { lock (_gate) { return _activeDelay; } }
                set { lock (_gate) { _activeDelay = value; } }
            }

            public bool Connected
            {
                get { lock (_gate) { return _connected; } }
                set { lock (_gate) { _connected = value; } }
            }

            /// <summary>The craft the processor and the lens are on.</summary>
            public string Carrier
            {
                get { lock (_gate) { return _carrier; } }
            }

            public void StageOff()
            {
                lock (_gate)
                {
                    _fleet.Add(StagedOff);
                    _carrier = StagedOff;
                }
            }

            public void UndoStaging()
            {
                lock (_gate)
                {
                    _fleet.Remove(StagedOff);
                    _carrier = CraftA;
                }
            }

            public IReadOnlyList<string> Fleet()
            {
                lock (_gate)
                {
                    return _fleet.ToList();
                }
            }

            public KspSnapshot Snapshot()
            {
                lock (_gate)
                {
                    return new KspSnapshot
                    {
                        Ut = Ut,
                        Values = new Dictionary<string, object?>
                        {
                            ["vessel"] = new Dictionary<string, object?>
                            {
                                ["identity"] = new Dictionary<string, object?> { ["id"] = _active, ["name"] = _active },
                            },
                            ["delay"] = _activeDelay,
                            ["connected"] = _connected,
                        },
                    };
                }
            }
        }

        /// <summary>One channel to sweep: a static topic, or one topic under a dynamic namespace.</summary>
        private sealed class SweptChannel
        {
            public SweptChannel(ChannelDeclaration declaration, string? prefix)
            {
                Declaration = declaration;
                Prefix = prefix;
            }

            public ChannelDeclaration Declaration { get; }

            /// <summary>The namespace prefix, or null for a static topic.</summary>
            public string? Prefix { get; }

            /// <summary>The topic under the namespace the sweep publishes and subscribes, keyed by what the namespace routes on.</summary>
            public string SubTopic =>
                Declaration.PerLensNode ? LensKey + ".sweep"
                : Declaration.VesselIdForKey != null ? ProcessorKey + ".sweep"
                : Declaration.PerVesselNode ? CraftA + ".sweep"
                : "sweep";

            public string Topic => Prefix == null ? Declaration.Topic : Prefix + SubTopic;
        }

        private sealed class SweptChannels
        {
            public List<SweptChannel> Broadcast { get; } = new List<SweptChannel>();
            public List<SweptChannel> Addressed { get; } = new List<SweptChannel>();

            public static SweptChannels Discover()
            {
                using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
                foreach (var uplink in Bundled())
                {
                    engine.RegisterUplink(uplink);
                }
                engine.RegisterUplink(new RoutingKindsUplink());
                engine.Start();
                try
                {
                    var swept = new SweptChannels();
                    foreach (var (declaration, addressed) in engine.UplinkChannels())
                    {
                        (addressed ? swept.Addressed : swept.Broadcast).Add(new SweptChannel(declaration, null));
                    }
                    foreach (var (prefix, template) in engine.UplinkNamespaces())
                    {
                        swept.Broadcast.Add(new SweptChannel(template, prefix));
                    }
                    return swept;
                }
                finally
                {
                    engine.Stop();
                }
            }

            private static IEnumerable<ISitrepUplink> Bundled() => new ISitrepUplink[]
            {
                new TestSystemUplink(),
                new TestVesselUplink(),
                new TestCareerUplink(),
                new TestScienceUplink(),
                new TestPartsUplink(),
                new TestBreakingGroundUplink(),
                new FleetDelayTestUplink(),
                new CommcastUplink(),
            };
        }

        /// <summary>
        /// One channel of each way a topic can route: the active craft, a fleet
        /// craft by its own id, a processor key that resolves to the craft carrying
        /// it, a lens that stands where its craft is, and a conversation addressed
        /// to a command centre. Read for its declarations only: the sweep supplies
        /// every source and resolver.
        /// </summary>
        private sealed class RoutingKindsUplink : ISitrepUplink
        {
            public const string ActiveTopic = "sweep.active";
            public const string AddressedTopic = "sweep.addressed";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "sweep-routing-kinds",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration { Kind = SampleKind.Continuous, Topic = ActiveTopic, Emission = Rarely() },
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Discrete,
                        Topic = AddressedTopic,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = Rarely(),
                        Addressed = true,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(ActiveTopic, _ => null);
                ((IAddressedStreamHost)host).DeclareAddressedTopic(AddressedTopic);
                host.RegisterDynamicNamespace("sweep.fleet.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Emission = Rarely(),
                    PerVesselNode = true,
                });
                host.RegisterDynamicNamespace("sweep.cpu.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Emission = Rarely(),
                    PerVesselNode = true,
                    VesselIdForKey = _ => null,
                });
                host.RegisterDynamicNamespace("sweep.lens.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Emission = Rarely(),
                    PerLensNode = true,
                    LensSiteForKey = _ => null,
                });
            }

            private static EmissionPolicy Rarely() =>
                new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0));
        }

        /// <summary>
        /// Every swept declaration registered again, each source publishing the one
        /// fixed value every tick, each key resolved against the sweep's world, and
        /// every craft's link reported the way the fleet capture reports it.
        /// </summary>
        private sealed class MirrorUplink : ISitrepUplink
        {
            public const string Id = "sweep-mirror";

            private readonly IReadOnlyList<SweptChannel> _channels;
            private readonly SweepWorld _world;
            private readonly bool _addressed;
            private readonly List<(SweptChannel Channel, IDynamicChannelSource Source)> _namespaces =
                new List<(SweptChannel, IDynamicChannelSource)>();
            private IUplinkHost? _host;

            public MirrorUplink(IReadOnlyList<SweptChannel> channels, SweepWorld world, bool addressed)
            {
                _channels = channels;
                _world = world;
                _addressed = addressed;
                Manifest = new UplinkManifest
                {
                    Id = Id,
                    Version = "1.0.0",
                    Channels = channels.Where(c => c.Prefix == null).Select(c => c.Declaration).ToList(),
                };
            }

            public UplinkManifest Manifest { get; }

            public IEnumerable<string> Topics => _channels.Select(c => c.Topic);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            private static object Payload(SweptChannel channel) =>
                channel.Declaration.OpaquePayload ? OpaqueValue : new Dictionary<string, object?> { ["sweep"] = Value };

            public void Register(IUplinkHost host)
            {
                _host = host;
                foreach (var channel in _channels)
                {
                    if (channel.Prefix != null)
                    {
                        _namespaces.Add((channel, host.RegisterDynamicNamespace(channel.Prefix, Resolved(channel.Declaration))));
                        continue;
                    }
                    if (_addressed)
                    {
                        ((IAddressedStreamHost)host).DeclareAddressedTopic(channel.Topic);
                        continue;
                    }
                    host.AddChannelSource(channel.Topic, _ => Payload(channel));
                }
                host.SetSignalDelaySource(snapshot => new CommsDelay
                {
                    OneWaySeconds = snapshot?.Values["delay"] is double delay ? delay : (double?)null,
                    Source = CommsDelaySource.SignalDelay,
                });
                host.SetConnectivitySource(snapshot => snapshot?.Values["connected"] as bool?);
                host.AddSampledSource(snapshot => (snapshot?.Ut, _world.Fleet(), _world.Connected), Handle);
            }

            private void Handle(object? captured)
            {
                if (captured is not ValueTuple<double?, IReadOnlyList<string>, bool> tick || tick.Item1 is not double ut || _host == null)
                {
                    return;
                }
                var (_, fleet, connected) = tick;
                if (_addressed)
                {
                    foreach (var channel in _channels)
                    {
                        ((IAddressedStreamHost)_host).PublishAddressedTo(channel.Topic, Payload(channel), ut, new Dictionary<string, double> { [Centre] = 0 });
                    }
                    return;
                }
                foreach (var craft in fleet)
                {
                    _host.SetVesselDelay(craft, 0);
                    _host.SetVesselConnectivity(craft, connected);
                }
                foreach (var (channel, source) in _namespaces)
                {
                    source.Publisher(channel.SubTopic).Publish(Payload(channel), ut);
                }
            }

            /*
             * A resolver reads the state of the Uplink that declared it, which the
             * sweep does not drive, so each is replaced by one reading the sweep's
             * world. The rest of the declaration is the channel's own.
             */
            private ChannelDeclaration Resolved(ChannelDeclaration template)
            {
                var copy = new ChannelDeclaration { Kind = template.Kind };
                foreach (var property in typeof(ChannelDeclaration).GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (property.CanWrite)
                    {
                        property.SetValue(copy, property.GetValue(template));
                    }
                }
                if (template.VesselIdForKey != null)
                {
                    copy.VesselIdForKey = key => key == ProcessorKey ? _world.Carrier : null;
                }
                if (template.LensSiteForKey != null)
                {
                    copy.LensSiteForKey = key => key == LensKey ? "vessel:" + _world.Carrier : null;
                }
                return copy;
            }
        }

        private sealed class OneCentre : ICommandCentreSource
        {
            public string ProviderId => "sweep";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Ground();
            }

            private sealed class Ground : ICommandCentre
            {
                public string Id => Centre;
                public string DisplayName => Centre;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
