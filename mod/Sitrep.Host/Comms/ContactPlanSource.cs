using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Commcast;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// One place that can hold a link, as the game shows it at one instant: a
    /// craft on its orbit, a craft standing on a surface, or a ground station.
    /// </summary>
    public sealed class ContactGameNode
    {
        private ContactGameNode(
            string id, int bodyIndex, OrbitElements? orbit, RotatingGroundStation? surface, bool station, object? radio, string? displayName)
        {
            DisplayName = displayName;
            Id = id;
            BodyIndex = bodyIndex;
            Orbit = orbit;
            Surface = surface;
            Station = station;
            Radio = radio;
        }

        /// <summary>The node's id, in the <c>commandCentre.roster</c> vocabulary.</summary>
        public string Id { get; }

        /// <summary>The body the node orbits, or stands on.</summary>
        public int BodyIndex { get; }

        /// <summary>The node's orbit, or null for one fixed to a surface.</summary>
        public OrbitElements? Orbit { get; }

        /// <summary>The node's place on its body, for one fixed to the surface.</summary>
        public RotatingGroundStation? Surface { get; }

        /// <summary>Whether the node is a ground station rather than a craft. Two stations are never planned against each other.</summary>
        public bool Station { get; }

        /// <summary>The node as the comms backend knows it, handed back to the backend's reach and link models and never read here.</summary>
        public object? Radio { get; }

        /// <summary>The node's human-facing name: the craft's, or the ground station's as the roster shows it. Null when the game gives none.</summary>
        public string? DisplayName { get; }

        public static ContactGameNode OrbitingCraft(
            string id, int bodyIndex, OrbitElements orbit, object? radio = null, string? displayName = null) =>
            new ContactGameNode(id, bodyIndex, orbit, null, false, radio, displayName);

        public static ContactGameNode LandedCraft(
            string id, int bodyIndex, RotatingGroundStation surface, object? radio = null, string? displayName = null) =>
            new ContactGameNode(id, bodyIndex, null, surface, false, radio, displayName);

        public static ContactGameNode GroundStation(
            string id, int bodyIndex, RotatingGroundStation surface, object? radio = null, string? displayName = null) =>
            new ContactGameNode(id, bodyIndex, null, surface, true, radio, displayName);
    }

    /// <summary>Everything a contact plan needs of the game, read at one instant on the main thread.</summary>
    public sealed class ContactGameLook
    {
        public ContactGameLook(
            IReadOnlyList<ContactGameNode> nodes,
            IReadOnlyList<SystemBody> bodies,
            int frameBodyIndex,
            Func<ICommsOcclusionModel, int, double> occludingRadius)
        {
            Nodes = nodes;
            Bodies = bodies;
            FrameBodyIndex = frameBodyIndex;
            OccludingRadius = occludingRadius;
        }

        public IReadOnlyList<ContactGameNode> Nodes { get; }

        /// <summary>The body table positions are solved over.</summary>
        public IReadOnlyList<SystemBody> Bodies { get; }

        /// <summary>The body whose frame the plan is solved in.</summary>
        public int FrameBodyIndex { get; }

        /// <summary>How large a body is as an occluder under a backend's occlusion model, in metres, or zero for an index that names no body.</summary>
        public Func<ICommsOcclusionModel, int, double> OccludingRadius { get; }
    }

    /// <summary>The game a contact plan is made of. Asked on the main thread only.</summary>
    public interface IContactGame
    {
        /// <summary>The nodes and bodies as they stand, or null while there is no game to plan for.</summary>
        ContactGameLook? Look();

        /// <summary>The active command centres' ids.</summary>
        IReadOnlyList<string> Centres();
    }

    /// <summary>Who a contact plan is made for. Any thread.</summary>
    public interface IPlanAudienceHost
    {
        /// <summary>The centres a plan is kept for: the home centre always, and every centre a session is sitting at.</summary>
        IReadOnlyCollection<string> PlanningCentres();

        /// <summary>The home centre's id, or null while there is none.</summary>
        string? HomeCentre();

        /// <summary>What a real light time is multiplied by to get the delay the game is set to model: see <see cref="DeliveryInputs.LightFactor"/>.</summary>
        double LightFactor();
    }

    /// <summary>
    /// Publishes <c>comms.contacts</c> and <c>comms.route</c>: for each command
    /// centre, the windows over the coming hours when it believes a link will
    /// hold between each ground station and craft it knows of, and its
    /// earliest-arrival route to and from the active craft over them.
    ///
    /// <para>A centre's plan is made only of what that centre has heard. The
    /// main thread reads each craft's <see cref="CraftState"/> when it changes
    /// and it is recorded on the craft's own node; <see cref="CentreHearing"/>
    /// receives it at each centre one light-time later; and
    /// <see cref="ReckonedPlan"/> reckons every craft a centre has heard of
    /// forward from the orbit it last reported. So nothing a craft does moves
    /// a centre's plan until the news has reached that centre.</para>
    ///
    /// <para>Each plan and each centre's routes are published to that centre
    /// alone, zero seconds after they are made: the light-time was spent by
    /// the craft states on their way in. No other centre is ever sent them,
    /// and they are on no craft's node, so a centre keeps planning while the
    /// active craft is out of contact.</para>
    ///
    /// <para>It publishes <c>comms.path</c>, <c>comms.network</c> and
    /// <c>comms.commandCentre</c> the same way: the active craft's path as each
    /// centre's own plan has it (see <see cref="CentrePath"/>), to that centre
    /// alone.</para>
    ///
    /// <para>And <c>system.vessels</c>: every craft a centre has heard of, as it
    /// last heard it, to that centre alone. A craft's entry is the one read
    /// with its state, so its orbit, its situation and its crew are as old as
    /// the light that brought them, and whether its radio answers is what the
    /// centre has heard of its link. A craft the centre has not heard of is not
    /// listed. A craft with no radio is listed as the ground saw it when it
    /// first appeared, and never again.</para>
    ///
    /// <para>A centre is planned for again when news reaches it, when the
    /// ground stations change, and when half its plan's horizon has passed.
    /// The plans run off both threads, on a stock analytic propagator over a
    /// snapshot of the body table, because one takes tens of milliseconds for
    /// a busy save.</para>
    /// </summary>
    public sealed class ContactPlanSource
    {
        public const string ContactsTopic = "comms.contacts";

        public const string RouteTopic = "comms.route";

        public const string PathTopic = "comms.path";

        public const string NetworkTopic = "comms.network";

        public const string CommandCentreTopic = "comms.commandCentre";

        public const string VesselsTopic = SystemViewProvider.VesselsTopic;

        private static readonly string[] PathTopics = { PathTopic, NetworkTopic, CommandCentreTopic };

        /// <summary>
        /// Soft cap on contact plans started per second of game time. A centre is
        /// planned for when news reaches it or half its horizon has passed, so a
        /// steady save starts one per centre every few hours and a burn one per
        /// centre every few seconds. Sustained above this, plans are being made
        /// on noise rather than on news.
        /// </summary>
        private static readonly PerfBudget PlansStartedBudget = new PerfBudget(
            "ContactPlanUplink plans started", threshold: 20, windowSec: 1.0, unit: "plans");

        /// <summary>
        /// The least wall time between two looks at the game. Reading every
        /// craft's orbit is cheap but not free, and nothing about a contact
        /// plan needs to notice a change within half a second.
        /// </summary>
        public const float LookIntervalSeconds = 0.5f;

        /// <summary>
        /// The least wall time between two route publishes. A route is re-planned
        /// for the current send instant every time, so it moves continuously; once
        /// a second is as fine as anyone reads an arrival time.
        /// </summary>
        public const float RouteIntervalSeconds = 1.0f;

        /// <summary>
        /// Soft cap on route rows published per second: two per command centre,
        /// once a second, so a save with twenty centres sits at forty.
        /// </summary>
        private static readonly PerfBudget RouteRowsBudget = new PerfBudget(
            "ContactPlanUplink route rows", threshold: 400, windowSec: 1.0, unit: "rows");

        /// <summary>
        /// Soft cap on path frames published per second: a path, and a network
        /// and a terminus when they change, per command centre, once a second.
        /// </summary>
        private static readonly PerfBudget PathFramesBudget = new PerfBudget(
            "ContactPlanUplink path frames", threshold: 600, windowSec: 1.0, unit: "frames");

        /// <summary>What one centre's current plan was made from.</summary>
        private sealed class Planned
        {
            public Planned(long news, int ground, double fromUt, ContactPlanRequest request)
            {
                News = news;
                Ground = ground;
                FromUt = fromUt;
                Request = request;
            }

            /// <summary>The centre's news count when the plan was asked for, or when later news was last found to change nothing.</summary>
            public long News { get; set; }

            public int Ground { get; }

            public double FromUt { get; }

            public ContactPlanRequest Request { get; }
        }

        /// <summary>What the main thread read of the game on one look.</summary>
        private sealed class Looked
        {
            public Looked(
                double ut,
                CraftStateRecorder.Batch craft,
                PlanGround ground,
                IReadOnlyList<ContactGameNode> stations,
                IReadOnlyList<string> centres,
                string? activeCraft,
                bool routesDue)
            {
                Ut = ut;
                Craft = craft;
                Ground = ground;
                Stations = stations;
                Centres = centres;
                ActiveCraft = activeCraft;
                RoutesDue = routesDue;
            }

            public double Ut { get; }

            public CraftStateRecorder.Batch Craft { get; }

            public PlanGround Ground { get; }

            public IReadOnlyList<ContactGameNode> Stations { get; }

            public IReadOnlyList<string> Centres { get; }

            public string? ActiveCraft { get; }

            public bool RoutesDue { get; }
        }

        private readonly IContactGame _game;
        private readonly Func<float> _wallSeconds;
        private readonly Action<string> _warn;
        private readonly bool _planInline;
        private readonly ContactPlanRunner _runner = new ContactPlanRunner();
        private readonly CraftStateRecorder _craft = new CraftStateRecorder();
        private IUplinkHost? _host;
        private ICraftStateHost? _craftHost;
        private IPlanAudienceHost? _audience;
        private IAddressedStreamHost? _streams;
        private volatile string? _lastFailure;

        // Main-thread pacing.
        private float _lookedAt = float.NegativeInfinity;
        private float _routedAt = float.NegativeInfinity;

        // Courier-thread state from here down.
        private CentreHearing? _hearing;
        private readonly Dictionary<string, ContactPlan> _plans = new Dictionary<string, ContactPlan>(StringComparer.Ordinal);
        private readonly Dictionary<string, Planned> _planned = new Dictionary<string, Planned>(StringComparer.Ordinal);
        private Dictionary<string, Planned> _offered = new Dictionary<string, Planned>(StringComparer.Ordinal);
        private IReadOnlyList<ContactGameNode> _stations = new ContactGameNode[0];
        private PlanGround? _ground;
        private int _groundVersion;
        private readonly Dictionary<string, IReadOnlyCollection<string>> _unsettled = new Dictionary<string, IReadOnlyCollection<string>>(StringComparer.Ordinal);
        private readonly HashSet<string> _unpublished = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> _routesAsked = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<string>> _pathsAsked = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _pathShapes = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly HashSet<string> _vesselsAsked = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _vesselsNews = new Dictionary<string, long>(StringComparer.Ordinal);
        private volatile bool _timelineReset;

        // What every centre has heard, for a save taken from another thread, and
        // what a loaded save carried, waiting for the reset that load starts.
        private HeardSnapshot? _heardNow;
        private long _heardNowNews = -1;
        private HeardSnapshot? _heardLoaded;
        private HeardSnapshot? _heardReloaded;
        private int _plansVersion;

        /// <param name="game">The game the plan is made of.</param>
        /// <param name="wallSeconds">Wall time in seconds, for pacing how often the game is looked at.</param>
        /// <param name="warn">Where a plan that threw is reported.</param>
        /// <param name="planInline">Run each round of plans on the Courier thread instead of a pool thread, so the tick that starts one also publishes it. For a scripted game, where which tick a plan lands on has to be the same every run.</param>
        public ContactPlanSource(IContactGame game, Func<float> wallSeconds, Action<string>? warn = null, bool planInline = false)
        {
            _game = game;
            _wallSeconds = wallSeconds;
            _warn = warn ?? (_ => { });
            _planInline = planInline;
        }

        /// <summary>Degraded while the most recent round of plans threw, naming what it threw; the next round that finishes clears it.</summary>
        public UplinkHealth Health()
        {
            var failure = _lastFailure;
            return failure == null
                ? UplinkHealth.Healthy
                : UplinkHealth.Degraded("the last contact plan failed: " + failure);
        }

        /// <summary>
        /// One of the three path channels. Addressed: each centre is sent the
        /// path its own plan has and no other's. Never aboard anything, so there
        /// is nothing to replay on reacquisition.
        /// </summary>
        private static ChannelDeclaration PathChannel(string topic) => new ChannelDeclaration
        {
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.Delayed,
            Recordable = false,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>The five channels, for the manifest of the Uplink that registers this.</summary>
        public static List<ChannelDeclaration> Channels() => new List<ChannelDeclaration>
        {
            PathChannel(PathTopic),
            PathChannel(NetworkTopic),
            PathChannel(CommandCentreTopic),
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = VesselsTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed: each centre is sent the craft it has heard of, as it heard them.
                Delay = DelayRole.Delayed,
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            },
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = ContactsTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed: each centre is sent its own plan and no other's.
                Delay = DelayRole.Delayed,
                // Never aboard anything, so nothing to replay on reacquisition.
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
            },
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = RouteTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed: each centre is sent its own routes and no other's.
                Delay = DelayRole.Delayed,
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
            },
        };

        /// <summary>The plan <paramref name="centre"/> currently holds, or null. Courier thread only.</summary>
        public ContactPlan? PlanOf(string centre) => _plans.TryGetValue(centre, out var plan) ? plan : null;

        public void Register(IUplinkHost host)
        {
            _host = host;
            _craftHost = host as ICraftStateHost;
            _audience = host as IPlanAudienceHost;
            _streams = host as IAddressedStreamHost;
            if (_craftHost == null || _audience == null || _streams == null)
            {
                _warn("this host carries no craft states or no addressed streams, so no contact plan can be made");
                return;
            }
            var plans = host as ICentrePlanHost;
            plans?.SetCentrePlans(PlanOf, () => System.Threading.Volatile.Read(ref _plansVersion));
            plans?.SetNodeNames(NameAt);
            plans?.SetHeardStore(HeardNow, NoteHeardLoaded, NoteHeardReloaded);
            _streams.DeclareAddressedTopic(ContactsTopic);
            _streams.DeclareAddressedTopic(RouteTopic);
            // A plan is state, and an addressed sample is not kept for whoever
            // subscribes after it landed, so a session that has just sat down is
            // told its centre's current plan and routes again.
            _streams.OnAddressedSubscribed(ContactsTopic, centre => _unpublished.Add(centre));
            _streams.OnAddressedSubscribed(RouteTopic, centre => _routesAsked.Add(centre));
            _streams.DeclareAddressedTopic(VesselsTopic);
            _streams.OnAddressedSubscribed(VesselsTopic, centre => _vesselsAsked.Add(centre));
            foreach (var topic in PathTopics)
            {
                var asked = new HashSet<string>(StringComparer.Ordinal);
                _pathsAsked[topic] = asked;
                _streams.DeclareAddressedTopic(topic);
                _streams.OnAddressedSubscribed(topic, centre => asked.Add(centre));
            }
            _hearing = new CentreHearing(_craftHost, plans == null ? (Action<string, string>?)null : plans.NoteHeard);
            _craftHost.OnTimelineReset(() =>
            {
                _craft.ReadAllAgain();
                _timelineReset = true;
            });
            // Ungated: a centre can only plan from what it has heard, so a craft's
            // state has to be on record, and on its way, before anyone asks for a
            // plan of it.
            host.AddSampledSource(LookOnMain, PlanOnCourier);
        }

        /// <summary>MAIN THREAD: reads the craft whose state is out of date, the ground stations, and who is planning.</summary>
        internal object? LookOnMain(KspSnapshot? snapshot)
        {
            if (snapshot == null || _host == null || _craftHost == null)
            {
                return null;
            }
            var wall = _wallSeconds();
            if (wall - _lookedAt < LookIntervalSeconds)
            {
                return null;
            }
            var look = _game.Look();
            if (look == null)
            {
                return null;
            }
            _lookedAt = wall;

            var stations = new List<ContactGameNode>();
            var stationNodes = new List<PlanNode>();
            foreach (var node in look.Nodes)
            {
                if (node.Station && node.Surface != null)
                {
                    stations.Add(node);
                    stationNodes.Add(PlanNode.OnSurface(node.Id, node.BodyIndex, node.Surface.Value));
                }
            }
            // The radii are read here because the game's bodies may only be read
            // on this thread; the plan is handed numbers.
            var occlusion = CommsElection.OcclusionModel(_host.Kernel);
            var radii = new double[look.Bodies.Count];
            for (var i = 0; i < radii.Length; i++)
            {
                radii[i] = look.OccludingRadius(occlusion, i);
            }
            var ground = new PlanGround(
                stationNodes, look.Bodies, look.FrameBodyIndex, index => index >= 0 && index < radii.Length ? radii[index] : 0.0);

            var routesDue = wall - _routedAt >= RouteIntervalSeconds;
            if (routesDue)
            {
                _routedAt = wall;
            }
            var active = VesselViewProvider.TryGetActiveVesselId(snapshot);
            return new Looked(
                snapshot.Ut,
                _craft.Capture(look, snapshot.Ut, _host.Kernel, RosterOf(snapshot)),
                ground,
                stations,
                new List<string>(_game.Centres()),
                string.IsNullOrEmpty(active) ? null : CraftStateRecorder.VesselPrefix + active,
                routesDue);
        }

        /// <summary>
        /// COURIER THREAD: records what was read, listens at every centre,
        /// publishes the round of plans that finished, and starts the next for
        /// each centre whose plan is out of date.
        /// </summary>
        internal void PlanOnCourier(object? captured)
        {
            if (!(captured is Looked looked) || _craftHost == null || _hearing == null || _audience == null || _host == null)
            {
                return;
            }
            if (_timelineReset)
            {
                _timelineReset = false;
                _hearing.Reset();
                // A load starts every centre where the save left it, knowing what
                // it had heard by then and nothing that was still on its way.
                var carried = System.Threading.Interlocked.Exchange(ref _heardLoaded, null)
                    ?? System.Threading.Interlocked.Exchange(ref _heardReloaded, null);
                if (carried != null)
                {
                    _hearing.Restore(carried);
                }
                _heardNowNews = -1;
                _plans.Clear();
                _planned.Clear();
                _unsettled.Clear();
                _pathShapes.Clear();
                _vesselsNews.Clear();
                System.Threading.Interlocked.Increment(ref _plansVersion);
                _offered = new Dictionary<string, Planned>(StringComparer.Ordinal);
                // A round still running was made of the old timeline; it is
                // taken and dropped when it finishes, by the FromUt check below.
            }

            CraftStateRecorder.Record(looked.Craft, _craftHost);

            var planning = _audience.PlanningCentres();
            var listening = new HashSet<string>(looked.Centres, StringComparer.Ordinal);
            listening.UnionWith(planning);
            _hearing.Listen(listening, looked.Craft.Known);
            KeepHeardForSave(listening);

            NoteGround(looked);
            TakeFinished(looked.Ut);
            Forget(planning);
            StartDue(planning, looked.Ut);
            if (_planInline)
            {
                TakeFinished(looked.Ut);
            }
            PublishPlans(looked.Ut);
            PublishRoutes(looked, planning);
            PublishPaths(looked, planning);
            PublishVessels(looked, planning);
        }

        /// <summary>Keeps a copy of what every centre has heard whenever any of it changes, so a save on the main thread reads a whole one.</summary>
        private void KeepHeardForSave(IReadOnlyCollection<string> centres)
        {
            long news = centres.Count;
            foreach (var centre in centres)
            {
                news += _hearing!.NewsAt(centre);
            }
            if (news == _heardNowNews)
            {
                return;
            }
            _heardNowNews = news;
            System.Threading.Volatile.Write(ref _heardNow, _hearing!.Snapshot());
        }

        /// <summary>
        /// What every centre has heard, for saving with the game. While a loaded
        /// game's own snapshot waits for the tick that restores it, that is what
        /// the game holds. Any thread.
        /// </summary>
        public HeardSnapshot? HeardNow() =>
            System.Threading.Volatile.Read(ref _heardLoaded) ?? System.Threading.Volatile.Read(ref _heardNow);

        /// <summary>A game was loaded carrying <paramref name="heard"/>: the timeline reset that load starts restores it. Any thread.</summary>
        public void NoteHeardLoaded(HeardSnapshot? heard)
        {
            System.Threading.Volatile.Write(ref _heardReloaded, null);
            System.Threading.Volatile.Write(ref _heardLoaded, heard ?? new HeardSnapshot(new HeardAtCentre[0]));
        }

        /// <summary>The game loaded this process's own latest save, which starts no new timeline. Should a rewind start one anyway, it restores what that save held. Any thread.</summary>
        public void NoteHeardReloaded(HeardSnapshot? heard) => System.Threading.Volatile.Write(ref _heardReloaded, heard);

        /// <summary>MAIN THREAD: each craft's <c>system.vessels</c> entry as the game shows it now, by node id, or null when the game lists no craft at all.</summary>
        private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>>? RosterOf(KspSnapshot snapshot)
        {
            if (!(SystemViewProvider.BuildSystemVessels(snapshot) is IDictionary<string, object?> built)
                || !built.TryGetValue("vessels", out var list)
                || !(list is IEnumerable<object?> entries))
            {
                return null;
            }
            var roster = new Dictionary<string, IReadOnlyDictionary<string, object?>>(StringComparer.Ordinal);
            foreach (var entry in entries)
            {
                if (entry is Dictionary<string, object?> listed && listed.TryGetValue("vesselId", out var id) && id is string vesselId)
                {
                    roster[CraftStateRecorder.VesselPrefix + vesselId] = listed;
                }
            }
            return roster;
        }

        /// <summary>
        /// Sends each planning centre the craft it has heard of, as it heard
        /// them: when news has reached it since it was last sent the list, and
        /// at once where a session has just sat down.
        /// </summary>
        private void PublishVessels(Looked looked, IReadOnlyCollection<string> planning)
        {
            if (!_host!.IsAnyTopicSubscribed(VesselsTopic))
            {
                _vesselsAsked.Clear();
                _vesselsNews.Clear();
                return;
            }
            var sent = 0;
            foreach (var centre in planning)
            {
                var news = _hearing!.NewsAt(centre);
                if (!_vesselsAsked.Contains(centre) && _vesselsNews.TryGetValue(centre, out var told) && told == news)
                {
                    continue;
                }
                _vesselsNews[centre] = news;
                var heard = new List<CraftState>(_hearing.HeardAt(centre));
                heard.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));
                var vessels = new List<object?>(heard.Count);
                foreach (var state in heard)
                {
                    if (!state.Exists || state.Roster == null)
                    {
                        continue;
                    }
                    var entry = new Dictionary<string, object?>(state.Roster.Count);
                    foreach (var fact in state.Roster)
                    {
                        entry[fact.Key] = fact.Value;
                    }
                    // A craft cannot say its own radio has stopped answering. The
                    // centre learns that from the silence, one light-time on.
                    var link = _hearing.LinkAt(centre, state.Id);
                    if (link != null)
                    {
                        entry["commsConnected"] = link.Value;
                    }
                    vessels.Add(entry);
                }
                _streams!.PublishAddressedTo(
                    VesselsTopic, new Dictionary<string, object?> { ["vessels"] = vessels }, looked.Ut, ToItself(centre));
                sent++;
            }
            _vesselsAsked.Clear();
            PathFramesBudget.Record(sent, looked.Ut);
        }

        /// <summary>Keeps the ground the next plans are made over, and counts each time the stations or the bodies' sizes change.</summary>
        private void NoteGround(Looked looked)
        {
            if (_ground == null || !SameGround(_ground, _stations, looked.Ground, looked.Stations))
            {
                _groundVersion++;
            }
            _ground = looked.Ground;
            _stations = looked.Stations;
        }

        private static bool SameGround(
            PlanGround was, IReadOnlyList<ContactGameNode> wasStations, PlanGround now, IReadOnlyList<ContactGameNode> nowStations)
        {
            if (was.Bodies.Count != now.Bodies.Count || was.FrameBodyIndex != now.FrameBodyIndex || wasStations.Count != nowStations.Count)
            {
                return false;
            }
            for (var i = 0; i < now.Bodies.Count; i++)
            {
                if (was.OccludingRadius(i) != now.OccludingRadius(i))
                {
                    return false;
                }
            }
            for (var i = 0; i < nowStations.Count; i++)
            {
                var a = wasStations[i];
                var b = nowStations[i];
                if (a.Id != b.Id
                    || a.BodyIndex != b.BodyIndex
                    || (a.Surface!.Value.PositionAt(0.0) - b.Surface!.Value.PositionAt(0.0)).Magnitude() > ContactPlanSchedule.SurfaceToleranceMeters)
                {
                    return false;
                }
            }
            return true;
        }

        private void TakeFinished(double ut)
        {
            if (!_runner.TryTake(out var finished) || finished == null)
            {
                return;
            }
            _lastFailure = null;
            foreach (var entry in finished)
            {
                // A plan from after this instant belongs to a timeline the game
                // has left, by a revert or a load; the next round replaces it.
                if (!_offered.TryGetValue(entry.Key, out var from) || entry.Value.FromUt > ut)
                {
                    continue;
                }
                _plans[entry.Key] = entry.Value;
                _planned[entry.Key] = from;
                _unsettled[entry.Key] = from.Request.Unsettled;
                _unpublished.Add(entry.Key);
                System.Threading.Interlocked.Increment(ref _plansVersion);
            }
        }

        /// <summary>Drops the plan of a centre nobody is planning for any more.</summary>
        private void Forget(IReadOnlyCollection<string> planning)
        {
            foreach (var centre in new List<string>(_plans.Keys))
            {
                if (!Has(planning, centre))
                {
                    _plans.Remove(centre);
                    _planned.Remove(centre);
                    _unsettled.Remove(centre);
                    _pathShapes.Remove(centre);
                    System.Threading.Interlocked.Increment(ref _plansVersion);
                }
            }
        }

        private void StartDue(IReadOnlyCollection<string> planning, double ut)
        {
            if (_runner.Running || _ground == null || _hearing == null)
            {
                return;
            }
            var requests = new Dictionary<string, ContactPlanRequest>(StringComparer.Ordinal);
            var offered = new Dictionary<string, Planned>(StringComparer.Ordinal);
            foreach (var centre in planning)
            {
                var request = Due(centre, ut);
                if (request == null)
                {
                    continue;
                }
                requests[centre] = request;
                offered[centre] = new Planned(_hearing.NewsAt(centre), _groundVersion, ut, request);
            }
            if (requests.Count == 0)
            {
                return;
            }

            _offered = offered;
            if (_runner.Offer(requests, _hearing.EverythingHeard(), Failed, _planInline))
            {
                PlansStartedBudget.Record(requests.Count, ut);
            }
        }

        /// <summary>
        /// The plan to make for <paramref name="centre"/> now, or null while the
        /// one it has still stands. It is planned for when it has no plan, when
        /// the clock went back, when half its horizon has passed, when the ground
        /// changed, and when news has reached it that changes what would be
        /// planned: at once for a craft arriving or leaving, and once the drift
        /// interval has passed for one whose orbit moved.
        ///
        /// <para>News that changes nothing starts no plan, so a craft read again
        /// with the same orbit and the same links is not something a centre's
        /// screen can see happen.</para>
        /// </summary>
        private ContactPlanRequest? Due(string centre, double ut)
        {
            var heard = _hearing!.HeardAt(centre);
            if (!_planned.TryGetValue(centre, out var planned)
                || ut < planned.FromUt
                || ut >= planned.FromUt + (ContactPlanSchedule.HorizonSeconds / 2.0)
                || planned.Ground != _groundVersion)
            {
                return ReckonedPlan.Request(heard, _ground!, ut, ContactPlanSchedule.HorizonSeconds);
            }
            var news = _hearing.NewsAt(centre);
            if (planned.News == news)
            {
                return null;
            }
            var request = ReckonedPlan.Request(heard, _ground!, ut, ContactPlanSchedule.HorizonSeconds);
            if (request.Matches(planned.Request))
            {
                planned.News = news;
                return null;
            }
            return request.Nodes.Count != planned.Request.Nodes.Count || ut >= planned.FromUt + ContactPlanSchedule.MinDriftReplanSeconds
                ? request
                : null;
        }

        /// <summary>
        /// A round that threw is forgotten, so the next look plans again rather
        /// than waiting out half a horizon on plans that never published.
        /// </summary>
        private void Failed(Exception ex)
        {
            _lastFailure = ex.GetType().Name + ": " + ex.Message;
            _warn("contact plan failed: " + ex);
        }

        /// <summary>Sends each centre whose plan has changed, or where a session has just sat down, its own plan.</summary>
        private void PublishPlans(double ut)
        {
            foreach (var centre in _unpublished)
            {
                if (_plans.TryGetValue(centre, out var plan))
                {
                    _unsettled.TryGetValue(centre, out var unsettled);
                    _streams!.PublishAddressedTo(ContactsTopic, ContactPlanWire.ToPayload(plan, unsettled), ut, ToItself(centre));
                }
            }
            _unpublished.Clear();
        }

        /// <summary>
        /// Plans each centre's routes for now from that centre's own plan, and
        /// sends them to it: every planning centre once a second, and at once a
        /// centre where a session has just sat down.
        /// </summary>
        private void PublishRoutes(Looked looked, IReadOnlyCollection<string> planning)
        {
            if (looked.ActiveCraft == null || !_host!.IsAnyTopicSubscribed(RouteTopic))
            {
                _routesAsked.Clear();
                return;
            }
            var rows = 0;
            foreach (var centre in planning)
            {
                if (!looked.RoutesDue && !_routesAsked.Contains(centre))
                {
                    continue;
                }
                if (!_plans.TryGetValue(centre, out var plan) || looked.Ut < plan.FromUt)
                {
                    continue;
                }
                var routes = ContactRouting.RoutesFor(plan, looked.ActiveCraft, new[] { centre }, looked.Ut, _audience!.LightFactor());
                rows += routes.Routes.Count;
                _streams!.PublishAddressedTo(RouteTopic, routes, looked.Ut, ToItself(centre));
            }
            _routesAsked.Clear();
            RouteRowsBudget.Record(rows, looked.Ut);
        }

        /// <summary>
        /// Sends each planning centre the active craft's path as its own plan has
        /// it: every centre once a second, and at once a centre where a session
        /// has just sat down. The hop lengths move with the craft, so the path is
        /// sent each time; the network and the terminus are sent when the path
        /// names different nodes, and to a session that has just sat down.
        ///
        /// <para>A centre with no plan yet is sent nothing while there is a craft
        /// to have a path: it has no belief to state, which is not the same as
        /// believing there is no path.</para>
        /// </summary>
        private void PublishPaths(Looked looked, IReadOnlyCollection<string> planning)
        {
            var frames = 0;
            var home = _audience!.HomeCentre();
            var lightFactor = _audience.LightFactor();
            foreach (var centre in planning)
            {
                _plans.TryGetValue(centre, out var plan);
                if (plan != null && looked.Ut < plan.FromUt)
                {
                    plan = null;
                }
                if (plan == null && looked.ActiveCraft != null)
                {
                    continue;
                }
                var asked = false;
                foreach (var topic in PathTopics)
                {
                    asked |= _pathsAsked[topic].Contains(centre);
                }
                if (!looked.RoutesDue && !asked)
                {
                    continue;
                }

                var heard = _hearing!.HeardAt(centre);
                var view = CentrePath.For(
                    plan, looked.ActiveCraft, centre, centre == home, _stations, id => NameOf(heard, id), looked.Ut, lightFactor);
                var reshaped = !_pathShapes.TryGetValue(centre, out var shape) || shape != view.Shape;
                _pathShapes[centre] = view.Shape;
                var to = ToItself(centre);
                if (_host!.IsAnyTopicSubscribed(PathTopic) && (reshaped || view.Path.Hops.Count > 0 || _pathsAsked[PathTopic].Contains(centre)))
                {
                    _streams!.PublishAddressedTo(PathTopic, view.Path, looked.Ut, to);
                    frames++;
                }
                if (_host.IsAnyTopicSubscribed(NetworkTopic) && (reshaped || _pathsAsked[NetworkTopic].Contains(centre)))
                {
                    _streams!.PublishAddressedTo(NetworkTopic, view.Network, looked.Ut, to);
                    frames++;
                }
                if (_host.IsAnyTopicSubscribed(CommandCentreTopic) && (reshaped || _pathsAsked[CommandCentreTopic].Contains(centre)))
                {
                    _streams!.PublishAddressedTo(CommandCentreTopic, view.CommandCentre, looked.Ut, to);
                    frames++;
                }
            }
            foreach (var asked in _pathsAsked.Values)
            {
                asked.Clear();
            }
            PathFramesBudget.Record(frames, looked.Ut);
        }

        /// <summary>The name <paramref name="centre"/> knows <paramref name="nodeId"/> by: a ground station's own, or a craft's as the centre last heard it. Courier thread only.</summary>
        private string? NameAt(string centre, string nodeId)
        {
            foreach (var station in _stations)
            {
                if (station.Id == nodeId)
                {
                    return station.DisplayName;
                }
            }
            return _hearing == null ? null : NameOf(_hearing.HeardAt(centre), nodeId);
        }

        private static string? NameOf(IReadOnlyCollection<CraftState> heard, string nodeId)
        {
            foreach (var state in heard)
            {
                if (state.Id == nodeId)
                {
                    return state.Name;
                }
            }
            return null;
        }

        /// <summary>An audience of one centre, reached at once: what a centre reckons is no distance from it.</summary>
        private static IReadOnlyDictionary<string, double> ToItself(string centre) =>
            new Dictionary<string, double>(StringComparer.Ordinal) { [centre] = 0.0 };

        private static bool Has(IReadOnlyCollection<string> centres, string centre)
        {
            foreach (var candidate in centres)
            {
                if (candidate == centre)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
