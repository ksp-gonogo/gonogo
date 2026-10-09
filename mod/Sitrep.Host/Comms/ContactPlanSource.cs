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
            string id, int bodyIndex, OrbitElements? orbit, RotatingGroundStation? surface, bool station, CommsNodeHandle? radio, string? displayName)
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
        public CommsNodeHandle? Radio { get; }

        /// <summary>The node's human-facing name: the craft's, or the ground station's as the roster shows it. Null when the game gives none.</summary>
        public string? DisplayName { get; }

        /// <summary>The craft's entry on <c>commandCentre.roster</c> while it is a command centre, or null.</summary>
        public CommandCentreEntry? Centre { get; set; }

        public static ContactGameNode OrbitingCraft(
            string id, int bodyIndex, OrbitElements orbit, CommsNodeHandle? radio = null, string? displayName = null) =>
            new ContactGameNode(id, bodyIndex, orbit, null, false, radio, displayName);

        public static ContactGameNode LandedCraft(
            string id, int bodyIndex, RotatingGroundStation surface, CommsNodeHandle? radio = null, string? displayName = null) =>
            new ContactGameNode(id, bodyIndex, null, surface, false, radio, displayName);

        public static ContactGameNode GroundStation(
            string id, int bodyIndex, RotatingGroundStation surface, CommsNodeHandle? radio = null, string? displayName = null) =>
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

        /// <summary>What the active craft's radio says of its own link now, or null when there is no active craft or no backend to ask.</summary>
        public ContactRadio? Radio { get; set; }

        /// <summary>Every command centre as the game has them now, or null for a game that keeps no roster.</summary>
        public IReadOnlyList<CommandCentreEntry>? Roster { get; set; }

        /// <summary>
        /// For each object the game's tracking can place, by node id, the
        /// straight-line light-time from it to each command centre, in seconds
        /// at the speed the game is set to model, by centre id. Null when
        /// nothing can be tracked by sight at all, which leaves every craft
        /// known by its radio alone.
        /// </summary>
        public IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? Sight { get; set; }

        /// <summary>
        /// Every vessel the game lists, by bare guid, whether or not it has a
        /// radio or can be planned for. Null from a game that cannot say,
        /// which leaves nothing judged to have gone by it.
        /// </summary>
        public IReadOnlyCollection<string>? Vessels { get; set; }

        /// <summary>
        /// Whether the game's vessel list could not be read on this look: it
        /// was still being filled, or the scene does not fill it. The look then
        /// holds the ground stations and the centres the game can still name,
        /// and no craft. That is not the craft having gone, so none is read,
        /// none is taken as gone and nothing is planned from such a look.
        /// </summary>
        public bool VesselsUnread { get; set; }
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

        /// <summary>Whether the save models a comms network at all: see <see cref="DeliveryInputs.NetworkModelled"/>.</summary>
        bool NetworkModelled();

        /// <summary>The light-time of the active craft's control route to the home centre as the game has it now, in seconds, or null while it has no route.</summary>
        double? ControlRouteSeconds();

        /// <summary>The light-time of the direct radio link between two nodes as the game has it now, in seconds, or null when they have none.</summary>
        double? LiveLinkSeconds(string from, string to);
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

        public const string TargetsTopic = "target.available";

        public const string RosterTopic = "commandCentre.roster";

        public const string UnreachableTopic = "commandCentre.unreachable";

        public const string SeparationTopic = "commandCentre.separation";

        public const string ActiveVesselDelayTopic = "commandCentre.activeVesselDelay";

        public const string DelayTopic = "comms.delay";

        public const string SignalTopic = "comms.signal";

        public const string DegradeTopic = "comms.degrade";

        private static readonly string[] PathTopics = { PathTopic, NetworkTopic, CommandCentreTopic, DelayTopic, SignalTopic, DegradeTopic };

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
                bool routesDue,
                ContactRadio? radio,
                IReadOnlyList<CommandCentreEntry>? roster,
                IReadOnlyList<object?>? targets,
                ICollection<string> inRange)
            {
                Radio = radio;
                Roster = roster;
                Targets = targets;
                InRange = inRange;
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

            /// <summary>Every vessel the game lists, by bare guid, or null where the game cannot say.</summary>
            public IReadOnlyCollection<string>? VesselsInGame { get; set; }

            /// <summary>Whether the game's vessel list could not be read on this look: see <see cref="ContactGameLook.VesselsUnread"/>.</summary>
            public bool VesselsUnread { get; set; }

            /// <summary>What the active craft's radio said on this look, or null.</summary>
            public ContactRadio? Radio { get; }

            /// <summary>Every command centre as the game had them on this look, or null.</summary>
            public IReadOnlyList<CommandCentreEntry>? Roster { get; }

            /// <summary>The game's own target list on this look, or null when the snapshot carried none.</summary>
            public IReadOnlyList<object?>? Targets { get; }

            /// <summary>The bare guids of the craft within physics range of the active one on this look.</summary>
            public ICollection<string> InRange { get; }

            public bool RoutesDue { get; }

            /// <summary>The comms backend's rule for what a whole path is worth from its hops, or null when it states none.</summary>
            public Func<IReadOnlyList<double>, double>? PathStrength { get; set; }
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

        /// <summary>The radio reading last recorded of each craft, so only a change is said.</summary>
        private readonly Dictionary<string, ContactRadio> _radioSaid = new Dictionary<string, ContactRadio>(StringComparer.Ordinal);

        /// <summary>The radio reading each centre was last sent its signal and grading from.</summary>
        private readonly Dictionary<string, ContactRadio> _radioSent = new Dictionary<string, ContactRadio>(StringComparer.Ordinal);

        /// <summary>The craft that was on screen on the last look, and whether the next reading of its radio is the first since it was put there.</summary>
        private string? _radioCraft;
        private bool _radioFirstLook;

        private readonly BelievedPaths _believed = new BelievedPaths();

        /// <summary>What each centre was last told of the signal and its grading, to the quantum a change is said at, and which kind of figure it was: measured on its path, worked out, or measured on another.</summary>
        private readonly Dictionary<string, (long Strength, SignalQuantity Quantity, int Kind, string? GradedBy, long? Grade, string? MeasuredOn)> _signalSent =
            new Dictionary<string, (long, SignalQuantity, int, string?, long?, string?)>(StringComparer.Ordinal);
        private readonly HashSet<string> _vesselsAsked = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _vesselsNews = new Dictionary<string, long>(StringComparer.Ordinal);
        private volatile bool _timelineReset;

        // What every centre has heard, for a save taken from another thread.
        private HeardSnapshot? _heardNow;
        private long _heardNowNews = -1;

        /// <summary>What a reset starts every centre knowing, held from the reset until the centres have been given it.</summary>
        private sealed class Restore
        {
            public Restore(HeardSnapshot? heard) => Heard = heard;

            /// <summary>What the loaded game carried, or null for nothing.</summary>
            public HeardSnapshot? Heard { get; }
        }

        /*
         * Written by the reset on the Courier thread and read by a save from
         * another. The centres are given it at the first look after the
         * reset, which waits for the game's vessel list to stand, and the
         * game saves in between: until then this, and not what was heard on
         * the timeline the load left, is what every centre knows.
         */
        private Restore? _restore;
        private int _plansVersion;

        /// <summary>Each centre's plan as it stood when the timeline last reset, until its next plan arrives.</summary>
        private Dictionary<string, ContactPlan> _plansBeforeReset = new Dictionary<string, ContactPlan>(StringComparer.Ordinal);

        /// <summary>How far a window edge may move between rounds and still be the same contact: the refinement of a crossing is not exact.</summary>
        private const double SameContactToleranceSeconds = 2.0;

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
            Addressed = true,
            Recordable = false,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>
        /// One of the three channels that describe the centres on a roster.
        /// Addressed: each centre is sent figures for its own roster, from its
        /// own plan. Never aboard anything, so nothing to replay.
        /// </summary>
        private static ChannelDeclaration RosterFigureChannel(string topic) => new ChannelDeclaration
        {
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.Delayed,
            Addressed = true,
            Recordable = false,
            Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>The channels, for the manifest of the Uplink that registers this.</summary>
        public static List<ChannelDeclaration> Channels() => new List<ChannelDeclaration>
        {
            PathChannel(PathTopic),
            PathChannel(NetworkTopic),
            PathChannel(CommandCentreTopic),
            PathChannel(DelayTopic),
            PathChannel(SignalTopic),
            PathChannel(DegradeTopic),
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = RosterTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed: each centre is sent the centres it knows of.
                Delay = DelayRole.Delayed,
                Addressed = true,
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
            },
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = TargetsTopic,
                Delivery = Delivery.LossyLatest,
                // The active craft's own list of what it knows of, so it is the
                // craft's telemetry: on its node, at its light-time, held
                // through its blackouts. Not addressed.
                Delay = DelayRole.Delayed,
                // The craft holds it, but it is put together here and not aboard, so there is no recording of it to replay.
                Recordable = false,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            },
            RosterFigureChannel(UnreachableTopic),
            RosterFigureChannel(SeparationTopic),
            RosterFigureChannel(ActiveVesselDelayTopic),
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = VesselsTopic,
                Delivery = Delivery.LossyLatest,
                // Addressed: each centre is sent the craft it has heard of, as it heard them.
                Delay = DelayRole.Delayed,
                Addressed = true,
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
                Addressed = true,
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
                Addressed = true,
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
            plans?.SetHeardStore(HeardNow, heard => System.Threading.Volatile.Write(ref _restore, new Restore(heard)));
            _streams.DeclareAddressedTopic(ContactsTopic);
            _streams.DeclareAddressedTopic(RouteTopic);
            // A plan is state, and an addressed sample is not kept for whoever
            // subscribes after it landed, so a session that has just sat down is
            // told its centre's current plan and routes again.
            _streams.OnAddressedSubscribed(ContactsTopic, centre => _unpublished.Add(centre));
            _streams.OnAddressedSubscribed(RouteTopic, centre => _routesAsked.Add(centre));
            _streams.DeclareAddressedTopic(RosterTopic);
            _streams.OnAddressedSubscribed(RosterTopic, centre => _rosterAsked.Add(centre));
            foreach (var topic in FigureTopics)
            {
                var asked = new HashSet<string>(StringComparer.Ordinal);
                _figuresAsked[topic] = asked;
                _streams.DeclareAddressedTopic(topic);
                _streams.OnAddressedSubscribed(topic, centre => asked.Add(centre));
            }
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

            if (look.VesselsUnread)
            {
                // No craft is read, so none can be recorded, missed or measured to.
                var none = new string[0];
                return new Looked(
                    snapshot.Ut,
                    new CraftStateRecorder.Batch(snapshot.Ut, none, new CraftState[0], none),
                    ground,
                    stations,
                    new List<string>(_game.Centres()),
                    null,
                    false,
                    null,
                    look.Roster,
                    null,
                    none)
                {
                    VesselsUnread = true,
                };
            }

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
                routesDue,
                look.Radio,
                look.Roster,
                SystemViewProvider.BuildTargetAvailable(snapshot) is IDictionary<string, object?> targets
                    && targets.TryGetValue("entries", out var listed)
                    ? listed as IReadOnlyList<object?>
                    : null,
                SystemViewProvider.TargetsInRange(snapshot))
            {
                PathStrength = CommsElection.PathStrength(_host.Kernel),
                VesselsInGame = look.Vessels,
            };
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
            var reset = _timelineReset;
            if (looked.VesselsUnread && !reset && !_unreadSinceReset)
            {
                // A scene that is loading, on the same timeline: every centre knows what it knew, and nothing is said until the craft can be read.
                return;
            }
            if (reset)
            {
                _timelineReset = false;
                _hearing.Reset();
                // A load starts every centre where the save left it, knowing what
                // it had heard by then and nothing that was still on its way.
                var carried = System.Threading.Volatile.Read(ref _restore)?.Heard;
                if (carried != null)
                {
                    _hearing.Restore(carried);
                }
                _heardNowNews = -1;
                _plansBeforeReset = new Dictionary<string, ContactPlan>(_plans, StringComparer.Ordinal);
                _plans.Clear();
                _planned.Clear();
                _unsettled.Clear();
                _pathShapes.Clear();
                _radioSaid.Clear();
                _radioCraft = null;
                _radioSent.Clear();
                _signalSent.Clear();
                _believed.Clear();
                _rosterSent.Clear();
                _said.Clear();
                _homeKnew.Clear();
                _homeLinkKnew.Clear();
                _homeRouteKnew.Clear();
                _seenNow.Clear();
                _knowledge.Clear();
                _rosterMemory.Clear();
                _unreachableSent.Clear();
                _vesselsNews.Clear();
                // The version does not move here: the first plan after the reset is judged against the
                // one it replaces, so a load that finds the same contacts is not a change to them.
                _offered = new Dictionary<string, Planned>(StringComparer.Ordinal);
                // A round still running was made of the old timeline; it is
                // taken and dropped when it finishes, by the FromUt check below.
            }

            var planning = _audience.PlanningCentres();
            var listening = new HashSet<string>(looked.Centres, StringComparer.Ordinal);
            listening.UnionWith(planning);
            if (looked.VesselsUnread)
            {
                SayWhatIsKnown(looked, planning, listening);
                return;
            }
            _unreadSinceReset = false;

            CraftStateRecorder.Record(looked.Craft, _craftHost);
            SayRadio(looked);
            _hearing.Listen(listening, looked.Craft.Known);
            if (looked.VesselsInGame != null && _hearing.ForgetGone(looked.VesselsInGame) > 0)
            {
                // What is kept for the next save no longer holds them.
                _heardNowNews = -1;
            }
            KeepHeardForSave(listening);
            // What is kept for a save is now what the centres were given back and have heard since.
            System.Threading.Volatile.Write(ref _restore, null);

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
            PublishRosters(looked, listening);
            PublishTargets(looked);
        }

        /// <summary>What each craft has said, by when it said it.</summary>
        private readonly SaidByWhen _said = new SaidByWhen();

        /// <summary>What the home centre knew of each craft, by when it came to know it.</summary>
        private readonly SaidByWhen _homeKnew = new SaidByWhen();

        /// <summary>Whether the home centre held each craft's link as up, by when it held it so.</summary>
        private readonly LinkByWhen _homeLinkKnew = new LinkByWhen();

        /// <summary>How long the home centre believed each craft's word would take to reach it, by when it believed so.</summary>
        private readonly RouteDelayByWhen _homeRouteKnew = new RouteDelayByWhen();

        /// <summary>The newest sighting of each object, as it stands in the game.</summary>
        private readonly Dictionary<string, CraftSighting> _seenNow = new Dictionary<string, CraftSighting>(StringComparer.Ordinal);

        /// <summary>What each craft that has been the active one knows of the others, by its node id.</summary>
        private readonly Dictionary<string, CraftKnowledge> _knowledge = new Dictionary<string, CraftKnowledge>(StringComparer.Ordinal);

        private IChannelPublisher? _targets;

        /// <summary>
        /// Works out what the active craft knows of every other, and publishes
        /// it as the craft's own <c>target.available</c>. The knowledge is kept
        /// whether or not anyone is watching, so a list first asked for after
        /// an hour out of contact is the hour-old one.
        /// </summary>
        private void PublishTargets(Looked looked)
        {
            foreach (var state in looked.Craft.States)
            {
                _said.Note(state.Id, looked.Ut, state);
            }
            foreach (var sighted in looked.Craft.Sightings)
            {
                _seenNow[sighted.Sighting.Id] = sighted.Sighting;
            }
            var home = _audience!.HomeCentre();
            if (home != null)
            {
                foreach (var state in _hearing!.HeardAt(home))
                {
                    _homeKnew.Note(state.Id, looked.Ut, state);
                    var up = _hearing.LinkAt(home, state.Id);
                    if (up != null)
                    {
                        _homeLinkKnew.Note(state.Id, looked.Ut, up.Value);
                    }
                }
                NoteHomeRoutes(looked, home);
            }
            var active = looked.ActiveCraft;
            if (active == null)
            {
                return;
            }
            if (!_knowledge.TryGetValue(active, out var knowledge))
            {
                knowledge = new CraftKnowledge();
                _knowledge[active] = knowledge;
            }

            var route = _audience.ControlRouteSeconds();
            var via = home == null ? null : NameAt(home, home) ?? home;
            var others = new HashSet<string>(_said.Ids, StringComparer.Ordinal);
            others.UnionWith(_homeKnew.Ids);
            others.UnionWith(_seenNow.Keys);
            foreach (var guid in looked.InRange)
            {
                others.Add(CraftStateRecorder.VesselPrefix + guid);
            }
            others.Remove(active);
            foreach (var id in others)
            {
                if (looked.InRange.Contains(CraftStateRecorder.GuidOf(id)))
                {
                    // Beside it, so seen as it is: what it last said and where it was last seen, which nothing has changed since.
                    _seenNow.TryGetValue(id, out var seen);
                    var asItIs = CraftSighting.Known(_said.AsOf(id, looked.Ut), seen);
                    if (asItIs != null)
                    {
                        knowledge.Learn(asItIs.Exists ? asItIs : CraftState.Gone(id, looked.Ut), looked.Ut, TargetKnowledge.InRange, null);
                    }
                    continue;
                }
                var link = _audience.LiveLinkSeconds(active, id);
                if (link != null && _said.AsOf(id, looked.Ut - link.Value) is CraftState said)
                {
                    knowledge.Learn(said, said.CapturedUt, TargetKnowledge.DirectLink, null);
                    // The link is up and that is still the newest it has carried: nothing has changed as late as its light-time ago.
                    knowledge.HeardNothingNewTo(id, said.CapturedUt, looked.Ut - link.Value);
                }
                if (route != null && home != null && _homeKnew.AsOf(id, looked.Ut - route.Value) is CraftState told)
                {
                    knowledge.Learn(told, told.CapturedUt, TargetKnowledge.CommandCentre, via);
                    // What home knew a control route's light-time ago is what the craft knows now, of the link as of everything else.
                    var homeKnewAt = looked.Ut - route.Value;
                    if (_homeLinkKnew.AsOf(id, homeKnewAt) == true)
                    {
                        // Home's silence from a craft whose link it held as up is word of no change, as late as a word could have left the craft and reached home by then.
                        var lastWord = Math.Max(0.0, (_homeKnew.NotedAt(id, homeKnewAt) ?? told.CapturedUt) - told.CapturedUt);
                        var unchangedTo = _homeRouteKnew.UnchangedTo(id, homeKnewAt, lastWord, CrossingSeconds(home, id, told, homeKnewAt));
                        if (unchangedTo != null)
                        {
                            knowledge.HeardNothingNewTo(id, told.CapturedUt, unchangedTo.Value, TargetKnowledge.CommandCentre);
                        }
                    }
                }
            }

            if (!looked.RoutesDue || !_host!.IsAnyTopicSubscribed(TargetsTopic))
            {
                return;
            }
            _targets ??= _host.Publisher(TargetsTopic);
            _targets.Publish(new Dictionary<string, object?> { ["entries"] = knowledge.Entries(looked.Targets, looked.InRange) }, looked.Ut);
        }

        /// <summary>
        /// Whether a load has been finished on a look that could read no craft,
        /// with no look that could since. While it is so, each centre is told
        /// its lists whenever a screen asks, from what it was given back.
        /// </summary>
        private bool _unreadSinceReset;

        /// <summary>
        /// COURIER THREAD: finishes a load into a scene whose vessel list cannot
        /// be read. Each centre has been given back what the loaded game
        /// carried, and is told its roster and its craft from that, as true as
        /// the save. No craft is recorded or missed, no radio is said, and no
        /// plan is made or kept: all of that waits for a look that can read
        /// the craft.
        ///
        /// <para>Without it a game loaded into such a scene, as an editor
        /// entered by reverting a flight is, left every centre told nothing for
        /// as long as the player stayed there, though each still knew what it
        /// knew.</para>
        /// </summary>
        private void SayWhatIsKnown(Looked looked, IReadOnlyCollection<string> planning, HashSet<string> listening)
        {
            _unreadSinceReset = true;
            _hearing!.Listen(listening, new string[0]);
            KeepHeardForSave(listening);
            // What is kept for a save is now what the centres were given back.
            System.Threading.Volatile.Write(ref _restore, null);
            NoteGround(looked);
            PublishVessels(looked, planning);
            PublishRosters(looked, listening);
        }

        /// <summary>
        /// Notes, each time routes are due, how long the home centre's own plan
        /// says a word leaving each craft it knows of now would take to reach
        /// the ground, or that the plan gives it no route.
        /// </summary>
        private void NoteHomeRoutes(Looked looked, string home)
        {
            if (!looked.RoutesDue || !_plans.TryGetValue(home, out var plan) || looked.Ut < plan.FromUt)
            {
                return;
            }
            var stations = StationIds();
            var lightFactor = _audience!.LightFactor();
            foreach (var state in _hearing!.HeardAt(home))
            {
                if (!state.Exists || !state.Plannable)
                {
                    continue;
                }
                var route = ContactRouter.EarliestArrivalAtAny(plan, state.Id, stations, looked.Ut, null, lightFactor);
                _homeRouteKnew.Note(state.Id, looked.Ut, route == null ? (double?)null : route.ArrivalUt - looked.Ut);
            }
        }

        /// <summary>
        /// The delay to go by for a craft's word to the home centre where that
        /// centre had believed nothing of the craft's route yet, in seconds:
        /// the larger of what home measured for the last word it had from the
        /// craft (when that word arrived, less when it was read) and the
        /// straight line home's own plan gives for the moment asked about.
        ///
        /// <para>Each falls short in one case the other covers. The measured
        /// time is as old as the word, so it is short for a craft that has
        /// moved away since; the planned line is short for a craft whose word
        /// reaches home through a relay. The larger of the two can only make
        /// the craft known unchanged to an earlier moment. The plan is used
        /// only while it was made of the same word the craft holds: one made of
        /// newer word is of an orbit the craft has not been told yet.</para>
        /// </summary>
        private double CrossingSeconds(string home, string id, CraftState told, double homeKnewAt)
        {
            var measured = Math.Max(0.0, (_homeKnew.NotedAt(id, homeKnewAt) ?? told.CapturedUt) - told.CapturedUt);
            if (!_plans.TryGetValue(home, out var plan))
            {
                return measured;
            }
            foreach (var state in _hearing!.HeardAt(home))
            {
                if (state.Id == id && state.CapturedUt != told.CapturedUt)
                {
                    return measured;
                }
            }
            foreach (var pair in plan.Pairs)
            {
                if ((pair.A == home && pair.B == id) || (pair.A == id && pair.B == home))
                {
                    var metres = pair.SeparationAt(homeKnewAt);
                    return metres == null
                        ? measured
                        : Math.Max(measured, metres.Value / PairPlan.SpeedOfLight * _audience!.LightFactor());
                }
            }
            return measured;
        }

        /// <summary>The roster each centre was last sent.</summary>
        private readonly Dictionary<string, List<CommandCentreEntry>> _rosterSent =
            new Dictionary<string, List<CommandCentreEntry>>(StringComparer.Ordinal);

        private readonly HashSet<string> _rosterAsked = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>What has been on each centre's own roster, and left it.</summary>
        private readonly Dictionary<string, RosterMemory> _rosterMemory = new Dictionary<string, RosterMemory>(StringComparer.Ordinal);

        /// <summary>The ids each centre was last told have left its roster, joined.</summary>
        private readonly Dictionary<string, string> _unreachableSent = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>The centres with a session that has just subscribed to each of the three figure topics.</summary>
        private readonly Dictionary<string, HashSet<string>> _figuresAsked = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        private static readonly string[] FigureTopics = { UnreachableTopic, SeparationTopic, ActiveVesselDelayTopic };

        /// <summary>
        /// Sends each centre the centres it knows of, which of them have left,
        /// how far apart they are and how far each is from the active craft.
        /// The roster and what has left it go when they change, the two sets
        /// of light-times once a second, and all four at once where a session
        /// has just sat down. What has left is remembered whether or not
        /// anyone is watching, so a centre's last time on a roster does not
        /// depend on who was subscribed when it went.
        /// </summary>
        private void PublishRosters(Looked looked, IReadOnlyCollection<string> centres)
        {
            if (looked.Roster == null)
            {
                _rosterAsked.Clear();
                foreach (var asked in _figuresAsked.Values)
                {
                    asked.Clear();
                }
                return;
            }
            var home = _audience!.HomeCentre();
            var lightFactor = _audience.LightFactor();
            IReadOnlyCollection<string>? stations = null;
            foreach (var centre in centres)
            {
                var roster = CentreRoster.For(centre, looked.Roster, _hearing!.HeardAt(centre));
                if (!_rosterMemory.TryGetValue(centre, out var memory))
                {
                    memory = new RosterMemory();
                    _rosterMemory[centre] = memory;
                }
                memory.Observe(roster, looked.Ut);
                var to = ToItself(centre);

                var changed = !_rosterSent.TryGetValue(centre, out var sent) || !CentreRoster.Same(sent, roster);
                if (_host!.IsAnyTopicSubscribed(RosterTopic) && (changed || _rosterAsked.Contains(centre)))
                {
                    _rosterSent[centre] = roster;
                    _streams!.PublishAddressedTo(RosterTopic, roster, looked.Ut, to);
                }

                if (_host.IsAnyTopicSubscribed(UnreachableTopic))
                {
                    var gone = memory.Unreachable();
                    var ids = string.Join("\u0001", gone.ConvertAll(entry => entry.Id));
                    if (_figuresAsked[UnreachableTopic].Contains(centre) || !_unreachableSent.TryGetValue(centre, out var told) || told != ids)
                    {
                        _unreachableSent[centre] = ids;
                        _streams!.PublishAddressedTo(UnreachableTopic, gone, looked.Ut, to);
                    }
                }

                var separationDue = _host.IsAnyTopicSubscribed(SeparationTopic) && (looked.RoutesDue || _figuresAsked[SeparationTopic].Contains(centre));
                var delaysDue = _host.IsAnyTopicSubscribed(ActiveVesselDelayTopic) && (looked.RoutesDue || _figuresAsked[ActiveVesselDelayTopic].Contains(centre));
                if (!separationDue && !delaysDue)
                {
                    continue;
                }
                _plans.TryGetValue(centre, out var plan);
                if (plan != null && looked.Ut < plan.FromUt)
                {
                    plan = null;
                }
                stations ??= StationIds();
                if (separationDue)
                {
                    _streams!.PublishAddressedTo(
                        SeparationTopic, CentreFigures.Separation(roster, plan, home, stations, looked.Ut, lightFactor), looked.Ut, to);
                }
                if (delaysDue)
                {
                    _streams!.PublishAddressedTo(
                        ActiveVesselDelayTopic,
                        CentreFigures.ActiveVesselDelays(roster, plan, looked.ActiveCraft, home, stations, looked.Ut, lightFactor),
                        looked.Ut,
                        to);
                }
            }
            _rosterAsked.Clear();
            foreach (var asked in _figuresAsked.Values)
            {
                asked.Clear();
            }
        }

        /// <summary>Keeps a copy of what every centre has heard whenever any of it changes, so a save on the main thread reads a whole one.</summary>
        private void KeepHeardForSave(IReadOnlyCollection<string> centres)
        {
            long news = centres.Count;
            foreach (var centre in centres)
            {
                news += _hearing!.NewsAt(centre) + _hearing.ReadingsAt(centre);
            }
            if (news == _heardNowNews)
            {
                return;
            }
            _heardNowNews = news;
            System.Threading.Volatile.Write(ref _heardNow, _hearing!.Snapshot());
        }

        /// <summary>What every centre has heard, for saving with the game. Any thread.</summary>
        public HeardSnapshot? HeardNow()
        {
            var restore = System.Threading.Volatile.Read(ref _restore);
            return restore != null
                ? restore.Heard ?? new HeardSnapshot(new HeardAtCentre[0])
                : System.Threading.Volatile.Read(ref _heardNow);
        }

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
                // Only a plan that predicts different contacts is a change a held
                // message needs to hear of: a round that finds the same windows
                // further on leaves what was excluded after a catch excluded.
                // After a reset the first plan of a centre is judged against the one it replaced,
                // so a load that finds the same contacts changes nothing a held message was excluded under.
                if (!_plans.TryGetValue(entry.Key, out var before) && _plansBeforeReset.TryGetValue(entry.Key, out var beforeReset))
                {
                    before = beforeReset;
                }
                _plansBeforeReset.Remove(entry.Key);
                var changed = before == null || !before.SameContactsAs(entry.Value, SameContactToleranceSeconds);
                _plans[entry.Key] = entry.Value;
                _planned[entry.Key] = from;
                _unsettled[entry.Key] = from.Request.Unsettled;
                _unpublished.Add(entry.Key);
                if (changed)
                {
                    System.Threading.Interlocked.Increment(ref _plansVersion);
                }
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
                    _radioSent.Remove(centre);
                    _signalSent.Remove(centre);
                    _believed.Forget(centre);
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
                var routes = ContactRouting.RoutesFor(
                    plan, looked.ActiveCraft, new[] { centre }, looked.Ut, _audience!.LightFactor(), _audience.HomeCentre(), StationIds());
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
            var modelled = _audience.NetworkModelled();
            var source = looked.ActiveCraft ?? "game";
            foreach (var centre in planning)
            {
                var radio = looked.ActiveCraft == null ? null : _hearing!.RadioAt(centre, looked.ActiveCraft);
                var radioNews = radio != null && (!_radioSent.TryGetValue(centre, out var sent) || !ReferenceEquals(sent, radio));
                if (radio != null)
                {
                    _radioSent[centre] = radio;
                }
                _plans.TryGetValue(centre, out var plan);
                if (plan != null && looked.Ut < plan.FromUt)
                {
                    plan = null;
                }
                // A delay that is switched off, or a save with no network to cross, is a setting and not a distance: it needs no plan to state.
                var measured = modelled && lightFactor > 0.0;
                if (!measured && _host!.IsAnyTopicSubscribed(DelayTopic) && (looked.RoutesDue || _pathsAsked[DelayTopic].Contains(centre)))
                {
                    _streams!.PublishAddressedTo(DelayTopic, CentreDelay.NotMeasured(modelled, source), looked.Ut, ToItself(centre));
                    frames++;
                }
                if (plan == null && looked.ActiveCraft != null)
                {
                    // Between one plan and the next the centre believes what it last believed.
                    frames += PublishSignal(looked, centre, _believed.Of(centre, looked.ActiveCraft), radio);
                    continue;
                }
                var asked = false;
                foreach (var topic in PathTopics)
                {
                    asked |= _pathsAsked[topic].Contains(centre);
                }
                if (!looked.RoutesDue && !asked && !radioNews)
                {
                    continue;
                }

                var heard = _hearing!.HeardAt(centre);
                var view = CentrePath.For(
                    plan,
                    looked.ActiveCraft,
                    centre,
                    centre == home,
                    _stations,
                    id => NameOf(heard, id),
                    looked.Ut,
                    lightFactor,
                    PathStrengths.For(heard, looked.PathStrength));
                WithHeardFacts(view.Path, radio);
                if (looked.ActiveCraft != null)
                {
                    _believed.Keep(centre, looked.ActiveCraft, view);
                }
                frames += PublishSignal(looked, centre, view, radio);
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
                // The light-time of the very path the centre was just sent, so the two never disagree.
                if (measured && _host.IsAnyTopicSubscribed(DelayTopic) && (reshaped || view.Path.Hops.Count > 0 || _pathsAsked[DelayTopic].Contains(centre)))
                {
                    _streams!.PublishAddressedTo(DelayTopic, CentreDelay.Over(view.Path, lightFactor, source), looked.Ut, to);
                    frames++;
                }
            }
            foreach (var asked in _pathsAsked.Values)
            {
                asked.Clear();
            }
            PathFramesBudget.Record(frames, looked.Ut);
        }

        /// <summary>
        /// Gives each hop of a centre's path the facts the craft's radio
        /// measured of it, where the newest reading to have reached that
        /// centre was taken over the same hop. A hop the centre believes in
        /// and has heard no reading of keeps what the backend worked out for
        /// it, or nothing where the backend states nothing.
        /// </summary>
        internal static void WithHeardFacts(CommsPath path, ContactRadio? radio)
        {
            if (radio == null)
            {
                return;
            }
            foreach (var hop in path.Hops)
            {
                foreach (var read in radio.Hops)
                {
                    if (read.Extensions != null && read.From == hop.From && read.To == hop.To)
                    {
                        hop.Extensions = read.Extensions;
                    }
                }
            }
        }

        /// <summary>Every ground station's id, as the plans name them.</summary>
        private IReadOnlyCollection<string> StationIds()
        {
            var ids = new List<string>(_stations.Count);
            foreach (var station in _stations)
            {
                ids.Add(station.Id);
            }
            return ids;
        }

        /// <summary>Records what the active craft's radio said on this look, when it says something new.</summary>
        private void SayRadio(Looked looked)
        {
            if (_radioCraft != looked.ActiveCraft)
            {
                // Another craft is on screen now, or this is the first look of a timeline.
                // What was said of it before is of another stay on screen, and the next reading is the first of this one.
                _radioCraft = looked.ActiveCraft;
                if (looked.ActiveCraft != null)
                {
                    _radioSaid.Remove(looked.ActiveCraft);
                }
                _radioFirstLook = true;
            }
            var radio = looked.Radio;
            if (radio == null)
            {
                return;
            }
            var firstLook = _radioFirstLook;
            _radioFirstLook = false;
            if (firstLook && !radio.Connected)
            {
                // The game takes a moment to bring a radio up when a craft is put on screen. One look with no link is that, and not a link lost: if the next look still has none, it is said then.
                return;
            }
            if (_radioSaid.TryGetValue(radio.CraftId, out var said) && radio.SaysTheSameAs(said))
            {
                return;
            }
            radio.CapturedUt = looked.Ut;
            _radioSaid[radio.CraftId] = radio;
            _craftHost!.RecordCraftRadio(CraftStateRecorder.GuidOf(radio.CraftId), radio, looked.Ut);
        }

        /// <summary>
        /// Sends <paramref name="centre"/> the strength and grading of the
        /// active craft's link as that centre has it: the radio's own report
        /// where it is of the path the centre believes in, and what the
        /// backend works out for that path where it is not. Where the report
        /// is of another path and nothing can be worked out, the report is
        /// sent marked as being of another path. Sent when either
        /// moves by <see cref="ContactRadio.Quantum"/> or changes kind, and at
        /// once where a session has just sat down. A centre with nothing heard
        /// and nothing to work out is sent nothing. Returns how many frames it
        /// sent.
        /// </summary>
        /// <param name="view">The centre's believed path, or null when it has no plan.</param>
        /// <param name="radio">The newest reading of the craft's radio to have reached the centre, or null.</param>
        private int PublishSignal(Looked looked, string centre, CentrePathView? view, ContactRadio? radio)
        {
            if (looked.ActiveCraft == null)
            {
                return 0;
            }
            var told = CentreSignal.For(view?.Path ?? new CommsPath(), view?.Strength, radio);
            if (told == null)
            {
                return 0;
            }
            var degrade = told.Value.Degrade;
            var measuredPath = told.Value.MeasuredOver == null ? null : MeasuredPath(centre, looked.ActiveCraft, told.Value.MeasuredOver);
            var said = (
                Quanta(told.Value.Strength),
                told.Value.Quantity,
                told.Value.Modelled ? 1 : told.Value.OtherPath ? 2 : 0,
                degrade?.ModelId,
                degrade?.Level == null ? (long?)null : Quanta(degrade.Level.Value),
                measuredPath == null ? null : ShapeOf(measuredPath));
            var news = !_signalSent.TryGetValue(centre, out var was) || !was.Equals(said);
            _signalSent[centre] = said;
            var to = ToItself(centre);
            var frames = 0;
            if (_host!.IsAnyTopicSubscribed(SignalTopic) && (news || _pathsAsked[SignalTopic].Contains(centre)))
            {
                _streams!.PublishAddressedTo(
                    SignalTopic,
                    new CommsSignal
                    {
                        Strength = told.Value.Strength,
                        Quantity = told.Value.Quantity,
                        Modelled = told.Value.Modelled,
                        OtherPath = told.Value.OtherPath,
                        MeasuredPath = measuredPath,
                    },
                    looked.Ut,
                    to);
                frames++;
            }
            if (degrade != null && _host.IsAnyTopicSubscribed(DegradeTopic) && (news || _pathsAsked[DegradeTopic].Contains(centre)))
            {
                _streams!.PublishAddressedTo(DegradeTopic, degrade, looked.Ut, to);
                frames++;
            }
            return frames;
        }

        private static long Quanta(double value) => (long)Math.Round(value / ContactRadio.Quantum);

        /// <summary>
        /// The path a radio reading was measured over, as <paramref name="centre"/>
        /// is sent it: the craft and then the far end of each of the reading's
        /// own hops, with each craft named as that centre last heard it named.
        /// Nothing is read of the game or of the centre's believed path, so it
        /// is exactly as old as the reading.
        /// </summary>
        private CommsMeasuredPath MeasuredPath(string centre, string activeCraft, IReadOnlyList<RadioHop> measuredOver)
        {
            var craftId = CraftStateRecorder.GuidOf(activeCraft);
            var nodes = new List<CommsNetworkNode>(measuredOver.Count + 1)
            {
                new CommsNetworkNode { Id = craftId, DisplayName = NameAt(centre, activeCraft) ?? craftId, Kind = CommsHopKind.Relay },
            };
            foreach (var hop in measuredOver)
            {
                var station = !hop.ToIsCraft;
                nodes.Add(new CommsNetworkNode
                {
                    Id = hop.To,
                    DisplayName = station ? hop.To : NameAt(centre, CraftStateRecorder.VesselPrefix + hop.To) ?? hop.To,
                    Kind = station ? CommsHopKind.Home : CommsHopKind.Relay,
                });
            }
            return new CommsMeasuredPath { Nodes = nodes };
        }

        /// <summary>A measured path's ends and names as one string, so a change of either is seen as news.</summary>
        private static string ShapeOf(CommsMeasuredPath path)
        {
            var shape = new System.Text.StringBuilder();
            foreach (var node in path.Nodes)
            {
                shape.Append(node.Id).Append('\u0001').Append(node.DisplayName).Append('\u0001');
            }
            return shape.ToString();
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
