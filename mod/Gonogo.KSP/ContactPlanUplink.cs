using System;
using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Publishes <c>comms.contacts</c>: for every ground station and craft that
    /// could hold a link, the windows over the coming hours when one is
    /// predicted.
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
    public sealed class ContactPlanUplink : ISitrepUplink
    {
        public const string ContactsTopic = "comms.contacts";

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
        private const float LookIntervalSeconds = 0.5f;

        private readonly CommandCentreRegistry _centres;
        private readonly ContactPlanSchedule _schedule = new ContactPlanSchedule();
        private readonly ContactPlanRunner _runner = new ContactPlanRunner();
        private IUplinkHost? _host;
        private IChannelPublisher? _publisher;
        private KspVisibilityGeometryFactory? _surface;
        private float _lookedAt = float.NegativeInfinity;
        private volatile string? _lastFailure;

        /// <param name="centres">The registry the ground stations' ids come from, so the plan names them as the roster does.</param>
        public ContactPlanUplink(CommandCentreRegistry centres)
        {
            _centres = centres;
        }

        /// <summary>Degraded while the most recent plan threw, naming what it threw; the next plan that finishes clears it.</summary>
        public UplinkHealth Health()
        {
            var failure = _lastFailure;
            return failure == null
                ? UplinkHealth.Healthy
                : UplinkHealth.Degraded("the last contact plan failed: " + failure);
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms-contacts",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
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
            },
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _publisher = host.Publisher(ContactsTopic);
            _surface = new KspVisibilityGeometryFactory(() => host.Kernel);
            host.AddSampledSource(CaptureOnMain, PublishOnCourier, ContactsTopic);
        }

        /// <summary>MAIN THREAD: starts a plan when the last one is out of date. Starting one costs a pool thread, not this one.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var bodies = FlightGlobals.Bodies;
            var vessels = FlightGlobals.Vessels;
            if (snapshot == null || bodies == null || vessels == null || _host == null || _runner.Running)
            {
                return null;
            }
            if (Time.realtimeSinceStartup - _lookedAt < LookIntervalSeconds)
            {
                return null;
            }
            _lookedAt = Time.realtimeSinceStartup;

            var ut = snapshot.Ut;
            var kernel = _host.Kernel;
            var nodes = new List<PlanNode>();
            var orbiting = new List<PropagationTarget>();
            var fingerprint = new List<ContactNodeFingerprint>();
            var comms = new Dictionary<string, CommNode>(StringComparer.Ordinal);
            var stations = new HashSet<string>(StringComparer.Ordinal);

            foreach (var vessel in vessels)
            {
                var comm = vessel != null && vessel.connection != null ? vessel.connection.Comm : null;
                if (comm == null || !Plannable(vessel.vesselType) || vessel.mainBody == null)
                {
                    continue;
                }
                var id = "vessel:" + vessel.id;
                var bodyIndex = bodies.IndexOf(vessel.mainBody);
                if (vessel.LandedOrSplashed)
                {
                    var point = _surface!.CalibratedSurfacePoint(vessel.mainBody, comm);
                    if (point == null)
                    {
                        continue;
                    }
                    nodes.Add(PlanNode.OnSurface(id, bodyIndex, point.Value));
                    fingerprint.Add(new ContactNodeFingerprint(id, bodyIndex, null, point.Value));
                }
                else
                {
                    var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                    if (orbit == null)
                    {
                        continue;
                    }
                    var elements = KspVisibilityGeometryFactory.ElementsOf(orbit);
                    orbiting.Add(PropagationTarget.Vessel(id, bodyIndex, elements));
                    fingerprint.Add(new ContactNodeFingerprint(id, bodyIndex, elements));
                }
                comms[id] = comm;
            }

            foreach (var centre in _centres.EnumerateActive())
            {
                if (centre.Kind != CommandCentreKind.GroundStation
                    || !(centre is KspCommandCentre home)
                    || home.Node == null
                    || home.BodyIndex == null)
                {
                    continue;
                }
                var bodyIndex = home.BodyIndex.Value;
                if (bodyIndex < 0 || bodyIndex >= bodies.Count)
                {
                    continue;
                }
                var point = _surface!.CalibratedSurfacePoint(bodies[bodyIndex], home.Node);
                if (point == null)
                {
                    continue;
                }
                nodes.Add(PlanNode.OnSurface(home.Id, bodyIndex, point.Value));
                fingerprint.Add(new ContactNodeFingerprint(home.Id, bodyIndex, null, point.Value));
                comms[home.Id] = home.Node;
                stations.Add(home.Id);
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

            var table = KspSystemTable.Current();
            var occlusion = CommsElection.OcclusionModel(kernel);
            Func<int, double> radiusOf = index => index >= 0 && index < bodies.Count
                ? KspVisibilityGeometryFactory.OccludingRadiusOf(occlusion, bodies[index])
                : 0.0;
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
                    var occluders = Occluders(a.BodyIndex, b.BodyIndex, table, radiusOf);
                    if (occluders == null)
                    {
                        continue;
                    }
                    var reach = CommsElection.ReachModel(kernel, comms[a.Id], comms[b.Id]).MaxRangeMeters;
                    pairs.Add(new PlanPair(a.Id, b.Id, occluders, reach));
                }
            }

            var request = new ContactPlanRequest(
                nodes,
                pairs,
                new KeplerProvider(table),
                Planetarium.fetch != null ? bodies.IndexOf(Planetarium.fetch.Sun) : 0,
                ut,
                ContactPlanSchedule.HorizonSeconds,
                fingerprint);
            if (_runner.Offer(request, Failed))
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
            Debug.LogWarning("[Gonogo.ContactPlanUplink] contact plan failed: " + ex);
        }

        /// <summary>COURIER THREAD: publishes whichever plan has finished since the last tick.</summary>
        internal void PublishOnCourier(object? captured)
        {
            if (_runner.TryTake(out var plan) && plan != null)
            {
                _lastFailure = null;
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

        /// <summary>Craft that carry a radio worth planning for: not debris, asteroids, comets or flags.</summary>
        private static bool Plannable(VesselType type) =>
            type != VesselType.Debris
            && type != VesselType.SpaceObject
            && type != VesselType.Flag
            && type != VesselType.Unknown
            && type != VesselType.DeployedScienceController
            && type != VesselType.DeployedSciencePart
            && type != VesselType.DroppedPart;
    }
}
