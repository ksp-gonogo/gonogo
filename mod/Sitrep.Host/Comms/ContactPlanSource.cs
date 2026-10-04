using System;
using System.Collections.Generic;
using Sitrep.Contract;
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
            string id, int bodyIndex, OrbitElements? orbit, RotatingGroundStation? surface, bool station, object? radio)
        {
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

        public static ContactGameNode OrbitingCraft(string id, int bodyIndex, OrbitElements orbit, object? radio = null) =>
            new ContactGameNode(id, bodyIndex, orbit, null, false, radio);

        public static ContactGameNode LandedCraft(string id, int bodyIndex, RotatingGroundStation surface, object? radio = null) =>
            new ContactGameNode(id, bodyIndex, null, surface, false, radio);

        public static ContactGameNode GroundStation(string id, int bodyIndex, RotatingGroundStation surface, object? radio = null) =>
            new ContactGameNode(id, bodyIndex, null, surface, true, radio);
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

    /// <summary>
    /// Publishes <c>comms.contacts</c> and <c>comms.route</c>: for every ground
    /// station and craft that could hold a link, the windows over the coming
    /// hours when one is predicted, and each command centre's earliest-arrival
    /// route to and from the active craft over them.
    ///
    /// <para>The main thread captures the nodes, their orbits and each pair's
    /// occluders and reach, but only when the schedule says the last plan is
    /// out of date. The plan itself runs off both threads, on a stock analytic
    /// propagator over a snapshot of the body table, because it takes tens of
    /// milliseconds for a busy save. A provider that integrates still bounds
    /// each craft's prediction, through the horizon it reports for it, and a
    /// craft whose horizon it cannot state is left out of the plan rather than
    /// trusted for all of it. Where the elected provider offers a secular seed
    /// for a craft, the plan carries the craft's drift with it instead.</para>
    /// </summary>
    public sealed class ContactPlanSource
    {
        public const string ContactsTopic = "comms.contacts";

        public const string RouteTopic = "comms.route";

        /// <summary>
        /// Soft cap on contact plans started per second of game time. A plan is
        /// made when an orbit moves, a node comes or goes, or half the horizon
        /// has passed, so a steady save starts one every few hours and a burn
        /// one every few seconds. Sustained above this, the schedule is
        /// re-planning on noise rather than on change.
        /// </summary>
        private static readonly PerfBudget PlansStartedBudget = new PerfBudget(
            "ContactPlanUplink plans started", threshold: 2, windowSec: 1.0, unit: "plans");

        /// <summary>
        /// The least wall time between two looks at whether a plan is due. Reading
        /// every craft's orbit is cheap but not free, and nothing about a contact
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

        private readonly IContactGame _game;
        private readonly Func<float> _wallSeconds;
        private readonly Action<string> _warn;
        private readonly bool _planInline;
        private readonly ContactPlanSchedule _schedule = new ContactPlanSchedule();
        private readonly ContactPlanRunner _runner = new ContactPlanRunner();
        private IUplinkHost? _host;
        private IChannelPublisher? _publisher;
        private IChannelPublisher? _routePublisher;
        private volatile ContactPlan? _plan;
        private float _routedAt = float.NegativeInfinity;
        private float _lookedAt = float.NegativeInfinity;
        private volatile string? _lastFailure;

        /// <param name="game">The game the plan is made of.</param>
        /// <param name="wallSeconds">Wall time in seconds, for pacing how often the game is looked at.</param>
        /// <param name="warn">Where a plan that threw is reported.</param>
        /// <param name="planInline">Run each plan on the capturing thread instead of a pool thread, so a tick that starts one also publishes it. For a scripted game, where which tick a plan lands on has to be the same every run.</param>
        public ContactPlanSource(IContactGame game, Func<float> wallSeconds, Action<string>? warn = null, bool planInline = false)
        {
            _game = game;
            _wallSeconds = wallSeconds;
            _warn = warn ?? (_ => { });
            _planInline = planInline;
        }

        /// <summary>Degraded while the most recent plan threw, naming what it threw; the next plan that finishes clears it.</summary>
        public UplinkHealth Health()
        {
            var failure = _lastFailure;
            return failure == null
                ? UplinkHealth.Healthy
                : UplinkHealth.Degraded("the last contact plan failed: " + failure);
        }

        /// <summary>The two channels, for the manifest of the Uplink that registers this.</summary>
        public static List<ChannelDeclaration> Channels() => new List<ChannelDeclaration>
        {
            new ChannelDeclaration
            {
                Requires = Requirement.None,
                Topic = ContactsTopic,
                Delivery = Delivery.LossyLatest,
                // Made on the ground from every node's orbit, so each centre
                // receives it one of its own light-times later.
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
                // Planned from comms.contacts, so it reaches each centre on the same delay.
                Delay = DelayRole.Delayed,
                Recordable = false,
                // Each centre's routes say where it can reach, which another
                // centre has no way to know.
                ViewerFilter = ContactRouting.ForViewer,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
            },
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _publisher = host.Publisher(ContactsTopic);
            _routePublisher = host.Publisher(RouteTopic);
            // The plan runs for either topic, since routes are read off it.
            host.AddSampledSource(CaptureOnMain, PublishOnCourier, ContactsTopic, RouteTopic);
            host.AddSampledSource(CaptureRouteInputsOnMain, PublishRoutesOnCourier, RouteTopic);
        }

        /// <summary>MAIN THREAD: who the routes are between and when, at most once a second.</summary>
        internal object? CaptureRouteInputsOnMain(KspSnapshot? snapshot)
        {
            var wall = _wallSeconds();
            if (snapshot == null || wall - _routedAt < RouteIntervalSeconds)
            {
                return null;
            }
            var active = VesselViewProvider.TryGetActiveVesselId(snapshot);
            if (string.IsNullOrEmpty(active))
            {
                return null;
            }
            _routedAt = wall;
            return new RouteInputs("vessel:" + active, new List<string>(_game.Centres()), snapshot.Ut);
        }

        /// <summary>COURIER THREAD: plans each centre's routes for now from the latest contact plan and publishes them.</summary>
        internal void PublishRoutesOnCourier(object? captured)
        {
            var plan = _plan;
            // A plan made after this instant belongs to a timeline the game has
            // left, by a revert or a load; the next plan replaces it.
            if (!(captured is RouteInputs inputs) || plan == null || inputs.Ut < plan.FromUt)
            {
                return;
            }
            var routes = ContactRouting.RoutesFor(plan, inputs.ActiveCraft, inputs.Centres, inputs.Ut);
            RouteRowsBudget.Record(routes.Routes.Count, inputs.Ut);
            _routePublisher?.Publish(routes, inputs.Ut);
        }

        private sealed class RouteInputs
        {
            public RouteInputs(string activeCraft, IReadOnlyList<string> centres, double ut)
            {
                ActiveCraft = activeCraft;
                Centres = centres;
                Ut = ut;
            }

            public string ActiveCraft { get; }

            public IReadOnlyList<string> Centres { get; }

            public double Ut { get; }
        }

        /// <summary>MAIN THREAD: starts a plan when the last one is out of date. Starting one costs a pool thread, not this one.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (snapshot == null || _host == null || _runner.Running)
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

            var ut = snapshot.Ut;
            var kernel = _host.Kernel;
            var nodes = new List<PlanNode>();
            var orbiting = new List<PropagationTarget>();
            var fingerprint = new List<ContactNodeFingerprint>();
            var radios = new Dictionary<string, object?>(StringComparer.Ordinal);
            var stations = new HashSet<string>(StringComparer.Ordinal);

            foreach (var node in look.Nodes)
            {
                if (node.Surface == null && node.Orbit == null)
                {
                    continue;
                }
                radios[node.Id] = node.Radio;
                if (node.Station)
                {
                    stations.Add(node.Id);
                }
                if (node.Surface != null)
                {
                    nodes.Add(PlanNode.OnSurface(node.Id, node.BodyIndex, node.Surface.Value));
                    fingerprint.Add(new ContactNodeFingerprint(node.Id, node.BodyIndex, null, node.Surface.Value));
                    continue;
                }
                orbiting.Add(PropagationTarget.Vessel(node.Id, node.BodyIndex, node.Orbit!.Value));
                fingerprint.Add(new ContactNodeFingerprint(node.Id, node.BodyIndex, node.Orbit.Value));
            }

            if (!_schedule.Due(fingerprint, ut))
            {
                return null;
            }
            // A craft with a secular seed is bounded by the seed's own span, not by
            // the conic's horizon, which bounds the very drift the seed carries.
            var secular = PropagationElection.Secular(kernel);
            foreach (var target in orbiting)
            {
                var seed = ContactSeeds.Read(secular, target, ut);
                if (seed != null)
                {
                    nodes.Add(PlanNode.Drifting(target.Id!, target, seed.Value));
                    continue;
                }
                var horizon = PropagationElection.HorizonFor(kernel, target, ut);
                if (horizon.Kind == PropagationHorizonKind.Unspecified)
                {
                    continue;
                }
                nodes.Add(PlanNode.Orbiting(
                    target.Id!, target, horizon.Kind == PropagationHorizonKind.Until ? horizon.UntilUt : null));
            }

            var occlusion = CommsElection.OcclusionModel(kernel);
            Func<int, double> radiusOf = index => look.OccludingRadius(occlusion, index);
            var pairs = new List<PlanPair>();
            for (var i = 0; i < nodes.Count; i++)
            {
                for (var j = i + 1; j < nodes.Count; j++)
                {
                    var a = nodes[i];
                    var b = nodes[j];
                    if (stations.Contains(a.Id) && stations.Contains(b.Id))
                    {
                        continue;
                    }
                    var occluders = Occluders(a.BodyIndex, b.BodyIndex, look.Bodies, radiusOf);
                    if (occluders == null)
                    {
                        continue;
                    }
                    var reach = CommsElection.ReachModel(kernel, radios[a.Id], radios[b.Id]).MaxRangeMeters;
                    var link = CommsElection.LinkModel(kernel, radios[a.Id], radios[b.Id], ut);
                    pairs.Add(new PlanPair(a.Id, b.Id, occluders, reach, link));
                }
            }

            var request = new ContactPlanRequest(
                nodes,
                pairs,
                new KeplerProvider(look.Bodies),
                look.FrameBodyIndex,
                ut,
                ContactPlanSchedule.HorizonSeconds,
                fingerprint);
            if (_runner.Offer(request, Failed, _planInline))
            {
                _schedule.Planned(request);
                PlansStartedBudget.Record(1, ut);
            }
            return null;
        }

        /// <summary>
        /// A plan that threw is forgotten, so the next look plans again rather than
        /// waiting out half a horizon on a plan that never published.
        /// </summary>
        private void Failed(Exception ex)
        {
            _schedule.Forget();
            _lastFailure = ex.GetType().Name + ": " + ex.Message;
            _warn("contact plan failed: " + ex);
        }

        /// <summary>COURIER THREAD: publishes whichever plan has finished since the last tick.</summary>
        internal void PublishOnCourier(object? captured)
        {
            if (_runner.TryTake(out var plan) && plan != null)
            {
                _lastFailure = null;
                _plan = plan;
                _publisher?.Publish(ContactPlanWire.ToPayload(plan), plan.FromUt);
            }
        }

        /// <summary>
        /// The bodies that can come between the two ends: the patched-conic chain
        /// between their bodies, plus each end's own body, which the chain leaves
        /// out and which is the commonest occluder of all. Null when no path joins
        /// the two bodies.
        /// </summary>
        private static List<OccludingBody>? Occluders(
            int aBody, int bBody, IReadOnlyList<SystemBody> table, Func<int, double> radiusOf)
        {
            var chain = PatchedConicChain.OccludersBetween(aBody, bBody, table, radiusOf);
            if (chain == null)
            {
                return null;
            }
            var seen = new HashSet<int>();
            var occluders = new List<OccludingBody>();
            foreach (var body in new[] { new OccludingBody(aBody, radiusOf(aBody)), new OccludingBody(bBody, radiusOf(bBody)) })
            {
                if (seen.Add(body.BodyIndex))
                {
                    occluders.Add(body);
                }
            }
            foreach (var body in chain)
            {
                if (seen.Add(body.BodyIndex))
                {
                    occluders.Add(body);
                }
            }
            return occluders;
        }
    }
}
