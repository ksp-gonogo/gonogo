using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Visibility;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Registers <c>comms.contacts</c> and <c>comms.route</c>, and is the game
    /// <see cref="ContactPlanSource"/> plans from: every craft that carries a
    /// radio and every ground station, read off the live scene on the main
    /// thread. The planning and the publishing are the source's.
    /// </summary>
    public sealed class ContactPlanUplink : ISitrepUplink, IContactGame
    {
        private readonly CommandCentreRegistry _centres;
        private readonly ContactPlanSource _source;
        private KspVisibilityGeometryFactory? _surface;

        /// <param name="centres">The registry the ground stations' ids come from, so the plan names them as the roster does.</param>
        public ContactPlanUplink(CommandCentreRegistry centres)
        {
            _centres = centres;
            _source = new ContactPlanSource(
                this,
                () => Time.realtimeSinceStartup,
                message => Debug.LogWarning("[Gonogo.ContactPlanUplink] " + message));
        }

        public UplinkHealth Health() => _source.Health();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms-contacts",
            Version = "1.0.0",
            Channels = ContactPlanSource.Channels(),
        };

        public void Register(IUplinkHost host)
        {
            _surface = new KspVisibilityGeometryFactory(() => host.Kernel);
            _source.Register(host);
        }

        public IReadOnlyList<string> Centres()
        {
            var centres = new List<string>();
            foreach (var centre in _centres.EnumerateActive())
            {
                centres.Add(centre.Id);
            }
            return centres;
        }

        public ContactGameLook? Look()
        {
            var bodies = FlightGlobals.Bodies;
            var vessels = FlightGlobals.Vessels;
            if (bodies == null || vessels == null || _surface == null)
            {
                return null;
            }

            var nodes = new List<ContactGameNode>();
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
                    var point = _surface.CalibratedSurfacePoint(vessel.mainBody, comm);
                    if (point != null)
                    {
                        nodes.Add(ContactGameNode.LandedCraft(id, bodyIndex, point.Value, comm));
                    }
                    continue;
                }
                var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                if (orbit != null)
                {
                    nodes.Add(ContactGameNode.OrbitingCraft(id, bodyIndex, KspVisibilityGeometryFactory.ElementsOf(orbit), comm));
                }
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
                var point = _surface.CalibratedSurfacePoint(bodies[bodyIndex], home.Node);
                if (point != null)
                {
                    nodes.Add(ContactGameNode.GroundStation(home.Id, bodyIndex, point.Value, home.Node));
                }
            }

            return new ContactGameLook(
                nodes,
                KspSystemTable.Current(),
                Planetarium.fetch != null ? bodies.IndexOf(Planetarium.fetch.Sun) : 0,
                (occlusion, index) => index >= 0 && index < bodies.Count
                    ? KspVisibilityGeometryFactory.OccludingRadiusOf(occlusion, bodies[index])
                    : 0.0);
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
