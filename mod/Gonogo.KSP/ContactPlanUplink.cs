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
        private readonly System.Func<HomeCommand> _home;
        private KspVisibilityGeometryFactory? _surface;
        private bool? _listStood;

        /// <summary>The links as they were last read from a vessel list that stood, or null before any was.</summary>
        private LiveLinkGraph? _linksLastRead;
        private IUplinkHost? _host;

        /// <param name="centres">The registry the ground stations' ids come from, so the plan names them as the roster does.</param>
        /// <param name="inputs">Where each tick's live links are handed to store-and-forward delivery.</param>
        /// <param name="home">Which centre is home, as the engine has it, for marking it on the roster. Not identified when omitted.</param>
        public ContactPlanUplink(CommandCentreRegistry centres, DeliveryInputs? inputs = null, System.Func<HomeCommand>? home = null)
        {
            _home = home ?? (() => HomeCommand.NotIdentified);
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
            // A list still being filled shows no craft and so no links. That is not the links having gone: light on its way over one still lands.
            if (!VesselListStanding.Stands(
                    HighLogic.LoadedSceneIsFlight,
                    FlightGlobals.ready,
                    vessels.Count,
                    HighLogic.CurrentGame?.flightState?.protoVessels?.Count))
            {
                return _linksLastRead;
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
            _linksLastRead = new LiveLinkGraph(links);
            return _linksLastRead;
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
            // A scene that is still loading has no vessels to show, which is not the same as none existing.
            var inGameState = HighLogic.CurrentGame?.flightState?.protoVessels?.Count;
            var stands = VesselListStanding.Stands(HighLogic.LoadedSceneIsFlight, FlightGlobals.ready, vessels.Count, inGameState);
            if (stands != _listStood)
            {
                _listStood = stands;
                // Each change is logged, so a list that stays unread shows in the log with the counts that kept it so.
                Debug.Log("[Gonogo] vessel list " + (stands ? "stands" : "not standing") + " in " + HighLogic.LoadedScene
                    + ": lists " + vessels.Count + ", the game's own state holds " + (inGameState?.ToString() ?? "none")
                    + ", flight ready " + FlightGlobals.ready);
            }
            if (!stands)
            {
                return null;
            }

            var active = _centres.EnumerateActive();
            var roster = CommandCentreDelayUplink.ToRoster(active, _home());
            var centreOf = new Dictionary<string, CommandCentreEntry>(System.StringComparer.Ordinal);
            foreach (var entry in roster)
            {
                if (entry.Id != null)
                {
                    centreOf[entry.Id] = entry;
                }
            }

            var nodes = new List<ContactGameNode>();
            var listed = new HashSet<string>(System.StringComparer.Ordinal);
            foreach (var vessel in vessels)
            {
                if (vessel != null)
                {
                    listed.Add(vessel.id.ToString());
                }
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
                        nodes.Add(AsCentre(ContactGameNode.LandedCraft(id, bodyIndex, point.Value, comm, GameWords.VesselName(vessel)), centreOf));
                    }
                    continue;
                }
                var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                if (orbit != null)
                {
                    nodes.Add(AsCentre(
                        ContactGameNode.OrbitingCraft(id, bodyIndex, KspVisibilityGeometryFactory.ElementsOf(orbit), comm, GameWords.VesselName(vessel)),
                        centreOf));
                }
            }

            foreach (var centre in active)
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
                Roster = roster,
                Sight = SightOf(vessels, active, roster),
                Vessels = listed,
            };
        }

        /// <summary>
        /// MAIN THREAD: the straight-line light-time from every object the game
        /// knows the orbit of to every command centre, or null when the
        /// tracking station cannot place a vessel at all.
        ///
        /// <para>What a tracking station can do is the game's own rule, read
        /// live: <c>GameVariables.GetOrbitDisplayMode</c> at the station's
        /// current level is what <c>Vessel.vesselOrbitsUnlocked</c> asks, and
        /// every stock level answers AllOrbits or better. An object the game
        /// has no state vectors for, an untracked asteroid, is placed by
        /// nothing, as it is drawn with no orbit in the game.</para>
        ///
        /// <para>The home centre sees through every ground station, so its
        /// light-time is the shortest of theirs.</para>
        /// </summary>
        private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? SightOf(
            List<Vessel> vessels, IReadOnlyList<ICommandCentre> centres, List<CommandCentreEntry> roster)
        {
            if (!TrackingStationPlacesVessels())
            {
                return null;
            }
            var config = CommsCoreUplink.SignalDelayConfig;
            var factor = config.Enabled && config.LightSpeedScale > 0.0 ? 1.0 / config.LightSpeedScale : 0.0;
            string? home = null;
            foreach (var entry in roster)
            {
                if (entry.IsHome)
                {
                    home = entry.Id;
                }
            }
            var eyes = new List<(string Id, Vector3d Position, bool Ground)>();
            foreach (var centre in centres)
            {
                if (centre is KspCommandCentre placed)
                {
                    eyes.Add((placed.Id, placed.Position, placed.Kind == CommandCentreKind.GroundStation));
                }
            }

            var sight = new Dictionary<string, IReadOnlyDictionary<string, double>>(System.StringComparer.Ordinal);
            foreach (var vessel in vessels)
            {
                if (vessel == null || !OrbitKnown(vessel))
                {
                    continue;
                }
                var at = vessel.GetWorldPos3D();
                var row = new Dictionary<string, double>(System.StringComparer.Ordinal);
                var nearestGround = double.PositiveInfinity;
                foreach (var eye in eyes)
                {
                    var seconds = (eye.Position - at).magnitude / PairPlan.SpeedOfLight * factor;
                    row[eye.Id] = seconds;
                    if (eye.Ground)
                    {
                        nearestGround = System.Math.Min(nearestGround, seconds);
                    }
                }
                if (home != null && row.ContainsKey(home) && !double.IsPositiveInfinity(nearestGround))
                {
                    row[home] = nearestGround;
                }
                sight["vessel:" + vessel.id] = row;
            }
            return sight;
        }

        private static bool TrackingStationPlacesVessels()
        {
            try
            {
                var rules = GameVariables.Instance;
                if (rules == null)
                {
                    // No rules to ask, as at the main menu, is not a station that cannot track.
                    return true;
                }
                var level = ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.TrackingStation);
                return rules.GetOrbitDisplayMode(level) >= GameVariables.OrbitDisplayMode.AllOrbits;
            }
            catch (System.Exception)
            {
                return true;
            }
        }

        /// <summary>Whether the game has state vectors for the vessel, which every craft it made for the player has.</summary>
        private static bool OrbitKnown(Vessel vessel)
        {
            try
            {
                return vessel.DiscoveryInfo == null || OrbitKnowledge.Known(vessel.DiscoveryInfo.Level);
            }
            catch (System.Exception)
            {
                return true;
            }
        }

        /// <summary>The craft's node, carrying its roster entry when the craft is a command centre.</summary>
        private static ContactGameNode AsCentre(ContactGameNode node, Dictionary<string, CommandCentreEntry> centreOf)
        {
            if (centreOf.TryGetValue(node.Id, out var entry))
            {
                node.Centre = entry;
            }
            return node;
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
