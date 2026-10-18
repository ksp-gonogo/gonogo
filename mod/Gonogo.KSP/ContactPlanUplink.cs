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

        /// <summary>How each vessel the game has said is leaving left, since the last look, by bare guid. Main thread.</summary>
        private Dictionary<string, CraftEnd> _ends = new Dictionary<string, CraftEnd>();
        private bool _endsHooked;

        /// <summary>The crew aboard each vessel the player ended from the Tracking Station, by bare guid, until their roster status is read at the next look. Main thread.</summary>
        private Dictionary<string, List<string>> _terminatedCrew = new Dictionary<string, List<string>>();

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
                message => GonogoLog.Sink("ContactPlanUplink: " + message));
        }

        public UplinkHealth Health() => _source.Health();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms-contacts",
            Version = "1.0.0",
            Channels = ContactPlanSource.Channels(),
            Commands = ContactPlanSource.Commands(),
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _surface = new KspVisibilityGeometryFactory(() => host.Kernel);
            _source.Register(host);
            CurrencyDelay.HomeCraftViews.Bind(_source.HomeViewOf);
            HookEnds();
            // Ungated: whether light that was sent lands is asked of these links
            // whether or not anyone is watching a topic.
            host.AddSampledSource(CaptureLinksOnMain, links => _inputs.SetLinks(links as LiveLinkGraph ?? LiveLinkGraph.Empty));
        }

        /// <summary>
        /// Main thread: every live link the game's network holds right now between
        /// the craft and ground stations a plan can name, with its signal delay as
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
            if (!VesselListWatch.Shared.Stands(
                    HighLogic.LoadedScene.ToString(),
                    HighLogic.LoadedSceneIsFlight,
                    FlightGlobals.ready,
                    vessels.Count,
                    HighLogic.CurrentGame?.flightState?.protoVessels?.Count,
                    VesselListWatch.RealNow()))
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

        /// <summary>
        /// Listens for how vessels leave the game, for the whole process: a
        /// vessel can be destroyed or recovered in any scene. Docking raises
        /// neither, so a docked vessel is one that left with no word.
        /// </summary>
        private void HookEnds()
        {
            if (_endsHooked)
            {
                return;
            }
            _endsHooked = true;
            GameEvents.onVesselWillDestroy.Add(OnVesselWillDestroy);
            GameEvents.onVesselRecovered.Add(OnVesselRecovered);
            GameEvents.onVesselTerminated.Add(OnVesselTerminated);
        }

        /// <summary>The player ended the vessel from the Tracking Station; stock then destroys it, which this end replaces.</summary>
        private void OnVesselTerminated(ProtoVessel vessel)
        {
            if (vessel != null)
            {
                _ends[vessel.vesselID.ToString()] = CraftEnd.Terminated;
                var names = new List<string>();
                foreach (var kerbal in vessel.GetVesselCrew())
                {
                    names.Add(kerbal.name);
                }
                _terminatedCrew[vessel.vesselID.ToString()] = names;
            }
        }

        private void OnVesselWillDestroy(Vessel vessel)
        {
            if (vessel != null && !_ends.ContainsKey(vessel.id.ToString()))
            {
                _ends[vessel.id.ToString()] = CraftEnd.Destroyed;
            }
        }

        /// <summary>Stock raises this before it removes the vessel, which it then reports destroyed too.</summary>
        private void OnVesselRecovered(ProtoVessel vessel, bool quick)
        {
            if (vessel != null)
            {
                _ends[vessel.vesselID.ToString()] = CraftEnd.Recovered;
            }
        }

        /// <summary>
        /// What the game's roster says of the crew of each vessel ended from the Tracking Station
        /// since the last look, handed over once. Stock marks them after raising the termination,
        /// within the same call, so a look after it reads what stock set.
        /// </summary>
        private IReadOnlyDictionary<string, CrewAtEnd> TakeEndCrews()
        {
            var read = new Dictionary<string, CrewAtEnd>();
            var roster = HighLogic.CurrentGame?.CrewRoster;
            foreach (var ended in _terminatedCrew)
            {
                if (roster == null)
                {
                    break;
                }
                var statuses = new List<string>();
                foreach (var name in ended.Value)
                {
                    var kerbal = roster[name];
                    if (kerbal != null)
                    {
                        statuses.Add(kerbal.rosterStatus.ToString());
                    }
                }
                read[ended.Key] = CrewAtEnd.Of(statuses);
            }
            _terminatedCrew = new Dictionary<string, List<string>>();
            return read;
        }

        /// <summary>The ends said since the last look, handed over once.</summary>
        private IReadOnlyDictionary<string, CraftEnd> TakeEnds()
        {
            var said = _ends;
            _ends = new Dictionary<string, CraftEnd>();
            return said;
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
            var stands = VesselListWatch.Shared.Stands(
                HighLogic.LoadedScene.ToString(), HighLogic.LoadedSceneIsFlight, FlightGlobals.ready, vessels.Count, inGameState, VesselListWatch.RealNow());
            if (stands != _listStood)
            {
                _listStood = stands;
                // Each change is logged, so a list that stays unread shows in the log with the counts that kept it so.
                GonogoLog.Info("contact-plan", "vessel list " + (stands ? "stands" : "not standing") + " in " + HighLogic.LoadedScene
                    + ": lists " + vessels.Count + ", the game's own state holds " + (inGameState?.ToString() ?? "none")
                    + ", flight ready " + FlightGlobals.ready);
            }
            if (!stands)
            {
                // Not read as empty: a look with the centres the game can still name and no craft.
                vessels = NoVessels;
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
                    var point = _surface.SurfacePointOf(vessel.mainBody, comm);
                    if (point != null)
                    {
                        nodes.Add(AsCentre(ContactGameNode.LandedCraft(id, bodyIndex, point.Value, CommsNodeHandle.Of(comm), GameWords.VesselName(vessel)), centreOf));
                    }
                    continue;
                }
                var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                if (orbit != null)
                {
                    nodes.Add(AsCentre(
                        ContactGameNode.OrbitingCraft(id, bodyIndex, KspVisibilityGeometryFactory.ElementsOf(orbit), CommsNodeHandle.Of(comm), GameWords.VesselName(vessel)),
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
                var point = _surface.SurfacePointOf(bodies[bodyIndex], home.Node);
                if (point != null)
                {
                    nodes.Add(ContactGameNode.GroundStation(home.Id, bodyIndex, point.Value, CommsNodeHandle.Of(home.Node), home.DisplayName));
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
                Radio = stands ? RadioOfActive() : null,
                Roster = roster,
                Sight = stands ? SightOf(vessels, active, roster, SightBodies(bodies)) : null,
                Vessels = stands ? listed : null,
                VesselsUnread = !stands,
                Ends = TakeEnds(),
                EndCrews = TakeEndCrews(),
            };
        }

        private static readonly List<Vessel> NoVessels = new List<Vessel>();

        /// <summary>
        /// Main thread: the straight-line signal delay from every object the game
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
        /// signal delay is the shortest of theirs.</para>
        /// </summary>
        private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? SightOf(
            List<Vessel> vessels, IReadOnlyList<ICommandCentre> centres, List<CommandCentreEntry> roster, IReadOnlyList<SightBody> bodies)
        {
            if (!TrackingStationPlacesVessels())
            {
                return null;
            }
            return SightLines.Table(vessels, vessel => vessel.GetWorldPos3D(), centres, roster, CommsCoreUplink.SignalDelayConfig, bodies);
        }

        /// <summary>Every body where it is now, at the radius the elected comms backend says it blocks a line at.</summary>
        private List<SightBody> SightBodies(List<CelestialBody> bodies)
        {
            var occlusion = CommsElection.OcclusionModel(_host?.Kernel);
            var sight = new List<SightBody>(bodies.Count);
            foreach (var body in bodies)
            {
                if (body != null)
                {
                    sight.Add(new SightBody(body.position, KspVisibilityGeometryFactory.OccludingRadiusOf(occlusion, body)));
                }
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
        /// Main thread: what the elected comms backend says of the active craft's
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
                var signal = backend.Signal();
                return new ContactRadio(
                    "vessel:" + active.id,
                    backend.Connectivity().Connected,
                    signal.Strength,
                    CommsDegradeModels.ToPayload(backend.DegradeModel()),
                    hops,
                    signal.Quantity);
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
