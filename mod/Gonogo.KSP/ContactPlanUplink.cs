using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
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
        private readonly DeliveryInputs _inputs;
        private KspVisibilityGeometryFactory? _surface;
        private IUplinkHost? _host;

        /// <param name="centres">The registry the ground stations' ids come from, so the plan names them as the roster does.</param>
        /// <param name="inputs">Where each tick's live links are handed to store-and-forward delivery.</param>
        public ContactPlanUplink(CommandCentreRegistry centres, DeliveryInputs? inputs = null)
        {
            _centres = centres;
            _inputs = inputs ?? new DeliveryInputs();
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
            _host = host;
            _surface = new KspVisibilityGeometryFactory(() => host.Kernel);
            _source.Register(host);
            // Ungated: whether light that was sent lands is asked of these links
            // whether or not anyone is watching a topic.
            host.AddSampledSource(CaptureLinksOnMain, links => _inputs.SetLinks(links as LiveLinkGraph ?? LiveLinkGraph.Empty));
        }

        /// <summary>
        /// MAIN THREAD: every live link the game's network holds right now between
        /// the craft and ground stations a plan can name, with its light time as
        /// the game is set to delay it. A network node is a map of its own live
        /// links, so this is a walk of those maps, not a route solve.
        ///
        /// <para>Store-and-forward reads these for one thing: whether light that
        /// was sent over a link lands, and whether a relay's own link is up. No
        /// command centre's decision and nothing a client is shown is made from
        /// them.</para>
        /// </summary>
        internal object? CaptureLinksOnMain(KspSnapshot? snapshot)
        {
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }
            var config = CommsCoreUplink.SignalDelayConfig;
            var factor = config.Enabled && config.LightSpeedScale > 0.0 ? 1.0 / config.LightSpeedScale : 0.0;
            _inputs.SetLightFactor(factor);
            // With the comms network switched off in the save there is nothing to
            // plan and no link to wait for. Unknown, as at the main menu, is not off.
            _inputs.SetNetworkModelled(CommsModelPresence.Present != false);

            var ids = new Dictionary<CommNode, string>();
            foreach (var vessel in vessels)
            {
                if (vessel == null)
                {
                    continue;
                }
                var comm = vessel.connection != null ? vessel.connection.Comm : null;
                if (comm != null && Plannable(vessel.vesselType))
                {
                    ids[comm] = "vessel:" + vessel.id;
                }
            }
            foreach (var centre in _centres.EnumerateActive())
            {
                if (centre.Kind == CommandCentreKind.GroundStation && centre is KspCommandCentre home && home.Node != null)
                {
                    ids[home.Node] = home.Id;
                }
            }
            var links = new List<(string, string, double)>();
            foreach (var entry in ids)
            {
                foreach (var other in entry.Key.Keys)
                {
                    if (other != null && ids.TryGetValue(other, out var otherId)
                        && string.CompareOrdinal(entry.Value, otherId) < 0)
                    {
                        var metres = (entry.Key.precisePosition - other.precisePosition).magnitude;
                        links.Add((entry.Value, otherId, metres / PairPlan.SpeedOfLight * factor));
                    }
                }
            }
            return new LiveLinkGraph(links);
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
                        nodes.Add(ContactGameNode.LandedCraft(id, bodyIndex, point.Value, comm, GameWords.VesselName(vessel)));
                    }
                    continue;
                }
                var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                if (orbit != null)
                {
                    nodes.Add(ContactGameNode.OrbitingCraft(id, bodyIndex, KspVisibilityGeometryFactory.ElementsOf(orbit), comm, GameWords.VesselName(vessel)));
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
                    nodes.Add(ContactGameNode.GroundStation(home.Id, bodyIndex, point.Value, home.Node, home.DisplayName));
                }
            }

            return new ContactGameLook(
                nodes,
                KspSystemTable.Current(),
                Planetarium.fetch != null ? bodies.IndexOf(Planetarium.fetch.Sun) : 0,
                (occlusion, index) => index >= 0 && index < bodies.Count
                    ? KspVisibilityGeometryFactory.OccludingRadiusOf(occlusion, bodies[index])
                    : 0.0)
            {
                Radio = RadioOfActive(),
            };
        }

        /// <summary>
        /// MAIN THREAD: what the elected comms backend says of the active craft's
        /// link now, and the hops it says so over. Null with no active craft, no
        /// backend, or a backend read that threw, which is tried again on the
        /// next look.
        /// </summary>
        private ContactRadio? RadioOfActive()
        {
            var active = ActiveVesselScope.Current;
            var kernel = _host?.Kernel;
            if (active == null || kernel == null)
            {
                return null;
            }
            try
            {
                var backend = CommsElection.Elected(kernel);
                if (backend == null)
                {
                    return null;
                }
                var hops = new List<RadioHop>();
                foreach (var hop in backend.Path(active).Hops)
                {
                    hops.Add(new RadioHop(hop.From, hop.To, !hop.ToIsHome, hop.Extensions));
                }
                return new ContactRadio(
                    "vessel:" + active.id,
                    backend.Connectivity().Connected,
                    backend.SignalStrength().Strength,
                    CommsDegradeModels.ToPayload(backend.DegradeModel()),
                    hops);
            }
            catch (System.Exception)
            {
                return null;
            }
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
