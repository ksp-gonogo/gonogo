using System;
using System.Collections.Generic;
using System.Reflection;
using Contracts;
using Expansions.Serenity;
using Sitrep.Host;
using Strategies;
using UnityEngine;
using Sitrep.Contract;

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
        /// Per-facility INTEGER tier/upgrade-cost, keyed by the raw
        /// <c>SpaceCenterFacility</c> enum name (e.g. <c>"LaunchPad"</c> -
        /// decompile-confirmed exact 9-member set: Administration/
        /// AstronautComplex/LaunchPad/MissionControl/ResearchAndDevelopment/
        /// Runway/TrackingStation/SpaceplaneHangar/VehicleAssemblyBuilding).
        ///
        /// <para>M3b career-detail capture-add: switched off the OLD
        /// <c>ScenarioUpgradeableFacilities.GetFacilityLevel</c> fractional
        /// [0,1] reading (which the KSC widget can't turn into a tier
        /// without also knowing the tier count) and onto
        /// <c>UpgradeableFacility.FacilityLevel</c>/<c>MaxLevel</c> - both
        /// confirmed via decompile as plain <c>int</c> properties on the
        /// LIVE facility object (0-based: tier 0 is the starting/unupgraded
        /// tier, <c>MaxLevel</c> is the top tier's own index, e.g. 2 for a
        /// 3-tier facility). Reached the exact same way the old
        /// <c>upgradeCost</c> capture already did -
        /// <c>ScenarioUpgradeableFacilities.protoUpgradeables[SlashSanitize(name)]
        /// .facilityRefs[0]</c> - so <c>currentTier</c>/<c>maxTier</c>/
        /// <c>upgradeCost</c> share ONE gate: all three are only resolvable
        /// while the facility's live <c>UpgradeableFacility</c> GameObject
        /// is registered (i.e. standing in the Space Center scene;
        /// confirmed via decompile that <c>ScenarioUpgradeableFacilities.
        /// GetFacilityLevelCount</c> itself just proxies to this same
        /// <c>facilityRefs[0].MaxLevel</c> read, returning the sentinel
        /// <c>-1</c> otherwise - there never was a scene-independent tier
        /// source). All three are commonly <c>null</c> outside the Space
        /// Center scene - that's a genuine "not available right now," not a
        /// bug.</para>
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

                int? currentTier = null;
                int? maxTier = null;
                double? upgradeCost = null;
                if (ScenarioUpgradeableFacilities.protoUpgradeables.TryGetValue(sanitizedId, out var proto) &&
                    proto?.facilityRefs != null && proto.facilityRefs.Count > 0 && proto.facilityRefs[0] != null)
                {
                    var live = proto.facilityRefs[0];
                    currentTier = live.FacilityLevel;
                    maxTier = live.MaxLevel;
                    upgradeCost = live.GetUpgradeCost();
                }

                result[facilityName] = new Dictionary<string, object?>
                {
                    ["currentTier"] = currentTier,
                    ["maxTier"] = maxTier,
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
            // CanBeActivated/CanBeDeactivated are documented above as pure
            // eligibility checks, but in practice KSP can throw a
            // NullReferenceException *inside* Strategy.CanBeActivated for some
            // strategies in some saves (observed live; related to the strategy
            // over-cap quirk). An unguarded throw here propagates up through
            // BuildCareerStrategies and makes TryBuildGroup drop the ENTIRE
            // vessel.strategies channel every tick. Guard per-strategy so a
            // single bad strategy degrades to canActivate=false + a reason,
            // and the rest of the strategies still serve.
            bool canActivate = false;
            string? activateBlockedReason = null;
            try
            {
                canActivate = strategy.CanBeActivated(out activateBlockedReason);
            }
            catch (Exception ex)
            {
                activateBlockedReason = "eligibility check failed: " + ex.GetType().Name;
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
                ["canActivate"] = canActivate,
                ["activateBlockedReason"] = activateBlockedReason,
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
        /// Full tech-node structure (id/title/scienceCost/unlocked/
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
        /// defined).</para>
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
                    ["scienceCost"] = (double)tech.scienceCost,
                    ["unlocked"] = ResearchAndDevelopment.GetTechnologyState(tech.techID) == RDTech.State.Available,
                    ["parents"] = parentIds,
                });
            }

            return nodes;
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
            TryBuildGroup(entry, "lab", () => BuildScienceLab(vessel));
            // Deployed science is captured GLOBALLY (across every loaded
            // vessel), NOT off the active vessel this method receives -- see
            // BuildDeployedScience's doc comment. Kept as a "science"
            // sub-group for channel continuity even though its data comes
            // from other vessels entirely.
            TryBuildGroup(entry, "deployed", () => BuildDeployedScience());
            return entry;
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
                            ["powerState"] = ReflectString(type, module, "PowerState"),
                            ["connectionState"] = ReflectString(type, module, "ConnectionState"),
                            ["deployedOnGround"] = ReflectBool(type, module, "DeployedOnGround"),
                        });
                    }
                }
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
            return entry;
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
        /// Breaking Ground robotics - rotors (<see cref="ModuleRoboticServoRotor"/>),
        /// hinges (<see cref="ModuleRoboticServoHinge"/>), and pistons
        /// (<see cref="ModuleRoboticServoPiston"/>), all confirmed via
        /// decompile to subclass the shared <see cref="BaseServo"/> (common
        /// lock/motor/engaged/limit/state fields - all public). Unlike
        /// <see cref="BuildDeployedScience"/>'s reflection guard, these
        /// three types decompiled cleanly with stable namespaces
        /// (<c>Expansions.Serenity</c>) baked into the SAME Assembly-CSharp.dll
        /// this project already references, so a direct static reference is
        /// safe - "DLC absent" here just means no part on the vessel uses
        /// these modules, which the empty-list -&gt; null fallback already
        /// covers without any special-casing. Null when the vessel has no
        /// robotic parts at all.
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
                    var rotors = part.Modules.GetModules<ModuleRoboticServoRotor>();
                    if (rotors != null)
                    {
                        foreach (var rotor in rotors)
                        {
                            if (rotor == null)
                            {
                                continue;
                            }
                            list ??= new List<object?>();
                            list.Add(BuildServoEntry(
                                rotor, partName, partId, "rotor",
                                currentAngle: null, targetAngle: null, traverseVelocity: null,
                                currentRpm: rotor.currentRPM, rpmLimit: rotor.rpmLimit,
                                normalizedOutput: rotor.normalizedOutput, brakePercentage: rotor.brakePercentage,
                                currentExtension: null, targetExtension: null));
                        }
                    }

                    var hinges = part.Modules.GetModules<ModuleRoboticServoHinge>();
                    if (hinges != null)
                    {
                        foreach (var hinge in hinges)
                        {
                            if (hinge == null)
                            {
                                continue;
                            }
                            list ??= new List<object?>();
                            list.Add(BuildServoEntry(
                                hinge, partName, partId, "hinge",
                                currentAngle: hinge.currentAngle, targetAngle: hinge.targetAngle, traverseVelocity: hinge.traverseVelocity,
                                currentRpm: null, rpmLimit: null, normalizedOutput: null, brakePercentage: null,
                                currentExtension: null, targetExtension: null));
                        }
                    }

                    var pistons = part.Modules.GetModules<ModuleRoboticServoPiston>();
                    if (pistons != null)
                    {
                        foreach (var piston in pistons)
                        {
                            if (piston == null)
                            {
                                continue;
                            }
                            list ??= new List<object?>();
                            list.Add(BuildServoEntry(
                                piston, partName, partId, "piston",
                                currentAngle: null, targetAngle: null, traverseVelocity: piston.traverseVelocity,
                                currentRpm: null, rpmLimit: null, normalizedOutput: null, brakePercentage: null,
                                currentExtension: piston.currentExtension, targetExtension: piston.targetExtension));
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] parts.robotics read failed on \"" + partName + "\", skipping: " + ex);
                }
            }

            return list;
        }

        private static Dictionary<string, object?> BuildServoEntry(
            BaseServo servo, string partName, string? partId, string type,
            float? currentAngle, float? targetAngle, float? traverseVelocity,
            float? currentRpm, float? rpmLimit, float? normalizedOutput, float? brakePercentage,
            float? currentExtension, float? targetExtension)
        {
            return new Dictionary<string, object?>
            {
                ["partName"] = partName,
                ["partId"] = partId,
                ["type"] = type,
                ["servoIsLocked"] = servo.servoIsLocked,
                ["servoIsMotorized"] = servo.servoIsMotorized,
                ["servoMotorIsEngaged"] = servo.servoMotorIsEngaged,
                ["servoMotorLimit"] = (double)servo.servoMotorLimit,
                ["motorState"] = servo.motorState,
                ["currentAngle"] = currentAngle.HasValue ? (double?)currentAngle.Value : null,
                ["targetAngle"] = targetAngle.HasValue ? (double?)targetAngle.Value : null,
                ["traverseVelocity"] = traverseVelocity.HasValue ? (double?)traverseVelocity.Value : null,
                ["currentRPM"] = currentRpm.HasValue ? (double?)currentRpm.Value : null,
                ["rpmLimit"] = rpmLimit.HasValue ? (double?)rpmLimit.Value : null,
                ["normalizedOutput"] = normalizedOutput.HasValue ? (double?)normalizedOutput.Value : null,
                ["brakePercentage"] = brakePercentage.HasValue ? (double?)brakePercentage.Value : null,
                ["currentExtension"] = currentExtension.HasValue ? (double?)currentExtension.Value : null,
                ["targetExtension"] = targetExtension.HasValue ? (double?)targetExtension.Value : null,
            };
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
