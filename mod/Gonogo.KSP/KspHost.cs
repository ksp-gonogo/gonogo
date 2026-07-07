using System;
using System.Collections.Generic;
using Contracts;
using Sitrep.Host;
using Strategies;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The ONLY class in the mod that touches KSP/Unity APIs directly ON THE
    /// READ SIDE (see <see cref="IKspHost"/>'s doc comment for the boundary
    /// this enforces). Every public member either returns a primitive/POCO or
    /// fires <see cref="Lifecycle"/> with one — no <c>CelestialBody</c>/
    /// <c>Vessel</c>/<c>Orbit</c> reference ever escapes through this type.
    /// M1 Task 3 added <see cref="KspVesselActuator"/> as this class's
    /// ACTUATION counterpart (write side, wired to <c>IVesselActuator</c>) —
    /// see its own doc comment; the two are deliberately separate by
    /// direction of data flow rather than one class doing both.
    ///
    /// KSP calls happen ONLY here, from <see cref="KspVesselActuator"/>, and
    /// from <see cref="GonogoAddon"/>'s <c>FixedUpdate</c>/GameEvents
    /// callbacks (all main-thread, EXCEPT <see cref="KspVesselActuator"/> —
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

        public KspHost(ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
        {
            _maneuverNodeIdRegistry = maneuverNodeIdRegistry;
            GameEvents.onGameSceneLoadRequested.Add(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Add(OnFlightReady);
            GameEvents.onVesselChange.Add(OnVesselChange);
            GameEvents.onGameStateLoad.Add(OnGameStateLoad);
        }

        /// <summary>Unsubscribes from every <see cref="GameEvents"/> hook. Call from <see cref="GonogoAddon"/>'s teardown - GameEvents are static/global, so a leaked subscription would outlive this instance.</summary>
        public void Unhook()
        {
            GameEvents.onGameSceneLoadRequested.Remove(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Remove(OnFlightReady);
            GameEvents.onVesselChange.Remove(OnVesselChange);
            GameEvents.onGameStateLoad.Remove(OnGameStateLoad);
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
                    var activeVessel = FlightGlobals.ActiveVessel;
                    if (activeVessel != null)
                    {
                        values["vessel"] = BuildVesselEntry(activeVessel, _maneuverNodeIdRegistry);
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
                    var career = BuildCareer();
                    if (career != null)
                    {
                        values["career"] = career;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] career snapshot build failed, omitting: " + ex);
                }
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
        private static Dictionary<string, object?> BuildVesselEntry(Vessel vessel, ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
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
            TryBuildGroup(entry, "control", () => BuildControl(vessel));
            TryBuildGroup(entry, "comms", () => BuildComms(vessel));
            TryBuildGroup(entry, "misc", () => BuildMisc(vessel));
            TryBuildGroup(entry, "propulsion", () => BuildPropulsion(vessel));
            TryBuildGroup(entry, "maneuverNodes", () => BuildManeuverNodes(vessel, maneuverNodeIdRegistry));
            TryBuildGroup(entry, "target", () => BuildTarget(vessel));
            // ---- M3 R3 capture-adds ----
            TryBuildGroup(entry, "dock", () => BuildDock(vessel));
            TryBuildGroup(entry, "surface", () => BuildSurface(vessel, orbit));
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
        /// beyond-the-conics-patch-limit one - mirrors the old Telemachus
        /// fork's <c>OrbitPatches.getPatchesForOrbit</c>, which walks the
        /// <c>nextPatch</c> chain only <c>while (activePatch)</c>) AND
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
        private static Dictionary<string, object?>? BuildOrbit(Orbit? orbit)
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
            };
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
                // missionTime (G-3): confirmed via decompile as a plain
                // Vessel field. The snapshot's own game-UT (KspSnapshot.Ut)
                // already comes from Planetarium.GetUniversalTime() via
                // NowUt() above - this is the vessel-specific "time since
                // launch" clock, a different quantity.
                ["missionTime"] = vessel.missionTime,
            };
        }

        /// <summary>
        /// Heading/pitch/roll via the same construction MechJeb2 uses
        /// (borrowed into this codebase's Telemachus fork as
        /// <c>UpdateHeadingPitchRoll</c> - see
        /// <c>local_docs/telemachus-fork/Telemachus/src/VesselDataHandlers.cs</c>):
        /// build a local surface frame from the vessel's up/north vectors,
        /// then measure the vessel's reference-transform rotation against
        /// it. Reuses <paramref name="orbit"/>'s already-guarded
        /// <c>referenceBody</c> rather than the computed <c>vessel.mainBody</c>
        /// property (which would re-dereference the same possibly-null
        /// orbit driver).
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

            var com = vessel.CoM;
            var up = ((Vector3d)com - body.position).normalized;
            var north = Vector3d.Exclude(up, body.position + (Vector3d)(body.transform.up * (float)body.Radius) - (Vector3d)com).normalized;
            var surfaceRotation = Quaternion.LookRotation(north, up);
            var attitude = Quaternion.Inverse(Quaternion.Euler(90, 0, 0) * Quaternion.Inverse(referenceTransform.rotation) * surfaceRotation);

            var euler = attitude.eulerAngles;
            var pitch = euler.x > 180 ? 360.0 - euler.x : -(double)euler.x;
            var roll = euler.z > 180 ? euler.z - 360.0 : (double)euler.z;

            return new Dictionary<string, object?>
            {
                ["pitch"] = pitch,
                ["heading"] = (double)euler.y,
                ["roll"] = roll,
            };
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
        /// by internal-temperature ratio. A part with <c>maxTemp &lt;= 0</c>
        /// (seen on some part configs) is excluded from that ratio rather
        /// than producing a divide-by-zero/NaN.
        ///
        /// <c>maxSkinRatio</c>/<c>maxInternalRatio</c> seed at
        /// <see cref="double.NegativeInfinity"/> (mirroring the
        /// <c>hottestRatio</c> guard two lines below) rather than 0 - a
        /// vessel where every part has <c>maxTemp &lt;= 0</c> now reports
        /// <c>null</c> for that ratio instead of an indistinguishable-from-
        /// real-data <c>0.0</c> ("no valid part" vs. "coldest possible
        /// part").
        /// </summary>
        private static Dictionary<string, object?>? BuildThermal(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            var maxSkinRatio = double.NegativeInfinity;
            var maxInternalRatio = double.NegativeInfinity;
            Part? hottest = null;
            var hottestRatio = double.NegativeInfinity;

            foreach (var part in parts)
            {
                if (part == null)
                {
                    continue;
                }

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
                }

                if (part.skinMaxTemp > 0)
                {
                    var skinRatio = part.skinTemperature / part.skinMaxTemp;
                    if (skinRatio > maxSkinRatio)
                    {
                        maxSkinRatio = skinRatio;
                    }
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
            }

            return result;
        }

        private static Dictionary<string, object?> BuildControl(Vessel vessel)
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
                ["throttle"] = ctrlState != null ? (double?)ctrlState.mainThrottle : null,
            };

            if (actionGroups != null)
            {
                result["ag1"] = actionGroups[KSPActionGroup.Custom01];
                result["ag2"] = actionGroups[KSPActionGroup.Custom02];
                result["ag3"] = actionGroups[KSPActionGroup.Custom03];
                result["ag4"] = actionGroups[KSPActionGroup.Custom04];
                result["ag5"] = actionGroups[KSPActionGroup.Custom05];
                result["ag6"] = actionGroups[KSPActionGroup.Custom06];
                result["ag7"] = actionGroups[KSPActionGroup.Custom07];
                result["ag8"] = actionGroups[KSPActionGroup.Custom08];
                result["ag9"] = actionGroups[KSPActionGroup.Custom09];
                result["ag10"] = actionGroups[KSPActionGroup.Custom10];
            }

            return result;
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
        private static Dictionary<string, object?> BuildPropulsion(Vessel vessel)
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

            return new Dictionary<string, object?>
            {
                ["totalMass"] = vessel.totalMass,
                ["dryMass"] = dryMass,
                ["currentThrust"] = currentThrust,
                ["availableThrust"] = availableThrust,
            };
        }

        /// <summary>
        /// Planned burns (G-7) - null (not an empty list) whenever the
        /// vessel has no maneuver nodes queued, which is the common case;
        /// present whenever the player (or MechJeb, or a script) has queued
        /// at least one. <c>ManeuverNode.DeltaV</c> is in the node's own
        /// radial/normal/prograde frame - see the project's own
        /// "Telemachus maneuver-node arg order" finding: x=radial,
        /// y=normal, z=prograde. <c>solver.maneuverNodes</c> is already
        /// ordered by <c>UT</c> (the order the player queued them / the
        /// order they'll execute).
        /// </summary>
        private static List<object?>? BuildManeuverNodes(Vessel vessel, ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
        {
            var solver = vessel.patchedConicSolver;
            var nodes = solver != null ? solver.maneuverNodes : null;
            if (nodes == null || nodes.Count == 0)
            {
                return null;
            }

            var list = new List<object?>(nodes.Count);
            foreach (var node in nodes)
            {
                if (node == null)
                {
                    continue;
                }

                var dv = node.DeltaV;
                list.Add(new Dictionary<string, object?>
                {
                    // M3 R3: a stable id per LIVE node object, assigned by
                    // the SAME registry KspVesselActuator resolves
                    // update/remove's nodeId argument against -- see
                    // ReferenceIdRegistry's doc comment. This is what makes
                    // a node's id usable in a command, not just a read-only
                    // label: a node placed by hand in the map view gets an
                    // id the very first time it's sampled here, and that id
                    // is what update/remove will find later.
                    ["id"] = maneuverNodeIdRegistry.GetOrAssign(node),
                    ["ut"] = node.UT,
                    ["dvRadial"] = dv.x,
                    ["dvNormal"] = dv.y,
                    ["dvPrograde"] = dv.z,
                    ["dvTotal"] = dv.magnitude,
                });
            }

            return list.Count > 0 ? list : null;
        }

        /// <summary>
        /// The M3 R3 <c>system.vessels</c> roster capture-add's raw per-vessel
        /// entry (primitives only, same discipline as every other Build*
        /// helper in this class): id/name/vesselType/situation/mainBody.
        /// <c>mainBody</c> is the raw BODY NAME (not yet resolved to an
        /// index -- <c>SystemViewProvider.BuildSystemVessels</c> resolves it
        /// against <c>snapshot.Values["bodies"]</c>, same two-step pattern
        /// <c>BuildIdentity</c>'s <c>parentBody</c> already uses), read off
        /// <c>orbitDriver.orbit.referenceBody</c> directly (never the
        /// computed <c>Vessel.mainBody</c> property, which NREs when
        /// <c>orbitDriver</c> is null -- e.g. a vessel that hasn't finished
        /// spawning yet -- see this class's doc comment).
        /// </summary>
        private static Dictionary<string, object?> BuildVesselRosterEntry(Vessel vessel)
        {
            var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
            var body = orbit?.referenceBody;

            return new Dictionary<string, object?>
            {
                ["id"] = vessel.id.ToString(),
                ["name"] = vessel.vesselName,
                ["vesselType"] = vessel.vesselType.ToString(),
                ["situation"] = vessel.situation.ToString(),
                ["mainBody"] = body != null ? body.bodyName : null,
            };
        }

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
        /// biome/landedAt/heightFromTerrain, for LandingStatus/GroundSurvey
        /// widgets. Null whenever there's no reference body yet (mirrors
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
        private static Dictionary<string, object?>? BuildTarget(Vessel vessel)
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

            var targetVessel = target.GetVessel();
            string targetType;
            if (targetVessel != null)
            {
                targetType = targetVessel.vesselType.ToString();
            }
            else if (target is CelestialBody)
            {
                targetType = "CelestialBody";
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
                ["relativePosition"] = relativePosition,
                ["relativeVelocity"] = new[] { relVel.x, relVel.y, relVel.z },
            };

            var targetOrbit = target.GetOrbit();
            if (targetOrbit != null)
            {
                result["orbit"] = BuildOrbit(targetOrbit);
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
            return new Dictionary<string, object?>
            {
                ["warpRate"] = (double)TimeWarp.CurrentRate,
                ["warpRateIndex"] = TimeWarp.CurrentRateIndex,
                ["warpMode"] = TimeWarp.WarpMode.ToString(),
                ["paused"] = FlightDriver.Pause,
            };
        }

        // ----------------------------------------------------------------
        // Career/KSC capture (funds/reputation/science, facility
        // levels+costs, contracts, strategies, unlocked tech)
        // ----------------------------------------------------------------

        /// <summary>
        /// The <c>SpaceCenterFacility</c> ids <see cref="BuildCareerFacilities"/>
        /// walks - every facility <c>ScenarioUpgradeableFacilities</c> knows
        /// about (confirmed via decompile: the enum has exactly these nine
        /// members - no "AdministrationFacility"/"SPH" aliases, the real
        /// names are <c>Administration</c> and <c>SpaceplaneHangar</c>).
        /// </summary>
        private static readonly SpaceCenterFacility[] TrackedFacilities =
        {
            SpaceCenterFacility.SpaceplaneHangar,
            SpaceCenterFacility.VehicleAssemblyBuilding,
            SpaceCenterFacility.LaunchPad,
            SpaceCenterFacility.Runway,
            SpaceCenterFacility.TrackingStation,
            SpaceCenterFacility.AstronautComplex,
            SpaceCenterFacility.MissionControl,
            SpaceCenterFacility.Administration,
            SpaceCenterFacility.ResearchAndDevelopment,
        };

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
        private static Dictionary<string, object?>? BuildCareer()
        {
            var game = HighLogic.CurrentGame;
            if (game == null || game.Mode != Game.Modes.CAREER)
            {
                return null;
            }

            var career = new Dictionary<string, object?>();
            TryBuildGroup(career, "economy", BuildCareerEconomy);
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
        private static Dictionary<string, object?>? BuildCareerEconomy()
        {
            var funding = Funding.Instance;
            var reputation = Reputation.Instance;
            var rnd = ResearchAndDevelopment.Instance;
            if (funding == null && reputation == null && rnd == null)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["funds"] = funding != null ? (double?)funding.Funds : null,
                ["reputation"] = reputation != null ? (double?)reputation.reputation : null,
                ["science"] = rnd != null ? (double?)rnd.Science : null,
            };
        }

        /// <summary>
        /// Per-facility level/upgrade-cost, keyed by the raw
        /// <c>SpaceCenterFacility</c> enum name (e.g. <c>"LaunchPad"</c>).
        /// <c>level</c> is <c>ScenarioUpgradeableFacilities.GetFacilityLevel</c>'s
        /// own NORMALIZED [0,1] reading (confirmed via decompile - there is
        /// no separate raw-integer-level accessor); <c>levelCount</c> is the
        /// number of upgrade tiers, but ONLY resolvable while the facility's
        /// live <c>UpgradeableFacility</c> GameObject is registered (i.e.
        /// standing in the Space Center scene) - confirmed via decompile
        /// that <c>ProtoUpgradeable.GetLevelCount()</c> returns the
        /// sentinel <c>-1</c> otherwise, which is mapped to <c>null</c> here
        /// rather than surfaced. <c>upgradeCost</c> (next-level funds cost)
        /// comes from the same live-facility-only
        /// <c>UpgradeableFacility.GetUpgradeCost()</c>, reached via
        /// <c>ScenarioUpgradeableFacilities.protoUpgradeables</c> keyed by
        /// <c>SlashSanitize(name)</c> (confirmed via decompile: the real
        /// dictionary key is <c>"SpaceCenter/&lt;FacilityName&gt;"</c>, not
        /// the bare enum name - <c>SlashSanitize</c> is the exact public API
        /// that does that prefixing, used here instead of hand-rolling the
        /// prefix so this stays correct if that convention ever changes).
        /// Both <c>levelCount</c> and <c>upgradeCost</c> are commonly
        /// <c>null</c> outside the Space Center scene - that's a genuine
        /// "not available right now," not a bug.
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

                double? upgradeCost = null;
                if (ScenarioUpgradeableFacilities.protoUpgradeables.TryGetValue(sanitizedId, out var proto) &&
                    proto?.facilityRefs != null && proto.facilityRefs.Count > 0 && proto.facilityRefs[0] != null)
                {
                    upgradeCost = proto.facilityRefs[0].GetUpgradeCost();
                }

                var levelCount = ScenarioUpgradeableFacilities.GetFacilityLevelCount(facility);

                result[facilityName] = new Dictionary<string, object?>
                {
                    ["level"] = (double)ScenarioUpgradeableFacilities.GetFacilityLevel(facility),
                    ["levelCount"] = levelCount >= 0 ? (int?)levelCount : null,
                    ["upgradeCost"] = upgradeCost,
                };
            }

            return result;
        }

        /// <summary>
        /// Active + offered contracts (title/agent/rewards/advance/deadline/
        /// state) from <c>ContractSystem.Instance.Contracts</c> - the list
        /// of NOT-YET-FINISHED contracts (completed/failed/expired ones live
        /// in the separate <c>ContractsFinished</c> list, out of scope for
        /// this capture). Every reward/advance field read here
        /// (<c>FundsAdvance</c>/<c>FundsCompletion</c>/<c>FundsFailure</c>/
        /// <c>ScienceCompletion</c>/<c>ReputationCompletion</c>/
        /// <c>ReputationFailure</c>) is a plain public field on
        /// <c>Contract</c>, confirmed via decompile - no getter indirection.
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
            };
        }

        private static Dictionary<string, object?> BuildContractEntry(Contract contract)
        {
            return new Dictionary<string, object?>
            {
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
            };
        }

        /// <summary>
        /// Active strategies (title/department/factor) from
        /// <c>StrategySystem.Instance.Strategies</c>, filtered to
        /// <c>IsActive</c> - the RAW active list, unfiltered against any
        /// admin-level cap. Deliberate: this project's own "KSP strategy
        /// over-cap quirk" finding is that the stock UI silently lets a save
        /// carry more active strategies than the Administration building's
        /// level allows, and the raw active list is the only surface that
        /// reveals it - re-deriving/enforcing the cap here would hide
        /// exactly the thing worth capturing. <c>activeCount</c> is simply
        /// this list's length, for a cheap "how many" read without a
        /// consumer needing to count the list itself.
        /// </summary>
        private static Dictionary<string, object?>? BuildCareerStrategies()
        {
            var system = StrategySystem.Instance;
            if (system == null)
            {
                return null;
            }

            var active = new List<object?>();
            var strategies = system.Strategies;
            if (strategies != null)
            {
                foreach (var strategy in strategies)
                {
                    if (strategy == null || !strategy.IsActive)
                    {
                        continue;
                    }

                    active.Add(new Dictionary<string, object?>
                    {
                        ["title"] = strategy.Title,
                        ["department"] = strategy.DepartmentName,
                        ["factor"] = (double)strategy.Factor,
                    });
                }
            }

            return new Dictionary<string, object?>
            {
                ["active"] = active,
                ["activeCount"] = active.Count,
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
            };
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
                ["rotationPeriod"] = body.rotationPeriod,
                ["initialRotation"] = body.initialRotation,
                ["rotationAngle"] = body.rotationAngle,
            };

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
