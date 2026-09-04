using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Contracts;
using Expansions;
using Expansions.Serenity;
using KSP.UI.Screens;
using ModuleWheels;
using Sitrep.Host;
using Sitrep.Host.Maneuver;
using Sitrep.Host.Propulsion;
using Strategies;
using UnityEngine;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The ONLY class in the mod that touches KSP/Unity APIs directly ON THE
    /// READ SIDE (see <see cref="IKspHost"/>'s doc comment for the boundary
    /// this enforces). Every public member either returns a primitive/POCO or
    /// fires <see cref="Lifecycle"/> with one: no <c>CelestialBody</c>/
    /// <c>Vessel</c>/<c>Orbit</c> reference ever escapes through this type.
    /// M1 Task 3 added <see cref="KspVesselActuator"/> as this class's
    /// ACTUATION counterpart (write side, wired to <c>IVesselActuator</c>),
    /// see its own doc comment; the two are deliberately separate by
    /// direction of data flow rather than one class doing both.
    ///
    /// KSP calls happen ONLY here, from <see cref="KspVesselActuator"/>, and
    /// from <see cref="GonogoAddon"/>'s <c>FixedUpdate</c>/GameEvents
    /// callbacks (all main-thread, EXCEPT <see cref="KspVesselActuator"/>:
    /// see its own doc comment for the known Courier-thread marshaling gap)
    /// - the courier/transport/recorder machinery downstream of
    /// <see cref="Sample"/> never touches a KSP type.
    ///
    /// <para><b>KSP-API surprises found via decompile (see the M5b Task 4b
    /// report for detail):</b></para>
    /// <list type="bullet">
    /// <item><description><c>CelestialBody.referenceBody</c> returns the body
    /// ITSELF (not <c>null</c>) when it has no <c>orbitDriver</c> - i.e. for
    /// the sun. <c>orbit</c> is genuinely <c>null</c> in that case though.
    /// So "is this the root star" is detected via
    /// <c>ReferenceEquals(refBody, body)</c>, not a null check.</description></item>
    /// <item><description><c>FlightGlobals.fetch</c> can itself be
    /// <c>null</c> (it's a lazy <c>FindObjectOfType</c> singleton) before any
    /// scene has spawned it, e.g. very early at the main menu -
    /// <c>FlightGlobals.Bodies</c> would NRE on that <c>fetch.bodies</c>
    /// dereference. Guarded below with <c>FlightGlobals.ready &amp;&amp;
    /// FlightGlobals.fetch != null</c> before ever touching
    /// <c>FlightGlobals.Bodies</c>.</description></item>
    /// </list>
    /// </summary>
    public sealed class KspHost : IKspHost
    {
        public event Action<KspLifecycleEvent> Lifecycle = delegate { };

        // Shared with KspVesselActuator (see GonogoAddon.Awake, which
        // constructs ONE instance and hands it to both) -- see
        // ReferenceIdRegistry's own doc comment for why sharing this single
        // instance is what makes a maneuver node's read-side id usable in a
        // vessel.maneuver.update/.remove command, not just a cosmetic
        // read-only label.
        private readonly ReferenceIdRegistry<ManeuverNode> _maneuverNodeIdRegistry;

        /// <summary>
        /// Carries the thrust latches (<c>vessel.propulsion.thrustStartedUt</c>
        /// / <c>.lastThrustEndUt</c>) ACROSS captures, which is the only reason
        /// it is a field: a per-capture reading cannot say when thrust began,
        /// and a per-capture reading of zero cannot tell a craft that never lit
        /// from one that has just shut down. See
        /// <see cref="ThrustObserver"/> for why the fact is latched rather than
        /// emitted as an edge.
        ///
        /// <para>Fed once per capture, so its instants resolve to
        /// <c>GonogoAddon.SampleIntervalUt</c>. A burn shorter than that may
        /// never be observed under thrust at all, in which case both latches
        /// simply stay where they were: the failure mode is a refusal to say
        /// anything, never a wrong instant. Reading engine thrust every physics
        /// tick instead would mean walking the part tree at physics rate for a
        /// resolution no orbital burn needs.</para>
        /// </summary>
        private readonly ThrustObserver _thrustObserver = new ThrustObserver();

        /// <summary>
        /// Resolves the elected <see cref="IManeuverPlanSource"/> (stock's
        /// patched-conic solver, or a provider elected over it) at CAPTURE
        /// time, on the main thread. Same late-bound install shape and same
        /// reason as <see cref="_actionGroupsBackend"/>: the engine, and so the
        /// Kernel, does not exist when this host is constructed.
        /// </summary>
        private Func<IManeuverPlanSource?>? _maneuverPlanSource;

        /// <summary>Installs the resolver described on <see cref="_maneuverPlanSource"/>.</summary>
        public void SetManeuverPlanSource(Func<IManeuverPlanSource?> resolver)
        {
            _maneuverPlanSource = resolver;
        }

        /// <summary>
        /// Resolves the elected <see cref="IActionGroupsBackend"/> (stock, or
        /// AGX once that phase lands) fresh on every sample. LATE-BOUND on
        /// purpose: <see cref="GonogoAddon"/> constructs this host before the
        /// ChannelEngine exists, and the capability Kernel isn't resolved until
        /// every uplink has registered its providers, so the resolver is a
        /// closure the addon installs after <c>ResolveCapabilities()</c>, not a
        /// constructor argument. Invoked per-sample rather than cached so a
        /// re-resolution is picked up without restarting the host.
        ///
        /// <para>Null before the addon wires it (and in a bare-host unit test),
        /// which degrades to "no action-group data this tick", the same
        /// null the contract already documents. Action groups are not
        /// SpineCritical; the rest of vessel.control is still good telemetry
        /// without them.</para>
        /// </summary>
        private Func<IActionGroupsBackend?>? _actionGroupsBackend;

        /// <summary>
        /// Installs the elected-backend resolver. Called by
        /// <see cref="GonogoAddon"/> once the capability Kernel has resolved,
        /// see <see cref="_actionGroupsBackend"/> for why this can't be a
        /// constructor argument.
        /// </summary>
        public void SetActionGroupsBackendSource(Func<IActionGroupsBackend?> resolver)
        {
            _actionGroupsBackend = resolver;
        }

        /// <summary>
        /// The elected <see cref="IEconomyBackend"/> resolver: what this install's
        /// money model makes of the reputation this host reads. Same late-bound
        /// install shape and the same reason as
        /// <see cref="_actionGroupsBackend"/>, and read on the same main-thread
        /// sample, because an overhaul's figures come off its own live scenario
        /// modules.
        ///
        /// <para>Null before the addon wires it, and in a bare-host unit test,
        /// which degrades to reputation published bare: exactly the state that
        /// existed before the capability, so nothing regresses.</para>
        /// </summary>
        private Func<IEconomyBackend?>? _economyBackend;

        /// <summary>Installs the elected economy-backend resolver; see <see cref="_economyBackend"/>.</summary>
        public void SetEconomyBackendSource(Func<IEconomyBackend?> resolver)
        {
            _economyBackend = resolver;
        }

        /// <summary>
        /// The elected <see cref="ICrewStandingBackend"/> resolver: what this
        /// install makes of a kerbal whose roster status alone is not the answer.
        /// Same late-bound install shape and the same reason as
        /// <see cref="_actionGroupsBackend"/>, and read on the same main-thread
        /// sample, because a career overhaul's crew bookkeeping lives on its own
        /// live scenario module.
        ///
        /// <para>Null before the addon wires it, and in a bare-host unit test,
        /// which degrades to the stock mapping the view provider falls back to,
        /// so a stock install is unaffected either way.</para>
        /// </summary>
        private Func<ICrewStandingBackend?>? _crewStandingBackend;

        /// <summary>Installs the elected crew-standing resolver; see <see cref="_crewStandingBackend"/>.</summary>
        public void SetCrewStandingBackendSource(Func<ICrewStandingBackend?> resolver)
        {
            _crewStandingBackend = resolver;
        }

        /// <summary>
        /// The elected <see cref="IPropagationProvider"/> resolver. Same
        /// late-bound install shape as <see cref="_actionGroupsBackend"/>: read on
        /// the main-thread sample to stamp <c>vessel.target</c>'s
        /// <c>closestApproach</c>.
        ///
        /// <para>The approach comes from the PROPAGATION provider rather than a
        /// solver of its own because an encounter is a consequence of a
        /// trajectory. Two elections could put an integrated trajectory and a
        /// two-body encounter on the wire for the same vessel at the same instant,
        /// and nothing on the wire would say which was which.</para>
        /// </summary>
        private Func<IPropagationProvider?>? _propagation;

        /// <summary>
        /// Installs the elected propagation-provider resolver. Called by
        /// <see cref="GonogoAddon"/> once the capability Kernel has resolved,
        /// see <see cref="_propagation"/> / <see cref="_actionGroupsBackend"/>
        /// for why this can't be a constructor argument.
        /// </summary>
        public void SetPropagationSource(Func<IPropagationProvider?> resolver)
        {
            _propagation = resolver;
        }

        public KspHost(ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
        {
            _maneuverNodeIdRegistry = maneuverNodeIdRegistry;
            GameEvents.onGameSceneLoadRequested.Add(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Add(OnFlightReady);
            GameEvents.onVesselChange.Add(OnVesselChange);
            GameEvents.onGameStateLoad.Add(OnGameStateLoad);

            // The active-vessel seam's own hooks. Subscribed here rather than from a
            // scene-scoped ScenarioModule because an EVA egress can land while a
            // scene module is being torn down, and this host's lifetime is the
            // process (GonogoAddon is DontDestroyOnLoad).
            ActiveVesselScope.Hook();
        }

        /// <summary>Unsubscribes from every <see cref="GameEvents"/> hook. Call from <see cref="GonogoAddon"/>'s teardown - GameEvents are static/global, so a leaked subscription would outlive this instance.</summary>
        public void Unhook()
        {
            GameEvents.onGameSceneLoadRequested.Remove(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Remove(OnFlightReady);
            GameEvents.onVesselChange.Remove(OnVesselChange);
            GameEvents.onGameStateLoad.Remove(OnGameStateLoad);
            ActiveVesselScope.Unhook();
        }

        /// <summary>
        /// Current UT. <see cref="Planetarium.GetUniversalTime"/> already
        /// falls back to <c>HighLogic.CurrentGame.UniversalTime</c> when
        /// <c>Planetarium.fetch</c> is null (decompiled and confirmed), but
        /// this still wraps in try/catch: a FixedUpdate-driven caller must
        /// never throw, and the fallback path itself touches
        /// <c>HighLogic.CurrentGame</c>, which can be null before any save
        /// is loaded.
        /// </summary>
        public double NowUt()
        {
            try
            {
                return Planetarium.GetUniversalTime();
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] NowUt() failed, returning 0: " + ex);
                return 0;
            }
        }

        /// <summary>
        /// Primitives-only snapshot of every celestial body FlightGlobals
        /// currently knows about. Returns an empty snapshot (no "bodies" key)
        /// when nothing is loaded yet (main menu) rather than throwing -
        /// see the class doc comment for the <c>FlightGlobals.fetch</c> guard.
        /// </summary>
        public KspSnapshot Sample()
        {
            var ut = NowUt();
            var values = new Dictionary<string, object?>();

            try
            {
                if (FlightGlobals.ready && FlightGlobals.fetch != null)
                {
                    var bodies = FlightGlobals.Bodies;
                    if (bodies != null && bodies.Count > 0)
                    {
                        var list = new List<object?>(bodies.Count);
                        foreach (var body in bodies)
                        {
                            if (body == null)
                            {
                                continue;
                            }
                            list.Add(BuildBodyEntry(body));
                        }
                        values["bodies"] = list;
                    }

                    // Only the active vessel - stations/replay consume a
                    // single "the ship we're flying" snapshot, not a fleet
                    // roster. Omitted entirely (no "vessel" key at all) at
                    // the main menu / between-flights rather than a null
                    // sentinel, matching the "bodies" convention above.
                    var activeVessel = ActiveVesselScope.Current;
                    if (activeVessel != null)
                    {
                        // Closest approach comes from the elected propagation
                        // provider (stock Kepler by default; an n-body provider when
                        // elected), sampled on this main thread at the current UT.
                        // Null when there's no target / no encounter -- stamped onto
                        // vessel.target below.
                        var closestApproach = SolveClosestApproach(ut);
                        values["vessel"] = BuildVesselEntry(activeVessel, _actionGroupsBackend?.Invoke(), _maneuverPlanSource?.Invoke(), closestApproach, _thrustObserver, ut);

                        // Science + parts/power/robotics capture-adds (this
                        // session) - both require an active vessel to have
                        // any parts to walk, so they're gated here alongside
                        // "vessel" itself rather than sampled unconditionally
                        // like "career" below. TryBuildGroup gives each its
                        // own try/catch-and-omit, same "one group's failure
                        // doesn't take out another" discipline as every
                        // vessel.* group above.
                        TryBuildGroup(values, "science", () => BuildScience(activeVessel));
                        TryBuildGroup(values, "parts", () => BuildParts(activeVessel));

                        // target.available -- everything the active vessel
                        // could target right now (generic ITargetable
                        // enumeration -- vessels, bodies, in-range docking
                        // ports). Active-vessel-scoped: distance,
                        // self-exclusion and isCurrent all need it. Its own
                        // TryBuildGroup so an enumeration hiccup can't take out
                        // the vessel/parts groups.
                        TryBuildGroup(values, "targetAvailable", () => BuildTargetAvailable(activeVessel));
                    }

                    // M3 R3 capture-add: the FULL known-vessel roster (not
                    // just the active one) -- system.vessels' raw source, for
                    // TargetPicker-style widgets. Same "omit the key entirely
                    // rather than emit an empty list when there's truly
                    // nothing yet" convention as "bodies" above; an empty
                    // FlightGlobals.Vessels (e.g. a save with nothing
                    // launched yet) still legitimately reports an EMPTY list
                    // here, never omits the key, since FlightGlobals itself
                    // is ready.
                    var allVessels = FlightGlobals.Vessels;
                    if (allVessels != null)
                    {
                        var roster = new List<object?>(allVessels.Count);
                        foreach (var candidate in allVessels)
                        {
                            if (candidate == null)
                            {
                                continue;
                            }
                            roster.Add(BuildVesselRosterEntry(candidate));
                        }
                        values["vessels"] = roster;
                    }
                }

                // Time-warp/pause (G-5) is global game state, not tied to a
                // vessel or even FlightGlobals readiness - guarded in its own
                // try so a TimeWarp/FlightDriver hiccup can't take out
                // bodies/vessel above.
                try
                {
                    values["time"] = BuildTime();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] time snapshot build failed, omitting: " + ex);
                }

                // Career/KSC state (funds/reputation/science, facility
                // levels+costs, contracts, strategies, unlocked tech) is
                // ALSO global game state, not tied to FlightGlobals/a scene -
                // same "own try so a hiccup here can't take out bodies/
                // vessel" reasoning as "time" above. BuildCareer itself
                // returns null (the key is omitted entirely, never a
                // fabricated empty group) whenever the active save isn't
                // career mode - see its own doc comment.
                try
                {
                    var career = BuildCareer(_economyBackend?.Invoke(), ut);
                    if (career != null)
                    {
                        values["career"] = career;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] career snapshot build failed, omitting: " + ex);
                }

                // Whole-career R&D archive - global ground-side truth like
                // "career" above, so it's captured here rather than inside
                // the FlightGlobals/active-vessel block. Deliberately a
                // TOP-LEVEL "scienceArchive" key rather than nested under
                // "science": that group is entirely omitted with no active
                // vessel (see BuildScience's own guard above), but the
                // archive must stream at the Space Center with nothing
                // flying. BuildScienceArchive itself returns null when
                // ResearchAndDevelopment.Instance is null (Sandbox has no
                // archive to walk).
                TryBuildGroup(values, "scienceArchive", () => BuildScienceArchive());

                // Game mode (SANDBOX / CAREER / SCIENCE_SANDBOX / ...) is a
                // ground-side game-global fact, captured in ALL modes - unlike
                // BuildCareer above, which returns null outside CAREER. A
                // sandbox/science save still needs widgets (SpaceCenterStatus,
                // TechTree, ...) to know which mode it is, and career.status
                // can't carry it (it's null in those modes). Own try so a
                // HighLogic hiccup can't take out the rest. The key is omitted
                // entirely when no game is loaded (main menu) - the provider
                // maps that to a null payload, "no data yet."
                try
                {
                    var gameMode = BuildGameMode();
                    if (gameMode != null)
                    {
                        values["gameMode"] = gameMode;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] game-mode snapshot build failed, omitting: " + ex);
                }

                // Installed-DLC capability (game.dlc) is a ground-side,
                // scene-independent game fact - which expansions the install
                // has, NOT vessel/scene state - so it's captured
                // unconditionally here (no FlightGlobals gate), in its own try
                // so an ExpansionsLoader hiccup can't take out the groups
                // above. This is the Meta.Dlc path a widget uses to tell "no
                // DLC" apart from "DLC present, nothing deployed yet."
                try
                {
                    values["dlc"] = BuildDlc();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] dlc snapshot build failed, omitting: " + ex);
                }

                // Revert-availability (ksp.revertAvailability) is a flight-scene
                // fact - whether the two stock "revert" actions are available
                // right now - so it's gated to the flight scene rather than
                // captured unconditionally: FlightDriver's static flags carry
                // stale values from the previous flight in other scenes, so
                // omitting the key outside flight is what lets the provider tell
                // "not in flight" apart from "in flight, revert unavailable."
                // Own try so a FlightDriver hiccup can't take out the groups
                // above.
                try
                {
                    if (HighLogic.LoadedSceneIsFlight)
                    {
                        values["revert"] = BuildRevertAvailability();
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] revert-availability snapshot build failed, omitting: " + ex);
                }

                // Current scene (spaceCenter.scene) is a global game fact -
                // resolvable in every scene, not tied to FlightGlobals - so it's
                // captured unconditionally here. The RAW GameScenes enum name is
                // passed through (not pre-mapped); SpaceCenterViewProvider.BuildScene
                // owns the fold to the six output strings, the same capture->provider
                // split as gameMode->CareerViewProvider. Own try so a HighLogic hiccup
                // can't take out the groups above.
                try
                {
                    values["scene"] = BuildScene();
                    // Active launch site: the site currently selected in the
                    // editor (EditorLogic.launchSiteName). EditorLogic.fetch is
                    // null outside the editor, so this is null in flight / the
                    // space center: the provider passes it straight onto
                    // spaceCenter.scene.launchSite.
                    values["activeLaunchSite"] = BuildActiveLaunchSite();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] scene snapshot build failed, omitting: " + ex);
                }

                // Launch sites (spaceCenter.launchSites) are the PSystemSetup
                // union - stock KSC pad + runway, Making History sites, and any
                // Kerbal Konstructs sites (KK registers into the same list via
                // AddLaunchSite, so no reflection/hard-link needed). Ground-side
                // facts, resolvable at the space center too, so captured
                // unconditionally (no FlightGlobals gate); BuildSpaceCenter omits
                // the key by returning null when PSystemSetup.Instance isn't ready
                // pre-load. Own try so a PSystemSetup hiccup can't take out the
                // groups above.
                try
                {
                    var spaceCenter = BuildSpaceCenter();
                    if (spaceCenter != null)
                    {
                        values["spaceCenter"] = spaceCenter;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] space-center snapshot build failed, omitting: " + ex);
                }

                // Crew roster, saved ships and the buildable-part count share the
                // "spaceCenter" group but each has its own scene/career gating
                // (crew needs HighLogic.CurrentGame, saved ships + part count are
                // career-gated), so each is built and attached independently -
                // a null or failure in one never drops the others or launchSites.
                // The saved-ships disk walk is throttled to the keyframe cadence
                // inside its builder; the rest are in-memory reads.
                AttachSpaceCenterGroup(values, "crewRoster", () => BuildCrewRoster(ut));
                AttachSpaceCenterGroup(values, "astronautComplex", () => BuildAstronautComplex(ut));
                AttachSpaceCenterGroup(values, "savedShips", () => BuildSavedShips(ut));
                AttachSpaceCenterGroup(values, "partsAvailable", () => BuildPartsAvailable());
                AttachSpaceCenterGroup(values, "contractTargets", BuildContractTargets);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] Sample() failed, returning a degraded snapshot: " + ex);
            }

            return new KspSnapshot { Ut = ut, Values = values };
        }

        // ----------------------------------------------------------------
        // Vessel telemetry
        // ----------------------------------------------------------------

        /// <summary>
        /// Resources tracked in <see cref="BuildResources"/>. Any resource a
        /// vessel doesn't actually carry (maxAmount == 0) is omitted rather
        /// than reported as a false <c>{0,0}</c> - the point of the omission
        /// is to distinguish "vessel has no fuel cells" from "vessel simply
        /// doesn't carry ElectricCharge at all."
        /// </summary>
        private static readonly string[] TrackedResourceNames =
        {
            "LiquidFuel", "Oxidizer", "SolidFuel", "MonoPropellant",
            "ElectricCharge", "XenonGas", "Ore", "Ablator",
        };

        /// <summary>
        /// Primitives-only snapshot of <paramref name="vessel"/>, grouped by
        /// concern (identity/orbit/flight/attitude/resources/thermal/
        /// control/comms/misc). Each group is built independently and
        /// wrapped via <see cref="TryBuildGroup"/> so one group throwing
        /// (e.g. a resource lookup on a vessel mid-destruction) degrades
        /// only that group, not the whole vessel entry - matching this
        /// class's existing "never let Sample() throw" discipline.
        /// </summary>
        private static Dictionary<string, object?> BuildVesselEntry(Vessel vessel, IActionGroupsBackend? actionGroupsBackend, IManeuverPlanSource? maneuverPlanSource, ClosestApproach? closestApproach, ThrustObserver thrustObserver, double ut)
        {
            // vessel.orbit is a computed property (orbitDriver.orbit) that
            // NREs if orbitDriver is null (e.g. a just-spawned/EVA vessel
            // before its OrbitDriver attaches) - read the field directly and
            // guard here once, rather than in every group that needs it.
            var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;

            var entry = new Dictionary<string, object?>();
            TryBuildGroup(entry, "identity", () => BuildIdentity(vessel, orbit));
            TryBuildGroup(entry, "orbit", () => BuildOrbit(orbit));
            TryBuildGroup(entry, "flight", () => BuildFlight(vessel));
            TryBuildGroup(entry, "attitude", () => BuildAttitude(vessel, orbit));
            TryBuildGroup(entry, "resources", () => BuildResources(vessel));
            TryBuildGroup(entry, "thermal", () => BuildThermal(vessel));
            TryBuildGroup(entry, "control", () => BuildControl(vessel, actionGroupsBackend));
            TryBuildGroup(entry, "physics", () => BuildPhysics(vessel));
            TryBuildGroup(entry, "comms", () => BuildComms(vessel));
            TryBuildGroup(entry, "crew", () => BuildCrew(vessel));
            TryBuildGroup(entry, "inventories", () => BuildInventories(vessel));
            TryBuildGroup(entry, "misc", () => BuildMisc(vessel));
            TryBuildGroup(entry, "propulsion", () => BuildPropulsion(vessel, thrustObserver, ut));
            // ONE Plan() call per capture: it reads live KSP, so asking twice
            // is both wasted work and an invitation for the two answers to
            // disagree within a single tick.
            var plan = maneuverPlanSource?.Plan();
            TryBuildGroup(entry, "maneuverNodes", () => BuildManeuverNodes(plan));
            if (plan != null)
            {
                // Names the planner that answered, and its ABSENCE is how
                // "there is no planner" reaches the wire at all: an empty node
                // list cannot say it. See VesselManeuver.Planner.
                entry["maneuverPlanner"] = maneuverPlanSource!.ProviderId;
            }
            TryBuildGroup(entry, "target", () => BuildTarget(vessel, closestApproach));
            TryBuildGroup(entry, "dock", () => BuildDock(vessel));
            TryBuildGroup(entry, "surface", () => BuildSurface(vessel, orbit));
            TryBuildGroup(entry, "landing", () => BuildLanding(vessel, orbit));
            // ---- P1b slice 2 topology capture-add: the full part tree the
            // vessel.parts channel (VesselPartsViewProvider) maps. Same
            // try/omit discipline; per-part reads are individually guarded in
            // BuildTopology so one bad part can't blank the list.
            TryBuildGroup(entry, "topology", () => BuildTopology(vessel));
            // ---- P1b slice 2 stage-ΔV capture-add: KSP's STOCK VesselDeltaV
            // stage simulation (dv.stages / dv.summary channels,
            // StageDeltaVViewProvider). The new stage-simulation capture path;
            // heavier than a field read, so its own try/omit group. Omitted
            // (BuildDeltaV returns null) until the stock sim is ready, the
            // TryBuildGroup + null-return pattern already carries "not ready yet"
            // through to the provider as a null payload.
            TryBuildGroup(entry, "deltaV", () => BuildDeltaV(vessel));
            return entry;
        }

        /// <summary>
        /// <paramref name="build"/> returns <c>object?</c> rather than
        /// <c>Dictionary&lt;string, object?&gt;?</c> so this same helper covers
        /// both per-group dictionaries (identity/orbit/flight/...) and
        /// per-group LISTS (maneuverNodes) - both are valid
        /// <see cref="KspSnapshot.Values"/> shapes, and a single
        /// try/catch-and-omit helper keeps one group's failure from
        /// degrading any other.
        /// </summary>
        private static void TryBuildGroup(Dictionary<string, object?> entry, string key, Func<object?> build)
        {
            try
            {
                entry[key] = build();
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel." + key + " build failed, omitting: " + ex);
            }
        }

        private static Dictionary<string, object?> BuildIdentity(Vessel vessel, Orbit? orbit)
        {
            var parentBody = orbit?.referenceBody;
            return new Dictionary<string, object?>
            {
                ["name"] = vessel.vesselName,
                ["vesselType"] = vessel.vesselType.ToString(),
                ["id"] = vessel.id.ToString(),
                ["situation"] = vessel.situation.ToString(),
                ["parentBody"] = parentBody != null ? parentBody.bodyName : null,
            };
        }

        /// <summary>
        /// Same raw shape <see cref="BuildBodyEntry"/> uses for a body's
        /// orbit (sma/ecc/inc/lan/argPe/meanAnomalyAtEpoch/epoch), plus
        /// <c>mu</c> (the parent body's <c>gravParameter</c>, for
        /// dead-reckoning on the replay/consumer side), the
        /// apoapsis/periapsis altitudes callers actually display, the
        /// GROUND-TRUTH state vector (<c>truthPosition</c>/<c>truthVelocity</c>
        /// - see below) plus the <c>truthFrameRotating</c> flag that gates
        /// whether that vector is even comparable to a propagator, and the
        /// next patch/encounter (see below).
        ///
        /// <para><b>Ground truth (G-6):</b> <c>orbit.pos</c>/<c>orbit.vel</c>
        /// are KSP's OWN maintained state vectors - <c>Orbit.UpdateFromUT</c>
        /// derives them from the exact same six elements captured above
        /// (sma/ecc/inc/lan/argPe/meanAnomalyAtEpoch/epoch) via a
        /// perifocal-to-inertial rotation built from <c>OrbitFrame</c>
        /// (itself constructed from those same elements). Critically, the
        /// frame that rotation lands in depends on <c>referenceBody.
        /// inverseRotation</c>, captured here as <c>truthFrameRotating</c>:
        /// KSP flips a body into the ROTATING regime
        /// (<c>inverseRotation == true</c>) whenever the vessel drops below
        /// that body's <c>inverseRotThresholdAltitude</c> - i.e. low orbit,
        /// atmospheric flight, or landed, which is the common case in any
        /// real recording. <c>truthFrameRotating == false</c> (the INERTIAL
        /// regime, high orbit) is the ONLY case where <c>truthPosition</c>/
        /// <c>truthVelocity</c> sit in the fixed, non-rotating "Zup" frame
        /// (<c>Planetarium.ZupAtT</c>) that the six elements above are
        /// themselves defined against, and are therefore directly comparable
        /// to an elements-based reconstruction using the standard
        /// Vallado/AIAA 3-1-3 rotation (inc, then LAN, then argPe - see
        /// <c>Sitrep.Propagation.KeplerProvider</c>). When
        /// <c>truthFrameRotating == true</c>, the truth vectors are instead
        /// expressed in a frame CO-ROTATING with the body's spin, so they
        /// diverge from <c>KeplerProvider.Solve</c>'s fixed-frame output by a
        /// rotation about the body's polar axis that GROWS with elapsed
        /// time - any M1 propagator diff MUST gate on this flag (or restrict
        /// the comparison to inertial-regime windows) rather than assume a
        /// single fixed frame throughout a recording. Reported
        /// parent-body-relative, matching every other vector in this
        /// dictionary.</para>
        ///
        /// <para><b>Encounter (G-9, fixed - see the M1 Task 4 wart-fix
        /// report):</b> <c>nextPatch</c> is routinely non-null WITHOUT there
        /// being a genuine upcoming SOI transition - KSP leaves a stale/
        /// inactive patch attached in the common case, which the ORIGINAL
        /// (buggy) version of this method reported as a fabricated encounter
        /// on essentially every tick (809/816 orbit samples in the M1
        /// reference recording, transitionType <c>FINAL</c> every time - never
        /// a real encounter or escape). Fixed by requiring BOTH
        /// <c>nextPatch.activePatch</c> (the patch is actually part of the
        /// currently active patched-conics solution, not a leftover/
        /// beyond-the-conics-patch-limit one: the chain must be walked only
        /// <c>while (activePatch)</c>, or leftover patches from a superseded
        /// solution are reported as though they were still ahead) AND
        /// <c>orbit.patchEndTransition</c> being genuinely <c>ENCOUNTER</c> or
        /// <c>ESCAPE</c> (never <c>FINAL</c>/<c>INITIAL</c>/<c>MANEUVER</c>/
        /// <c>COLLISION</c>). Confirmed via decompile:
        /// <c>Orbit.activePatch</c> is a plain <c>bool</c> field on the patch
        /// itself (read off <c>nextPatch</c>, not the current <c>orbit</c>).
        /// <c>encounter</c> is null whenever either condition fails - never a
        /// sentinel. When present, <c>transitionType</c> is
        /// <c>orbit.patchEndTransition</c> and <c>body</c> is the body of the
        /// patch being transitioned INTO.
        /// <see cref="Sitrep.Host.VesselViewProvider.MapOrbit"/> applies the
        /// SAME transitionType restriction defensively on the mapping side,
        /// so even a payload recorded before this fix existed maps to a null
        /// encounter on replay.</para>
        /// </summary>
        internal static Dictionary<string, object?>? BuildOrbit(Orbit? orbit)
        {
            if (orbit == null)
            {
                return null;
            }

            var body = orbit.referenceBody;
            var pos = orbit.pos;
            var vel = orbit.vel;

            Dictionary<string, object?>? encounter = null;
            var nextPatch = orbit.nextPatch;
            var transition = orbit.patchEndTransition;
            if (nextPatch != null && nextPatch.activePatch &&
                (transition == Orbit.PatchTransitionType.ENCOUNTER || transition == Orbit.PatchTransitionType.ESCAPE))
            {
                var encounterBody = nextPatch.referenceBody;
                encounter = new Dictionary<string, object?>
                {
                    ["transitionType"] = transition.ToString(),
                    ["transitionUt"] = orbit.EndUT,
                    ["body"] = encounterBody != null ? encounterBody.bodyName : null,
                };
            }

            return new Dictionary<string, object?>
            {
                ["sma"] = orbit.semiMajorAxis,
                ["ecc"] = orbit.eccentricity,
                ["inc"] = orbit.inclination,
                ["lan"] = orbit.LAN,
                ["argPe"] = orbit.argumentOfPeriapsis,
                ["meanAnomalyAtEpoch"] = orbit.meanAnomalyAtEpoch,
                ["epoch"] = orbit.epoch,
                ["mu"] = body != null ? (double?)body.gravParameter : null,
                // ApA/PeA both dereference referenceBody.Radius internally -
                // only safe to call once we know body != null.
                ["apoapsisAlt"] = body != null ? (double?)orbit.ApA : null,
                ["periapsisAlt"] = body != null ? (double?)orbit.PeA : null,
                ["referenceBody"] = body != null ? body.bodyName : null,
                ["truthPosition"] = new[] { pos.x, pos.y, pos.z },
                ["truthVelocity"] = new[] { vel.x, vel.y, vel.z },
                // See the doc comment above: gates whether truthPosition/
                // truthVelocity are directly comparable to KeplerProvider's
                // fixed-frame output (false) or are in the body-co-rotating
                // frame instead (true) - null only if referenceBody itself
                // is unavailable, never a default guess.
                ["truthFrameRotating"] = body != null ? (bool?)body.inverseRotation : null,
                ["encounter"] = encounter,
                ["patches"] = BuildOrbitPatchChain(orbit),
            };
        }

        /// <summary>Bound on <see cref="BuildOrbitPatchChain"/>'s walk -- see that method's doc comment.</summary>
        private const int MaxOrbitPatches = 16;

        /// <summary>
        /// The <c>vessel.landing</c> relevance-gate closure horizon: seconds-to-
        /// terrain above which a descent is not yet "landing" and the channel
        /// stays absent. The internally-tuned metric (see <see cref="LandingModel.IsRelevant"/>);
        /// a starting value, widened/narrowed once the PQS sample cost is benchmarked.
        /// </summary>
        private const double LandingGateHorizonSeconds = 180.0;

        /// <summary>
        /// Walks a patched-conic chain starting at <paramref name="start"/>
        /// (INCLUSIVE -- element 0 of the returned list IS
        /// <paramref name="start"/> itself, restated in
        /// <see cref="Sitrep.Contract.OrbitPatch"/>'s shape) via
        /// <c>Orbit.nextPatch</c>, stopping at the first patch whose
        /// <c>nextPatch</c> is null or not <c>activePatch</c> (KSP reuses
        /// <c>Orbit</c> objects in its solver's internal pool --
        /// <c>activePatch</c> is what distinguishes a patch genuinely part of
        /// the current solved chain from a stale, recycled instance; the same
        /// signal <see cref="BuildOrbit"/>'s own encounter detection already
        /// gates on, see its doc comment). Capped at
        /// <see cref="MaxOrbitPatches"/> -- 150
        /// (<c>PatchedConicSolver.maxTotalPatches</c>) is KSP's own ceiling,
        /// but a client-side trajectory PREVIEW has no use for more than a
        /// handful of future patches.
        ///
        /// Returns null (never an empty list -- <see cref="TryBuildGroup"/>'s
        /// per-group discipline distinguishes "this field wasn't buildable"
        /// from "buildable and empty") when <paramref name="start"/> or its
        /// <c>referenceBody</c> is null. Each entry is a primitives-only
        /// <c>Dictionary&lt;string, object?&gt;</c> -- never a live
        /// <c>Orbit</c> reference (this class's "no KSP type escapes" rule,
        /// see class doc): sma/ecc/inc/lan/argPe/meanAnomalyAtEpoch/epoch/
        /// period/startUt/endUt/peA/apA/semiLatusRectum/semiMinorAxis/
        /// referenceBody/closestEncounterBody (body NAME strings, not
        /// indexes -- see <see cref="Sitrep.Contract.OrbitPatch"/>'s doc
        /// comment for why) plus patchStartTransition/patchEndTransition as
        /// the STRING name <see cref="Sitrep.Host.VesselViewProvider"/>'s
        /// <c>ParseTransitionType</c> already recognises -- KSP's own enum
        /// spells the impact case "IMPACT"; that parser's vocabulary is
        /// "COLLISION", so <see cref="MapTransition"/> translates it rather
        /// than teaching the parser a second synonym.
        /// </summary>

        /// <summary>
        /// A contract patch as the raw dictionary form the snapshot carries.
        /// The single wire encoding for a patch: the live-Orbit path reaches it
        /// through <see cref="OrbitToPatch"/>, and a maneuver-plan provider's
        /// already-typed patches come straight in. The snapshot stays
        /// dictionaries because it must round-trip through recorded JSON (see
        /// the replay tests) while a capability's return value is typed,
        /// because an interface trafficking in loose dictionaries is not a seam.
        /// </summary>
        private static Dictionary<string, object?> PatchToRaw(Sitrep.Contract.OrbitPatch patch) => new Dictionary<string, object?>
        {
            ["sma"] = patch.Sma,
            ["ecc"] = patch.Ecc,
            ["inc"] = patch.Inc,
            ["lan"] = patch.Lan,
            ["argPe"] = patch.ArgPe,
            ["meanAnomalyAtEpoch"] = patch.MeanAnomalyAtEpoch,
            ["epoch"] = patch.Epoch,
            ["period"] = patch.Period,
            ["startUt"] = patch.StartUt,
            ["endUt"] = patch.EndUt,
            ["patchStartTransition"] = patch.PatchStartTransition.ToString().ToUpperInvariant(),
            ["patchEndTransition"] = patch.PatchEndTransition.ToString().ToUpperInvariant(),
            ["peA"] = patch.PeA,
            ["apA"] = patch.ApA,
            ["semiLatusRectum"] = patch.SemiLatusRectum,
            ["semiMinorAxis"] = patch.SemiMinorAxis,
            ["referenceBody"] = patch.ReferenceBody,
            ["closestEncounterBody"] = patch.ClosestEncounterBody,
            ["mu"] = patch.Mu,
            ["referenceBodyIndex"] = patch.ReferenceBodyIndex,
            ["closestEncounterBodyIndex"] = patch.ClosestEncounterBodyIndex,
        };

        private static List<object?>? BuildOrbitPatchChain(Orbit? start)
        {
            // Absent (null) and empty are different facts here and the
            // distinction predates this walk: null means there was no orbit to
            // chain from at all, so it stays a null return rather than [].
            if (start == null || start.referenceBody == null)
            {
                return null;
            }

            return WalkPatchChain(start).ConvertAll(p => (object?)PatchToRaw(p));
        }

        /// <summary>
        /// A live KSP <c>Orbit</c> as the contract's patch POCO. The ONE place
        /// orbit fields are read off KSP, so the vessel-orbit chain and a
        /// maneuver node's post-burn chain cannot drift apart: both build this
        /// and the wire encoding happens once, in <see cref="PatchToRaw"/>.
        ///
        /// A second encoder writing a dictionary directly, beside
        /// <see cref="PatchToRaw"/>'s POCO encoder, would have to agree with it
        /// key-for-key and nothing could check that it did. Going through the
        /// POCO also puts the every-public-property wire ratchet across this
        /// path, which only reaches the POCO encoder.
        /// </summary>
        internal static Sitrep.Contract.OrbitPatch OrbitToPatch(Orbit patch)
        {
            var body = patch.referenceBody;
            var closestEncounterBody = patch.closestEncounterBody;

            return new Sitrep.Contract.OrbitPatch
            {
                Sma = patch.semiMajorAxis,
                Ecc = patch.eccentricity,
                Inc = patch.inclination,
                Lan = patch.LAN,
                ArgPe = patch.argumentOfPeriapsis,
                MeanAnomalyAtEpoch = patch.meanAnomalyAtEpoch,
                Epoch = patch.epoch,
                Period = patch.period,
                StartUt = patch.StartUT,
                EndUt = patch.EndUT,
                PatchStartTransition = MapTransition(patch.patchStartTransition),
                PatchEndTransition = MapTransition(patch.patchEndTransition),
                // PeA/ApA/semiLatusRectum all dereference referenceBody
                // internally -- safe here since the caller already gated on
                // body != null.
                PeA = patch.PeA,
                ApA = patch.ApA,
                SemiLatusRectum = patch.semiLatusRectum,
                SemiMinorAxis = patch.semiMinorAxis,
                ReferenceBody = body!.bodyName,
                ClosestEncounterBody = closestEncounterBody != null ? closestEncounterBody.bodyName : null,
                // Index is the identity and the name is the display string;
                // see OrbitPatch.ReferenceBodyIndex for why both are carried.
                ReferenceBodyIndex = body.flightGlobalsIndex,
                ClosestEncounterBodyIndex = closestEncounterBody != null
                    ? (int?)closestEncounterBody.flightGlobalsIndex
                    : null,
                // Read off the same body the elements above are relative to, so
                // a patch propagates from what it carries with no system.bodies
                // join. Matches BuildOrbit's own mu read.
                Mu = body.gravParameter,
            };
        }

        /// <summary>
        /// KSP's transition enum onto the contract's. IMPACT is the one that is
        /// not a rename: the contract calls it Collision because "impact" reads
        /// as an atmospheric entry and it also covers hitting an airless body.
        /// An unrecognised value maps to Unknown rather than throwing, since a
        /// KSP update adding a transition type must not take the uplink down.
        /// </summary>
        private static Sitrep.Contract.TransitionType MapTransition(Orbit.PatchTransitionType t)
        {
            switch (t)
            {
                case Orbit.PatchTransitionType.INITIAL:
                    return Sitrep.Contract.TransitionType.Initial;
                case Orbit.PatchTransitionType.FINAL:
                    return Sitrep.Contract.TransitionType.Final;
                case Orbit.PatchTransitionType.ENCOUNTER:
                    return Sitrep.Contract.TransitionType.Encounter;
                case Orbit.PatchTransitionType.ESCAPE:
                    return Sitrep.Contract.TransitionType.Escape;
                case Orbit.PatchTransitionType.MANEUVER:
                    return Sitrep.Contract.TransitionType.Maneuver;
                case Orbit.PatchTransitionType.IMPACT:
                    return Sitrep.Contract.TransitionType.Collision;
                default:
                    return Sitrep.Contract.TransitionType.Unknown;
            }
        }

        /// <summary>
        /// Walk a patch chain from <paramref name="start"/> as POCOs. Shared by
        /// the vessel-orbit capture and the stock plan backend's per-node
        /// post-burn chain, which is the same walk over a different starting
        /// orbit.
        /// </summary>
        internal static List<Sitrep.Contract.OrbitPatch> WalkPatchChain(Orbit? start)
        {
            var result = new List<Sitrep.Contract.OrbitPatch>();
            if (start == null || start.referenceBody == null)
            {
                return result;
            }

            var current = start;
            var guard = 0;
            while (current != null && current.referenceBody != null && guard < MaxOrbitPatches)
            {
                result.Add(OrbitToPatch(current));
                guard++;

                var next = current.nextPatch;
                if (next == null || !next.activePatch)
                {
                    break;
                }
                current = next;
            }

            return result;
        }

        private static Dictionary<string, object?> BuildFlight(Vessel vessel)
        {
            return new Dictionary<string, object?>
            {
                // latitude/longitude/altitude are NOT derivable post-hoc from
                // anything else this class captures - they're read directly
                // off Vessel's own fields (G-1), not computed.
                ["latitude"] = vessel.latitude,
                ["longitude"] = vessel.longitude,
                ["altitudeAsl"] = vessel.altitude,
                // radarAltitude is KSP's actual height-above-terrain (AGL)
                // reading - "altitudeTerrain" in the plan's naming.
                ["altitudeTerrain"] = vessel.radarAltitude,
                ["verticalSpeed"] = vessel.verticalSpeed,
                ["surfaceSpeed"] = vessel.srfSpeed,
                ["orbitalSpeed"] = vessel.obt_speed,
                ["gForce"] = vessel.geeForce,
                ["dynamicPressure"] = vessel.dynamicPressurekPa,
                ["mach"] = vessel.mach,
                ["atmDensity"] = vessel.atmDensity,
                // externalTemperature / atmosphericTemperature (G-11): plain
                // public double fields on Vessel (Kelvin) - read directly, not
                // derivable from anything else this class captures.
                ["externalTemperature"] = vessel.externalTemperature,
                ["atmosphericTemperature"] = vessel.atmosphericTemperature,
                // missionTime (G-3): confirmed via decompile as a plain
                // Vessel field. The snapshot's own game-UT (KspSnapshot.Ut)
                // already comes from Planetarium.GetUniversalTime() via
                // NowUt() above - this is the vessel-specific "time since
                // launch" clock, a different quantity.
                ["missionTime"] = vessel.missionTime,
            };
        }

        /// <summary>
        /// Heading/pitch/roll via the same construction MechJeb2 uses:
        /// build a local surface frame from the vessel's up/north vectors,
        /// then measure the vessel's reference-transform rotation against
        /// it. Reuses <paramref name="orbit"/>'s already-guarded
        /// <c>referenceBody</c> rather than the computed <c>vessel.mainBody</c>
        /// property (which would re-dereference the same possibly-null
        /// orbit driver).
        ///
        /// <para>Computes BOTH named frames (see <c>Sitrep.Contract.VesselAttitude</c>'s
        /// class doc): the surface up/north vectors are measured once from
        /// <c>vessel.CoM</c> (the primary, CoM-referenced frame) and again
        /// from <c>vessel.rootPart</c>'s position (the root-part-referenced
        /// frame) - the reference-transform ORIENTATION is shared between
        /// both, only the up/north POSITION differs, so the two frames
        /// diverge exactly when the root part sits away from the CoM.
        /// <c>rootPart</c> null (unusual - EVA kerbals still have a part) falls
        /// back to CoM so the root-frame fields degrade to a copy of the
        /// primary ones rather than going missing.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildAttitude(Vessel vessel, Orbit? orbit)
        {
            var body = orbit?.referenceBody;
            if (body == null)
            {
                return null;
            }

            var referenceTransform = vessel.GetTransform();
            if (referenceTransform == null)
            {
                return null;
            }

            var comAttitude = SurfaceAttitude(body, vessel.CoM, referenceTransform);

            var rootPart = vessel.rootPart;
            var rootPosition = rootPart != null ? (Vector3d)rootPart.transform.position : (Vector3d)vessel.CoM;
            var rootAttitude = SurfaceAttitude(body, rootPosition, referenceTransform);

            return new Dictionary<string, object?>
            {
                ["pitch"] = comAttitude.pitch,
                ["heading"] = comAttitude.heading,
                ["roll"] = comAttitude.roll,
                ["pitchRootFrame"] = rootAttitude.pitch,
                ["headingRootFrame"] = rootAttitude.heading,
                ["rollRootFrame"] = rootAttitude.roll,
            };
        }

        /// <summary>
        /// Shared surface-frame construction behind <see cref="BuildAttitude"/>'s
        /// two named frames: build a local up/north frame anchored at
        /// <paramref name="position"/> (CoM for the primary frame,
        /// <c>rootPart.transform.position</c> for the root-part frame), then
        /// measure <paramref name="referenceTransform"/>'s rotation against it
        /// (MechJeb2's construction).
        /// </summary>
        private static (double pitch, double heading, double roll) SurfaceAttitude(CelestialBody body, Vector3d position, Transform referenceTransform)
        {
            var up = (position - (Vector3d)body.position).normalized;
            var north = Vector3d.Exclude(up, body.position + (Vector3d)(body.transform.up * (float)body.Radius) - position).normalized;
            var surfaceRotation = Quaternion.LookRotation(north, up);
            var attitude = Quaternion.Inverse(Quaternion.Euler(90, 0, 0) * Quaternion.Inverse(referenceTransform.rotation) * surfaceRotation);

            var euler = attitude.eulerAngles;
            var pitch = euler.x > 180 ? 360.0 - euler.x : -(double)euler.x;
            var roll = euler.z > 180 ? euler.z - 360.0 : (double)euler.z;

            return (pitch, (double)euler.y, roll);
        }

        /// <summary>
        /// Per-named-resource {current,max} via
        /// <c>Vessel.GetConnectedResourceTotals</c> (aggregates over every
        /// connected part, respecting crossfeed - not a raw part sum). A
        /// resource id comes from <c>PartResourceLibrary.Instance.GetDefinition(name).id</c>;
        /// a name the current save's resource config doesn't define (rare,
        /// but modded installs can prune the stock list) yields a null
        /// definition and is skipped, not faulted.
        /// </summary>
        private static Dictionary<string, object?> BuildResources(Vessel vessel)
        {
            var result = new Dictionary<string, object?>();
            var library = PartResourceLibrary.Instance;
            if (library == null)
            {
                return result;
            }

            foreach (var name in TrackedResourceNames)
            {
                var definition = library.GetDefinition(name);
                if (definition == null)
                {
                    continue;
                }

                vessel.GetConnectedResourceTotals(definition.id, out var amount, out var maxAmount);
                if (maxAmount <= 0)
                {
                    // Vessel doesn't carry this resource at all - omit
                    // rather than report a misleading {0,0}.
                    continue;
                }

                result[name] = new Dictionary<string, object?>
                {
                    ["current"] = amount,
                    ["max"] = maxAmount,
                };
            }

            return result;
        }

        /// <summary>
        /// Max skin/internal temperature ratios (temperature/maxTemp) over
        /// every part, plus the raw readings for whichever part is hottest
        /// by internal-temperature ratio: and the same tracking scoped to
        /// engine parts only (any part carrying a <c>ModuleEngines</c>;
        /// covers <c>ModuleEnginesFX</c> too, see <c>BuildPropulsion</c>'s
        /// own comment for the decompile-verified subclass note). A part
        /// with <c>maxTemp &lt;= 0</c> (seen on some part configs) is
        /// excluded from that ratio rather than producing a divide-by-zero/
        /// NaN.
        ///
        /// <c>maxSkinRatio</c>/<c>maxInternalRatio</c> seed at
        /// <see cref="double.NegativeInfinity"/> (mirroring the
        /// <c>hottestRatio</c> guard two lines below) rather than 0 - a
        /// vessel where every part has <c>maxTemp &lt;= 0</c> now reports
        /// <c>null</c> for that ratio instead of an indistinguishable-from-
        /// real-data <c>0.0</c> ("no valid part" vs. "coldest possible
        /// part").
        ///
        /// "Overheating" has no dedicated KSP flag on <c>ModuleEngines</c>
        /// (verified by decompile: stock's own overheat/explosion logic is
        /// part-level, off <c>Part.temperature</c> vs <c>maxTemp</c>, not a
        /// per-module bool), so <c>anyEnginesOverheating</c> reuses the same
        /// 0.9 ratio threshold ThermalStatus's inline alert copy already
        /// states ("Engine overheating (&gt;90% max)").
        /// </summary>
        private static Dictionary<string, object?>? BuildThermal(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            const double EngineOverheatRatio = 0.9;

            var maxSkinRatio = double.NegativeInfinity;
            var maxInternalRatio = double.NegativeInfinity;
            Part? hottest = null;
            var hottestRatio = double.NegativeInfinity;

            Part? hottestEngine = null;
            var hottestEngineRatio = double.NegativeInfinity;
            var anyEnginesOverheating = false;
            var hasAnyEngine = false;

            // Hottest ablative heat shield: the part carrying a ModuleAblator with
            // the highest internal temperature. Temperature is Part.temperature in
            // Kelvin (converted to °C below); flux is the ablator's own heat flux.
            Part? hottestShield = null;
            var hottestShieldTemp = double.NegativeInfinity;
            double hottestShieldFlux = 0;

            foreach (var part in parts)
            {
                if (part == null)
                {
                    continue;
                }

                var engines = part.Modules != null ? part.Modules.GetModules<ModuleEngines>() : null;
                var isEnginePart = engines != null && engines.Count > 0;

                if (part.maxTemp > 0)
                {
                    var internalRatio = part.temperature / part.maxTemp;
                    if (internalRatio > maxInternalRatio)
                    {
                        maxInternalRatio = internalRatio;
                    }
                    if (internalRatio > hottestRatio)
                    {
                        hottestRatio = internalRatio;
                        hottest = part;
                    }

                    if (isEnginePart)
                    {
                        hasAnyEngine = true;
                        if (internalRatio > hottestEngineRatio)
                        {
                            hottestEngineRatio = internalRatio;
                            hottestEngine = part;
                        }
                        if (internalRatio >= EngineOverheatRatio)
                        {
                            anyEnginesOverheating = true;
                        }
                    }
                }

                if (part.skinMaxTemp > 0)
                {
                    var skinRatio = part.skinTemperature / part.skinMaxTemp;
                    if (skinRatio > maxSkinRatio)
                    {
                        maxSkinRatio = skinRatio;
                    }
                }

                var ablators = part.Modules != null ? part.Modules.GetModules<ModuleAblator>() : null;
                if (ablators != null && ablators.Count > 0 && part.temperature > hottestShieldTemp)
                {
                    hottestShieldTemp = part.temperature;
                    hottestShield = part;
                    hottestShieldFlux = ablators[0].flux;
                }
            }

            var result = new Dictionary<string, object?>
            {
                ["maxSkinTempRatio"] = double.IsNegativeInfinity(maxSkinRatio) ? (double?)null : maxSkinRatio,
                ["maxInternalTempRatio"] = double.IsNegativeInfinity(maxInternalRatio) ? (double?)null : maxInternalRatio,
            };

            if (hottest != null)
            {
                result["hottestPartInternalTemp"] = hottest.temperature;
                result["hottestPartMaxTemp"] = hottest.maxTemp;
                result["hottestPartSkinTemp"] = hottest.skinTemperature;
                result["hottestPartSkinMaxTemp"] = hottest.skinMaxTemp;
                result["hottestPartName"] = hottest.partInfo != null ? hottest.partInfo.title : hottest.name;
            }

            if (hottestShield != null)
            {
                // Kelvin, raw: the same unit as every other temperature on this
                // channel. Celsius is a PRESENTATION choice and belongs in the
                // client, not on the wire. Flux passes through in the ablator's
                // own units (kW).
                result["heatShieldTemp"] = hottestShieldTemp;
                result["heatShieldFlux"] = hottestShieldFlux;
            }

            if (hottestEngine != null)
            {
                result["hottestEngineTemp"] = hottestEngine.temperature;
                result["hottestEngineMaxTemp"] = hottestEngine.maxTemp;
                result["hottestEngineTempRatio"] = hottestEngineRatio;
            }

            if (hasAnyEngine)
            {
                result["anyEnginesOverheating"] = anyEnginesOverheating;
            }

            return result;
        }

        /// <summary>
        /// <paramref name="actionGroupsBackend"/> is the ELECTED action-groups
        /// backend (stock, or AGX once that phase lands), resolved by
        /// <see cref="GonogoAddon"/> and threaded down here rather than read
        /// from a global, exactly as <c>maneuverNodeIdRegistry</c> is.
        ///
        /// <para>This is the ONLY correct place to call it: the backend reads
        /// LIVE KSP, and this method runs on the main thread as part of the
        /// snapshot capture. A channel-source closure
        /// (<c>VesselViewProvider.BuildControlWire</c>) may run on the Courier
        /// thread and must never touch a backend, the same reason
        /// <see cref="CommsCoreUplink"/> reads its backend from
        /// <c>CaptureOnMain</c> rather than from its channel sources. See
        /// <see cref="IActionGroupsBackend"/>'s threading note.</para>
        /// </summary>
        private static Dictionary<string, object?> BuildControl(Vessel vessel, IActionGroupsBackend? actionGroupsBackend)
        {
            var actionGroups = vessel.ActionGroups;
            var autopilot = vessel.Autopilot;
            var ctrlState = vessel.ctrlState;

            var result = new Dictionary<string, object?>
            {
                ["sas"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.SAS] : null,
                ["sasMode"] = autopilot != null ? autopilot.Mode.ToString() : null,
                ["rcs"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.RCS] : null,
                ["gear"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.Gear] : null,
                ["brakes"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.Brakes] : null,
                ["lights"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.Light] : null,
                ["abort"] = actionGroups != null ? (bool?)actionGroups[KSPActionGroup.Abort] : null,
                // Precision (fine-control) mode is a global flight-input singleton,
                // not a per-vessel field. Null when there's no active flight scene.
                ["precisionControl"] = FlightInputHandler.fetch != null ? (bool?)FlightInputHandler.fetch.precisionMode : null,
                ["throttle"] = ctrlState != null ? (double?)ctrlState.mainThrottle : null,
                // Commanded fly-by-wire axis inputs: the ECHO half of the
                // vessel.control.{pitch,yaw,roll,translationX/Y/Z} setAxes stream
                // channels (VesselControl.cs). KSP's FlightCtrlState holds the
                // currently-applied axis values (-1..1); translation is X/Y/Z.
                // Null when there's no ctrlState (no active flight). This is what
                // the client's ControlDelayStream draws as the confirmed-readback
                // track, so a delayed axis command visibly lands after the round
                // trip. LIVE-TEST-REQUIRED: confirm these reflect the applied
                // stick, not a stale zero, on a real vessel.
                ["pitch"] = ctrlState != null ? (double?)ctrlState.pitch : null,
                ["yaw"] = ctrlState != null ? (double?)ctrlState.yaw : null,
                ["roll"] = ctrlState != null ? (double?)ctrlState.roll : null,
                ["translationX"] = ctrlState != null ? (double?)ctrlState.X : null,
                ["translationY"] = ctrlState != null ? (double?)ctrlState.Y : null,
                ["translationZ"] = ctrlState != null ? (double?)ctrlState.Z : null,
            };

            // The NAMED custom action groups, sourced from the elected backend
            // rather than spelled out as ag1..ag10 scalars here. The ten-ness
            // of stock lives in exactly ONE place, StockActionGroupsBackend.
            // This method knows neither how many groups there are nor what they
            // are called, which is what lets an AGX backend report 250
            // player-named groups through this same code with no edit.
            //
            // Null backend / null Groups() => no "actionGroups" key at all,
            // which VesselViewProvider maps to the contract's documented "not
            // available this tick". Deliberately not an empty list.
            var groups = actionGroupsBackend?.Groups();
            if (groups != null)
            {
                var wire = new List<object?>(groups.Count);
                foreach (var group in groups)
                {
                    wire.Add(new Dictionary<string, object?>
                    {
                        ["index"] = group.Index,
                        ["name"] = group.Name,
                        ["state"] = group.State,
                    });
                }
                result["actionGroups"] = wire;
            }

            return result;
        }

        /// <summary>
        /// The active vessel's physics-simulation regime, derived from KSP's
        /// own <c>Vessel.loaded</c>/<c>Vessel.packed</c> bool fields (confirmed
        /// via decompile). Emitted as a raw string under
        /// <c>vessel.physics.mode</c>; <c>VesselViewProvider.BuildPhysicsMode</c>
        /// maps it string→enum with an Unknown fallback (same convention as
        /// sasMode). Never null: the flags are always readable on a present
        /// vessel: so this is a single-key sub-group, not a whole-group
        /// absence case:
        /// <list type="bullet">
        /// <item><c>!loaded</c> ⇒ <c>OnRails</c></item>
        /// <item><c>loaded &amp;&amp; packed</c> ⇒ <c>Packed</c></item>
        /// <item><c>loaded &amp;&amp; !packed</c> ⇒ <c>Unpacked</c></item>
        /// </list>
        /// </summary>
        private static Dictionary<string, object?> BuildPhysics(Vessel vessel)
        {
            string mode;
            if (!vessel.loaded)
            {
                mode = "OnRails";
            }
            else if (vessel.packed)
            {
                mode = "Packed";
            }
            else
            {
                mode = "Unpacked";
            }

            return new Dictionary<string, object?>
            {
                ["mode"] = mode,
            };
        }

        private static Dictionary<string, object?>? BuildComms(Vessel vessel)
        {
            var connection = vessel.connection;
            if (connection == null)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["connected"] = connection.IsConnected,
                ["signalStrength"] = connection.SignalStrength,
                ["controlState"] = connection.ControlState.ToString(),
            };
        }

        /// <summary>
        /// The <c>vessel.crew</c> roster + capacity (G-13 additive growth of the
        /// count-only channel). <c>Vessel.GetVesselCrew()</c> (verified: returns
        /// <c>List&lt;ProtoCrewMember&gt;</c>) walked per member for
        /// <c>name</c>/<c>trait</c>/<c>experienceLevel</c> (public fields) plus the
        /// <c>type</c> (<c>KerbalType</c>) and <c>rosterStatus</c>
        /// (<c>RosterStatus</c>) enums captured as string names;
        /// <c>Vessel.GetCrewCapacity()</c> (verified: returns <c>int</c>) for the
        /// seat count.
        /// </summary>
        /// <summary>
        /// Every part-hosted cargo hold on the vessel.
        ///
        /// <para>Parts only. A kerbal's own two slots ride on the crew group
        /// instead, beside the trait and experience level that decide whether
        /// they may act, because "what is aboard" and "who can do this now"
        /// are read at different moments by different surfaces.</para>
        /// </summary>
        private static Dictionary<string, object?> BuildInventories(Vessel vessel)
        {
            var stores = new List<object?>();
            var parts = vessel.parts;
            if (parts != null)
            {
                foreach (var part in parts)
                {
                    var inventory = part?.FindModuleImplementing<ModuleInventoryPart>();
                    if (inventory == null)
                    {
                        continue;
                    }

                    var row = new Dictionary<string, object?>
                    {
                        ["partId"] = part!.flightID.ToString(),
                        ["partName"] = part.partInfo?.title,
                    };
                    AddInventoryFields(row, inventory);
                    stores.Add(row);
                }
            }

            return new Dictionary<string, object?> { ["stores"] = stores };
        }

        private static Dictionary<string, object?> BuildCrew(Vessel vessel)
        {
            var members = new List<object?>();
            var roster = vessel.GetVesselCrew();
            if (roster != null)
            {
                foreach (var member in roster)
                {
                    if (member == null)
                    {
                        continue;
                    }

                    var crewRow = new Dictionary<string, object?>
                    {
                        ["name"] = member.name,
                        ["trait"] = member.trait,
                        ["experienceLevel"] = member.experienceLevel,
                        ["type"] = member.type.ToString(),
                        ["rosterStatus"] = member.rosterStatus.ToString(),
                    };
                    /*
                     * What this kerbal is personally carrying, read from their
                     * own inventory module rather than from an EVA part. A
                     * SEATED kerbal still has one: KerbalInventoryModule is on
                     * the ProtoCrewMember itself, so this works in flight
                     * without anyone going outside, which is the whole point
                     * for a command centre that cannot send anyone outside.
                     */
                    AddInventoryFields(crewRow, member.KerbalInventoryModule);
                    members.Add(crewRow);
                }
            }

            return new Dictionary<string, object?>
            {
                ["capacity"] = vessel.GetCrewCapacity(),
                ["members"] = members,
            };
        }

        /// <summary>
        /// Writes an inventory module's slots, limits and contents onto a raw
        /// row, or leaves the row untouched when there is no module.
        ///
        /// <para>Absent and empty are kept distinct on purpose: a kerbal with
        /// no inventory module at all reports nothing here, while a kerbal
        /// carrying nothing reports an empty list. A consumer deciding whether
        /// someone can act needs to tell "holding none" from "cannot tell".</para>
        ///
        /// <para><c>volumeCapacity</c> is KSP's USED volume and
        /// <c>packedVolumeLimit</c> its ceiling, which read the wrong way round
        /// from the names alone.</para>
        /// </summary>
        internal static void AddInventoryFields(
            IDictionary<string, object?> row, ModuleInventoryPart? inventory)
        {
            if (inventory == null)
            {
                return;
            }

            var items = new List<object?>();
            var slotsUsed = 0;
            var stored = inventory.storedParts;
            if (stored != null)
            {
                foreach (var entry in stored.Values)
                {
                    if (entry == null || string.IsNullOrEmpty(entry.partName))
                    {
                        continue;
                    }

                    slotsUsed++;
                    var available = PartLoader.getPartInfoByName(entry.partName);
                    items.Add(new Dictionary<string, object?>
                    {
                        ["name"] = entry.partName,
                        ["title"] = available?.title,
                        ["quantity"] = entry.quantity,
                        ["packedVolume"] = available?.partPrefab
                            ?.FindModuleImplementing<ModuleCargoPart>()
                            ?.packedVolume,
                    });
                }
            }

            row["carrying"] = items;
            row["slots"] = inventory.InventorySlots;
            row["slotsUsed"] = slotsUsed;
            row["packedVolumeLimit"] = inventory.HasPackedVolumeLimit
                ? (object?)inventory.packedVolumeLimit
                : null;
            row["packedVolumeUsed"] = inventory.volumeCapacity;
            row["massLimit"] = inventory.HasMassLimit ? (object?)inventory.massLimit : null;
        }

        private static Dictionary<string, object?> BuildMisc(Vessel vessel)
        {
            var parts = vessel.parts;
            int? stageCount = null;
            if (parts != null && parts.Count > 0)
            {
                var maxInverseStage = -1;
                foreach (var part in parts)
                {
                    if (part != null && part.inverseStage > maxInverseStage)
                    {
                        maxInverseStage = part.inverseStage;
                    }
                }
                if (maxInverseStage >= 0)
                {
                    stageCount = maxInverseStage + 1;
                }
            }

            return new Dictionary<string, object?>
            {
                ["crewCount"] = vessel.GetCrewCount(),
                ["currentStage"] = vessel.currentStage,
                ["stageCount"] = stageCount,
                ["partCount"] = parts != null ? (int?)parts.Count : null,
            };
        }

        /// <summary>
        /// Mass and thrust (G-4) - the TWR / dead-reckoning-under-thrust
        /// foundation. <c>dryMass</c> is summed from <c>Part.mass</c> (which
        /// is itself the part's dry mass - <c>Part.resourceMass</c> is
        /// tracked separately by KSP), NOT derived from
        /// <c>vessel.totalMass</c> minus anything, since summing the
        /// per-part field neither needs nor risks a resource-mass mismatch.
        /// Thrust sums every <c>ModuleEngines</c> (covers
        /// <c>ModuleEnginesFX</c> too - confirmed via decompile that it
        /// subclasses <c>ModuleEngines</c>, so <c>GetModules&lt;ModuleEngines&gt;()</c>
        /// already returns both) across every part: <c>finalThrust</c> for
        /// CURRENT thrust (kN, zero when not firing), and <c>GetMaxThrust()</c>
        /// for AVAILABLE thrust - but only from engines that are actually
        /// <c>EngineIgnited &amp;&amp; !flameout</c>, so a shut-down or
        /// flamed-out stage's rated thrust doesn't inflate "what can this
        /// vessel produce right now."
        /// </summary>
        /// <summary>
        /// <paramref name="thrustObserver"/> is fed the thrust this method
        /// already measures, and answers with the two LATCHED instants that
        /// describe it over time. The walk stays here; the state machine is
        /// pure and lives in <c>Sitrep.Host</c>, same split as
        /// <see cref="BurnTiming"/>.
        /// </summary>
        private static Dictionary<string, object?> BuildPropulsion(Vessel vessel, ThrustObserver thrustObserver, double ut)
        {
            var parts = vessel.parts;
            double dryMass = 0;
            double currentThrust = 0;
            double availableThrust = 0;

            if (parts != null)
            {
                foreach (var part in parts)
                {
                    if (part == null)
                    {
                        continue;
                    }

                    dryMass += part.mass;

                    var engines = part.Modules != null ? part.Modules.GetModules<ModuleEngines>() : null;
                    if (engines == null)
                    {
                        continue;
                    }

                    foreach (var engine in engines)
                    {
                        if (engine == null)
                        {
                            continue;
                        }

                        currentThrust += engine.finalThrust;
                        if (engine.EngineIgnited && !engine.flameout)
                        {
                            availableThrust += engine.GetMaxThrust();
                        }
                    }
                }
            }

            // Thrust is only READABLE on a loaded, unpacked craft: an on-rails
            // vessel has no parts to walk and so reports nothing, which is a
            // fact about the simulation and not about the engines. Passing that
            // through as a genuine zero would latch a shutdown every time the
            // operator switched away from a burning craft.
            var measurable = vessel.loaded && !vessel.packed;
            thrustObserver.Observe(vessel.id.ToString(), ut, currentThrust, measurable);

            return new Dictionary<string, object?>
            {
                ["totalMass"] = vessel.totalMass,
                ["dryMass"] = dryMass,
                ["currentThrust"] = currentThrust,
                ["availableThrust"] = availableThrust,
                ["thrustStartedUt"] = thrustObserver.ThrustStartedUt,
                ["lastThrustEndUt"] = thrustObserver.LastThrustEndUt,
            };
        }

        /// <summary>
        /// Planned burns (G-7) - null (not an empty list) whenever the
        /// vessel has no maneuver nodes queued, which is the common case;
        /// present whenever the player (or MechJeb, or a script) has queued
        /// at least one. <c>ManeuverNode.DeltaV</c> is in the node's own
        /// radial/normal/prograde frame, and the axis order is not the one
        /// the field name suggests: x=radial, y=normal, z=prograde.
        /// Established by decompile, and easy to get backwards. <c>solver.maneuverNodes</c> is already
        /// ordered by <c>UT</c> (the order the player queued them / the
        /// order they'll execute).
        /// </summary>
        private static List<object?>? BuildManeuverNodes(IList<Sitrep.Contract.ManeuverNode>? plan)
        {
            // Whatever the ELECTED provider answered, never patchedConicSolver
            // directly. Stock's own solver reaches here through
            // StockManeuverPlanBackend, the capability's vanilla, so nothing in
            // this file knows or cares which planner answered.
            if (plan == null)
            {
                // No planner at all, which is not the same fact as no burns and
                // is a state stock reaches on its own (an un-upgraded Tracking
                // Station leaves patchedConicSolver null). Omitting the group
                // is how that travels; the planner id below is what lets the
                // mapper tell it apart from an empty plan.
                return null;
            }

            var list = new List<object?>(plan.Count);
            foreach (var node in plan)
            {
                if (node == null)
                {
                    continue;
                }

                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = node.Id,
                    ["ut"] = node.Ut,
                    ["dvRadial"] = node.DvRadial,
                    ["dvNormal"] = node.DvNormal,
                    ["dvPrograde"] = node.DvPrograde,
                    ["dvTotal"] = node.DvTotal,
                    ["ignitionUt"] = node.IgnitionUt,
                    ["cutoffUt"] = node.CutoffUt,
                    ["frame"] = node.Frame == null ? null : node.Frame.Value.ToString(),
                    ["patches"] = node.Patches.ConvertAll(PatchToRaw),
                });
            }

            return list;
        }

        /// <summary>
        /// The M3 R3 <c>system.vessels</c> roster capture-add's raw per-vessel
        /// entry (primitives only, same discipline as every other Build*
        /// helper in this class): id/name/vesselType/situation/mainBody, plus
        /// the FleetRoster crew/comms capture-add (crewCount/crewCapacity/
        /// commsConnected/commsControlSource), plus the vessel's own orbital
        /// elements (see <see cref="AddRosterOrbitFields"/>).
        /// <c>mainBody</c> is the raw BODY NAME (not yet resolved to an
        /// index -- <c>SystemViewProvider.BuildSystemVessels</c> resolves it
        /// against <c>snapshot.Values["bodies"]</c>, same two-step pattern
        /// <c>BuildIdentity</c>'s <c>parentBody</c> already uses), read off
        /// <c>orbitDriver.orbit.referenceBody</c> directly (never the
        /// computed <c>Vessel.mainBody</c> property, which NREs when
        /// <c>orbitDriver</c> is null -- e.g. a vessel that hasn't finished
        /// spawning yet -- see this class's doc comment).
        ///
        /// <para>This runs for EVERY known vessel each tick -- unlike
        /// <see cref="BuildCrew"/>/<see cref="BuildComms"/> above, which only
        /// ever see the (always-loaded) active vessel -- so most calls here
        /// are against an UNLOADED vessel. Both the crew and comms reads are
        /// therefore their own try/catch, defaulting to a null field rather
        /// than letting one bad vessel (mid-unload, a scene-transition race
        /// on a CommNet graph node that hasn't settled yet) take out this
        /// vessel's entire roster entry -- or, since the caller has no
        /// per-vessel guard of its own, the WHOLE <c>Sample()</c> capture for
        /// the tick. Debris/asteroid/Unknown-type vessels are NOT a "bad
        /// vessel" case for comms -- see <see cref="AddRosterCommsFields"/>'s
        /// own doc comment: those three types never get a CommNet node at
        /// all, by design, so their null comms fields are an expected steady
        /// state, not a caught failure.</para>
        /// </summary>
        private static Dictionary<string, object?> BuildVesselRosterEntry(Vessel vessel)
        {
            var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
            var body = orbit?.referenceBody;

            var entry = new Dictionary<string, object?>
            {
                ["id"] = vessel.id.ToString(),
                ["name"] = vessel.vesselName,
                ["vesselType"] = vessel.vesselType.ToString(),
                ["situation"] = vessel.situation.ToString(),
                ["mainBody"] = body != null ? body.bodyName : null,
            };

            AddRosterCrewFields(entry, vessel);
            AddRosterCommsFields(entry, vessel);
            AddRosterOrbitFields(entry, orbit);

            return entry;
        }

        /// <summary>
        /// This vessel's own orbital elements, same raw key set (and same
        /// <c>SystemViewProvider.BuildOrbit</c> consumer) <see cref="BuildBodyEntry"/>
        /// uses for a body's orbit: the join key that positions a roster
        /// vessel, and a SystemView graph node keyed to it, client-side. Keys
        /// are omitted entirely (never emitted as explicit nulls) when
        /// <paramref name="orbit"/> is null, so <c>SystemViewProvider</c> maps
        /// the whole thing to a null <c>OrbitEntry</c> rather than an
        /// all-null one.
        /// </summary>
        private static void AddRosterOrbitFields(Dictionary<string, object?> entry, Orbit? orbit)
        {
            if (orbit == null)
            {
                return;
            }

            entry["sma"] = orbit.semiMajorAxis;
            entry["ecc"] = orbit.eccentricity;
            entry["inc"] = orbit.inclination;
            entry["lan"] = orbit.LAN;
            entry["argPe"] = orbit.argumentOfPeriapsis;
            entry["meanAnomalyAtEpoch"] = orbit.meanAnomalyAtEpoch;
            entry["epoch"] = orbit.epoch;
        }

        /// <summary>
        /// Crew count/capacity for one <see cref="BuildVesselRosterEntry"/>
        /// entry. <c>Vessel.GetCrewCount()</c>/<c>GetCrewCapacity()</c> (the
        /// same calls <see cref="BuildCrew"/>/<see cref="BuildMisc"/> use for
        /// the always-loaded active vessel) walk live <c>Part</c>s, which an
        /// unloaded vessel doesn't have -- so for an unloaded vessel this
        /// reads <c>Vessel.protoVessel</c> instead: <c>ProtoVessel.GetVesselCrew()</c>
        /// for the roster (count = its length), and the sum of each
        /// <c>ProtoPartSnapshot</c>'s prefab <c>CrewCapacity</c> for the seat
        /// count (there is no single proto-side capacity getter). Both fields
        /// stay null (never a fabricated zero) if the vessel is unloaded with
        /// no <c>protoVessel</c> yet, or if any read throws.
        /// </summary>
        private static void AddRosterCrewFields(Dictionary<string, object?> entry, Vessel vessel)
        {
            int? crewCount = null;
            int? crewCapacity = null;
            try
            {
                if (vessel.loaded)
                {
                    crewCount = vessel.GetCrewCount();
                    crewCapacity = vessel.GetCrewCapacity();
                }
                else
                {
                    var proto = vessel.protoVessel;
                    if (proto != null)
                    {
                        // Left null when the crew list is unreadable: a null
                        // list is "could not read", not "nobody aboard", and
                        // every other field here is careful to say so.
                        crewCount = proto.GetVesselCrew()?.Count;

                        var capacity = 0;
                        var protoParts = proto.protoPartSnapshots;
                        if (protoParts != null)
                        {
                            foreach (var pps in protoParts)
                            {
                                var prefab = pps?.partInfo?.partPrefab;
                                if (prefab != null)
                                {
                                    capacity += prefab.CrewCapacity;
                                }
                            }
                        }
                        crewCapacity = capacity;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] roster crew read failed for vessel " + vessel.id + ", omitting: " + ex.Message);
                crewCount = null;
                crewCapacity = null;
            }

            entry["crewCount"] = crewCount;
            entry["crewCapacity"] = crewCapacity;
        }

        /// <summary>
        /// Comms connectivity for one <see cref="BuildVesselRosterEntry"/>
        /// entry -- a NEW, direct read of stock <c>Vessel.connection</c>
        /// against every roster vessel, deliberately NOT routed through the
        /// active-vessel-only elected-backend <c>ICommsBackend</c>/<c>CommsElection</c>
        /// machinery (<see cref="BuildComms"/> above and <c>CommNetBackend</c>
        /// are that family; they only ever run against
        /// <see cref="ActiveVesselScope.Current"/>). Stock CommNet maintains its
        /// graph for every vessel regardless of load state, so this can read
        /// a background vessel's link -- but <c>CommNetBackend.Connection</c>'s
        /// own doc comment warns that <c>connection</c>/<c>ControlPath</c> can
        /// dereference torn-down state and NRE during a scene-transition
        /// settle window; both fields stay null (never a fabricated "no
        /// link") if that happens here, or if CommNet has no connection
        /// object for this vessel at all.
        ///
        /// <para><b>Verified (decompile, <c>CommNet.CommNetVessel.OnStart</c>):</b>
        /// a null <c>vessel.connection</c> is not only the rare scene-transition
        /// race described above -- it is the PERMANENT, by-design state for
        /// three <c>VesselType</c>s. <c>CommNetVessel.OnStart</c> only assigns
        /// <c>vessel.connection = this</c> when <c>vesselType != Flag</c>,
        /// <c>vesselType &gt; Unknown</c>, and <c>vesselType != DeployedSciencePart</c>
        /// -- so <c>Debris</c>, <c>SpaceObject</c> (asteroids/comets) and
        /// <c>Unknown</c> (ordinals 0/1/2, all &lt;= <c>Unknown</c>) NEVER get a
        /// <c>CommNetVessel</c> attached at all. A debris or asteroid roster
        /// entry therefore reports <c>commsConnected</c>/<c>commsControlSource</c>
        /// as null on every tick of its life, not just an occasional unsettled
        /// one -- this is the common case for those two vessel types, not an
        /// edge case.</para>
        /// </summary>
        private static void AddRosterCommsFields(Dictionary<string, object?> entry, Vessel vessel)
        {
            bool? connected = null;
            string? controlSource = null;
            try
            {
                var conn = vessel.connection;
                if (conn != null)
                {
                    connected = conn.IsConnected;
                    controlSource = MapRosterControlSource(conn.GetControlLevel());
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] roster comms read failed for vessel " + vessel.id + ", omitting: " + ex.Message);
                connected = null;
                controlSource = null;
            }

            entry["commsConnected"] = connected;
            entry["commsControlSource"] = controlSource;
        }

        /// <summary>
        /// <c>Vessel.ControlLevel</c> -&gt; the roster's raw control-source
        /// string (mirrors <c>CommNetBackend.MapControlSource</c>'s
        /// none/partial/full tiering exactly, kept as an independent copy
        /// here since the roster read is deliberately NOT part of that
        /// backend -- see <see cref="AddRosterCommsFields"/>).
        /// </summary>
        private static string MapRosterControlSource(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return "Full";
                case Vessel.ControlLevel.PARTIAL_MANNED:
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return "Partial";
                default:
                    return "None";
            }
        }

        /// <summary>
        /// The <c>target.available</c> raw group -- the list of everything the
        /// active vessel could target right now. Built GENERICALLY: enumerate
        /// candidate <c>ITargetable</c>s from the game (vessels, bodies, and
        /// docking ports on loaded in-range vessels) and classify each by
        /// concrete type into a kind + stable id, rather than three hardcoded
        /// per-kind passes -- so a modded ITargetable falls through to "Other"
        /// with no code change. Filters the same vessel types the fork's
        /// <c>tar.availableVessels</c> did (Flag/EVA/Debris/Unknown) plus the
        /// active vessel itself; keeps SpaceObject (asteroids/comets). Each
        /// entry carries a metric <c>distance</c> to the active vessel (a
        /// coarse picker sort aid, not a HUD value) and <c>isCurrent</c> (== the
        /// live <c>VesselTarget</c>). The host-side
        /// <c>SystemViewProvider.BuildTargetAvailable</c> maps the string enums
        /// to ordinals; this producer emits the raw shapes, mirroring
        /// <see cref="BuildVesselRosterEntry"/>.
        /// </summary>
        private static Dictionary<string, object?> BuildTargetAvailable(Vessel active)
        {
            var entries = new List<object?>();
            var current = FlightGlobals.fetch != null ? FlightGlobals.fetch.VesselTarget : null;
            var activeTransform = active.GetTransform();
            Vector3d? activePos = activeTransform != null ? (Vector3d)activeTransform.position : (Vector3d?)null;

            double? DistanceTo(ITargetable t)
            {
                if (activePos == null)
                {
                    return null;
                }
                var tf = t.GetTransform();
                return tf != null ? (double?)((Vector3d)tf.position - activePos.Value).magnitude : null;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels != null)
            {
                foreach (var v in vessels)
                {
                    if (v == null || ReferenceEquals(v, active) || IsFilteredTargetVesselType(v.vesselType))
                    {
                        continue;
                    }

                    entries.Add(new Dictionary<string, object?>
                    {
                        ["kind"] = "Vessel",
                        ["name"] = v.GetName(),
                        ["vesselId"] = v.id.ToString(),
                        ["vesselType"] = v.vesselType.ToString(),
                        ["situation"] = v.situation.ToString(),
                        ["distance"] = DistanceTo(v),
                        ["isCurrent"] = ReferenceEquals(current, v),
                    });

                    // Docking ports on LOADED vessels only -- enumerating every
                    // part on every unloaded vessel is neither cheap nor useful,
                    // and only loaded ports are in physics/docking range.
                    if (v.loaded)
                    {
                        foreach (var node in v.FindPartModulesImplementing<ModuleDockingNode>())
                        {
                            if (node == null || node.part == null)
                            {
                                continue;
                            }
                            entries.Add(new Dictionary<string, object?>
                            {
                                ["kind"] = "Part",
                                ["name"] = node.GetName(),
                                ["vesselId"] = v.id.ToString(),
                                ["partId"] = node.part.flightID,
                                ["vesselType"] = v.vesselType.ToString(),
                                ["distance"] = DistanceTo(node),
                                ["isCurrent"] = ReferenceEquals(current, node),
                            });
                        }
                    }
                }
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies != null)
            {
                for (var i = 0; i < bodies.Count; i++)
                {
                    var b = bodies[i];
                    if (b == null)
                    {
                        continue;
                    }
                    entries.Add(new Dictionary<string, object?>
                    {
                        // i is the system.bodies index (BuildBodyEntry
                        // enumerates FlightGlobals.Bodies in the SAME order).
                        ["kind"] = "Body",
                        ["name"] = b.GetName(),
                        ["bodyIndex"] = i,
                        ["distance"] = DistanceTo(b),
                        ["isCurrent"] = ReferenceEquals(current, b),
                    });
                }
            }

            return new Dictionary<string, object?> { ["entries"] = entries };
        }

        /// <summary>
        /// The vessel types the available-targets list drops (same filter the
        /// fork's <c>tar.availableVessels</c> applied): flags, EVA kerbals,
        /// debris, and unclassified. SpaceObject (asteroids/comets) is
        /// deliberately kept.
        /// </summary>
        private static bool IsFilteredTargetVesselType(VesselType type) =>
            type == VesselType.Flag
            || type == VesselType.EVA
            || type == VesselType.Debris
            || type == VesselType.Unknown;

        /// <summary>
        /// The M3 R3 <c>vessel.dock</c> capture-add's raw group -- docking
        /// alignment between the active vessel's nearest FREE (not currently
        /// docked/disabled) <see cref="ModuleDockingNode"/> and the
        /// currently-targeted docking port. Null (the group omitted
        /// entirely, via <see cref="TryBuildGroup"/>'s try/catch-and-omit)
        /// whenever docking isn't relevant right now: nothing targeted, the
        /// target isn't itself a docking port (<c>ITargetable</c> also
        /// covers vessels/bodies/waypoints -- see <see cref="BuildTarget"/>'s
        /// doc comment), or this vessel has no port free to dock with.
        ///
        /// <para>"Nearest free port" (rather than e.g. the vessel's
        /// reference-transform part) is the pragmatic reading of "the
        /// vessel's controlling/reference docking port": KSP has no single
        /// "the docking port" concept for a vessel that may carry several --
        /// picking the one physically closest to the target is the port a
        /// player doing a real rendezvous is actually about to use.
        /// <c>ModuleDockingNode.state == "Ready"</c> is the confirmed
        /// (decompile) idle/available state string; a port already
        /// docked/disabled/mid-acquire is excluded.</para>
        ///
        /// <para><see cref="ModuleDockingNode.GetFwdVector"/> (not the
        /// node's raw <c>Transform.forward</c>) is used for
        /// <c>forwardDot</c> -- it's the API KSP itself exposes specifically
        /// for "which way does this docking port face," so it's safe against
        /// a docking node's local axis convention differing from its
        /// transform's own forward axis.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildDock(Vessel vessel)
        {
            var fetch = FlightGlobals.fetch;
            var target = fetch != null ? fetch.VesselTarget : null;
            if (target is not ModuleDockingNode targetPort)
            {
                // Not targeting a specific docking port -- the common case
                // (nothing targeted, or targeting a whole vessel/body
                // instead). No docking alignment to report.
                return null;
            }

            var targetTransform = targetPort.GetTransform();
            if (targetTransform == null)
            {
                return null;
            }

            ModuleDockingNode? ownPort = null;
            var bestDistanceSqr = double.MaxValue;
            var parts = vessel.parts;
            if (parts != null)
            {
                foreach (var part in parts)
                {
                    if (part == null || part.Modules == null)
                    {
                        continue;
                    }

                    var candidates = part.Modules.GetModules<ModuleDockingNode>();
                    if (candidates == null)
                    {
                        continue;
                    }

                    foreach (var candidate in candidates)
                    {
                        if (candidate == null || candidate.state != "Ready")
                        {
                            continue;
                        }

                        var candidateTransform = candidate.GetTransform();
                        if (candidateTransform == null)
                        {
                            continue;
                        }

                        var distanceSqr = ((Vector3d)candidateTransform.position - (Vector3d)targetTransform.position).sqrMagnitude;
                        if (distanceSqr < bestDistanceSqr)
                        {
                            bestDistanceSqr = distanceSqr;
                            ownPort = candidate;
                        }
                    }
                }
            }

            if (ownPort == null)
            {
                // This vessel has no port free to dock with -- nothing to
                // report (e.g. every port is already docked/disabled).
                return null;
            }

            var ownTransform = ownPort.GetTransform();
            if (ownTransform == null)
            {
                return null;
            }

            var relPos = (Vector3d)targetTransform.position - (Vector3d)ownTransform.position;
            var relVel = (Vector3d)targetPort.GetObtVelocity() - (Vector3d)ownPort.GetObtVelocity();
            var forwardDot = (double)Vector3.Dot(ownPort.GetFwdVector(), targetPort.GetFwdVector());

            return new Dictionary<string, object?>
            {
                ["relativePosition"] = new[] { relPos.x, relPos.y, relPos.z },
                ["relativeVelocity"] = new[] { relVel.x, relVel.y, relVel.z },
                ["distance"] = relPos.magnitude,
                ["forwardDot"] = forwardDot,
            };
        }

        /// <summary>
        /// The M3 R3 <c>vessel.surface</c> capture-add's raw group --
        /// biome/landedAt/heightFromTerrain, for the LandingStatus widget.
        /// Null whenever there's no reference body yet (mirrors
        /// <see cref="BuildAttitude"/>'s guard) or the vessel is
        /// <c>ORBITING</c>/<c>ESCAPING</c> -- KSP keeps whatever stale
        /// <c>heightFromTerrain</c>/biome-at-last-surface-contact it last
        /// computed even deep in space, which would otherwise read as
        /// current AGL/biome data when it's neither.
        /// </summary>
        private static Dictionary<string, object?>? BuildSurface(Vessel vessel, Orbit? orbit)
        {
            var body = orbit?.referenceBody;
            if (body == null)
            {
                return null;
            }

            var situation = vessel.situation;
            if (situation == Vessel.Situations.ORBITING || situation == Vessel.Situations.ESCAPING)
            {
                return null;
            }

            string? biome = null;
            if (body.BiomeMap != null)
            {
                // CBAttributeMapSO.GetAtt expects RADIANS (confirmed via
                // decompile: it divides lat by Math.PI, not 180) -- vessel
                // lat/long are in degrees, same convention as every other
                // lat/long this class reads.
                var latRad = vessel.latitude * Math.PI / 180.0;
                var lonRad = vessel.longitude * Math.PI / 180.0;
                var attribute = body.BiomeMap.GetAtt(latRad, lonRad);
                biome = attribute != null ? attribute.name : null;
            }

            return new Dictionary<string, object?>
            {
                ["biome"] = biome,
                // Empty string means "landed/splashed somewhere with no
                // named site" -- null it out rather than ship a wire value
                // that's indistinguishable from "not present at all".
                ["landedAt"] = string.IsNullOrEmpty(vessel.landedAt) ? null : vessel.landedAt,
                ["heightFromTerrain"] = (double)vessel.heightFromTerrain,
            };
        }

        /// <summary>
        /// The <c>vessel.landing</c> capture (B1 slice: relevance gate +
        /// atmosphere-aware descent estimate; PQS terrain fields follow). Reads
        /// the live vessel/body and feeds the KSP-free <see cref="LandingModel"/>
        /// so the maths stays unit-tested. Returns null (group omitted) unless
        /// the source relevance gate is open: descending toward a solid,
        /// PQS-backed surface within the closure horizon. Scalar results only,
        /// never an unverified 0.0.
        /// </summary>
        private static Dictionary<string, object?>? BuildLanding(Vessel vessel, Orbit? orbit)
        {
            var body = orbit?.referenceBody;
            if (body == null)
            {
                return null;
            }

            var heightFromTerrain = (double)vessel.heightFromTerrain;
            if (!LandingModel.IsRelevant(
                    body.hasSolidSurface,
                    body.pqsController != null,
                    vessel.verticalSpeed,
                    heightFromTerrain,
                    LandingGateHorizonSeconds))
            {
                return null;
            }

            var result = new Dictionary<string, object?>();

            // This method READS; whether the reading is publishable is
            // LandingModel.AtmosphericFields' decision, on the pure side where it
            // can carry a test. Null drag is "the parts could not be read", and
            // every atmospheric field derives from those same parts, so they
            // stand or fall together over there.
            var parts = vessel.parts;
            if (body.atmosphere)
            {
                // Aggregate current drag force (kN): a real measurement, no sim.
                double? dragForce = null;
                string? parachuteState = null;
                if (parts != null)
                {
                    double drag = 0.0;
                    for (int i = 0; i < parts.Count; i++)
                    {
                        drag += parts[i].dragScalar;
                    }
                    dragForce = drag;
                    parachuteState = BuildParachuteState(parts);
                }

                double altAsl = vessel.altitude;
                double r = body.Radius + altAsl;
                // Local gravity g = GM / r^2; weight in kN (tonnes * m/s^2 = kN),
                // the same force unit as dragScalar so the ratio is unit-clean.
                double g = r > 0 ? body.gravParameter / (r * r) : 0.0;
                double weight = vessel.totalMass * g;
                double vNow = vessel.srfSpeed;
                double rhoNow = vessel.atmDensity;

                // The ASL altitude of the ground beneath the lowest point.
                double groundAlt = Math.Max(0.0, altAsl - heightFromTerrain);
                double rhoGround = DensityAt(body, groundAlt);

                // Density profile down the fall column for the TTI integral.
                const int steps = 8;
                var alts = new double[steps + 1];
                var rhos = new double[steps + 1];
                for (int i = 0; i <= steps; i++)
                {
                    double a = altAsl - (altAsl - groundAlt) * i / steps;
                    alts[i] = a;
                    rhos[i] = DensityAt(body, a);
                }

                var atmospheric = LandingModel.AtmosphericFields(
                    dragForce, parachuteState, weight, vNow, rhoNow, rhoGround, alts, rhos);
                if (atmospheric != null)
                {
                    foreach (var field in atmospheric)
                    {
                        result[field.Key] = field.Value;
                    }
                }
            }

            // Terrain sampling: option 1 (mod-side predicted touchdown point)
            // with a sub-vessel fallback, behind an injectable sample-source.
            SampleTerrain(result, vessel, orbit, body);

            // Outcome: atmosphere headlines when it was actually SOLVED, else
            // terrain-assessed once we have a slope reading, else the bare
            // vacuum case. Keyed on the solved field rather than on
            // body.atmosphere, because an atmospheric body whose drag we could
            // not read reaches here with none of the atmospheric fields set,
            // and "atmospheric-aware" would then be a headline over nothing.
            result["outcome"] = result.ContainsKey("terminalVelocity")
                ? "atmospheric-aware"
                : result.ContainsKey("predictedSlopeAngle")
                    ? "terrain-assessed"
                    : "vacuum-solved";

            return result;
        }

        /// <summary>
        /// Sample terrain (slope / heading / residual roughness / elevation /
        /// biome) into the landing group. Tries the mod-side predicted-touchdown
        /// point first (the site the craft is heading for); falls back to the
        /// sub-vessel point when no touchdown solution is available. The live
        /// source is reported in <c>sampleSource</c>. All PQS reads are on the
        /// main thread (this runs in <see cref="Sample"/>), one at a time; a
        /// null pqsController was already gated out by the relevance check.
        /// </summary>
        private static void SampleTerrain(
            Dictionary<string, object?> result,
            Vessel vessel,
            Orbit? orbit,
            CelestialBody body)
        {
            double sampleLat;
            double sampleLon;
            string sampleSource;
            var predicted = orbit != null ? PredictImpact(orbit, body) : null;
            if (predicted.HasValue)
            {
                sampleLat = predicted.Value.lat;
                sampleLon = predicted.Value.lon;
                sampleSource = "predicted";
            }
            else
            {
                sampleLat = vessel.latitude;
                sampleLon = vessel.longitude;
                sampleSource = "sub-vessel";
            }

            result["sampleSource"] = sampleSource;
            result["predictedLatitude"] = sampleLat;
            result["predictedLongitude"] = sampleLon;
            // allowNegative so ocean floor reads honestly rather than clamping to 0.
            result["predictedTerrainElevation"] =
                body.TerrainAltitude(sampleLat, sampleLon, allowNegative: true);
            result["predictedBiome"] = BiomeAt(body, sampleLat, sampleLon);

            // Footprint wide enough that residual sigma grades on the shared
            // roughness scale (§2e). One ring gives slope + heading + residual
            // roughness from a single plane fit.
            const double footprintMeters = 100.0;
            var samples = SampleTerrainRing(body, sampleLat, sampleLon, footprintMeters);
            var fit = LandingTerrain.FitPlane(samples);
            if (fit.HasValue)
            {
                result["predictedSlopeAngle"] = fit.Value.SlopeDeg;
                result["predictedSlopeHeading"] = fit.Value.HeadingDeg;
                result["predictedRoughness"] = fit.Value.Roughness;
                result["roughnessFootprintMeters"] = footprintMeters;
                result["slopeSampleRadiusMeters"] = footprintMeters;
            }
        }

        /// <summary>
        /// A 9-point (centre + 8 compass) terrain-height ring around a lat/lon,
        /// as local east/north/height samples for the plane fit. PQS heights via
        /// <c>CelestialBody.TerrainAltitude(allowNegative: true)</c>.
        /// </summary>
        private static List<LandingTerrain.Sample> SampleTerrainRing(
            CelestialBody body,
            double lat,
            double lon,
            double footprintMeters)
        {
            double r = body.Radius;
            double cosLat = Math.Cos(lat * Math.PI / 180.0);
            if (Math.Abs(cosLat) < 1e-6)
                cosLat = 1e-6;
            // metres -> degree offsets for the given footprint.
            double dLatDeg = footprintMeters / r * (180.0 / Math.PI);
            double dLonDeg = footprintMeters / (r * cosLat) * (180.0 / Math.PI);

            // (northSteps, eastSteps) for centre + 8 neighbours.
            int[,] ring =
            {
                { 0, 0 }, { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 },
                { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 },
            };
            var samples = new List<LandingTerrain.Sample>();
            for (int i = 0; i < ring.GetLength(0); i++)
            {
                int n = ring[i, 0];
                int e = ring[i, 1];
                double la = lat + n * dLatDeg;
                double lo = lon + e * dLonDeg;
                double h = body.TerrainAltitude(la, lo, allowNegative: true);
                samples.Add(new LandingTerrain.Sample(
                    e * footprintMeters, n * footprintMeters, h));
            }
            return samples;
        }

        /// <summary>KSP biome name at a lat/lon (degrees), or null when the body has no biome map.</summary>
        private static string? BiomeAt(CelestialBody body, double lat, double lon)
        {
            if (body.BiomeMap == null)
                return null;
            var b = ScienceUtil.GetExperimentBiome(body, lat, lon);
            return string.IsNullOrEmpty(b) ? null : b;
        }

        /// <summary>
        /// Best-effort mod-side predicted touchdown lat/lon: a conic patch-walk
        /// of the live orbit to the surface crossing (option 1), mirroring the
        /// client's proven <c>findImpactPoint</c>. Returns null (→ sub-vessel
        /// fallback) when the body does not rotate normally or the trajectory
        /// does not reach the surface within the horizon. The KSP-frame maths
        /// (position → lat/lon with the rotation correction) is Deck-to-verify;
        /// the pure search is unit-tested in <see cref="LandingPredictor"/>.
        /// </summary>
        private static (double lat, double lon)? PredictImpact(Orbit orbit, CelestialBody body)
        {
            double rot = body.rotationPeriod;
            if (!(rot > 0))
                return null;
            double now = Planetarium.GetUniversalTime();
            double degPerSec = 360.0 / rot;

            LandingPredictor.GeoPoint Sampler(double ut)
            {
                Vector3d wpos = orbit.getPositionAtUT(ut);
                double alt = body.GetAltitude(wpos);
                double lat = body.GetLatitude(wpos);
                // getPositionAtUT is inertial; GetLongitude uses the body's
                // CURRENT rotation, so correct for the rotation between now and
                // ut. KSP bodies rotate prograde; sign is Deck-to-verify.
                double lon = body.GetLongitude(wpos) - (ut - now) * degPerSec;
                lon = ((lon % 360.0) + 360.0) % 360.0;
                if (lon > 180.0)
                    lon -= 360.0;
                return new LandingPredictor.GeoPoint(lat, lon, alt);
            }

            double horizon = orbit.period > 0 ? Math.Min(orbit.period, 1200.0) : 1200.0;
            double step = Math.Max(1.0, horizon / 240.0);
            return LandingPredictor.FindImpact(Sampler, now, horizon, step, -100.0);
        }

        /// <summary>Air density at an ASL altitude, via the body's pressure/temperature curves.</summary>
        private static double DensityAt(CelestialBody body, double altitude)
        {
            double pressure = body.GetPressure(altitude);
            double temperature = body.GetTemperature(altitude);
            return body.GetDensity(pressure, temperature);
        }

        /// <summary>
        /// Parachute state affecting the terminal-velocity estimate:
        /// "deployed" (its drag is already in the measured aggregate, so the
        /// estimate self-corrects), "armed" (a future step change the instant
        /// model cannot see: flag it), or "none".
        /// </summary>
        private static string BuildParachuteState(List<Part> parts)
        {
            // Takes the parts rather than the vessel so there is no unreadable
            // case to answer: "none" is a statement that the craft has no
            // parachutes, and a craft whose parts we cannot see has not made
            // that statement. The caller skips the whole atmospheric block
            // instead.
            bool armed = false;
            for (int i = 0; i < parts.Count; i++)
            {
                var modules = parts[i].Modules;
                if (modules == null)
                {
                    continue;
                }

                for (int m = 0; m < modules.Count; m++)
                {
                    if (modules[m] is ModuleParachute chute)
                    {
                        switch (chute.deploymentState)
                        {
                            case ModuleParachute.deploymentStates.DEPLOYED:
                            case ModuleParachute.deploymentStates.SEMIDEPLOYED:
                                return "deployed";
                            case ModuleParachute.deploymentStates.ACTIVE:
                                armed = true;
                                break;
                        }
                    }
                }
            }

            return armed ? "armed" : "none";
        }

        /// <summary>
        /// The next closest approach between the active vessel and its current
        /// target, asked of the ELECTED propagation provider. Everything KSP is
        /// read here and turned into contract shapes; the provider sees two named
        /// targets, a frame and a window, and never a KSP type.
        ///
        /// <para>Null whenever there is nothing honest to say: no provider yet, no
        /// target, no orbit on either side, or no encounter inside the window. The
        /// old solver additionally refused any target that did not share a
        /// reference body, because it was calling KSP's two-body helper directly.
        /// That gate is gone: a provider holding the body table reaches a common
        /// frame across the hierarchy itself, and one that cannot simply declines.</para>
        /// </summary>
        private ClosestApproach? SolveClosestApproach(double ut)
        {
            var provider = _propagation != null ? _propagation.Invoke() : null;
            if (provider == null)
            {
                return null;
            }

            var fetch = FlightGlobals.fetch;
            var active = ActiveVesselScope.Current;
            var target = fetch != null ? fetch.VesselTarget : null;
            if (active == null || target == null)
            {
                return null;
            }

            var selfOrbit = active.orbit;
            if (selfOrbit == null || selfOrbit.referenceBody == null)
            {
                return null;
            }

            var parentIndex = BodyIndexOf(selfOrbit.referenceBody);
            var subject = PropagationTarget.Vessel(
                active.id.ToString(), parentIndex, ElementsOf(selfOrbit));
            PropagationTarget? other = AsPropagationTarget(target);
            if (other == null)
            {
                return null;
            }

            // The active vessel's own parent, so the common case needs no body
            // table at all and the cross-body case is the provider's walk to make.
            var frame = PropagationFrame.CentredOn(parentIndex);
            var window = ApproachWindow(provider, subject, other.Value);
            if (window == null)
            {
                return null;
            }

            return provider.SolveClosestApproach(subject, other.Value, frame, ut, ut + window.Value);
        }

        /// <summary>
        /// The KSP target as something a provider can resolve. A body is NAMED and
        /// a vessel is DESCRIBED, which is the asymmetry
        /// <see cref="PropagationTarget"/> draws: no provider has a registry to
        /// look a vessel id up in, but every provider knows where the bodies are.
        /// </summary>
        private static PropagationTarget? AsPropagationTarget(ITargetable target)
        {
            if (target is CelestialBody body)
            {
                var index = BodyIndexOf(body);
                return index >= 0 ? PropagationTarget.Body(index) : (PropagationTarget?)null;
            }

            var orbit = target.GetOrbit();
            if (orbit == null || orbit.referenceBody == null)
            {
                return null;
            }

            // A docking port is targeted as its owning vessel: a port's own offset
            // from its craft is metres against an approach measured in kilometres,
            // and the vessel is the thing that has a trajectory.
            var owner = target.GetVessel();
            var id = owner != null ? owner.id.ToString() : target.GetName();
            return PropagationTarget.Vessel(id, BodyIndexOf(orbit.referenceBody), ElementsOf(orbit));
        }

        /// <summary>
        /// The search window, derived from how fast the two objects actually move
        /// rather than fixed.
        ///
        /// <para>Three pulls, and all three are real. It has to reach past ONE
        /// cycle of the faster object, or a rendezvous three orbits out reads as no
        /// encounter at all. It should reach a cycle of the slower object, so a
        /// transfer is inside it. And it must stay short enough that the provider
        /// can still resolve the faster object's turns across it, which is what the
        /// upper bound is for: a window nothing can be resolved in is worse than a
        /// shorter one, because it answers.</para>
        ///
        /// <para>Null when neither object repeats. There is nothing to derive a
        /// window from then, and a made-up one would put a made-up horizon behind
        /// an answer of "no encounter".</para>
        /// </summary>
        private static double? ApproachWindow(
            IPropagationProvider provider, PropagationTarget subject, PropagationTarget other)
        {
            const int MinimumCyclesAhead = 16;
            const int MaximumCyclesAhead = 125;

            var subjectCycle = provider.CharacteristicCycleSeconds(subject);
            var otherCycle = provider.CharacteristicCycleSeconds(other);
            if (subjectCycle == null && otherCycle == null)
            {
                return null;
            }

            var fastest = subjectCycle == null
                ? otherCycle!.Value
                : otherCycle == null ? subjectCycle.Value : Math.Min(subjectCycle.Value, otherCycle.Value);
            var slowest = subjectCycle == null
                ? otherCycle!.Value
                : otherCycle == null ? subjectCycle.Value : Math.Max(subjectCycle.Value, otherCycle.Value);
            if (!(fastest > 0.0))
            {
                return null;
            }

            return Math.Min(Math.Max(slowest, fastest * MinimumCyclesAhead), fastest * MaximumCyclesAhead);
        }

        /// <summary>Index into <c>FlightGlobals.Bodies</c>, the index space every propagation frame and body target is keyed on. -1 when the list is not up yet.</summary>
        private static int BodyIndexOf(CelestialBody body)
        {
            var bodies = FlightGlobals.Bodies;
            return bodies == null || body == null ? -1 : bodies.IndexOf(body);
        }

        private static OrbitElements ElementsOf(Orbit orbit) =>
            OrbitElements.FromKspDegrees(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                incDegrees: orbit.inclination,
                lanDegrees: orbit.LAN,
                argPeDegrees: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);

        /// <summary>
        /// Current docking/rendezvous/tracking target (G-8) - null when
        /// nothing is targeted (the common case). <c>ITargetable</c> covers
        /// vessels, celestial bodies, and docking ports/waypoints alike;
        /// <c>GetVessel()</c> is non-null only for the vessel case (a
        /// docking port target's <c>GetVessel()</c> returns the vessel it's
        /// attached to, so that's classified as a vessel target too).
        /// Relative position/velocity are computed against THIS vessel
        /// (target minus self), in the same world-space transform frame
        /// <see cref="BuildAttitude"/> already reads from
        /// <c>Vessel.GetTransform()</c> - safe here because both vessel and
        /// target sit inside the same floating-origin frame while relevant
        /// (rendezvous range), which is the only time a target's relative
        /// state matters.
        /// </summary>
        private static Dictionary<string, object?>? BuildTarget(Vessel vessel, ClosestApproach? closestApproach)
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return null;
            }

            var target = fetch.VesselTarget;
            if (target == null)
            {
                return null;
            }

            // Classify + resolve the target's OWN stable identity. Order
            // matters: a ModuleDockingNode's GetVessel() returns the OWNING
            // vessel (non-null), so a bare "GetVessel() != null -> Vessel"
            // would misread a docking port as a vessel. Check PartModule
            // FIRST. targetVesselId carries the vessel guid for a Vessel
            // target AND the owning vessel for a Part target (the parser reads
            // it for both); partId is the port's Part.flightID, Part only.
            var targetVessel = target.GetVessel();
            string targetType;
            string? targetVesselId = null;
            uint? partId = null;
            if (target is CelestialBody)
            {
                targetType = "CelestialBody";
            }
            else if (target is PartModule partModule)
            {
                // A part target -- in practice a docking port.
                targetType = "Part";
                partId = partModule.part != null ? partModule.part.flightID : (uint?)null;
                targetVesselId = partModule.vessel != null ? partModule.vessel.id.ToString() : null;
            }
            else if (targetVessel != null)
            {
                targetType = targetVessel.vesselType.ToString();
                targetVesselId = targetVessel.id.ToString();
            }
            else
            {
                targetType = target.GetType().Name;
            }

            double[]? relativePosition = null;
            var targetTransform = target.GetTransform();
            var vesselTransform = vessel.GetTransform();
            if (targetTransform != null && vesselTransform != null)
            {
                var relPos = (Vector3d)targetTransform.position - (Vector3d)vesselTransform.position;
                relativePosition = new[] { relPos.x, relPos.y, relPos.z };
            }

            var relVel = (Vector3d)target.GetObtVelocity() - vessel.obt_velocity;

            var result = new Dictionary<string, object?>
            {
                ["name"] = target.GetName(),
                ["type"] = targetType,
                ["targetVesselId"] = targetVesselId,
                ["partId"] = partId,
                ["relativePosition"] = relativePosition,
                ["relativeVelocity"] = new[] { relVel.x, relVel.y, relVel.z },
            };

            var targetOrbit = target.GetOrbit();
            if (targetOrbit != null)
            {
                result["orbit"] = BuildOrbit(targetOrbit);
            }

            // Mod-side closest approach from the elected solver (computed in
            // Sample at the current UT). Omit the key entirely when there's no
            // encounter -- the parser leaves VesselTarget.ClosestApproach null.
            if (closestApproach != null)
            {
                result["closestApproach"] = new Dictionary<string, object?>
                {
                    ["time"] = closestApproach.Time,
                    ["distance"] = closestApproach.Distance,
                };
            }

            return result;
        }

        /// <summary>
        /// Global (not per-vessel) time-warp/pause state (G-5) - drives
        /// WarpControl and disambiguates "paused" from "1x" in replay.
        /// <c>TimeWarp.CurrentRate</c>/<c>CurrentRateIndex</c>/<c>WarpMode</c>
        /// are confirmed via decompile to already guard their own
        /// <c>!fetch</c> case internally (returning 1x/HIGH defaults) - no
        /// extra null check needed here, unlike the Unity-object guards
        /// elsewhere in this class. <c>FlightDriver.Pause</c> reads a
        /// private STATIC field (not instance-backed), so it's always safe
        /// to call too.
        /// </summary>
        private static Dictionary<string, object?> BuildTime()
        {
            // The calendar rides in the same group as warp/pause because it is
            // the same KIND of fact: global game state with no vessel, present
            // in every scene. `KSPUtil.dateTimeFormatter` is a static the game
            // maintains for its own clock, so reading it is free and needs no
            // caching; Kopernicus and RSS replace the whole object, and the
            // stock implementation already answers for GameSettings.KERBIN_TIME,
            // so these numbers are correct under every configuration without
            // this code knowing which one it is in. The epoch beside them is
            // read off the same object, reflectively, because the interface
            // declares how long a day is and never which day it is.
            var calendar = KSPUtil.dateTimeFormatter;

            return new Dictionary<string, object?>
            {
                ["warpRate"] = (double)TimeWarp.CurrentRate,
                ["warpRateIndex"] = TimeWarp.CurrentRateIndex,
                ["warpMode"] = TimeWarp.WarpMode.ToString(),
                ["paused"] = FlightDriver.Pause,
                ["minuteSeconds"] = (double)calendar.Minute,
                ["hourSeconds"] = (double)calendar.Hour,
                ["daySeconds"] = (double)calendar.Day,
                ["yearSeconds"] = (double)calendar.Year,
                // The instant UT 0 is, when the formatter models a real
                // calendar. Null for the stock one, which has no such instant
                // and whose own UI prints Year 1 Day 1; see CalendarEpoch.
                ["epoch"] = CalendarEpoch.Read(calendar),
                ["kerbinTime"] = GameSettings.KERBIN_TIME,
            };
        }

        /// <summary>
        /// Installed-DLC capability (<c>game.dlc</c>) - which KSP expansions
        /// the install has, read from <c>ExpansionsLoader.IsExpansionInstalled</c>
        /// (the same static check the stock game uses everywhere it gates
        /// Serenity/MakingHistory content). The internal expansion names are
        /// <c>"Serenity"</c> (Breaking Ground) and <c>"MakingHistory"</c> -
        /// confirmed against Assembly-CSharp's own call sites. Two plain
        /// bools, never null: a ground-side, scene-independent fact, so
        /// <see cref="Sample"/> captures it unconditionally.
        /// </summary>
        private static Dictionary<string, object?> BuildDlc()
        {
            return new Dictionary<string, object?>
            {
                ["breakingGround"] = ExpansionsLoader.IsExpansionInstalled("Serenity"),
                ["makingHistory"] = ExpansionsLoader.IsExpansionInstalled("MakingHistory"),
            };
        }

        /// <summary>
        /// Primitives-only snapshot of whether the two stock in-flight "revert"
        /// actions are currently available, read from the same static
        /// <c>FlightDriver</c> flags KSP's own pause menu
        /// (<c>PauseMenu.drawStockRevertOptions</c>) gates its revert buttons
        /// on. Only sampled in the flight scene (see the <c>Sample</c> call
        /// site): the flags are meaningless, and carry stale values from the
        /// previous flight, outside it.
        ///
        /// <para><b>Mapping (verified against <c>drawStockRevertOptions</c>):</b>
        /// the "Revert to Launch" button (calls <c>FlightDriver.RevertToLaunch()</c>,
        /// restoring the on-pad <c>PostInitState</c>) is gated on
        /// <c>CanRevertToPostInit</c>; the "Revert to VAB/SPH" buttons (call
        /// <c>FlightDriver.RevertToPrelaunch(...)</c>, returning to the editor)
        /// are gated on <c>CanRevertToPrelaunch</c>. So <c>canRevertToLaunch</c>
        /// reads <c>CanRevertToPostInit</c> and <c>canRevertToEditor</c> reads
        /// <c>CanRevertToPrelaunch</c>: the KSP field names read backwards to
        /// their button meaning, so this mapping is deliberately the inverse of
        /// a naive name-match.
        /// </summary>
        private static Dictionary<string, object?> BuildRevertAvailability()
        {
            /*
             * Each button has MORE than one gate, and we published one apiece.
             * `drawStockRevertOptions` shows Revert to Launch on
             * CanRevertToPostInit AND GameParameters.Flight.CanRestart, and
             * Revert to VAB/SPH on CanRevertToPrelaunch AND
             * GameParameters.Flight.CanLeaveToEditor AND a non-null
             * ShipConstruction.ShipConfig.
             *
             * Publishing only the FlightDriver half lit both controls on a save
             * with reverting switched off, which is a standard hard-mode preset,
             * and after any scene reload that leaves ShipConfig null. The game
             * drew no such button. A control offered where the game has none is
             * the wrong-positive shape: it fails at the press, having invited it.
             *
             * The difficulty flags are folded into the verdict rather than
             * published beside it, deliberately and for now: the wire shape is
             * pinned to RevertAvailability by a contract test, and "this save
             * disallows reverting" belongs with the rest of the difficulty rules
             * rather than as one field smuggled in here. That block is its own
             * tracked gap.
             */
            var flight = HighLogic.CurrentGame?.Parameters?.Flight;
            var canRestart = flight?.CanRestart ?? true;
            var canLeaveToEditor = flight?.CanLeaveToEditor ?? true;
            var haveShipConfig = ShipConstruction.ShipConfig != null;

            return new Dictionary<string, object?>
            {
                ["canRevertToEditor"] =
                    FlightDriver.CanRevertToPrelaunch && canLeaveToEditor && haveShipConfig,
                ["canRevertToLaunch"] = FlightDriver.CanRevertToPostInit && canRestart,
            };
        }

        // ----------------------------------------------------------------
        // Space-center / launch-site capture (spaceCenter.scene +
        // spaceCenter.launchSites) - ground-side game facts, DelayRole.TrueNow
        // ----------------------------------------------------------------

        /// <summary>
        /// The RAW <c>GameScenes</c> enum name of the current scene
        /// (<c>HighLogic.LoadedScene.ToString()</c>) - e.g. <c>"FLIGHT"</c>,
        /// <c>"SPACECENTER"</c>, <c>"TRACKSTATION"</c>. Passed straight through
        /// (not pre-mapped), same capture->provider split as
        /// <see cref="BuildGameMode"/>: <c>SpaceCenterViewProvider.BuildScene</c>
        /// owns the fold to the six output strings the legacy <c>kc.scene</c>
        /// key used. Global game state, so captured unconditionally.
        /// </summary>
        private static string BuildScene()
        {
            return HighLogic.LoadedScene.ToString();
        }

        /// <summary>
        /// The launch site currently selected in the editor
        /// (<c>EditorLogic.fetch.launchSiteName</c>). <c>EditorLogic.fetch</c>
        /// is null outside the editor scene, so this returns <c>null</c> in
        /// flight and at the space center: a genuine "no site selected right
        /// now," never a fabricated default. <c>SpaceCenterViewProvider.BuildScene</c>
        /// passes it straight through onto <c>spaceCenter.scene.launchSite</c>.
        /// </summary>
        private static string? BuildActiveLaunchSite()
        {
            var editor = EditorLogic.fetch;
            return editor != null ? editor.launchSiteName : null;
        }

        /// <summary>
        /// Primitives-only snapshot of the launch-site roster - the
        /// <c>PSystemSetup.Instance.LaunchSites</c> UNION: stock KSC pad +
        /// runway, plus any Making History sites and any Kerbal Konstructs
        /// sites (KK registers into that same list via the public
        /// <c>AddLaunchSite</c> API, so iterating the one list already covers
        /// all three - no reflection, no hard KK link). Returns <c>null</c> -
        /// the WHOLE group - when <c>PSystemSetup.Instance</c> isn't ready
        /// (pre-load / main menu), so the provider distinguishes "no data yet"
        /// from "zero sites."
        ///
        /// <para><b>Pad occupancy (§8 FLAG, option a):</b> there is no clean
        /// stock per-site "is a vessel on this pad" API. Stock KSP has one
        /// physical pad, so the global "active vessel is in PRELAUNCH"
        /// derivation is replicated onto the stock VAB launch site (the pad)
        /// only; the runway and every non-stock site carry <c>null</c>
        /// occupancy. Per-site true occupancy is a documented follow-up.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildSpaceCenter()
        {
            var setup = PSystemSetup.Instance;
            if (setup == null)
            {
                return null;
            }

            var launchSites = setup.LaunchSites;
            if (launchSites == null)
            {
                return null;
            }

            // Global "a vessel is sitting on the pad right now" derivation: the
            // active vessel in the PRELAUNCH situation. Read defensively -
            // FlightGlobals may not be ready outside flight, in which case there
            // is no active vessel and nothing is on the pad.
            var active = FlightGlobals.ready ? ActiveVesselScope.Current : null;
            var prelaunch = active != null && active.situation == Vessel.Situations.PRELAUNCH;
            var activeTitle = prelaunch && active != null ? active.vesselName : null;

            var sites = new List<object?>(launchSites.Count);
            foreach (var site in launchSites)
            {
                if (site == null)
                {
                    continue;
                }

                var name = site.name;
                var isStock = name != null && setup.IsStockLaunchSite(name);
                // The stock pad is the stock, VAB-launched site (VAB -> pad,
                // SPH -> runway). Only it gets the global PRELAUNCH-derived
                // occupancy; every other site carries null.
                var isStockPad = isStock && site.editorFacility == EditorFacility.VAB;

                var body = site.Body;

                // spaceCenter.pois needs a coordinate per site to place it on
                // the map; the first spawn point that actually has one set
                // (LaunchSite.SpawnPoint.latlonaltSet) wins - most sites carry
                // exactly one, some (the stock pad) carry several equivalent
                // ones. Both null when no spawn point has a set coordinate -
                // SpaceCenterViewProvider.BuildPois skips such a site rather
                // than emit a fabricated (0,0).
                double? spawnLatitude = null;
                double? spawnLongitude = null;
                var spawnPoints = site.spawnPoints;
                if (spawnPoints != null)
                {
                    foreach (var spawnPoint in spawnPoints)
                    {
                        if (spawnPoint != null && spawnPoint.latlonaltSet)
                        {
                            spawnLatitude = spawnPoint.latitude;
                            spawnLongitude = spawnPoint.longitude;
                            break;
                        }
                    }
                }

                sites.Add(new Dictionary<string, object?>
                {
                    ["name"] = name,
                    ["displayName"] = (name != null ? setup.GetLaunchSiteDisplayName(name) : null) ?? site.launchSiteName,
                    ["editorFacility"] = site.editorFacility.ToString(),
                    ["body"] = body != null ? body.bodyName : null,
                    ["isStock"] = isStock,
                    ["padOccupied"] = isStockPad ? (object?)prelaunch : null,
                    ["padVesselTitle"] = isStockPad && prelaunch ? activeTitle : null,
                    ["latitude"] = spawnLatitude,
                    ["longitude"] = spawnLongitude,
                });
            }

            return new Dictionary<string, object?>
            {
                ["launchSites"] = sites,
            };
        }

        /// <summary>
        /// Primitives-only snapshot of the surface contract-waypoint roster -
        /// <c>FinePrint.WaypointManager.Instance().Waypoints</c> filtered down
        /// to genuine contract targets (<c>contractReference != null</c>) that
        /// sit on a surface (<c>isOnSurface</c>) - the raw contract state name
        /// is passed through unfiltered (the Active/Offered inclusion decision
        /// is <c>SpaceCenterViewProvider.BuildPois</c>'s job, the same
        /// capture-&gt;provider split <see cref="BuildCrewRoster"/> uses for
        /// <c>rosterStatus</c>). Returns <c>null</c> - the whole list - when
        /// <c>WaypointManager.Instance()</c> isn't ready (pre-load / main
        /// menu), so the provider distinguishes "no data yet" from "zero
        /// targets."
        /// </summary>
        private static List<object?>? BuildContractTargets()
        {
            var manager = FinePrint.WaypointManager.Instance();
            var waypoints = manager != null ? manager.Waypoints : null;
            if (waypoints == null)
            {
                return null;
            }

            var targets = new List<object?>();
            foreach (var wp in waypoints)
            {
                if (wp == null || wp.contractReference == null)
                {
                    continue;
                }

                var contract = wp.contractReference;
                targets.Add(new Dictionary<string, object?>
                {
                    ["navigationId"] = wp.navigationId.ToString(),
                    ["celestialName"] = wp.celestialName,
                    ["latitude"] = wp.latitude,
                    ["longitude"] = wp.longitude,
                    ["isOnSurface"] = wp.isOnSurface,
                    ["contractState"] = contract.ContractState.ToString(),
                    ["contractTitle"] = contract.Title,
                    ["contractAgent"] = contract.Agent != null ? contract.Agent.Name : null,
                    ["contractFundsAdvance"] = contract.FundsAdvance,
                    ["contractFundsCompletion"] = contract.FundsCompletion,
                    ["contractDateDeadline"] = contract.DateDeadline,
                });
            }

            return targets;
        }

        /// <summary>
        /// Attaches <paramref name="build"/>'s result under
        /// <c>values["spaceCenter"][<paramref name="key"/>]</c>, creating the
        /// <c>spaceCenter</c> group if <see cref="BuildSpaceCenter"/> didn't (its
        /// gating differs from these sub-groups'). A <c>null</c> result attaches
        /// nothing - the "no data yet" signal the providers read as a null
        /// payload - and each attach has its own try so one sub-group's failure
        /// never drops another or the launch-site roster.
        /// </summary>
        private static void AttachSpaceCenterGroup(Dictionary<string, object?> values, string key, Func<object?> build)
        {
            try
            {
                var built = build();
                if (built == null)
                {
                    return;
                }

                if (!(values.TryGetValue("spaceCenter", out var existing) && existing is Dictionary<string, object?> group))
                {
                    group = new Dictionary<string, object?>();
                    values["spaceCenter"] = group;
                }

                group[key] = built;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] space-center " + key + " snapshot build failed, omitting: " + ex);
            }
        }

        /// <summary>
        /// Primitives-only snapshot of one kerbal, shared by the hired-crew
        /// roster and the Astronaut Complex applicant pool so both ride the
        /// same wire shape (<c>CrewRosterEntry</c>). <c>rosterStatus</c> and
        /// <paramref name="isApplicant"/> are passed through RAW;
        /// <c>SpaceCenterViewProvider</c> folds them into <c>available</c>/
        /// <c>unavailableReason</c>/<c>situation</c>, the same capture-&gt;provider
        /// split <see cref="BuildScene"/> uses. <c>experienceTrait</c> can be
        /// null before a kerbal's stats have loaded, so its description fields
        /// are read defensively rather than assumed present.
        /// </summary>
        /// <summary>
        /// One kerbal's standing, plus who decided it: the elected backend's
        /// answer where it has one, otherwise the contract's own map of KSP's
        /// roster status.
        ///
        /// <para>The elected capability is EXCLUSIVE, so under a career overhaul
        /// the mod's backend is the only one reachable, and it is handed every
        /// kerbal rather than only the ones it knows about. A backend that
        /// declines (null, or a null standing) is not a failure: it is the
        /// ordinary answer for the majority of a roster, and the default has to
        /// stand for it here rather than leave a hole. The SOURCE follows the
        /// answer rather than the election, so a kerbal RP-1 has nothing to say
        /// about is attributed to <c>"stock"</c> and one it corrected is
        /// attributed to <c>"rp1"</c>: which mod is making the claim is the
        /// operator's question, not which mod won a vote.</para>
        ///
        /// <para>Fail-soft: a backend that throws costs this kerbal its
        /// correction and nothing else. A crew roster must not be able to take
        /// the whole space-centre capture down.</para>
        /// </summary>
        private CrewStandingResolution ReadCrewStanding(CrewStandingQuery query)
        {
            ICrewStandingBackend? backend;
            try
            {
                backend = _crewStandingBackend?.Invoke();
            }
            catch (Exception)
            {
                backend = null;
            }
            if (backend == null)
            {
                return CrewStandings.Resolve(query, null, null);
            }

            CrewStandingReading? reading;
            try
            {
                reading = backend.Read(query);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] crew-standing backend threw for " + query.KerbalName + ", falling back to the roster status: " + ex);
                reading = null;
            }

            return CrewStandings.Resolve(query, reading, backend.ProviderId);
        }

        private Dictionary<string, object?> BuildCrewEntry(ProtoCrewMember pcm, bool isApplicant, double ut)
        {
            var trait = pcm.experienceTrait;
            var ordinal = (int)pcm.rosterStatus;
            var standing = ReadCrewStanding(new CrewStandingQuery
            {
                KerbalName = pcm.name,
                // An applicant is not in the roster and has no RosterStatus at
                // all, so it is withheld rather than defaulted: a backend that
                // saw a zero here would read it as stock's Available.
                RosterStatusOrdinal = isApplicant ? (int?)null : ordinal,
                IsApplicant = isApplicant,
                Inactive = pcm.inactive,
                InactiveUntilUt = pcm.inactiveTimeEnd,
                Ut = ut,
            });

            return new Dictionary<string, object?>
            {
                ["name"] = pcm.name,
                ["trait"] = pcm.trait,
                ["experienceLevel"] = pcm.experienceLevel,
                ["rosterStatus"] = pcm.rosterStatus.ToString(),
                // KSP's own answer, published beside the standing rather than
                // instead of it: under a career overhaul the two disagree, and a
                // retiree reads Dead here. See Sitrep.Contract/CrewStanding.cs.
                ["rosterStatusOrdinal"] = ordinal,
                ["standing"] = (int)standing.Standing,
                ["standingSource"] = standing.Source,
                ["standingAvailable"] = standing.Available,
                ["standingUnavailableReason"] = standing.UnavailableReason,
                ["standingEndsAtUt"] = standing.StandingEndsAtUt,
                ["retiresAtUt"] = standing.RetiresAtUt,
                ["isApplicant"] = isApplicant,
                ["inactive"] = pcm.inactive,
                ["inactiveUntilUt"] = pcm.inactiveTimeEnd,
                ["courage"] = (double)pcm.courage,
                ["stupidity"] = (double)pcm.stupidity,
                ["experience"] = (double)pcm.experience,
                ["experienceLevelDelta"] = (double)pcm.ExperienceLevelDelta,
                ["roleDescription"] = trait?.Description,
                ["descriptionEffects"] = trait?.DescriptionEffects,
            };
        }

        /// <summary>
        /// Primitives-only snapshot of the hired-crew roster -
        /// <c>HighLogic.CurrentGame.CrewRoster.Crew</c>, which filters on
        /// <c>type == KerbalType.Crew</c> and NOTHING else (verified in the
        /// disassembly): tourists and applicants are excluded, but a kerbal whose
        /// roster status is Dead or Missing is still owned crew and still here.
        /// That is why the standing matters: an RP-1 retiree carries stock's Dead
        /// and arrives on this list. Each entry is built by
        /// <see cref="BuildCrewEntry"/>. Returns <c>null</c> - the whole list -
        /// when no game is loaded (main menu) so the provider distinguishes "no
        /// data yet" from "zero crew."
        /// </summary>
        private List<object?>? BuildCrewRoster(double ut)
        {
            var game = HighLogic.CurrentGame;
            var roster = game?.CrewRoster;
            if (roster == null)
            {
                return null;
            }

            var crew = new List<object?>();
            foreach (var pcm in roster.Crew)
            {
                if (pcm == null)
                {
                    continue;
                }

                crew.Add(BuildCrewEntry(pcm, isApplicant: false, ut));
            }

            return crew;
        }

        /// <summary>
        /// Primitives-only snapshot of the Astronaut Complex hire tab, the live
        /// applicant pool (<c>KerbalRoster.Applicants</c>) plus the numbers a
        /// hire is gated on: the current active-crew count
        /// (<c>KerbalRoster.GetActiveCrewCount</c>), the facility-tier cap
        /// (<c>GameVariables.GetActiveCrewLimit</c> over the Astronaut Complex's
        /// normalised level), and the next-hire price
        /// (<c>GameVariables.GetRecruitHireCost</c>, a function of the
        /// active-crew count - one figure for the whole pool, not per
        /// applicant). Each applicant is built by <see cref="BuildCrewEntry"/>,
        /// the same shape as the hired-crew roster. CAREER-gated on
        /// <c>Funding.Instance</c> (hiring spends funds; sandbox/science have no
        /// funds affordance), so this returns <c>null</c> (the whole group
        /// omitted) outside career, letting
        /// <c>SpaceCenterViewProvider.BuildAstronautComplex</c> distinguish "not
        /// in career" from "career with an empty pool." The cost/cap numbers are
        /// captured raw; the KSP-free provider owns any presentation fold.
        /// </summary>
        private Dictionary<string, object?>? BuildAstronautComplex(double ut)
        {
            var roster = HighLogic.CurrentGame?.CrewRoster;
            if (roster == null || Funding.Instance == null)
            {
                return null;
            }

            var gameVariables = GameVariables.Instance;
            var activeCrew = roster.GetActiveCrewCount();
            double? nextHireCost = gameVariables != null ? (double?)gameVariables.GetRecruitHireCost(activeCrew) : null;

            int? crewCapacity = null;
            if (gameVariables != null && ScenarioUpgradeableFacilities.Instance != null)
            {
                var norm = ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.AstronautComplex);
                crewCapacity = gameVariables.GetActiveCrewLimit(norm);
            }

            var applicants = new List<object?>();
            foreach (var pcm in roster.Applicants)
            {
                if (pcm == null)
                {
                    continue;
                }

                applicants.Add(BuildCrewEntry(pcm, isApplicant: true, ut));
            }

            return new Dictionary<string, object?>
            {
                ["applicants"] = applicants,
                ["activeCrew"] = activeCrew,
                ["crewCapacity"] = crewCapacity,
                ["nextHireCost"] = nextHireCost,
            };
        }

        /// <summary>
        /// The UT interval between saved-ship disk re-walks. <see cref="Sample"/>
        /// runs on a ~1 UT cadence, but enumerating the craft folders + parsing
        /// each <c>.craft</c> file is disk I/O, so it's rate-limited here to the
        /// same 30 UT floor the uplink's keyframe uses rather than run every tick.
        /// </summary>
        private const double SavedShipsRescanIntervalUt = 30.0;

        private static double _lastSavedShipsScanUt = double.NegativeInfinity;
        private static List<object?>? _cachedSavedShips;

        /// <summary>
        /// Primitives-only snapshot of the save's saved craft - a disk walk of
        /// the VAB and SPH craft folders
        /// (<c>ShipConstruction.GetShipsPathFor</c>), each <c>.craft</c> file's
        /// metadata read via the stock <c>CraftProfileInfo</c> loader. Career-
        /// gated (the saved-ships widgets are career-facing; a sandbox has no
        /// funds affordance to spend on unlocking parts) and rate-limited to
        /// <see cref="SavedShipsRescanIntervalUt"/> - between scans the cached
        /// list is returned so the disk isn't touched every tick. Returns
        /// <c>null</c> - the whole list - outside career or before a save folder
        /// exists, so the provider reads "no data yet."
        /// </summary>
        private static List<object?>? BuildSavedShips(double ut)
        {
            var game = HighLogic.CurrentGame;
            if (game == null || game.Mode != Game.Modes.CAREER)
            {
                _cachedSavedShips = null;
                _lastSavedShipsScanUt = double.NegativeInfinity;
                return null;
            }

            // Serve the cache unless the scan interval has elapsed; a UT that
            // moved backward (revert/load) also forces a fresh scan.
            if (_cachedSavedShips != null
                && ut >= _lastSavedShipsScanUt
                && ut - _lastSavedShipsScanUt < SavedShipsRescanIntervalUt)
            {
                return _cachedSavedShips;
            }

            var gameName = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(gameName))
            {
                return null;
            }

            var ships = new List<object?>();
            foreach (var facility in new[] { EditorFacility.VAB, EditorFacility.SPH })
            {
                string path;
                try
                {
                    path = ShipConstruction.GetShipsPathFor(gameName, facility);
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] saved-ships path lookup failed for " + facility + ", skipping: " + ex);
                    continue;
                }

                if (string.IsNullOrEmpty(path) || !Directory.Exists(path))
                {
                    continue;
                }

                foreach (var file in Directory.GetFiles(path, "*.craft"))
                {
                    try
                    {
                        var root = ConfigNode.Load(file);
                        if (root == null)
                        {
                            continue;
                        }

                        var info = new CraftProfileInfo();
                        info.LoadDetailsFromCraftFile(root, file);

                        var missing = new List<object?>();
                        if (info.UnavailableShipParts != null)
                        {
                            foreach (var part in info.UnavailableShipParts)
                            {
                                missing.Add(part);
                            }
                        }

                        ships.Add(new Dictionary<string, object?>
                        {
                            ["name"] = info.shipName,
                            ["partCount"] = info.partCount,
                            ["totalMass"] = info.totalMass,
                            ["facility"] = info.shipFacility.ToString(),
                            // The ordinal is what the client branches on and
                            // sends back; the name is its display label.
                            ["facilityOrdinal"] = (int)info.shipFacility,
                            ["requiresFunds"] = info.totalCost,
                            ["missingParts"] = missing,
                        });
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning("[Gonogo] saved-ship parse failed for " + file + ", skipping: " + ex);
                    }
                }
            }

            _cachedSavedShips = ships;
            _lastSavedShipsScanUt = ut;
            return ships;
        }

        /// <summary>
        /// The count of parts the player can place right now. In career this is
        /// tech-unlocked AND purchased (<c>ResearchAndDevelopment.
        /// PartTechAvailable</c> + <c>PartModelPurchased</c>, the same
        /// <c>PartLoader.parts</c> walk <see cref="BuildCareerTech"/> already
        /// does); outside career everything in the catalogue is placeable, so
        /// the full <c>PartLoader.parts.Count</c> is emitted. Returns <c>null</c>
        /// when <c>PartLoader</c> isn't ready (pre-load), or in career when
        /// <c>ResearchAndDevelopment.Instance</c> isn't ready, so the provider
        /// reads "no data yet."
        /// </summary>
        private static int? BuildPartsAvailable()
        {
            var loader = PartLoader.Instance;
            if (loader == null || loader.parts == null)
            {
                return null;
            }

            var game = HighLogic.CurrentGame;
            var career = game != null && game.Mode == Game.Modes.CAREER;
            if (!career)
            {
                return loader.parts.Count;
            }

            if (ResearchAndDevelopment.Instance == null)
            {
                return null;
            }

            var count = 0;
            foreach (var part in loader.parts)
            {
                if (part == null)
                {
                    continue;
                }

                if (ResearchAndDevelopment.PartTechAvailable(part) && ResearchAndDevelopment.PartModelPurchased(part))
                {
                    count++;
                }
            }

            return count;
        }

        // ----------------------------------------------------------------
        // Career/KSC capture (funds/reputation/science, facility
        // levels+costs, contracts, strategies, unlocked tech)
        // ----------------------------------------------------------------

        /// <summary>
        /// The <c>SpaceCenterFacility</c> ids <see cref="BuildCareerFacilities"/>
        /// walks: EVERY member of the enum, derived rather than written out.
        ///
        /// <para>This was a hand-written list of nine. It was complete, which is
        /// the problem with a list like it: nothing says so, and nothing would
        /// say otherwise the day KSP adds a tenth facility. The walk would simply
        /// not visit it, the client would show eight buildings out of nine, and
        /// no test in the tree would notice. Same shape as the action-group
        /// table beside it, so the same fix.</para>
        /// </summary>
        private static readonly SpaceCenterFacility[] TrackedFacilities =
            ((SpaceCenterFacility[])Enum.GetValues(typeof(SpaceCenterFacility)))
            .OrderBy(f => (int)f)
            .ToArray();

        /// <summary>
        /// Primitives-only snapshot of KSP's career-mode state - the
        /// funds/reputation/science economy, per-facility level/upgrade
        /// cost, active+offered contracts, active strategies, and unlocked
        /// tech count. Scene-independent (career state is global, unlike
        /// vessel/body data), so <see cref="Sample"/> attempts this every
        /// tick regardless of <c>FlightGlobals</c> readiness.
        ///
        /// <para>Returns <c>null</c> - the WHOLE group, never a partial or
        /// fabricated-zero one - whenever the active save isn't career mode:
        /// Sandbox has no <c>Funding</c>/<c>ContractSystem</c>/
        /// <c>StrategySystem</c> to read at all, so reporting zeros there
        /// would be indistinguishable from "a career save with genuinely
        /// zero funds," which is exactly the kind of fabricated-sentinel
        /// this class's every other <c>Build*</c> helper refuses to do (see
        /// <see cref="BuildResources"/>'s doc comment for the same
        /// discipline). <c>Game.Modes.SCIENCE_SANDBOX</c> is treated the
        /// same as Sandbox here - it has <c>ResearchAndDevelopment</c> but
        /// no <c>Funding</c>/<c>ContractSystem</c>/<c>StrategySystem</c>/
        /// <c>ScenarioUpgradeableFacilities</c>, so gating the whole group
        /// on genuine <c>CAREER</c> mode is the correct "all or nothing"
        /// read, not a missed case.</para>
        /// </summary>
        private static string? BuildGameMode()
        {
            var game = HighLogic.CurrentGame;
            if (game == null)
            {
                return null;
            }

            // Raw Game.Modes name passed straight through (not pre-mapped) so
            // the provider (CareerViewProvider.ParseGameMode) owns the
            // enum-fold, same capture->provider split as every other pair
            // here. Emitted in ALL modes - unlike BuildCareer, which returns
            // null outside CAREER. HighLogic.CurrentGame.Mode is a Game.Modes
            // field (decompile-verified).
            return game.Mode.ToString();
        }

        private static Dictionary<string, object?>? BuildCareer(IEconomyBackend? economy, double ut)
        {
            var game = HighLogic.CurrentGame;
            if (game == null || game.Mode != Game.Modes.CAREER)
            {
                return null;
            }

            var career = new Dictionary<string, object?>();
            TryBuildGroup(career, "economy", () => BuildCareerEconomy(economy, ut));
            TryBuildGroup(career, "facilities", BuildCareerFacilities);
            TryBuildGroup(career, "contracts", BuildCareerContracts);
            TryBuildGroup(career, "strategies", BuildCareerStrategies);
            TryBuildGroup(career, "tech", BuildCareerTech);
            return career;
        }

        /// <summary>
        /// Funds/reputation/science - confirmed via decompile as
        /// <c>Funding.Instance.Funds</c> (double), <c>Reputation.Instance.
        /// reputation</c> (float property, lowercase - the decompiled
        /// source really does expose it that way, alongside the
        /// unrelated static <c>CurrentRep</c>), and <c>ResearchAndDevelopment.
        /// Instance.Science</c> (float). Each of these three lazy
        /// <c>ScenarioModule</c> singletons is independently null-checked -
        /// they can be transiently null even in career mode (e.g. mid
        /// scene-transition, right after <see cref="BuildCareer"/>'s own
        /// mode gate already passed) - so a hiccup in one doesn't blank the
        /// other two.
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerEconomy(IEconomyBackend? economy, double ut)
        {
            var funding = Funding.Instance;
            var reputation = Reputation.Instance;
            var rnd = ResearchAndDevelopment.Instance;
            if (funding == null && reputation == null && rnd == null)
            {
                return null;
            }

            var rep = reputation != null ? (double?)reputation.reputation : null;
            var group = new Dictionary<string, object?>
            {
                ["funds"] = funding != null ? (double?)funding.Funds : null,
                ["reputation"] = rep,
                ["science"] = rnd != null ? (double?)rnd.Science : null,
            };

            // What that reputation MEANS, from whichever money model won the
            // election. The reading above is untouched by it: the value was never
            // in dispute, and a career overhaul that decays reputation daily and
            // converts it to a funding subsidy changes what the number is FOR
            // rather than what it is. The elected backend is handed the reputation
            // rather than reading it, so there is exactly one place that number
            // comes from.
            //
            // A throw takes this GROUP only, via TryBuildGroup, leaving
            // funds/reputation/science standing.
            //
            // This runs on the COURIER thread, not the main one: it is reached
            // from the career.status channel mapper, and AddChannelSource mappers
            // run on the Courier thread by design. So a backend here may read an
            // overhaul's own scenario modules, which is what the elected backends
            // do, but must not call anything that touches Unity or broadcasts a
            // game event. RP-1's per-line upkeep pricing does broadcast one, which
            // is why it is captured on the main thread by the RP-1 Uplink's own
            // sampled source and only read from here.
            var reading = economy?.Interpret(ut, rep);
            if (reading == null)
            {
                return group;
            }

            group["economyModel"] = economy?.ProviderId;
            group["reputationDecayPerDay"] = reading.ReputationDecayPerDay;
            group["subsidyPerDay"] = reading.SubsidyPerDay;
            group["subsidyMinPerDay"] = reading.SubsidyMinPerDay;
            group["subsidyMaxPerDay"] = reading.SubsidyMaxPerDay;
            group["upkeepPerDay"] = reading.UpkeepPerDay;

            // Two breakdowns, and each is emitted only when the model has one.
            // `upkeep` decomposes upkeepPerDay and is absent when the model cannot
            // state its parts in the same convention as its total;
            // `upkeepBeforeModifiers` is the same sources priced before whatever
            // the model applies at transaction time. Either can stand without the
            // other, so neither gates the other's key.
            AddUpkeepGroup(group, "upkeep", reading.UpkeepBreakdown);
            AddUpkeepGroup(group, "upkeepBeforeModifiers", reading.UpkeepBeforeModifiers);

            // Emitted only when a model actually has such a pool, the same way
            // the breakdown above is. Unlike decay and subsidy, where stock's
            // answer is a real zero worth stating, "no prepaid allowance exists
            // in this install" is said by the key not being there: a zero would
            // read as an exhausted allowance, which is a different fact.
            if (reading.UnlockCredit != null)
            {
                group["unlockCredit"] = reading.UnlockCredit;
            }
            return group;
        }

        /// <summary>
        /// One upkeep breakdown under <paramref name="key"/>, or nothing at all
        /// when the model does not have that one. Absent rather than a bag of
        /// nulls, the same way the group itself is absent on a model with no
        /// per-source concept.
        /// </summary>
        private static void AddUpkeepGroup(
            Dictionary<string, object?> group, string key, EconomyUpkeepBreakdown? breakdown)
        {
            if (breakdown == null)
            {
                return;
            }
            group[key] = new Dictionary<string, object?>
            {
                ["facilities"] = breakdown.Facilities,
                ["launchComplexes"] = breakdown.LaunchComplexes,
                ["researchSalary"] = breakdown.ResearchSalary,
                ["training"] = breakdown.Training,
                ["crewBase"] = breakdown.CrewBase,
                ["crewInFlight"] = breakdown.CrewInFlight,
                ["integrationSalary"] = breakdown.IntegrationSalary,
            };
        }

        /// <summary>
        /// Per-facility INTEGER tier/upgrade-cost, keyed by the raw
        /// <c>SpaceCenterFacility</c> enum name (e.g. <c>"LaunchPad"</c> -
        /// decompile-confirmed exact 9-member set: Administration/
        /// AstronautComplex/LaunchPad/MissionControl/ResearchAndDevelopment/
        /// Runway/TrackingStation/SpaceplaneHangar/VehicleAssemblyBuilding).
        ///
        /// <para>Read from
        /// <c>UpgradeableFacility.FacilityLevel</c>/<c>MaxLevel</c> rather than
        /// <c>ScenarioUpgradeableFacilities.GetFacilityLevel</c>, whose
        /// fractional [0,1] reading the KSC widget cannot turn into a tier
        /// without also knowing the tier count. Both are
        /// confirmed via decompile as plain <c>int</c> properties on the
        /// LIVE facility object (0-based: tier 0 is the starting/unupgraded
        /// tier, <c>MaxLevel</c> is the top tier's own index, e.g. 2 for a
        /// 3-tier facility). Reached the same way the
        /// <c>upgradeCost</c> capture is -
        /// <c>ScenarioUpgradeableFacilities.protoUpgradeables[SlashSanitize(name)]
        /// .facilityRefs[0]</c> - so <c>currentTier</c>/<c>maxTier</c>/
        /// <c>upgradeCost</c> share ONE gate: all three are only resolvable
        /// while the facility's live <c>UpgradeableFacility</c> GameObject
        /// is registered (i.e. standing in the Space Center scene;
        /// confirmed via decompile that <c>ScenarioUpgradeableFacilities.
        /// GetFacilityLevelCount</c> itself just proxies to this same
        /// <c>facilityRefs[0].MaxLevel</c> read, returning the sentinel
        /// <c>-1</c> otherwise - there never was a scene-independent tier
        /// source).</para>
        ///
        /// <para><b>A facility that cannot be read is left out, and a capture
        /// where none can be read is <c>null</c>.</b> The reading is gone
        /// through most of a session, and it used to be reported as nine
        /// entries of nulls, which travelled as a current answer of "no tier"
        /// and blanked a space centre that was still standing. Absence is now
        /// said by omission, once, and the <c>career.facilities</c> channel is
        /// declared <c>NullIsUnreadable</c> so a whole-capture null goes out as
        /// silence: the client holds its last reading and dates it.</para>
        ///
        /// <para>There is no stock way to recover the ladder off-scene. The
        /// persisted level is NORMALISED
        /// (<c>UpgradeableFacility.Save</c> writes <c>lvl =
        /// FacilityLevel / MaxLevel</c>), <c>upgradeLevels</c> is a serialized
        /// field on the scene component rather than anything the game database
        /// loads, and every <c>GameVariables</c> entry point takes a normalised
        /// level rather than exposing a count. So "0.5" cannot be told from
        /// tier 1 of 3 or tier 2 of 5 without the count that only the live
        /// object has.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerFacilities()
        {
            if (ScenarioUpgradeableFacilities.Instance == null)
            {
                return null;
            }

            var result = new Dictionary<string, object?>();
            foreach (var facility in TrackedFacilities)
            {
                var facilityName = facility.ToString();
                var sanitizedId = ScenarioUpgradeableFacilities.SlashSanitize(facilityName);

                if (!ScenarioUpgradeableFacilities.protoUpgradeables.TryGetValue(sanitizedId, out var proto) ||
                    proto?.facilityRefs == null || proto.facilityRefs.Count == 0 || proto.facilityRefs[0] == null)
                {
                    // Nothing to read from here, so nothing is written. The
                    // entry used to be emitted with all three values null,
                    // which spends a key on saying nothing and reads
                    // downstream as a facility that answered with no tier. An
                    // absent key says the same thing once, and lets the whole
                    // channel be absent when every facility is in this state.
                    continue;
                }

                var live = proto.facilityRefs[0];
                result[facilityName] = new Dictionary<string, object?>
                {
                    // The map stays keyed by NAME: rekeying it to a number would
                    // be a breaking retype and would change every consumer's key
                    // walk. The ordinal rides inside the entry so a client can
                    // identify the facility without trusting the key.
                    ["facilityOrdinal"] = (int)facility,
                    ["currentTier"] = live.FacilityLevel,
                    ["maxTier"] = live.MaxLevel,
                    ["upgradeCost"] = live.GetUpgradeCost(),
                };
            }

            return result.Count > 0 ? result : null;
        }

        /// <summary>Bound on the recently-completed contracts list: the last N
        /// <c>State.Completed</c> contracts by finish date, newest-first.</summary>
        private const int CompletedRecentLimit = 10;

        /// <summary>
        /// Active + offered contracts (title/agent/rewards/advance/deadline/
        /// state) from <c>ContractSystem.Instance.Contracts</c> - the list
        /// of NOT-YET-FINISHED contracts - PLUS a bounded recently-completed
        /// list from the separate <c>ContractSystem.Instance.ContractsFinished</c>
        /// (decompile-confirmed <c>List&lt;Contract&gt;</c>). Finished holds
        /// every terminal contract (completed/failed/expired/cancelled/
        /// withdrawn), so it is filtered to <c>Contract.State.Completed</c>,
        /// sorted newest-first by <c>Contract.DateFinished</c>
        /// (decompile-confirmed public <c>double</c>), and capped to
        /// <see cref="CompletedRecentLimit"/>. Every reward/advance field read
        /// here (<c>FundsAdvance</c>/<c>FundsCompletion</c>/<c>FundsFailure</c>/
        /// <c>ScienceCompletion</c>/<c>ReputationCompletion</c>/
        /// <c>ReputationFailure</c>) is a plain public field on
        /// <c>Contract</c>, confirmed via decompile - no getter indirection.
        /// Recently-completed entries reuse the exact same
        /// <see cref="BuildContractEntry"/> mapping as active/offered - no extra
        /// fields (their <c>state</c> is always <c>"Completed"</c>).
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerContracts()
        {
            var system = ContractSystem.Instance;
            if (system == null)
            {
                return null;
            }

            var active = new List<object?>();
            var offered = new List<object?>();
            var all = system.Contracts;
            if (all != null)
            {
                foreach (var contract in all)
                {
                    if (contract == null)
                    {
                        continue;
                    }

                    switch (contract.ContractState)
                    {
                        case Contract.State.Active:
                            active.Add(BuildContractEntry(contract));
                            break;
                        case Contract.State.Offered:
                            offered.Add(BuildContractEntry(contract));
                            break;
                    }
                }
            }

            return new Dictionary<string, object?>
            {
                ["active"] = active,
                ["offered"] = offered,
                ["completedRecent"] = BuildCompletedRecent(system),
            };
        }

        /// <summary>
        /// The last <see cref="CompletedRecentLimit"/> completed contracts from
        /// <c>ContractSystem.ContractsFinished</c>, newest-first by
        /// <c>DateFinished</c>. Filters to <c>Contract.State.Completed</c> so
        /// failed/expired/cancelled/withdrawn finished contracts are excluded.
        /// </summary>
        private static List<object?> BuildCompletedRecent(ContractSystem system)
        {
            var result = new List<object?>();
            var finished = system.ContractsFinished;
            if (finished == null)
            {
                return result;
            }

            var completed = new List<Contract>();
            foreach (var contract in finished)
            {
                if (contract != null && contract.ContractState == Contract.State.Completed)
                {
                    completed.Add(contract);
                }
            }

            completed.Sort((a, b) => b.DateFinished.CompareTo(a.DateFinished));

            for (var i = 0; i < completed.Count && i < CompletedRecentLimit; i++)
            {
                result.Add(BuildContractEntry(completed[i]));
            }

            return result;
        }

        /// <summary>
        /// <c>id</c>/<c>parameters</c> are the M3b career-detail
        /// capture-add: <c>ContractManager</c>/<c>Objectives</c> hard-require
        /// a stable per-contract id (they drop any entry without one) and
        /// <c>parameters</c> drives their whole progress-bar UI - neither
        /// existed on the wire before this session. <c>id</c> is
        /// <c>Contract.ContractID</c> (decompile-confirmed <c>long</c>
        /// field, stringified since KSP contract IDs routinely exceed
        /// <c>Number.MAX_SAFE_INTEGER</c> on the JS side) rather than
        /// <c>ContractGuid</c> - <c>ContractID</c> is the identifier every
        /// other KSP-adjacent surface (save files, other mods) already keys
        /// contracts by.
        /// </summary>
        private static Dictionary<string, object?> BuildContractEntry(Contract contract)
        {
            return new Dictionary<string, object?>
            {
                ["id"] = contract.ContractID.ToString(),
                ["title"] = contract.Title,
                ["agent"] = contract.Agent != null ? contract.Agent.Name : null,
                ["state"] = contract.ContractState.ToString(),
                ["fundsAdvance"] = contract.FundsAdvance,
                ["fundsCompletion"] = contract.FundsCompletion,
                ["fundsFailure"] = contract.FundsFailure,
                ["scienceCompletion"] = (double)contract.ScienceCompletion,
                ["reputationCompletion"] = (double)contract.ReputationCompletion,
                ["reputationFailure"] = (double)contract.ReputationFailure,
                ["dateAccepted"] = contract.DateAccepted,
                ["dateDeadline"] = contract.DateDeadline,
                ["dateExpire"] = contract.DateExpire,
                ["parameters"] = BuildContractParameters(contract),
            };
        }

        /// <summary>
        /// Flat top-level parameter list (title/state only, per the M3b
        /// scope) - <c>Contract.GetParameter(int)</c>/<c>ParameterCount</c>
        /// are the confirmed-via-decompile public <c>IContractParameterHost</c>
        /// accessors. A <c>ContractParameter</c> can itself host nested
        /// sub-parameters (same interface), but those aren't walked here -
        /// the widget's progress UI only needs the top-level list.
        /// <c>ParameterState</c>'s three values (Incomplete/Complete/Failed,
        /// decompile-confirmed) map 1:1 onto the widget's own
        /// <c>ContractParameterState</c> union, so <c>.ToString()</c> is a
        /// safe direct pass-through.
        /// </summary>
        private static List<object?> BuildContractParameters(Contract contract)
        {
            var result = new List<object?>();
            var count = contract.ParameterCount;
            for (var i = 0; i < count; i++)
            {
                var parameter = contract.GetParameter(i);
                if (parameter == null)
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["title"] = parameter.Title,
                    ["state"] = parameter.State.ToString(),
                    // The ordinal is what the client branches on; the name is
                    // its display label. See Sitrep.Contract/KspEnums.cs.
                    ["stateOrdinal"] = (int)parameter.State,
                });
            }

            return result;
        }

        /// <summary>
        /// Active strategies (rich id/cost/eligibility shape - see
        /// <see cref="BuildStrategyEntry"/>) from <c>StrategySystem.Instance.
        /// Strategies</c>, filtered to <c>IsActive</c> - the RAW active
        /// list, unfiltered against any admin-level cap. Deliberate: this
        /// project's own "KSP strategy over-cap quirk" finding is that the
        /// stock UI silently lets a save carry more active strategies than
        /// the Administration building's level allows, and the raw active
        /// list is the only surface that reveals it - re-deriving/enforcing
        /// the cap here would hide exactly the thing worth capturing.
        /// <c>activeCount</c> is simply this list's length, for a cheap
        /// "how many" read without a consumer needing to count the list
        /// itself.
        ///
        /// <para>M3b career-detail capture-add: <c>all</c> is the FULL
        /// roster (active + inactive), same entry shape as <c>active</c> -
        /// the Strategies widget's "browse and activate" list needs every
        /// strategy the current save knows about, not just the ones
        /// already committed to.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerStrategies()
        {
            var system = StrategySystem.Instance;
            if (system == null)
            {
                return null;
            }

            var active = new List<object?>();
            var all = new List<object?>();
            var strategies = system.Strategies;
            if (strategies != null)
            {
                foreach (var strategy in strategies)
                {
                    if (strategy == null)
                    {
                        continue;
                    }

                    var entry = BuildStrategyEntry(strategy);
                    all.Add(entry);
                    if (strategy.IsActive)
                    {
                        active.Add(entry);
                    }
                }
            }

            return new Dictionary<string, object?>
            {
                ["active"] = active,
                ["all"] = all,
                ["activeCount"] = active.Count,
            };
        }

        /// <summary>
        /// Per-strategy id/cost/eligibility, shared by <c>active</c> and
        /// <c>all</c> in <see cref="BuildCareerStrategies"/> - the Strategies
        /// widget's full parser shape (activate/deactivate need the stable
        /// id; the cost/eligibility fields drive the affordability and
        /// blocked-reason UI). Every field here is a plain public getter on
        /// <c>Strategy</c>/<c>StrategyConfig</c>, confirmed via decompile -
        /// no scene gating, no extra allocation beyond the one dictionary.
        /// <c>id</c> is <c>StrategyConfig.Name</c> (the strategy's internal
        /// cfg name, e.g. <c>"OutsourceRnDStrategy"</c> - stable across a
        /// save, unlike a list index). <c>CanBeActivated</c>/
        /// <c>CanBeDeactivated</c> are confirmed via decompile as pure
        /// eligibility checks (Administration cap, conflicting-strategy
        /// group tags, funds-on-hand) - no state mutation, safe to call on
        /// every strategy including already-active ones.
        /// </summary>
        private static Dictionary<string, object?> BuildStrategyEntry(Strategy strategy)
        {
            // Whether a strategy can be activated is a question KSP answers only
            // while the Administration Building is open, and that is structural
            // rather than occasional: CanBeActivated's first three arms read the
            // active-strategy count, the concurrent cap and the commit-level
            // ceiling straight off Administration.Instance, a UI MonoBehaviour
            // that exists only while the player has that screen up. With it
            // closed the very first arm throws, for EVERY strategy, on EVERY
            // tick. KspCareerActuator.ActivateStrategy already refuses on the
            // same ground; this is the reading half of the same rule.
            //
            // So canActivate is ABSENT rather than false when the answer cannot
            // be had. A false with "eligibility check failed" beside it is a
            // fabricated no: it reads as a strategy that was judged and refused,
            // it reads as intermittent, and neither is true. CanBeDeactivated
            // touches none of that and is asked unconditionally, which is why an
            // RP-1 Program reports a real deactivate reason beside an unanswered
            // activate one.
            //
            // The try/catch stays under the guard. A throw from anywhere else in
            // the eligibility walk must not propagate: BuildCareerStrategies
            // would lose the ENTIRE strategies channel for every tick one bad
            // strategy is in the roster.
            var eligibility = StrategyEligibility.AdministrationClosed();
            if (Administration.Instance != null)
            {
                try
                {
                    var answer = strategy.CanBeActivated(out var reason);
                    eligibility = StrategyEligibility.Answered(answer, reason);
                }
                catch (Exception ex)
                {
                    eligibility = StrategyEligibility.Threw(ex.GetType().Name);
                }
            }

            bool canDeactivate = false;
            string? deactivateBlockedReason = null;
            try
            {
                canDeactivate = strategy.CanBeDeactivated(out deactivateBlockedReason);
            }
            catch (Exception ex)
            {
                deactivateBlockedReason = "eligibility check failed: " + ex.GetType().Name;
            }

            return new Dictionary<string, object?>
            {
                ["id"] = strategy.Config != null ? strategy.Config.Name : null,
                ["title"] = strategy.Title,
                ["description"] = strategy.Description,
                ["department"] = strategy.DepartmentName,
                ["isActive"] = strategy.IsActive,
                ["factor"] = (double)strategy.Factor,
                ["dateActivated"] = strategy.DateActivated,
                ["requiredReputation"] = (double)strategy.RequiredReputation,
                ["initialCostFunds"] = (double)strategy.InitialCostFunds,
                ["initialCostScience"] = (double)strategy.InitialCostScience,
                ["initialCostReputation"] = (double)strategy.InitialCostReputation,
                ["hasFactorSlider"] = strategy.HasFactorSlider,
                ["factorSliderDefault"] = (double)strategy.FactorSliderDefault,
                ["factorSliderSteps"] = strategy.FactorSliderSteps,
                ["canActivate"] = eligibility.CanActivate,
                ["activateBlockedReason"] = eligibility.BlockedReason,
                ["canDeactivate"] = canDeactivate,
                ["deactivateBlockedReason"] = deactivateBlockedReason,
                ["effect"] = strategy.Effect,
            };
        }

        /// <summary>
        /// Unlocked-tech count (+ ids, since it's cheap here) - derived from
        /// <c>PartLoader.Instance.parts</c> rather than
        /// <c>ResearchAndDevelopment</c>'s own tech dictionary, which is
        /// PRIVATE (confirmed via decompile: <c>protoTechNodes</c> has no
        /// public enumerator, only per-id lookups via <c>GetTechState</c>).
        /// Every loaded <c>AvailablePart</c> carries a public
        /// <c>TechRequired</c> field; <c>ResearchAndDevelopment.
        /// PartTechAvailable(AvailablePart)</c> is the confirmed public
        /// static check for "is this part's tech unlocked" - deduplicating
        /// by <c>TechRequired</c> across every unlocked part yields the
        /// distinct unlocked tech-node id set cheaply, without needing the
        /// full tech-tree asset. A part with no <c>TechRequired</c> (rare,
        /// but seen on some stock/utility parts) is skipped rather than
        /// counted as an empty-string "tech."
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerTech()
        {
            var rnd = ResearchAndDevelopment.Instance;
            var loader = PartLoader.Instance;
            if (rnd == null || loader == null || loader.parts == null)
            {
                return null;
            }

            var unlockedTechIds = new HashSet<string>();
            foreach (var part in loader.parts)
            {
                if (part == null || string.IsNullOrEmpty(part.TechRequired))
                {
                    continue;
                }

                if (ResearchAndDevelopment.PartTechAvailable(part))
                {
                    unlockedTechIds.Add(part.TechRequired);
                }
            }

            return new Dictionary<string, object?>
            {
                ["unlockedCount"] = unlockedTechIds.Count,
                ["unlockedIds"] = new List<object?>(unlockedTechIds),
                // M3b career-detail capture-add: see BuildCareerTechNodes -
                // purely additive alongside unlockedCount/unlockedIds above
                // (unchanged), so nothing that already reads those two
                // regresses.
                ["nodes"] = BuildCareerTechNodes(),
            };
        }

        /// <summary>
        /// Full tech-node structure (id/title/description/scienceCost/unlocked/
        /// prerequisite edges) for the TechTree widget. Sourced from
        /// <c>AssetBase.RnDTechTree.GetTreeNodes()</c> - confirmed via
        /// decompile to return the STATIC, scene-independent
        /// <c>ProtoRDNode[]</c> graph (each node carries <c>parents</c>/
        /// <c>children</c>/<c>tech</c>), unlike the live <c>RDTech</c>
        /// <c>MonoBehaviour</c>s that only exist while the R&amp;D Building
        /// scene is open - so this, like <c>unlockedCount</c>/
        /// <c>unlockedIds</c> above, is available in career mode generally,
        /// not scene-gated.
        ///
        /// <para>Per-node <c>title</c> comes from <c>ResearchAndDevelopment.
        /// GetTechnologyTitle</c> and <c>unlocked</c> from
        /// <c>ResearchAndDevelopment.GetTechnologyState</c> - both STATIC
        /// methods confirmed via decompile to read the CURRENT save's live
        /// state (not the tree's own baked default), and both confirmed to
        /// null/no-op-guard their own <c>Instance</c>/
        /// <c>HighLogic.CurrentGame</c> internally, so no extra guard is
        /// needed here beyond this method's own <c>ResearchAndDevelopment.
        /// Instance</c>/tree-null checks. <c>scienceCost</c> comes from
        /// <c>ProtoTechNode.scienceCost</c> - the tree's own baked config
        /// value, not save-scoped (a tech's cost doesn't change once
        /// defined). <c>description</c> comes off the tree's own
        /// <c>ConfigNode</c>, see <see cref="BuildCareerTechDescriptions"/> for
        /// why it cannot come from the node objects here.</para>
        ///
        /// <para><c>parents</c> (prerequisite edges) is included rather
        /// than deferred: <c>ProtoRDNode.parents</c> is already an in-memory
        /// object graph the walk below needs anyway for <c>tech.techID</c>
        /// resolution on the node itself, so collecting each parent's
        /// <c>techID</c> alongside is free - no extra ConfigNode parsing.
        /// A "Researchable" (prereqs-met-but-not-yet-unlocked) UI state is
        /// NOT computed here - the raw <c>unlocked</c> bool + <c>parents</c>
        /// edges are enough for a consumer to derive that client-side (the
        /// TechTree widget already walks <c>parents</c> for its own graph
        /// layout), matching this capture's usual "primitives, not derived
        /// UI state" discipline.</para>
        ///
        /// <para>Returns <c>null</c> - the whole <c>nodes</c> list, never a
        /// partial one - whenever the static tree itself isn't resolvable
        /// (e.g. <c>AssetBase.RnDTechTree</c>'s backing <c>fetch</c> hasn't
        /// spawned yet), which <see cref="BuildCareerTech"/>'s caller
        /// (<c>TryBuildGroup</c>, one level up in <c>BuildCareer</c>) maps
        /// to omitting the whole <c>tech</c> group on any exception - this
        /// method itself only returns <c>null</c> for the "tree not ready"
        /// case, it never throws deliberately.</para>
        /// </summary>
        private static List<object?>? BuildCareerTechNodes()
        {
            var tree = AssetBase.RnDTechTree;
            var rdNodes = tree != null ? tree.GetTreeNodes() : null;
            if (rdNodes == null)
            {
                return null;
            }

            var descriptions = BuildCareerTechDescriptions(tree!);

            var nodes = new List<object?>();
            foreach (var rdNode in rdNodes)
            {
                var tech = rdNode != null ? rdNode.tech : null;
                if (tech == null || string.IsNullOrEmpty(tech.techID))
                {
                    continue;
                }

                var parentIds = new List<object?>();
                if (rdNode!.parents != null)
                {
                    foreach (var parent in rdNode.parents)
                    {
                        var parentTechId = parent != null && parent.tech != null ? parent.tech.techID : null;
                        if (!string.IsNullOrEmpty(parentTechId))
                        {
                            parentIds.Add(parentTechId);
                        }
                    }
                }

                nodes.Add(new Dictionary<string, object?>
                {
                    ["id"] = tech.techID,
                    ["title"] = ResearchAndDevelopment.GetTechnologyTitle(tech.techID),
                    ["description"] = descriptions.TryGetValue(tech.techID, out var description) ? description : null,
                    ["scienceCost"] = (double)tech.scienceCost,
                    ["unlocked"] = ResearchAndDevelopment.GetTechnologyState(tech.techID) == RDTech.State.Available,
                    ["parents"] = parentIds,
                });
            }

            return nodes;
        }

        /// <summary>
        /// Each tech node's flavour line, keyed by tech id, read off the tree's
        /// own <c>ConfigNode</c>.
        ///
        /// <para>The config is the only place a description survives outside the
        /// R&amp;D Building. <c>ProtoTechNode</c>, which the walk above holds,
        /// carries id/state/cost and nothing else; the <c>description</c> field
        /// lives on <c>RDTech</c>, a <c>MonoBehaviour</c> spawned only while
        /// that scene is open. <c>GetTreeConfigNode</c> hands back the same
        /// <c>TechTree</c> node <c>GetTreeNodes</c> was built from, loaded from
        /// the GameDatabase, so a tree a mod has replaced (RP-1) reads
        /// identically and a node's description is the one the save is actually
        /// playing.</para>
        ///
        /// <para>Values arrive from the database already localised. The
        /// <c>#autoLOC_</c> guard covers the file-loaded path KSP falls back to,
        /// and drops the value rather than showing an operator a key that did
        /// not resolve.</para>
        /// </summary>
        private static Dictionary<string, string> BuildCareerTechDescriptions(RDTechTree tree)
        {
            var byId = new Dictionary<string, string>();
            var treeNode = tree.GetTreeConfigNode();
            if (treeNode == null)
            {
                return byId;
            }

            foreach (var configNode in treeNode.GetNodes("RDNode"))
            {
                var id = configNode.GetValue("id");
                var description = configNode.GetValue("description");
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(description))
                {
                    continue;
                }

                if (description!.IndexOf("#autoLOC", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    description = GameWords.Sentence(description, string.Empty);
                    if (string.IsNullOrEmpty(description))
                    {
                        continue;
                    }
                }

                byId[id!] = description!;
            }

            return byId;
        }

        /// <summary>
        /// Raw per-body dictionary in the exact shape
        /// <c>Sitrep.Host.SystemViewProvider.BuildSystemBodies</c> expects
        /// (see that class's doc comment) - primitives only, keyed exactly:
        /// name/index/parentIndex/radius/sma/ecc/inc/lan/argPe/
        /// meanAnomalyAtEpoch/epoch/mu - plus the physical parameters added
        /// for G-2 (gravParameter/mass/sphereOfInfluence/geeASL/
        /// rotationPeriod/initialRotation/rotationAngle), which
        /// <c>BuildSystemBodies</c> simply ignores (additive-only mapping -
        /// see its doc comment). <c>mu</c> is the PARENT body's
        /// <c>gravParameter</c> (needed to propagate THIS body's own orbit -
        /// before G-2 only the vessel's orbit carried a <c>mu</c>), not this
        /// body's own <c>gravParameter</c> (that's the separate
        /// <c>gravParameter</c> key, this body's own µ for satellites
        /// orbiting IT).
        /// </summary>
        private static Dictionary<string, object?> BuildBodyEntry(CelestialBody body)
        {
            var refBody = body.referenceBody;
            // See the class doc comment: referenceBody returns the body
            // ITSELF (never null) when there's no orbitDriver - the sun.
            var isRoot = refBody == null || ReferenceEquals(refBody, body);
            int? parentIndex = isRoot ? (int?)null : refBody!.flightGlobalsIndex;

            var entry = new Dictionary<string, object?>
            {
                ["name"] = body.bodyName,
                ["index"] = body.flightGlobalsIndex,
                ["parentIndex"] = parentIndex,
                ["radius"] = body.Radius,
                ["gravParameter"] = body.gravParameter,
                ["mass"] = body.Mass,
                ["sphereOfInfluence"] = body.sphereOfInfluence,
                ["geeASL"] = body.GeeASL,
                // PositiveInfinity for the root star, which the provider's
                // non-finite-is-absent rule turns into a null rather than a
                // token: nothing bounds the star.
                ["hillSphere"] = body.hillSphere,
                ["rotationPeriod"] = body.rotationPeriod,
                ["initialRotation"] = body.initialRotation,
                ["rotationAngle"] = body.rotationAngle,
                // Almanac enrichment consumed by SystemViewProvider.BuildBody.
                ["tidallyLocked"] = body.tidallyLocked,
                ["hasOcean"] = body.ocean,
                ["description"] = body.bodyDescription,
                ["isHome"] = body.isHomeWorld,
                /* Atmosphere as FLAT keys (a nested dict here would need special
                   handling across the RecordedSessionCodec JSON round-trip); the
                   provider reassembles them into the nested wire object. The two
                   pressure-profile arrays below are added conditionally rather
                   than as nulls, so an airless body carries no trace of a
                   profile at all. */
                ["hasAtmosphere"] = body.atmosphere,
                ["atmosphereDepth"] = body.atmosphere ? (double?)body.atmosphereDepth : null,
                ["atmosphereHasOxygen"] = body.atmosphere ? (bool?)body.atmosphereContainsOxygen : null,
                ["atmosphereSeaLevelPressure"] = body.atmosphere ? (double?)body.atmospherePressureSeaLevel : null,
            };

            if (body.atmosphere)
            {
                var profile = PressureProfileFor(body);
                entry["atmospherePressureAltitudes"] = profile?.Altitudes;
                entry["atmospherePressureSamples"] = profile?.Pressures;
            }

            var orbit = body.orbit;
            if (!isRoot && orbit != null)
            {
                entry["sma"] = orbit.semiMajorAxis;
                entry["ecc"] = orbit.eccentricity;
                entry["inc"] = orbit.inclination;
                entry["lan"] = orbit.LAN;
                entry["argPe"] = orbit.argumentOfPeriapsis;
                entry["meanAnomalyAtEpoch"] = orbit.meanAnomalyAtEpoch;
                entry["epoch"] = orbit.epoch;
                entry["mu"] = refBody != null ? (double?)refBody.gravParameter : null;
            }

            return entry;
        }

        private sealed class PressureProfile
        {
            public double Depth;
            public double SeaLevel;
            public double[]? Altitudes;
            public double[]? Pressures;
        }

        /// <summary>
        /// Cached per-body pressure profile, keyed by the body's stable index.
        ///
        /// <para>The profile is a property of the atmosphere and nothing moves
        /// it, but this method is on the once-per-second body-roster path and
        /// the sampler costs a few hundred <c>GetPressure</c> calls, so
        /// resampling every body every tick would spend that on the game's own
        /// thread for a table that never changes. The cached depth and
        /// sea-level pressure are re-checked rather than assumed, so a
        /// Kopernicus reload that genuinely reshapes an atmosphere is picked
        /// up.</para>
        /// </summary>
        private static readonly Dictionary<int, PressureProfile> PressureProfiles =
            new Dictionary<int, PressureProfile>();

        private static PressureProfile? PressureProfileFor(CelestialBody body)
        {
            var depth = body.atmosphereDepth;
            var seaLevel = body.atmospherePressureSeaLevel;
            if (PressureProfiles.TryGetValue(body.flightGlobalsIndex, out var cached)
                && cached.Depth == depth
                && cached.SeaLevel == seaLevel)
            {
                return cached;
            }

            var profile = new PressureProfile { Depth = depth, SeaLevel = seaLevel };
            if (AtmospherePressureProfile.TryBuild(body.GetPressure, depth, out var altitudes, out var pressures))
            {
                profile.Altitudes = altitudes;
                profile.Pressures = pressures;
            }
            PressureProfiles[body.flightGlobalsIndex] = profile;
            return profile;
        }

        // ----------------------------------------------------------------
        // Science capture (onboard experiments/containers, science lab
        // processing state, Breaking Ground deployed experiments)
        // ----------------------------------------------------------------

        /// <summary>
        /// Primitives-only snapshot of the active vessel's science state -
        /// mirrors <see cref="BuildCareer"/>'s "own try per sub-group"
        /// discipline via <see cref="TryBuildGroup"/> so a failure reading
        /// e.g. a Breaking Ground module can't blank the onboard-experiment
        /// list. Speed-prioritized for THIS session: every field is a raw
        /// primitive pass-through of what KSP already tracks - no derived
        /// "true" science value is computed here (that's
        /// <c>ResearchAndDevelopment.Instance.ScienceValue</c>'s job, a
        /// follow-up if a consumer needs it).
        /// </summary>
        private static Dictionary<string, object?> BuildScience(Vessel vessel)
        {
            var entry = new Dictionary<string, object?>();
            TryBuildGroup(entry, "experiments", () => BuildScienceExperiments(vessel));
            TryBuildGroup(entry, "instruments", () => BuildScienceInstruments(vessel));
            TryBuildGroup(entry, "sensors", () => BuildScienceSensors(vessel));
            TryBuildGroup(entry, "lab", () => BuildScienceLab(vessel));
            // Deployed science is captured GLOBALLY (across every loaded
            // vessel), NOT off the active vessel this method receives -- see
            // BuildDeployedScience's doc comment. Kept as a "science"
            // sub-group for channel continuity even though its data comes
            // from other vessels entirely.
            TryBuildGroup(entry, "deployed", () => BuildDeployedScience());
            TryBuildGroup(entry, "experimentBreakdown", () => BuildScienceExperimentBreakdown(vessel));
            return entry;
        }

        /// <summary>
        /// Per-subject rollup of the same stored <see cref="ScienceData"/>
        /// <see cref="BuildScienceExperiments"/> lists one-row-per-blob. This is
        /// the home of the <c>sci.experimentBreakdown</c> enrichment, which the
        /// base wire carries no equivalent of.
        /// Re-walks the vessel's experiment/container modules
        /// independently rather than reusing <see cref="BuildScienceExperiments"/>'s
        /// output, mirroring this group's existing "one independent walk per
        /// sub-group" convention (<see cref="BuildScienceLab"/>/
        /// <see cref="BuildScienceSensors"/>/<see cref="BuildScienceInstruments"/>
        /// are likewise separate walks, not derived from each other).
        /// <c>biome</c>/<c>situation</c> come from
        /// <c>ScienceUtil.GetExperimentFieldsFromScienceID</c> (confirmed via
        /// decompile: public static, splits the subject id APART rather than
        /// re-deriving from the vessel's CURRENT position, so a subject
        /// collected earlier in the flight keeps its own original biome/
        /// situation). <c>remainingPotential</c> is the ABSOLUTE science left
        /// in the subject (<c>ScienceSubject.scienceCap - science</c>, via
        /// <c>ResearchAndDevelopment.GetSubjectByID</c>): <c>0</c> outside
        /// Career/Science mode, where <c>ResearchAndDevelopment.Instance</c> is
        /// null. One entry per DISTINCT subject id; multiple stored blobs for
        /// the same subject collapse into one entry with <c>dataMits</c>
        /// summed. Null when the vessel carries no stored science data at all,
        /// never an empty list (same convention <see cref="BuildScienceExperiments"/>
        /// uses).
        /// </summary>
        private static List<object?>? BuildScienceExperimentBreakdown(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            var bySubject = new Dictionary<string, (string title, double dataMits)>();
            var order = new List<string>();

            void Accumulate(ScienceData data)
            {
                var subjectId = data.subjectID;
                if (string.IsNullOrEmpty(subjectId))
                {
                    return;
                }

                if (bySubject.TryGetValue(subjectId, out var running))
                {
                    bySubject[subjectId] = (running.title, running.dataMits + data.dataAmount);
                }
                else
                {
                    bySubject[subjectId] = (data.title, data.dataAmount);
                    order.Add(subjectId);
                }
            }

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var experiments = part.Modules.GetModules<ModuleScienceExperiment>();
                if (experiments != null)
                {
                    foreach (var exp in experiments)
                    {
                        if (exp == null)
                        {
                            continue;
                        }

                        ScienceData[]? data;
                        try { data = exp.GetData(); } catch { data = null; }
                        if (data == null)
                        {
                            continue;
                        }

                        foreach (var d in data)
                        {
                            if (d != null)
                            {
                                Accumulate(d);
                            }
                        }
                    }
                }

                var containers = part.Modules.GetModules<ModuleScienceContainer>();
                if (containers != null)
                {
                    foreach (var container in containers)
                    {
                        if (container == null)
                        {
                            continue;
                        }

                        ScienceData[]? data;
                        try { data = container.GetData(); } catch { data = null; }
                        if (data == null)
                        {
                            continue;
                        }

                        foreach (var d in data)
                        {
                            if (d != null)
                            {
                                Accumulate(d);
                            }
                        }
                    }
                }
            }

            if (order.Count == 0)
            {
                return null;
            }

            var list = new List<object?>();
            foreach (var subjectId in order)
            {
                var (title, dataMits) = bySubject[subjectId];
                ScienceUtil.GetExperimentFieldsFromScienceID(subjectId, out _, out string situation, out string biome);

                var remainingPotential = 0.0;
                if (ResearchAndDevelopment.Instance != null)
                {
                    var subject = ResearchAndDevelopment.GetSubjectByID(subjectId);
                    if (subject != null)
                    {
                        remainingPotential = (double)(subject.scienceCap - subject.science);
                    }
                }

                list.Add(new Dictionary<string, object?>
                {
                    ["subjectId"] = subjectId,
                    ["biome"] = biome,
                    ["situation"] = situation,
                    ["expTitle"] = title,
                    ["dataMits"] = dataMits,
                    ["remainingPotential"] = remainingPotential,
                });
            }

            return list;
        }

        /// <summary>
        /// One entry per <see cref="ScienceData"/> currently held by any
        /// <see cref="ModuleScienceExperiment"/> (data collected in the
        /// experiment itself, not yet transferred - <c>location:
        /// "experiment"</c>) or <see cref="ModuleScienceContainer"/> (data
        /// already collected into an onboard container - <c>location:
        /// "container"</c>) on the vessel. Both classes expose a public
        /// <c>GetData()</c> directly (confirmed via decompile) - called on
        /// the concrete type rather than through <c>IScienceDataContainer</c>
        /// (that interface decompiled with no visible members, so nothing is
        /// assumed about it). Null when the vessel carries no science data
        /// at all, never an empty list (same "omit entirely" convention
        /// <see cref="BuildManeuverNodes"/> uses).
        /// </summary>
        private static List<object?>? BuildScienceExperiments(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            List<object?>? list = null;
            var situation = vessel.situation.ToString();

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var partName = part.partInfo != null ? part.partInfo.title : part.name;

                var experiments = part.Modules.GetModules<ModuleScienceExperiment>();
                if (experiments != null)
                {
                    foreach (var exp in experiments)
                    {
                        if (exp == null)
                        {
                            continue;
                        }

                        ScienceData[]? data;
                        try { data = exp.GetData(); } catch { data = null; }
                        if (data == null)
                        {
                            continue;
                        }

                        foreach (var d in data)
                        {
                            if (d == null)
                            {
                                continue;
                            }
                            list ??= new List<object?>();
                            list.Add(BuildScienceDataEntry(d, partName, situation, "experiment", exp.experimentID, exp.Deployed, exp.Inoperable));
                        }
                    }
                }

                var containers = part.Modules.GetModules<ModuleScienceContainer>();
                if (containers != null)
                {
                    foreach (var container in containers)
                    {
                        if (container == null)
                        {
                            continue;
                        }

                        ScienceData[]? data;
                        try { data = container.GetData(); } catch { data = null; }
                        if (data == null)
                        {
                            continue;
                        }

                        foreach (var d in data)
                        {
                            if (d == null)
                            {
                                continue;
                            }
                            list ??= new List<object?>();
                            list.Add(BuildScienceDataEntry(d, partName, situation, "container", null, null, null));
                        }
                    }
                }
            }

            return list;
        }

        private static Dictionary<string, object?> BuildScienceDataEntry(ScienceData data, string partName, string situation, string location, string? experimentId, bool? deployed, bool? inoperable)
        {
            return new Dictionary<string, object?>
            {
                ["partName"] = partName,
                // "experiment" = still sitting in the experiment module,
                // uncollected; "container" = already collected into an
                // onboard ModuleScienceContainer. KSP doesn't track a
                // separate "already transmitted" flag on ScienceData itself
                // (transmission is a fire-and-forget action, not persisted
                // state) - the consumer reads location as the closest
                // available "stored vs not yet collected" signal.
                ["location"] = location,
                ["experimentId"] = experimentId,
                ["subjectId"] = data.subjectID,
                ["title"] = data.title,
                ["dataAmount"] = (double)data.dataAmount,
                ["scienceValueRatio"] = (double)data.scienceValueRatio,
                ["baseTransmitValue"] = (double)data.baseTransmitValue,
                ["transmitBonus"] = (double)data.transmitBonus,
                ["labValue"] = (double)data.labValue,
                ["deployed"] = deployed,
                ["inoperable"] = inoperable,
                ["situation"] = situation,
            };
        }

        /// <summary>
        /// One entry per <see cref="ModuleScienceExperiment"/> on the active
        /// vessel, captured as an INVENTORY / operability list keyed by the
        /// part's <c>flightID</c> - distinct from
        /// <see cref="BuildScienceExperiments"/>, which walks the same modules
        /// but emits one row per STORED <see cref="ScienceData"/> result (a
        /// module holding no data produces no row there). This list emits a row
        /// for EVERY experiment module regardless of whether it currently holds
        /// data, so the operator can see what instruments are aboard and their
        /// deploy/inoperable/rerunnable/resettable/collectable state. All five
        /// booleans and <c>experimentID</c> are public fields on
        /// <see cref="ModuleScienceExperiment"/> (confirmed via decompile);
        /// <c>title</c> is the linked <c>ScienceExperiment.experimentTitle</c>,
        /// read defensively since the definition can be lazily unresolved.
        /// Null when the vessel carries no experiment modules at all, never an
        /// empty list (same "omit entirely" convention the sibling builders
        /// use).
        /// </summary>
        private static List<object?>? BuildScienceInstruments(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            List<object?>? list = null;

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var partName = part.partInfo != null ? part.partInfo.title : part.name;
                var partId = part.flightID != 0 ? part.flightID.ToString() : null;

                var experiments = part.Modules.GetModules<ModuleScienceExperiment>();
                if (experiments == null)
                {
                    continue;
                }

                foreach (var exp in experiments)
                {
                    if (exp == null)
                    {
                        continue;
                    }

                    string? title = null;
                    try { title = exp.experiment != null ? exp.experiment.experimentTitle : null; }
                    catch { title = null; }

                    list ??= new List<object?>();
                    list.Add(new Dictionary<string, object?>
                    {
                        ["partId"] = partId,
                        ["partName"] = partName,
                        ["experimentId"] = exp.experimentID,
                        ["title"] = title,
                        ["deployed"] = exp.Deployed,
                        ["inoperable"] = exp.Inoperable,
                        ["rerunnable"] = exp.rerunnable,
                        ["resettable"] = exp.resettable,
                        ["dataIsCollectable"] = exp.dataIsCollectable,
                    });
                }
            }

            return list;
        }

        /// <summary>
        /// One entry per <see cref="ModuleEnviroSensor"/> (thermometer,
        /// barometer, gravioli detector, accelerometer, and any modded sensor
        /// sharing the module) on the active vessel. A GENERAL sensor group -
        /// one entry per module, <c>type</c> carrying the raw
        /// <see cref="SensorType"/> enum name as a string - NOT four fixed
        /// temp/pres/grav/acc keys, so modded sensor types and multiple
        /// instances of the same type both fall out naturally. Verified public
        /// members (via decompile): <c>sensorType</c> (SensorType enum),
        /// <c>readoutInfo</c> (string, the live readout, "Off" when inactive),
        /// <c>sensorActive</c> (bool). Null when the vessel carries no sensor
        /// module at all, never an empty list (same "omit entirely" convention
        /// <see cref="BuildScienceExperiments"/> uses).
        /// </summary>
        private static List<object?>? BuildScienceSensors(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            List<object?>? list = null;

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var partName = part.partInfo != null ? part.partInfo.title : part.name;
                // Same flightID join key as the power/robotics captures - see
                // BuildPartsPower's comment. 0 is the uninitialized sentinel.
                var partId = part.flightID != 0 ? part.flightID.ToString() : null;

                var sensors = part.Modules.GetModules<ModuleEnviroSensor>();
                if (sensors == null)
                {
                    continue;
                }

                foreach (var sensor in sensors)
                {
                    if (sensor == null)
                    {
                        continue;
                    }
                    list ??= new List<object?>();
                    list.Add(new Dictionary<string, object?>
                    {
                        ["partId"] = partId,
                        ["partName"] = partName,
                        ["type"] = sensor.sensorType.ToString(),
                        ["readout"] = sensor.readoutInfo,
                        ["active"] = sensor.sensorActive,
                    });
                }
            }

            return list;
        }

        /// <summary>
        /// One entry per <see cref="ModuleScienceLab"/> (MPL) on the vessel.
        /// <c>scienceRate</c> comes from <c>ModuleScienceConverter.
        /// CalculateScienceRate(dataStored)</c> via the lab's public
        /// <c>Converter</c> property (confirmed via decompile) - wrapped in
        /// its own try since a lab with no converter configured is a valid
        /// (if unusual) part config. <c>scientistCount</c> counts
        /// <c>part.protoModuleCrew</c> entries whose <c>trait == "Scientist"</c>
        /// (both confirmed via decompile - <c>Part.protoModuleCrew</c> is a
        /// public field, <c>ProtoCrewMember.trait</c> a public string).
        /// </summary>
        private static List<object?>? BuildScienceLab(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            List<object?>? list = null;

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var labs = part.Modules.GetModules<ModuleScienceLab>();
                if (labs == null)
                {
                    continue;
                }

                foreach (var lab in labs)
                {
                    if (lab == null)
                    {
                        continue;
                    }

                    var partName = part.partInfo != null ? part.partInfo.title : part.name;

                    double? rate = null;
                    try
                    {
                        var converter = lab.Converter;
                        if (converter != null)
                        {
                            rate = converter.CalculateScienceRate(lab.dataStored);
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning("[Gonogo] science.lab rate read failed on \"" + partName + "\", omitting: " + ex);
                    }

                    var scientistCount = 0;
                    var crew = part.protoModuleCrew;
                    if (crew != null)
                    {
                        foreach (var kerbal in crew)
                        {
                            if (kerbal != null && kerbal.trait == "Scientist")
                            {
                                scientistCount++;
                            }
                        }
                    }

                    bool? isOperational = null;
                    try { isOperational = lab.IsOperational(); } catch { isOperational = null; }

                    list ??= new List<object?>();
                    list.Add(new Dictionary<string, object?>
                    {
                        ["partName"] = partName,
                        ["dataStored"] = (double)lab.dataStored,
                        ["dataStorage"] = (double)lab.dataStorage,
                        ["storedScience"] = (double)lab.storedScience,
                        ["processingData"] = lab.processingData,
                        ["statusText"] = lab.statusText,
                        ["scientistCount"] = scientistCount,
                        ["scienceRate"] = rate,
                        ["isOperational"] = isOperational,
                    });
                }
            }

            return list;
        }

        /// <summary>
        /// Breaking Ground deployed-experiment modules
        /// (<c>ModuleGroundExperiment</c>), captured GLOBALLY across every
        /// loaded vessel <c>FlightGlobals.Vessels</c> knows about - NOT off
        /// the active vessel.
        ///
        /// <para><b>Why global (the bug this fixes):</b> a Breaking Ground
        /// deployed experiment does NOT live on the vessel the player is
        /// flying - once deployed, KSP spawns each cluster as its OWN
        /// separate ground vessel (vessel type <c>DeployedSciencePart</c> /
        /// <c>DeployedScienceController</c>). The original version of this
        /// method walked only <c>FlightGlobals.ActiveVessel</c>'s parts, so
        /// it never saw a single deployed experiment and this group always
        /// came back null even with science actively deploying. Iterating
        /// <c>FlightGlobals.Vessels</c> and walking each vessel's parts is
        /// the fix - the deployed cluster is a peer vessel, found the same
        /// way <see cref="BuildVesselRosterEntry"/> enumerates the roster.
        /// (LOADED vessels only: an unloaded/packed cluster far from the
        /// active vessel has no live <c>parts</c> list - reading it would
        /// need <c>ProtoPartSnapshot</c> walking, a documented follow-up.)</para>
        ///
        /// <para><b>Reflection guard (absent-DLC → null):</b> the type is
        /// matched by <c>GetType().Name == "ModuleGroundExperiment"</c> and
        /// every field/property read via <see cref="ReflectString"/>/
        /// <see cref="ReflectDouble"/>/<see cref="ReflectBool"/> rather than
        /// a static reference, so an install WITHOUT Breaking Ground (where
        /// the type simply never appears on any part) yields an empty walk
        /// and this returns null - the whole group omitted, same convention
        /// as every other <c>Build*</c> here. Decompile-confirmed members
        /// (<c>Assembly-CSharp.dll</c>, <c>ModuleGroundExperiment :
        /// ModuleGroundSciencePart</c>): <c>experimentId</c> (string field),
        /// <c>ScienceCompletedPercentage</c>/<c>ScienceTransmittedPercentage</c>
        /// (float fields), <c>ScienceValue</c>/<c>ScienceLimit</c> (float
        /// get-properties); inherited from <c>ModuleGroundSciencePart</c>:
        /// <c>PowerState</c>/<c>ConnectionState</c> (string fields - the
        /// "has power / has comms" readout) and <c>DeployedOnGround</c>
        /// (bool get-property). <c>Type.GetField(Public|Instance)</c> reaches
        /// inherited public fields/properties, so all are read straight off
        /// the concrete module instance.</para>
        /// </summary>
        private static List<object?>? BuildDeployedScience()
        {
            if (!FlightGlobals.ready || FlightGlobals.fetch == null)
            {
                return null;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            List<object?>? list = null;

            foreach (var vessel in vessels)
            {
                if (vessel == null)
                {
                    continue;
                }

                var parts = vessel.parts;
                if (parts == null || parts.Count == 0)
                {
                    continue;
                }

                var vesselName = vessel.vesselName;
                var situation = vessel.situation.ToString();
                var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
                var body = orbit?.referenceBody;
                var bodyName = body != null ? body.bodyName : null;
                var biome = ResolveBiome(vessel, body);

                foreach (var part in parts)
                {
                    if (part == null || part.Modules == null)
                    {
                        continue;
                    }

                    var partName = part.partInfo != null ? part.partInfo.title : part.name;

                    foreach (var module in part.Modules)
                    {
                        if (module == null || module.GetType().Name != "ModuleGroundExperiment")
                        {
                            continue;
                        }

                        var type = module.GetType();
                        list ??= new List<object?>();
                        list.Add(new Dictionary<string, object?>
                        {
                            ["vesselName"] = vesselName,
                            ["partName"] = partName,
                            ["body"] = bodyName,
                            ["situation"] = situation,
                            ["biome"] = biome,
                            ["experimentId"] = ReflectString(type, module, "experimentId"),
                            ["scienceCompletedPercentage"] = ReflectDouble(type, module, "ScienceCompletedPercentage"),
                            ["scienceTransmittedPercentage"] = ReflectDouble(type, module, "ScienceTransmittedPercentage"),
                            ["scienceValue"] = ReflectDouble(type, module, "ScienceValue"),
                            ["scienceLimit"] = ReflectDouble(type, module, "ScienceLimit"),
                            // Localised prose, kept for display only. The two
                            // derived fields below are what a client branches on.
                            ["powerState"] = ReflectString(type, module, "PowerState"),
                            ["connectionState"] = ReflectString(type, module, "ConnectionState"),
                            ["power"] = (int?)DerivePowerState(type, module),
                            ["controllerConnected"] = ReflectMemberValue(type, module, "ScienceClusterData") != null,
                            ["deployedOnGround"] = ReflectBool(type, module, "DeployedOnGround"),
                        });
                    }
                }
            }

            return list;
        }

        /// <summary>
        /// A deployed experiment's power state, derived from the same four facts
        /// <c>ModuleGroundSciencePart.UpdateModuleUI()</c> branches on rather
        /// than parsed back out of the sentence that method writes.
        ///
        /// <para>The reason this is not simply <c>PowerState</c> forwarded:
        /// <c>UpdateModuleUI</c> assigns that field from <c>Localizer</c>, so it
        /// is prose in the player's language, and it only assigns it when the
        /// part-action window refreshes, so it can be stale. A client that
        /// compared it against <c>"Powered"</c> read every not-powered state as
        /// powered. Reading the booleans removes both problems at once.</para>
        ///
        /// <para>The branch order mirrors stock's exactly - no cluster, then not
        /// enabled or not deployed, then powered, then controller off, then
        /// unpowered - so this reports what the game's own readout would say,
        /// in a form that survives translation.</para>
        /// </summary>
        private static DeployedPowerState? DerivePowerState(Type type, object module)
        {
            var cluster = ReflectMemberValue(type, module, "ScienceClusterData");
            if (cluster == null)
            {
                return DeployedPowerState.NotConnected;
            }

            var enabled = ReflectBool(type, module, "Enabled");
            var deployed = ReflectBool(type, module, "DeployedOnGround");
            if (enabled == false || deployed == false)
            {
                return DeployedPowerState.Disabled;
            }

            var clusterType = cluster.GetType();
            var isPowered = ReflectBool(clusterType, cluster, "IsPowered");
            var controllerEnabled = ReflectBool(clusterType, cluster, "ControllerPartEnabled");
            if (isPowered == true)
            {
                return DeployedPowerState.Powered;
            }

            // Neither read answered: the cluster is there but says nothing, which
            // is not a claim that it is unpowered.
            if (isPowered == null && controllerEnabled == null)
            {
                return null;
            }

            return controllerEnabled == true
                ? DeployedPowerState.Unpowered
                : DeployedPowerState.ControllerDisabled;
        }

        /// <summary>
        /// Whole-career R&amp;D archive - a GLOBAL walk of
        /// <c>ResearchAndDevelopment.GetSubjects()</c>, not tied to the
        /// active vessel like every other <c>science.*</c> sub-group above.
        /// A <see cref="ScienceSubject"/> is created the first time its id
        /// is ever collected or recovered anywhere, so this is every subject
        /// the career has EVER touched, not just what a craft currently has
        /// stored. Returns null - no key at all, never an empty list - when
        /// <c>ResearchAndDevelopment.Instance</c> is null (Sandbox has no
        /// R&amp;D archive to walk).
        /// <c>situation</c>/<c>biome</c> come from the string-out overload of
        /// <c>ScienceUtil.GetExperimentFieldsFromScienceID</c> (BodyName,
        /// Situation, Biome order, confirmed via decompile), the same helper
        /// <see cref="BuildScienceExperimentBreakdown"/> uses.
        /// <c>experimentTitle</c> falls back to the raw experiment id when
        /// <c>GetExperiment</c> can't resolve it (a modded experiment no
        /// longer installed since the subject was first collected).
        /// </summary>
        private static List<object?>? BuildScienceArchive()
        {
            if (ResearchAndDevelopment.Instance == null)
            {
                return null;
            }

            // A live R&D instance with no subjects yet (a fresh career) must
            // emit an EMPTY list, not null: null is reserved for "no R&D
            // instance at all" (Sandbox, the guard above) so the client can
            // tell a not-yet-collected career apart from a non-career save.
            var subjects = ResearchAndDevelopment.GetSubjects() ?? new List<ScienceSubject>();

            var list = new List<object?>(subjects.Count);
            foreach (var subject in subjects)
            {
                if (subject == null || string.IsNullOrEmpty(subject.id))
                {
                    continue;
                }

                var experimentId = subject.id.Split('@')[0];
                var experiment = ResearchAndDevelopment.GetExperiment(experimentId);
                var experimentTitle = experiment != null && !string.IsNullOrEmpty(experiment.experimentTitle)
                    ? experiment.experimentTitle
                    : experimentId;

                var body = ScienceUtil.GetExperimentBodyName(subject.id);
                ScienceUtil.GetExperimentFieldsFromScienceID(subject.id, out _, out string situation, out string biome);

                list.Add(new Dictionary<string, object?>
                {
                    ["subjectId"] = subject.id,
                    ["experimentId"] = experimentId,
                    ["experimentTitle"] = experimentTitle,
                    ["body"] = body,
                    ["situation"] = situation,
                    ["biome"] = biome,
                    ["title"] = subject.title,
                    ["science"] = (double)subject.science,
                    ["scienceCap"] = (double)subject.scienceCap,
                    ["remainingPotential"] = (double)(subject.scienceCap - subject.science),
                    ["subjectValue"] = (double)subject.subjectValue,
                });
            }

            return list;
        }

        /// <summary>
        /// Biome name at <paramref name="vessel"/>'s current lat/long on
        /// <paramref name="body"/>, or null when the body has no biome map.
        /// <c>CBAttributeMapSO.GetAtt</c> expects RADIANS (confirmed via
        /// decompile - it divides lat by <c>Math.PI</c>, not 180), while
        /// <c>Vessel.latitude</c>/<c>longitude</c> are degrees.
        /// </summary>
        private static string? ResolveBiome(Vessel vessel, CelestialBody? body)
        {
            if (body == null || body.BiomeMap == null)
            {
                return null;
            }

            var latRad = vessel.latitude * Math.PI / 180.0;
            var lonRad = vessel.longitude * Math.PI / 180.0;
            var attribute = body.BiomeMap.GetAtt(latRad, lonRad);
            return attribute != null ? attribute.name : null;
        }

        /// <summary>
        /// Reads a public instance FIELD or get-PROPERTY named
        /// <paramref name="name"/> off <paramref name="instance"/> via
        /// reflection, tolerating it being absent/renamed (returns
        /// <c>null</c>, never throws) - the guard
        /// <see cref="BuildDeployedScience"/>'s doc comment describes for the
        /// obfuscation-risky Breaking Ground type this class can't safely
        /// reference statically. Field takes precedence over property (some
        /// members surfaced as one or the other across KSP versions).
        /// </summary>
        private static object? ReflectMemberValue(Type type, object instance, string name)
        {
            try
            {
                var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
                if (field != null)
                {
                    return field.GetValue(instance);
                }
                var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (property != null && property.CanRead)
                {
                    return property.GetValue(instance);
                }
                return null;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] reflective read of " + type.Name + "." + name + " failed, omitting: " + ex);
                return null;
            }
        }

        private static string? ReflectString(Type type, object instance, string name) =>
            ReflectMemberValue(type, instance, name) as string;

        private static bool? ReflectBool(Type type, object instance, string name) =>
            ReflectMemberValue(type, instance, name) as bool?;

        /// <summary>
        /// Numeric-aware sibling of <see cref="ReflectMemberValue"/> - widens
        /// a reflected <c>float</c>/<c>int</c>/<c>double</c> to <c>double?</c>
        /// (a boxed <c>float</c> won't satisfy a plain <c>is double</c>), or
        /// null when the member is absent or non-numeric.
        /// </summary>
        private static double? ReflectDouble(Type type, object instance, string name)
        {
            var value = ReflectMemberValue(type, instance, name);
            return value switch
            {
                float f => f,
                double d => d,
                int i => i,
                _ => (double?)null,
            };
        }

        // ----------------------------------------------------------------
        // Parts/power/robotics capture (solar/battery/fuel-cell/alternator
        // power production, Breaking Ground robotics)
        // ----------------------------------------------------------------

        /// <summary>
        /// Primitives-only snapshot of the active vessel's power production
        /// and robotics state. Same "own try per sub-group" discipline as
        /// <see cref="BuildScience"/>.
        /// </summary>
        private static Dictionary<string, object?> BuildParts(Vessel vessel)
        {
            var entry = new Dictionary<string, object?>();
            TryBuildGroup(entry, "power", () => BuildPartsPower(vessel));
            TryBuildGroup(entry, "robotics", () => BuildPartsRobotics(vessel));
            // Always-present availability flag (NOT a TryBuildGroup group -
            // it must be a definite bool whenever there's an active vessel, so
            // robotics.available can tell "vessel has no robotic parts"
            // (false) apart from "no active vessel" (parts key omitted). See
            // BuildRoboticsAvailable.
            entry["roboticsAvailable"] = BuildRoboticsAvailable(vessel);
            return entry;
        }

        /// <summary>
        /// True when the active vessel carries ANY Breaking Ground robotic
        /// servo (rotor / hinge / piston) - all of which subclass the shared
        /// <see cref="BaseServo"/> (<c>Expansions.Serenity</c>), so a single
        /// <c>GetModules&lt;BaseServo&gt;()</c> per part covers all three
        /// without enumerating the concrete subtypes. Powers the
        /// <c>robotics.available</c> Topic. Each part's read is individually
        /// try/caught so one bad part can't blank the flag; an absent Serenity
        /// install just means no part reports a BaseServo, which reads as
        /// false without any special-casing.
        /// </summary>
        private static bool BuildRoboticsAvailable(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return false;
            }

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                try
                {
                    var servos = part.Modules.GetModules<BaseServo>();
                    if (servos != null && servos.Count > 0)
                    {
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] robotics.available read failed on a part, skipping: " + ex);
                }
            }

            return false;
        }

        /// <summary>
        /// Solar panels (<see cref="ModuleDeployableSolarPanel"/>: deploy
        /// state + live/rated flow), batteries (any part's <c>ElectricCharge</c>
        /// resource capacity - per-part granularity, complementing
        /// <see cref="BuildResources"/>'s vessel-wide sum), fuel cells
        /// (<see cref="ModuleResourceConverter"/> whose recipe outputs
        /// <c>ElectricCharge</c> - confirmed via decompile that
        /// <c>BaseConverter.outputList</c>/<c>ResourceRatio.ResourceName</c>
        /// are public), and alternators (<see cref="ModuleAlternator"/>'s
        /// live <c>outputRate</c>). <c>totalProductionEc</c> sums solar
        /// <c>flowRate</c> + alternator <c>outputRate</c> only - the "if
        /// cheap" aggregate the task called for; fuel-cell/consumption isn't
        /// cheaply derivable from these fields alone and is left to the
        /// consumer. Each part's read is individually try/caught so one bad
        /// part can't blank the whole group. Null when the vessel has
        /// nothing at all in any of the four lists.
        /// </summary>
        private static Dictionary<string, object?>? BuildPartsPower(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            var solarPanels = new List<object?>();
            var batteries = new List<object?>();
            var fuelCells = new List<object?>();
            var alternators = new List<object?>();
            double totalProduction = 0;

            foreach (var part in parts)
            {
                if (part == null)
                {
                    continue;
                }

                var partName = part.partInfo != null ? part.partInfo.title : part.name;
                // flightID is the ID FlightGlobals.FindPartByID/Vessel's own
                // indexer key off - assigned uniquely per Part instance when
                // the vessel loads into flight, stable across scene changes
                // and quicksave/quickload for the life of that flight. That
                // makes it the right join key for disambiguating symmetric
                // parts (e.g. a multirotor's N identically-named arms) that
                // partName alone can't tell apart. 0 is the uninitialized
                // sentinel, so treat it as "unavailable".
                var partId = part.flightID != 0 ? part.flightID.ToString() : null;

                try
                {
                    var panels = part.Modules != null ? part.Modules.GetModules<ModuleDeployableSolarPanel>() : null;
                    if (panels != null)
                    {
                        foreach (var panel in panels)
                        {
                            if (panel == null)
                            {
                                continue;
                            }
                            solarPanels.Add(new Dictionary<string, object?>
                            {
                                ["partName"] = partName,
                                ["partId"] = partId,
                                ["deployState"] = panel.deployState.ToString(),
                                ["flowRate"] = (double)panel.flowRate,
                                ["chargeRate"] = (double)panel.chargeRate,
                                ["sunAOA"] = (double)panel.sunAOA,
                            });
                            totalProduction += panel.flowRate;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.power solar read failed on \"" + partName + "\", skipping: " + ex);
                }

                try
                {
                    var resources = part.Resources;
                    if (resources != null && resources.Contains("ElectricCharge"))
                    {
                        var ec = resources["ElectricCharge"];
                        if (ec != null && ec.maxAmount > 0)
                        {
                            batteries.Add(new Dictionary<string, object?>
                            {
                                ["partName"] = partName,
                                ["partId"] = partId,
                                ["current"] = ec.amount,
                                ["max"] = ec.maxAmount,
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.power battery read failed on \"" + partName + "\", skipping: " + ex);
                }

                try
                {
                    var converters = part.Modules != null ? part.Modules.GetModules<ModuleResourceConverter>() : null;
                    if (converters != null)
                    {
                        foreach (var converter in converters)
                        {
                            if (converter == null)
                            {
                                continue;
                            }

                            var producesEc = false;
                            var outputs = converter.outputList;
                            if (outputs != null)
                            {
                                foreach (var output in outputs)
                                {
                                    if (output.ResourceName == "ElectricCharge")
                                    {
                                        producesEc = true;
                                        break;
                                    }
                                }
                            }
                            if (!producesEc)
                            {
                                continue;
                            }

                            fuelCells.Add(new Dictionary<string, object?>
                            {
                                ["partName"] = partName,
                                ["partId"] = partId,
                                ["active"] = converter.IsActivated,
                                ["status"] = converter.status,
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.power fuel cell read failed on \"" + partName + "\", skipping: " + ex);
                }

                try
                {
                    var alts = part.Modules != null ? part.Modules.GetModules<ModuleAlternator>() : null;
                    if (alts != null)
                    {
                        foreach (var alt in alts)
                        {
                            if (alt == null)
                            {
                                continue;
                            }
                            alternators.Add(new Dictionary<string, object?>
                            {
                                ["partName"] = partName,
                                ["partId"] = partId,
                                ["outputRate"] = (double)alt.outputRate,
                            });
                            totalProduction += alt.outputRate;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.power alternator read failed on \"" + partName + "\", skipping: " + ex);
                }
            }

            if (solarPanels.Count == 0 && batteries.Count == 0 && fuelCells.Count == 0 && alternators.Count == 0)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["solarPanels"] = solarPanels,
                ["batteries"] = batteries,
                ["fuelCells"] = fuelCells,
                ["alternators"] = alternators,
                ["totalProductionEc"] = totalProduction,
            };
        }

        /// <summary>
        /// Breaking Ground robotics. Discovery goes through the shared
        /// <see cref="BaseServo"/> (<c>Expansions.Serenity</c>) rather than a
        /// list of concrete subclasses: <c>BaseServo</c> is what "a robotic
        /// servo" MEANS, and asking the game for it cannot fall behind the
        /// game the way a written-down list of kinds does. It already had:
        /// <see cref="ModuleRoboticRotationServo"/> is a SIBLING of
        /// <see cref="ModuleRoboticServoHinge"/>, not a subclass, so a
        /// per-kind scan for hinges never saw one and every rotation servo on
        /// the vessel was dropped before it reached the wire - while
        /// <see cref="BuildRoboticsAvailable"/> and
        /// <c>KspRoboticsActuator</c>, which both already asked for
        /// <c>BaseServo</c>, reported the craft as having robotics and would
        /// lock or unlock a servo this list never showed.
        ///
        /// <para>Per-kind DETAIL still varies by kind (a rotor has RPM, a
        /// hinge an angle, a piston an extension), and that mapping lives in
        /// <see cref="ServoCapture"/>. This method's job is only to find every
        /// servo and stamp the part identity on it.</para>
        ///
        /// <para>The <c>Expansions.Serenity</c> types are baked into the SAME
        /// Assembly-CSharp.dll this project already references, so the direct
        /// static reference is safe without <see cref="BuildDeployedScience"/>'s
        /// reflection guard - "DLC absent" here just means no part on the
        /// vessel reports a <c>BaseServo</c>, which the empty-list -&gt; null
        /// fallback already covers. Null when the vessel has no robotic parts
        /// at all.</para>
        /// </summary>
        private static List<object?>? BuildPartsRobotics(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            List<object?>? list = null;

            foreach (var part in parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var partName = part.partInfo != null ? part.partInfo.title : part.name;
                // Same flightID join key as BuildPartsPower - see comment
                // there. Same-named symmetric servos (e.g. a multirotor's N
                // identical arms) are otherwise indistinguishable on the wire.
                var partId = part.flightID != 0 ? part.flightID.ToString() : null;

                try
                {
                    var entries = ServoCapture.BuildEntries(
                        part.Modules.GetModules<BaseServo>(), partName, partId);
                    if (entries.Count > 0)
                    {
                        list ??= new List<object?>();
                        list.AddRange(entries);
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.robotics read failed on \"" + partName + "\", skipping: " + ex);
                }
            }

            return list;
        }

        // ----------------------------------------------------------------
        // Part-tree topology capture (vessel.parts: P1b slice 2)
        // ----------------------------------------------------------------

        /// <summary>
        /// One pass over <c>vessel.parts</c> producing the raw part-tree the
        /// <c>vessel.parts</c> channel maps (VesselPartsViewProvider). Each
        /// part carries its stable flightID join key (same string form as the
        /// parts.power/robotics captures), parent link, name/title/category,
        /// vessel-local position + up axis + bounds, dry mass, staging, the
        /// four per-part temperatures thermal folds in on, its PartModule class
        /// names (what ShipMap's classifier matches), and the robotics /
        /// power-related / fuel-line-target flags. Null when the vessel has no
        /// parts at all. Every part's read is individually try/caught so one
        /// bad part can't blank the whole list, matching the part-walk
        /// discipline in <see cref="BuildPartsPower"/>/<see cref="BuildPartsRobotics"/>.
        /// </summary>
        private static List<object?>? BuildTopology(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            var list = new List<object?>();
            foreach (var part in parts)
            {
                if (part == null)
                {
                    continue;
                }

                try
                {
                    list.Add(BuildTopologyPart(part));
                }
                catch (Exception ex)
                {
                    var name = part.partInfo != null ? part.partInfo.name : part.name;
                    Debug.LogWarning("[Gonogo] vessel.parts topology read failed on \"" + name + "\", skipping: " + ex);
                }
            }

            return list;
        }

        private static Dictionary<string, object?> BuildTopologyPart(Part part)
        {
            // Same flightID string join key the power/robotics captures use,
            // see BuildPartsPower's comment. 0 is the uninitialized sentinel.
            var id = part.flightID != 0 ? part.flightID.ToString() : null;
            var parentId = part.parent != null && part.parent.flightID != 0
                ? part.parent.flightID.ToString()
                : null;

            var modules = new List<object?>();
            if (part.Modules != null)
            {
                foreach (var module in part.Modules)
                {
                    if (module != null)
                    {
                        // GetType().Name is the CLR class name (e.g.
                        // "ModuleEngines", "CModuleFuelLine"): exactly what
                        // ShipMap's classifyPart matches on, and guaranteed the
                        // class-name form (unlike PartModule.moduleName).
                        modules.Add(module.GetType().Name);
                    }
                }
            }

            var up = part.orgRot * Vector3.up;

            return new Dictionary<string, object?>
            {
                ["id"] = id,
                ["parentId"] = parentId,
                ["name"] = part.partInfo != null ? part.partInfo.name : part.name,
                ["title"] = part.partInfo != null ? part.partInfo.title : null,
                ["position"] = Vec3Array(part.orgPos),
                ["up"] = Vec3Array(up),
                ["bounds"] = new Dictionary<string, object?>
                {
                    // prefabSize is the per-part-constant proxy for renderer
                    // bounds (design §6): cheap to read every keyframe.
                    ["size"] = Vec3Array(part.prefabSize),
                    ["center"] = Vec3Array(part.boundsCentroidOffset),
                },
                ["dryMass"] = (double)part.mass,
                ["inverseStage"] = part.inverseStage,
                ["maxTemp"] = part.maxTemp,
                // -1 is the "no skin-thermal model" / "not yet simulated"
                // sentinel for both skinMaxTemp and temperature: carry it as
                // null, never a fabricated sub-zero-Kelvin reading.
                ["skinMaxTemp"] = part.skinMaxTemp > 0 ? part.skinMaxTemp : (double?)null,
                ["currentTemp"] = part.temperature >= 0 ? part.temperature : (double?)null,
                // skinTemp needs no such guard and the asymmetry is deliberate:
                // Part declares `skinMaxTemp = -1.0` but leaves skinTemperature
                // at 0, so -1 is never its value. Its uninitialised reading is
                // 0 K, which PASSES the >= 0 guard used above, so a 0 here is an
                // unsimulated part rather than a cold one.
                ["skinTemp"] = part.skinTemperature,
                ["category"] = part.partInfo != null ? part.partInfo.category.ToString() : null,
                // The ordinal is what the client branches on; the name is its
                // display label. `PartCategories.none` is -1, a real value.
                ["categoryOrdinal"] = part.partInfo != null ? (int)part.partInfo.category : (int?)null,
                ["modules"] = modules,
                ["isRobotics"] = part.isRobotic(),
                ["isPowerRelated"] = IsPowerRelated(part),
                ["fuelLineTargetId"] = FuelLineTargetId(part),
                ["resources"] = BuildPartResources(part),
                ["moduleStates"] = BuildPartModuleStates(part),
                ["actionBindings"] = BuildActionBindings(part),
            };
        }

        /// <summary>
        /// The named <see cref="KSPActionGroup"/> members a part action can be
        /// bound to, DERIVED from the enum rather than written out.
        ///
        /// <para>This was a hand-written list of seventeen, which is a
        /// transcription of somebody else's declaration and drifts the moment
        /// they append to it: a group KSP adds is dropped before it reaches the
        /// wire, and the client cannot tell a group it was never sent from a
        /// group nothing is bound to. That is the ServoCapture failure from
        /// contract Minor 20 in a different domain, so it gets the same fix.</para>
        ///
        /// <para><c>None</c> (0) and <c>REPLACEWITHDEFAULT</c> (-1) are excluded
        /// because neither is a group: 0 matches every mask under <c>&amp;</c>
        /// and -1 matches any bit set at all, so including either would report a
        /// group on every action. Ordered by value, which reproduces the previous
        /// list's order for every member it had.</para>
        /// </summary>
        private static readonly KSPActionGroup[] NamedActionGroups =
            ((KSPActionGroup[])Enum.GetValues(typeof(KSPActionGroup)))
            .Where(g => (int)g > 0)
            .OrderBy(g => (int)g)
            .ToArray();

        /// <summary>
        /// Per-action action-group bindings for the parts tree, one entry per
        /// part action bound to at least one action group. <c>BaseAction.actionGroup</c>
        /// is a <see cref="KSPActionGroup"/> Flags bitmask; decode it to the named
        /// groups (Custom01..., SAS, Brakes, ...) + the action's <c>guiName</c>.
        /// Actions bound to no group are omitted. Retires the legacy
        /// <c>f.ag.bindings</c> shim.
        /// </summary>
        private static List<object?> BuildActionBindings(Part part)
        {
            var result = new List<object?>();
            if (part.Actions == null)
            {
                return result;
            }

            foreach (var action in part.Actions)
            {
                if (action == null)
                {
                    continue;
                }

                var groups = new List<object?>();
                foreach (var group in NamedActionGroups)
                {
                    if ((action.actionGroup & group) == group)
                    {
                        groups.Add(group.ToString());
                    }
                }

                if (groups.Count == 0)
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["action"] = action.guiName ?? "",
                    ["groups"] = groups,
                    // The whole bitmask, so a client is never limited to the
                    // groups this capture happened to name.
                    ["groupsMask"] = (int)action.actionGroup,
                });
            }

            return result;
        }

        /// <summary>
        /// Per-part live resource storage + flow: the <c>vessel.parts</c>
        /// replacement for the legacy <c>r.resourceFor[flightId]</c> key.
        /// Every resource the part carries gets an amount/maxAmount row
        /// (storage, always present); a row with zero storage is still added
        /// when a module contributes FLOW for a resource the part doesn't
        /// itself store (e.g. an engine's own part rarely carries its own
        /// propellant): same "flow without storage" contract
        /// <c>PartResources</c>' SDK doc comment documents.
        ///
        /// <para><b>Production flow ("if cheap" only, matching
        /// <see cref="BuildPartsPower"/>'s own precedent):</b> solar panels
        /// (<c>ModuleDeployableSolarPanel.flowRate</c>/<c>chargeRate</c> →
        /// nominal), alternators (<c>ModuleAlternator.outputRate</c>, no
        /// nominal), and engine propellant consumption
        /// (<c>Propellant.currentRequirement</c>, signed negative, no
        /// nominal).</para>
        ///
        /// <para><b>EC consumption</b>, which is what feeds PowerSystems'
        /// "Consumers" list: without it that list has only production rows to
        /// filter negatives out of, and finds none. Every
        /// <c>PartModule</c> carries a <c>resHandler</c>
        /// (<c>ModuleResourceHandler</c>) field: decompile of
        /// <c>UpdateModuleResourceInputs</c> shows
        /// <c>ModuleResource.currentRequest = rate * rateMultiplier *
        /// TimeWarp.fixedDeltaTime</c>, i.e. the live per-tick amount the
        /// module is CURRENTLY drawing, in the SAME <c>resHandler</c> shape
        /// across every module that uses it, <see cref="EcInputRatePerSecond"/>
        /// is the one shared reader for that shape (prefer-the-generic-path
        /// over re-deriving the rate math per module type). It is deliberately
        /// NOT walked blindly across every module on the part though:
        /// <c>currentRequest</c> is a snapshot only refreshed by the OWNING
        /// module's own update call, and several of them skip that call
        /// entirely while inactive (e.g. <c>ModuleLight.FixedUpdate</c> jumps
        /// straight past <c>resHandler.UpdateModuleResourceInputs</c> when
        /// <c>isOn</c> is false), reading it unconditionally would report a
        /// switched-off light's LAST active draw forever. So each consumer
        /// below is still gated on its own "is this actually consuming right
        /// now" signal: <c>ModuleReactionWheel.State == Active</c> (decompile
        /// of <c>FixedUpdate</c> confirms the resHandler update itself is
        /// nested behind this exact check), <c>ModuleLight.useResources &amp;&amp;
        /// isOn</c>, <c>ModuleDataTransmitter.IsBusy()</c>.
        /// <c>ModuleCommand.UpdateControlState()</c> is the one exception,
        /// decompile shows it runs unconditionally every flight FixedUpdate
        /// (hibernation only scales <c>rateMultiplier</c> down, never skips
        /// the call), so it needs no extra active-gate.
        /// <c>ModuleResourceConverter</c>/<c>ModuleResourceHarvester</c>
        /// (ISRU/drills) share a common ancestor, <c>BaseConverter</c>, whose
        /// EC entry (if any) lives in the PUBLIC <c>inputList</c>, walked
        /// generically across every <c>BaseConverter</c> subclass rather than
        /// enumerating the concrete converter/harvester types by hand. Their
        /// live draw is approximated as <c>Ratio * EfficiencyBonus *
        /// lastTimeFactor</c> (all public fields on <c>BaseConverter</c>):
        /// this REVISES the "not cheaply derivable" call in
        /// <see cref="BuildPartsPower"/>'s doc comment for the EC-INPUT side
        /// specifically (production/output recipe simulation there is
        /// unaffected and still unwalked); <c>lastTimeFactor</c> is a
        /// decompile-inferred proxy for "fraction of the nominal rate the
        /// broker actually granted last tick" rather than a value KSP labels
        /// as such, so treat it as best-effort pending a live Deck
        /// cross-check against an active ISRU rig. Inactive converters still
        /// get a negative <c>nominalFlow</c> (from the config <c>Ratio</c>)
        /// so a stowed/idle drill shows up in PowerSystems' Idle section,
        /// same as an unfolded-but-shaded solar panel does today.</para>
        /// </summary>
        private static Dictionary<string, object?> BuildPartResources(Part part)
        {
            var result = new Dictionary<string, object?>();

            var resources = part.Resources;
            if (resources != null)
            {
                foreach (PartResource res in resources)
                {
                    if (res == null || string.IsNullOrEmpty(res.resourceName))
                    {
                        continue;
                    }

                    result[res.resourceName] = new Dictionary<string, object?>
                    {
                        ["amount"] = (double)res.amount,
                        ["maxAmount"] = (double)res.maxAmount,
                        ["flow"] = null,
                        ["nominalFlow"] = null,
                    };
                }
            }

            if (part.Modules != null)
            {
                try
                {
                    var panels = part.Modules.GetModules<ModuleDeployableSolarPanel>();
                    if (panels != null)
                    {
                        foreach (var panel in panels)
                        {
                            if (panel == null)
                            {
                                continue;
                            }
                            var name = string.IsNullOrEmpty(panel.resourceName) ? "ElectricCharge" : panel.resourceName;
                            ApplyResourceFlow(result, name, panel.flowRate, panel.chargeRate);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources solar read failed, skipping: " + ex);
                }

                try
                {
                    var alts = part.Modules.GetModules<ModuleAlternator>();
                    if (alts != null)
                    {
                        foreach (var alt in alts)
                        {
                            if (alt == null)
                            {
                                continue;
                            }
                            ApplyResourceFlow(result, "ElectricCharge", alt.outputRate, null);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources alternator read failed, skipping: " + ex);
                }

                try
                {
                    var engines = part.Modules.GetModules<ModuleEngines>();
                    if (engines != null)
                    {
                        foreach (var engine in engines)
                        {
                            if (engine == null || engine.propellants == null)
                            {
                                continue;
                            }
                            foreach (var propellant in engine.propellants)
                            {
                                if (propellant == null || string.IsNullOrEmpty(propellant.name))
                                {
                                    continue;
                                }
                                ApplyResourceFlow(result, propellant.name, -propellant.currentRequirement, null);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources engine read failed, skipping: " + ex);
                }

                try
                {
                    var wheels = part.Modules.GetModules<ModuleReactionWheel>();
                    if (wheels != null)
                    {
                        foreach (var wheel in wheels)
                        {
                            // Gate matches decompile: FixedUpdate only calls
                            // into resHandler.UpdateModuleResourceInputs while
                            // State == Active - see BuildPartResources' doc
                            // comment.
                            if (wheel == null || wheel.State != ModuleReactionWheel.WheelState.Active)
                            {
                                continue;
                            }
                            var draw = EcInputRatePerSecond(wheel.resHandler);
                            if (draw > 0)
                            {
                                ApplyResourceFlow(result, "ElectricCharge", -draw, null);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources reaction wheel read failed, skipping: " + ex);
                }

                try
                {
                    var lights = part.Modules.GetModules<ModuleLight>();
                    if (lights != null)
                    {
                        foreach (var light in lights)
                        {
                            // useResources && isOn mirrors the exact gate
                            // ModuleLight.FixedUpdate uses before it touches
                            // resHandler - see BuildPartResources' doc comment.
                            if (light == null || !light.useResources || !light.isOn)
                            {
                                continue;
                            }
                            var draw = EcInputRatePerSecond(light.resHandler);
                            if (draw > 0)
                            {
                                ApplyResourceFlow(result, "ElectricCharge", -draw, null);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources light read failed, skipping: " + ex);
                }

                try
                {
                    var commands = part.Modules.GetModules<ModuleCommand>();
                    if (commands != null)
                    {
                        foreach (var command in commands)
                        {
                            // No extra active-gate: UpdateControlState() runs
                            // unconditionally every flight FixedUpdate -
                            // hibernation only scales the rate down via
                            // hibernationMultiplier, it never skips the
                            // resHandler update.
                            if (command == null)
                            {
                                continue;
                            }
                            var draw = EcInputRatePerSecond(command.resHandler);
                            if (draw > 0)
                            {
                                ApplyResourceFlow(result, "ElectricCharge", -draw, null);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources command read failed, skipping: " + ex);
                }

                try
                {
                    var transmitters = part.Modules.GetModules<ModuleDataTransmitter>();
                    if (transmitters != null)
                    {
                        foreach (var transmitter in transmitters)
                        {
                            // IsBusy() is the public equivalent of the
                            // protected "busy" flag the transmit coroutine
                            // sets while it's actually charging its
                            // capacitor off resHandler each tick - see
                            // BuildPartResources' doc comment.
                            if (transmitter == null || !transmitter.IsBusy())
                            {
                                continue;
                            }
                            var draw = EcInputRatePerSecond(transmitter.resHandler);
                            if (draw > 0)
                            {
                                ApplyResourceFlow(result, "ElectricCharge", -draw, null);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources transmitter read failed, skipping: " + ex);
                }

                try
                {
                    // BaseConverter is the shared ancestor of
                    // ModuleResourceConverter AND ModuleResourceHarvester
                    // (BaseDrill -> BaseConverter) - walked generically here
                    // rather than enumerating both concrete types, and picks
                    // up any other BaseConverter subclass with an EC input
                    // for free.
                    var converters = part.Modules.GetModules<BaseConverter>();
                    if (converters != null)
                    {
                        foreach (var converter in converters)
                        {
                            if (converter == null || converter.inputList == null)
                            {
                                continue;
                            }
                            foreach (var input in converter.inputList)
                            {
                                if (input.ResourceName != "ElectricCharge")
                                {
                                    continue;
                                }
                                var nominal = (float)input.Ratio;
                                // See BuildPartResources' doc comment: this
                                // revises the "not cheaply derivable" call for
                                // the EC-INPUT side specifically.
                                var live = converter.IsActivated
                                    ? input.Ratio * converter.EfficiencyBonus * converter.lastTimeFactor
                                    : 0.0;
                                ApplyResourceFlow(result, "ElectricCharge", -live, -nominal);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] vessel.parts resources converter read failed, skipping: " + ex);
                }
            }

            // nominalFlow is only meaningful when it disagrees with the live
            // flow (PartResources' SDK doc contract: "Omitted ... when
            // nominal equals flow").
            foreach (var row in result.Values)
            {
                if (row is not Dictionary<string, object?> dict)
                {
                    continue;
                }
                if (dict["flow"] is double flow && dict["nominalFlow"] is double nominal && Math.Abs(flow - nominal) < 1e-9)
                {
                    dict["nominalFlow"] = null;
                }
            }

            return result;
        }

        private static void ApplyResourceFlow(Dictionary<string, object?> result, string resourceName, double flow, float? nominalFlow)
        {
            if (!result.TryGetValue(resourceName, out var existing) || existing is not Dictionary<string, object?> row)
            {
                row = new Dictionary<string, object?>
                {
                    ["amount"] = 0.0,
                    ["maxAmount"] = 0.0,
                    ["flow"] = null,
                    ["nominalFlow"] = null,
                };
                result[resourceName] = row;
            }

            var priorFlow = row["flow"] as double? ?? 0.0;
            row["flow"] = priorFlow + flow;

            if (nominalFlow.HasValue)
            {
                var priorNominal = row["nominalFlow"] as double? ?? 0.0;
                row["nominalFlow"] = priorNominal + nominalFlow.Value;
            }
        }

        /// <summary>
        /// Sums the ElectricCharge row(s) of a <c>PartModule.resHandler</c>'s
        /// <c>inputResources</c> and converts KSP's per-FixedUpdate-tick
        /// amount into a per-second rate. Decompile of
        /// <c>ModuleResourceHandler.UpdateModuleResourceInputs</c> shows
        /// <c>ModuleResource.currentRequest = rate * rateMultiplier *
        /// TimeWarp.fixedDeltaTime</c> (an AMOUNT for that tick, not a rate)
        /// so dividing back out by <c>fixedDeltaTime</c> is what makes this
        /// comparable to every other flow row <see cref="BuildPartResources"/>
        /// emits. Every <c>PartModule</c> has a <c>resHandler</c> (it's a base
        /// -class field, default-empty), so this one reader is shared by
        /// every resHandler-driven consumer in <see cref="BuildPartResources"/>
        /// instead of re-deriving the same division per module type; see
        /// that method's doc comment for why callers must still gate on the
        /// owning module's own "active right now" signal before calling this
        /// (the field is a stale snapshot when the module skipped its own
        /// update this tick, e.g. an <c>isOn == false</c> light).
        /// </summary>
        private static double EcInputRatePerSecond(ModuleResourceHandler? handler)
        {
            if (handler?.inputResources == null)
            {
                return 0.0;
            }

            var total = 0.0;
            foreach (var res in handler.inputResources)
            {
                if (res != null && res.name == "ElectricCharge")
                {
                    total += res.currentRequest;
                }
            }

            var dt = TimeWarp.fixedDeltaTime;
            return dt > 0 ? total / dt : 0.0;
        }

        /// <summary>
        /// Per-part module behavioural state: the <c>vessel.parts</c>
        /// replacement for the legacy <c>v.partState[flightId]</c> key.
        /// Covers the module types whose deploy/activation state is a
        /// single decompile-verified public field: solar panels / radiators
        /// / antennas (shared <see cref="ModuleDeployablePart.DeployState"/>),
        /// parachutes (stock <see cref="ModuleParachute.deploymentStates"/> plus
        /// RO's <c>RealChuteModule</c> per-canopy <c>depState</c>, read
        /// reflectively since that mod subclasses <c>PartModule</c> not
        /// <c>ModuleParachute</c>),
        /// engines (<see cref="ModuleEngines.EngineIgnited"/>/<c>flameout</c>),
        /// drills (<see cref="ModuleResourceHarvester"/>'s inherited
        /// <c>BaseConverter.IsActivated</c>), and landing gear
        /// (<c>ModuleWheels.ModuleWheelDeployment.stateString</c>, the wheel
        /// FSM's own state name). <c>cargoBay</c> (a defined
        /// <c>PartStateModule.type</c> vocabulary value) is DELIBERATELY not
        /// captured: <c>ModuleCargoBay</c> delegates its deploy animation to
        /// a configurable <c>IScalarModule</c> index rather than exposing a
        /// direct state field/enum, so there is no single decompile-stable
        /// API to read (flagged rather than guessed, matching this mod's
        /// existing "FLAG explicitly" convention for unresolved APIs).
        /// </summary>
        private static List<object?> BuildPartModuleStates(Part part)
        {
            var result = new List<object?>();
            if (part.Modules == null)
            {
                return result;
            }

            try
            {
                var panels = part.Modules.GetModules<ModuleDeployableSolarPanel>();
                if (panels != null)
                {
                    foreach (var panel in panels)
                    {
                        if (panel == null)
                        {
                            continue;
                        }
                        var tracking = panel.isTracking && panel.deployState == ModuleDeployablePart.DeployState.EXTENDED;
                        result.Add(ModuleStateEntry("solarPanel", MapDeployState(panel.deployState), tracking: tracking));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates solar read failed, skipping: " + ex);
            }

            try
            {
                var radiators = part.Modules.GetModules<ModuleDeployableRadiator>();
                if (radiators != null)
                {
                    foreach (var radiator in radiators)
                    {
                        if (radiator == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry("radiator", MapDeployState(radiator.deployState)));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates radiator read failed, skipping: " + ex);
            }

            try
            {
                var antennas = part.Modules.GetModules<ModuleDeployableAntenna>();
                if (antennas != null)
                {
                    foreach (var antenna in antennas)
                    {
                        if (antenna == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry("antenna", MapDeployState(antenna.deployState)));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates antenna read failed, skipping: " + ex);
            }

            try
            {
                var chutes = part.Modules.GetModules<ModuleParachute>();
                if (chutes != null)
                {
                    foreach (var chute in chutes)
                    {
                        if (chute == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry("parachute", MapParachuteState(chute.deploymentState)));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates parachute read failed, skipping: " + ex);
            }

            try
            {
                // RealChute (the parachute mod every RO capsule/booster recovery
                // chute uses) subclasses PartModule, NOT ModuleParachute, so the
                // stock reader above misses it entirely: under RO the parachute
                // state would always be empty. Read RealChuteModule's per-canopy
                // deploy state reflectively; RealChute.dll ships only in an RO
                // install so it is never referenced at compile time (same
                // by-name reflection pattern as ModuleGroundExperiment above).
                // Verified public surface (RealChute 1.4): RealChuteModule.armed
                // (bool field), RealChuteModule.parachutes (List<Parachute>);
                // Parachute.depState (string field = DeploymentStates enum name:
                // NONE / STOWED / LOWDEPLOYED / PREDEPLOYED / DEPLOYED / CUT).
                // Emitted through the same "parachute" ModuleStateEntry shape as
                // the stock reader so the client widget consumes both uniformly.
                foreach (var module in part.Modules)
                {
                    if (module == null || module.GetType().Name != "RealChuteModule")
                    {
                        continue;
                    }

                    var rcType = module.GetType();
                    var armed = ReflectBool(rcType, module, "armed") ?? false;
                    if (ReflectMemberValue(rcType, module, "parachutes") is System.Collections.IEnumerable canopies)
                    {
                        foreach (var canopy in canopies)
                        {
                            if (canopy == null)
                            {
                                continue;
                            }
                            var depState = ReflectString(canopy.GetType(), canopy, "depState");
                            result.Add(ModuleStateEntry("parachute", MapRealChuteState(depState, armed)));
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates RealChute read failed, skipping: " + ex);
            }

            try
            {
                var engines = part.Modules.GetModules<ModuleEngines>();
                if (engines != null)
                {
                    foreach (var engine in engines)
                    {
                        if (engine == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry(
                            "engine",
                            engine.EngineIgnited ? "active" : "inactive",
                            flameout: engine.flameout ? (bool?)true : null));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates engine read failed, skipping: " + ex);
            }

            try
            {
                var harvesters = part.Modules.GetModules<ModuleResourceHarvester>();
                if (harvesters != null)
                {
                    foreach (var harvester in harvesters)
                    {
                        if (harvester == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry("drill", harvester.IsActivated ? "active" : "inactive"));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates drill read failed, skipping: " + ex);
            }

            try
            {
                var gear = part.Modules.GetModules<ModuleWheelDeployment>();
                if (gear != null)
                {
                    foreach (var g in gear)
                    {
                        if (g == null)
                        {
                            continue;
                        }
                        result.Add(ModuleStateEntry("landingGear", MapWheelState(g.stateString)));
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] vessel.parts moduleStates landing gear read failed, skipping: " + ex);
            }

            return result;
        }

        private static Dictionary<string, object?> ModuleStateEntry(string type, string state, bool? tracking = null, bool? flameout = null)
        {
            return new Dictionary<string, object?>
            {
                ["type"] = type,
                ["state"] = state,
                ["tracking"] = tracking,
                ["flameout"] = flameout,
            };
        }

        private static string MapDeployState(ModuleDeployablePart.DeployState state)
        {
            switch (state)
            {
                case ModuleDeployablePart.DeployState.EXTENDED:
                    return "extended";
                case ModuleDeployablePart.DeployState.RETRACTED:
                    return "retracted";
                case ModuleDeployablePart.DeployState.EXTENDING:
                    return "deploying";
                case ModuleDeployablePart.DeployState.RETRACTING:
                    return "retracting";
                default:
                    // BROKEN (and any future enum value): "unknown" is the
                    // documented fallback; this vocabulary bucket has no
                    // "broken" state (only the parachute bucket does).
                    return "unknown";
            }
        }

        private static string MapParachuteState(ModuleParachute.deploymentStates state)
        {
            switch (state)
            {
                case ModuleParachute.deploymentStates.STOWED:
                    return "stowed";
                case ModuleParachute.deploymentStates.ACTIVE:
                    return "armed";
                case ModuleParachute.deploymentStates.SEMIDEPLOYED:
                case ModuleParachute.deploymentStates.DEPLOYED:
                    return "extended";
                case ModuleParachute.deploymentStates.CUT:
                    return "broken";
                default:
                    return "unknown";
            }
        }

        /// <summary>
        /// Maps a RealChute per-canopy <c>Parachute.depState</c> (the
        /// <c>DeploymentStates</c> enum name, read reflectively as a string)
        /// onto the SAME vocabulary <see cref="MapParachuteState"/> uses for the
        /// stock <c>ModuleParachute</c>, so the client widget treats RO
        /// RealChute canopies and stock chutes identically. RealChute's enum:
        /// NONE / STOWED / LOWDEPLOYED / PREDEPLOYED / DEPLOYED / CUT. A STOWED
        /// canopy whose module is <paramref name="armed"/> is reported "armed"
        /// (deploy triggered, waiting on the pressure/altitude condition),
        /// mirroring stock ACTIVE -> "armed"; the pre/low/full deployed stages
        /// all collapse to "extended" like stock SEMIDEPLOYED/DEPLOYED.
        /// </summary>
        private static string MapRealChuteState(string? depState, bool armed)
        {
            switch (depState)
            {
                case "STOWED":
                    return armed ? "armed" : "stowed";
                case "LOWDEPLOYED":
                case "PREDEPLOYED":
                case "DEPLOYED":
                    return "extended";
                case "CUT":
                    return "broken";
                default:
                    // NONE (uninitialised) or an unrecognised/renamed value.
                    return "unknown";
            }
        }

        /// <summary>
        /// <c>ModuleWheelDeployment.stateString</c> is a free-form FSM state
        /// name (<c>"Deployed"</c>/<c>"Retracted"</c>/<c>"Deploying"</c>/
        /// <c>"Retracting"</c>/<c>"Broken"</c> per the wheel FSM's own state
        /// setup) rather than a typed enum: decompile confirms the field
        /// but not an enum, so this matches by substring rather than an
        /// exhaustive switch. Order matters: "Deploying"/"Retracting" must
        /// be checked before their "-ed" counterparts since one contains a
        /// prefix of the other's word stem.
        /// </summary>
        private static string MapWheelState(string? stateString)
        {
            var value = stateString ?? "";
            if (value.Length == 0)
            {
                return "unknown";
            }

            if (value.IndexOf("Deploying", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "deploying";
            }
            if (value.IndexOf("Retracting", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "retracting";
            }
            if (value.IndexOf("Retracted", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "retracted";
            }
            if (value.IndexOf("Deployed", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "extended";
            }

            return "unknown";
        }

        /// <summary>
        /// The P1b slice 2 stage-ΔV capture: reads KSP's STOCK
        /// <c>VesselDeltaV</c> stage simulation (the same numbers the in-game
        /// ΔV app shows; atmosphere/ISP/crossfeed/staging all handled by the
        /// game, so this never hand-rolls the rocket equation) into the raw
        /// <c>deltaV</c> group <see cref="Sitrep.Host.StageDeltaVViewProvider"/>
        /// maps to the <c>dv.stages</c>/<c>dv.summary</c> channels.
        ///
        /// <para>Uses <c>OperatingStageInfo</c>, the stages that actually have
        /// ΔV: not the raw stage list, matching what the in-game app shows.
        /// The per-stage dv/twr/thrust/mass fields are <c>float</c> on
        /// <c>DeltaVStageInfo</c> and are widened to <c>double</c> here (no
        /// precision concern); the <c>Total*</c> rollups are already
        /// <c>double</c>.</para>
        ///
        /// <para><b>Readiness.</b> In the flight scene the stock sim can be
        /// dormant. When it is not yet ready we kick it once
        /// (<c>EnableStockSimluation</c> + <c>SetCalcsDirty</c>) so a subsequent
        /// sample reads a clean result, and OMIT the group this tick
        /// (return null) rather than block <c>Sample()</c> on it, the
        /// <c>TryBuildGroup</c> + null-return pattern carries "not ready yet"
        /// straight through to the provider as a null payload. Whether the
        /// flight-scene sim is live by default is not decompile-resolvable, so
        /// this self-heals either way.</para>
        /// </summary>
        private static Dictionary<string, object?>? BuildDeltaV(Vessel vessel)
        {
            var dv = vessel.VesselDeltaV;
            if (dv == null)
            {
                return null;
            }

            if (!dv.IsReady)
            {
                // Stock sim dormant: request it, then read on a later tick.
                if (!dv.DoStockSimulation)
                {
                    dv.EnableStockSimluation();
                }
                dv.SetCalcsDirty(false);
                return null;
            }

            var stages = dv.OperatingStageInfo;
            var stageList = new List<object?>();
            if (stages != null)
            {
                foreach (var s in stages)
                {
                    if (s == null)
                    {
                        continue;
                    }

                    stageList.Add(new Dictionary<string, object?>
                    {
                        ["stage"] = s.stage,
                        ["dvVac"] = (double)s.deltaVinVac,
                        ["dvAsl"] = (double)s.deltaVatASL,
                        ["dvActual"] = (double)s.deltaVActual,
                        ["burnTime"] = s.stageBurnTime,
                        ["twrVac"] = (double)s.TWRVac,
                        ["twrAsl"] = (double)s.TWRASL,
                        ["twrActual"] = (double)s.TWRActual,
                        ["thrustVac"] = (double)s.thrustVac,
                        ["thrustAsl"] = (double)s.thrustASL,
                        ["thrustActual"] = (double)s.thrustActual,
                        ["startMass"] = (double)s.startMass,
                        ["endMass"] = (double)s.endMass,
                        ["dryMass"] = (double)s.dryMass,
                        ["fuelMass"] = (double)s.fuelMass,
                        ["resources"] = BuildStageResources(s),
                    });
                }
            }

            return new Dictionary<string, object?>
            {
                ["stages"] = stageList,
                ["summary"] = new Dictionary<string, object?>
                {
                    ["stageCount"] = stageList.Count,
                    ["totalDvVac"] = dv.TotalDeltaVVac,
                    ["totalDvAsl"] = dv.TotalDeltaVASL,
                    ["totalDvActual"] = dv.TotalDeltaVActual,
                    ["totalBurnTime"] = dv.TotalBurnTime,
                },
            };
        }

        /// <summary>
        /// Per-resource current/max amounts for the parts active in
        /// <paramref name="stage"/>: STAGE-scoped, as opposed to
        /// <see cref="BuildResources"/>'s vessel-WIDE totals. The two are easy
        /// to confuse and answer different questions. <c>DeltaVStageInfo</c> carries only aggregate
        /// dry/fuel MASS for the stage (confirmed via decompile, no
        /// per-resource field at all), so this walks every
        /// <c>DeltaVPartInfo</c> in the stage's own <c>parts</c> list, looks
        /// up that part's <c>stageFuelMass[stage.stage]</c> snapshot (a
        /// per-stage <c>PartResourceList</c> the stock sim keeps per part,
        /// <c>DeltaVPartInfo.stageFuelMass</c> is keyed by stage number), and
        /// sums each resource's <c>amount</c>/<c>maxAmount</c> by name across
        /// every part that carries it in this stage. Returns an EMPTY dict
        /// (never null) when the stage carries no tracked resources, a real
        /// "nothing here" reading distinct from the whole stage entry being
        /// absent (that's <see cref="BuildDeltaV"/>'s own null case).
        /// </summary>
        private static Dictionary<string, object?> BuildStageResources(DeltaVStageInfo stage)
        {
            var totals = new Dictionary<string, (double current, double max)>();
            var parts = stage.parts;
            if (parts != null)
            {
                foreach (var partInfo in parts)
                {
                    var stageFuelMass = partInfo?.stageFuelMass;
                    if (stageFuelMass == null || !stageFuelMass.TryGetValue(stage.stage, out var perStage))
                    {
                        continue;
                    }

                    var resources = perStage?.resources;
                    if (resources == null)
                    {
                        continue;
                    }

                    foreach (var res in resources)
                    {
                        if (res == null || string.IsNullOrEmpty(res.resourceName))
                        {
                            continue;
                        }

                        totals.TryGetValue(res.resourceName, out var running);
                        totals[res.resourceName] = (running.current + res.amount, running.max + res.maxAmount);
                    }
                }
            }

            var result = new Dictionary<string, object?>();
            foreach (var kvp in totals)
            {
                result[kvp.Key] = new Dictionary<string, object?>
                {
                    ["current"] = kvp.Value.current,
                    ["max"] = kvp.Value.max,
                };
            }
            return result;
        }

        private static double[] Vec3Array(Vector3 v) => new double[] { v.x, v.y, v.z };

        /// <summary>
        /// True when the part carries a solar panel, an engine alternator, an
        /// EC-producing resource converter, or its own ElectricCharge storage,
        /// the same producers <see cref="BuildPartsPower"/> enumerates, folded
        /// into a single per-part flag so the topology channel can flag power
        /// nodes without a cross-channel join.
        /// </summary>
        private static bool IsPowerRelated(Part part)
        {
            if (part.Modules != null)
            {
                var panels = part.Modules.GetModules<ModuleDeployableSolarPanel>();
                if (panels != null && panels.Count > 0)
                {
                    return true;
                }

                var alts = part.Modules.GetModules<ModuleAlternator>();
                if (alts != null && alts.Count > 0)
                {
                    return true;
                }

                var converters = part.Modules.GetModules<ModuleResourceConverter>();
                if (converters != null)
                {
                    foreach (var converter in converters)
                    {
                        var outputs = converter != null ? converter.outputList : null;
                        if (outputs != null)
                        {
                            foreach (var output in outputs)
                            {
                                if (output.ResourceName == "ElectricCharge")
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }

            var resources = part.Resources;
            if (resources != null && resources.Contains("ElectricCharge"))
            {
                var ec = resources["ElectricCharge"];
                if (ec != null && ec.maxAmount > 0)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// The stringified flightID of the part a fuel line feeds, or null when
        /// this isn't a fuel-line part. A fuel line is a <see cref="CompoundPart"/>
        /// (its <c>target</c> is the fed part) carrying a
        /// <c>CModuleFuelLine</c> module: gate on the module so struts (also
        /// CompoundParts) don't report a fuel-flow target.
        /// </summary>
        private static string? FuelLineTargetId(Part part)
        {
            if (!(part is CompoundPart compound) || compound.target == null)
            {
                return null;
            }

            if (part.Modules == null)
            {
                return null;
            }

            var fuelLines = part.Modules.GetModules<CompoundParts.CModuleFuelLine>();
            if (fuelLines == null || fuelLines.Count == 0)
            {
                return null;
            }

            return compound.target.flightID != 0 ? compound.target.flightID.ToString() : null;
        }

        // ----------------------------------------------------------------
        // GameEvents -> Lifecycle
        // ----------------------------------------------------------------

        private void OnGameSceneLoadRequested(GameScenes scene)
        {
            Emit("scene-load", new Dictionary<string, object?> { ["scene"] = scene.ToString() });
        }

        private void OnFlightReady()
        {
            Emit("flight-ready", new Dictionary<string, object?>());
        }

        private void OnVesselChange(Vessel vessel)
        {
            Emit("vessel-change", new Dictionary<string, object?>
            {
                ["vesselId"] = vessel != null ? vessel.id.ToString() : null,
                ["vesselName"] = vessel != null ? vessel.vesselName : null,
            });
        }

        private void OnGameStateLoad(ConfigNode node)
        {
            // Fired for both a fresh load and a quickload (F9) - the recorder
            // doesn't need to (and can't cheaply) distinguish the two; the
            // replay side treats every "game-state-load" as a timeline
            // rewind point.
            Emit("game-state-load", new Dictionary<string, object?>());
        }

        private void Emit(string kind, Dictionary<string, object?> args)
        {
            try
            {
                Lifecycle.Invoke(new KspLifecycleEvent { Ut = NowUt(), Kind = kind, Args = args });
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] Lifecycle handler for \"" + kind + "\" threw: " + ex);
            }
        }
    }
}
