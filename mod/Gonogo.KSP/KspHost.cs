using System;
using System.Collections.Generic;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The ONLY class in the mod that touches KSP/Unity APIs directly (see
    /// <see cref="IKspHost"/>'s doc comment for the boundary this enforces).
    /// Every public member either returns a primitive/POCO or fires
    /// <see cref="Lifecycle"/> with one — no <c>CelestialBody</c>/<c>Vessel</c>/
    /// <c>Orbit</c> reference ever escapes through this type.
    ///
    /// KSP calls happen ONLY here and from <see cref="GonogoAddon"/>'s
    /// <c>FixedUpdate</c>/GameEvents callbacks (both main-thread) - the
    /// courier/transport/recorder machinery downstream of <see cref="Sample"/>
    /// never touches a KSP type.
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

        public KspHost()
        {
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
                        values["vessel"] = BuildVesselEntry(activeVessel);
                    }
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
        private static Dictionary<string, object?> BuildVesselEntry(Vessel vessel)
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
            return entry;
        }

        private static void TryBuildGroup(Dictionary<string, object?> entry, string key, Func<Dictionary<string, object?>?> build)
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
        /// dead-reckoning on the replay/consumer side) and the
        /// apoapsis/periapsis altitudes callers actually display.
        /// </summary>
        private static Dictionary<string, object?>? BuildOrbit(Orbit? orbit)
        {
            if (orbit == null)
            {
                return null;
            }

            var body = orbit.referenceBody;
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
            };
        }

        private static Dictionary<string, object?> BuildFlight(Vessel vessel)
        {
            return new Dictionary<string, object?>
            {
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
        /// </summary>
        private static Dictionary<string, object?>? BuildThermal(Vessel vessel)
        {
            var parts = vessel.parts;
            if (parts == null || parts.Count == 0)
            {
                return null;
            }

            double maxSkinRatio = 0;
            double maxInternalRatio = 0;
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
                ["maxSkinTempRatio"] = maxSkinRatio,
                ["maxInternalTempRatio"] = maxInternalRatio,
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
        /// Raw per-body dictionary in the exact shape
        /// <c>Sitrep.Host.SystemViewProvider.BuildSystemBodies</c> expects
        /// (see that class's doc comment) - primitives only, keyed exactly:
        /// name/index/parentIndex/radius/sma/ecc/inc/lan/argPe/
        /// meanAnomalyAtEpoch/epoch.
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
