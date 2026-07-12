using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the four M1 "core" vessel channels —
    /// <c>vessel.identity</c>/<c>vessel.orbit</c>/<c>vessel.orbit.truth</c>/
    /// <c>vessel.flight</c> — the Task 1 foundation for the vessel telemetry
    /// uplink. See local_docs/telemetry-mod/m1-provider-taxonomy-design.md
    /// §2.2 and telemachus-api-issues.md O-1/O-8/O-9/O-10/V-10/V-12/V-13.
    /// Reads <see cref="KspSnapshot.Values"/>'s <c>"vessel"</c> groups (see
    /// <c>Gonogo.KSP.KspHost.BuildVesselEntry</c>'s doc comment for the raw
    /// shape) and produces the typed <c>Sitrep.Contract</c> POCOs. Every
    /// <c>Build*</c> method returns <c>null</c> — never a partially-populated
    /// record — when its required raw data is missing (R1: absence is typed,
    /// never a sentinel default).
    ///
    /// <para><b>Subject provenance</b> (the M1 "must-ship, unretrofittable"
    /// rule — design doc §6.1/§8.1): every payload's <c>Meta.Source</c> is
    /// stamped <c>"vessel:&lt;guid&gt;"</c> from <c>vessel.identity.id</c>, so
    /// a sample is always attributable to the vessel it describes even across
    /// a vessel switch. Epoching that switch into a clean keyframe boundary is
    /// <see cref="VesselEpochSampler"/>'s job (a registered
    /// <see cref="ISnapshotSampler"/>) — this class only produces payloads,
    /// never touches the emitter.</para>
    ///
    /// <para><b>Wire adapter (the <c>*Wire</c> methods):</b>
    /// <see cref="Sitrep.Core.Serialization.JsonWriter.AppendValue"/> only
    /// knows how to serialize <c>null</c>/bool/numeric/string/
    /// <c>IDictionary&lt;string, object?&gt;</c>/<c>IEnumerable</c> — an
    /// arbitrary typed POCO (like <see cref="VesselIdentity"/>) falls through
    /// to its "unsupported CLR value type" throw, which
    /// <c>ChannelEngine</c>'s delivery-time guard would treat as a genuinely
    /// poisoned payload and fail-soft the WHOLE uplink (see
    /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests.
    /// GenuinelyUnserializablePayloadFailsSoftTheOwningUplinkInsteadOfRecurringSilently</c>,
    /// which deliberately pins that behavior for a genuinely-unrecognized
    /// type). Rather than widen <c>JsonWriter</c> itself — a shared,
    /// widely-depended-on class where doing so would blur that intentional
    /// safety net — each payload type gets a small, explicit
    /// <c>ToWire</c> flattening into the same
    /// <c>Dictionary&lt;string, object?&gt;</c> tree shape
    /// <c>SystemViewProvider.BuildSystemBodies</c> already uses. The
    /// <c>Build*Wire</c> methods (typed mapper + flatten) are what
    /// <c>VesselUplink.Register</c> actually hands to
    /// <c>IUplinkHost.AddChannelSource</c>; the plain <c>Build*</c> methods
    /// are the typed logic itself, exercised directly by unit/replay
    /// tests.</para>
    /// </summary>
    public static class VesselViewProvider
    {
        public const string IdentityTopic = "vessel.identity";
        public const string OrbitTopic = "vessel.orbit";
        public const string OrbitTruthTopic = "vessel.orbit.truth";
        public const string FlightTopic = "vessel.flight";

        // ---- M1 Task 2 topics ----
        public const string AttitudeTopic = "vessel.attitude";
        public const string ResourcesTopic = "vessel.resources";
        public const string ThermalTopic = "vessel.thermal";
        public const string ControlTopic = "vessel.control";
        public const string PhysicsModeTopic = "vessel.physics.mode";
        public const string CommsTopic = "vessel.comms";
        public const string PropulsionTopic = "vessel.propulsion";
        public const string ManeuverTopic = "vessel.maneuver";
        public const string TargetTopic = "vessel.target";
        public const string CrewTopic = "vessel.crew";
        public const string StructureTopic = "vessel.structure";
        public const string WarpTopic = "time.warp";

        // ---- M3 R3 capture-adds ----
        public const string DockTopic = "vessel.dock";
        public const string SurfaceTopic = "vessel.surface";

        /// <summary>All M1 vessel(+time.warp, see <see cref="WarpState"/>'s doc comment for the scoping note) topics — shared by <see cref="Gonogo.KSP.VesselUplink"/>'s manifest (in Gonogo.KSP) and <see cref="VesselEpochSampler"/>'s force-keyframe fan-out.</summary>
        public static readonly IReadOnlyList<string> Topics = new[]
        {
            IdentityTopic, OrbitTopic, OrbitTruthTopic, FlightTopic,
            AttitudeTopic, ResourcesTopic, ThermalTopic, ControlTopic, PhysicsModeTopic, CommsTopic,
            PropulsionTopic, ManeuverTopic, TargetTopic, CrewTopic, StructureTopic, WarpTopic,
            DockTopic, SurfaceTopic,
        };

        // ----------------------------------------------------------------
        // Typed mappers
        // ----------------------------------------------------------------

        public static VesselIdentity? BuildIdentity(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetGroup(vessel, "identity", out var identity))
            {
                return null;
            }

            var vesselId = GetString(identity, "id");
            if (string.IsNullOrEmpty(vesselId))
            {
                // No stable subject id -- can't attribute this sample to
                // anything (R1: an unattributable payload is worse than no
                // payload at all).
                return null;
            }

            int? parentBodyIndex = null;
            var parentBodyName = GetString(identity, "parentBody");
            if (parentBodyName != null)
            {
                parentBodyIndex = ResolveBodyIndex(snapshot!, parentBodyName);
            }

            double? launchUt = null;
            if (TryGetGroup(vessel, "flight", out var flight))
            {
                var missionTime = GetDouble(flight, "missionTime");
                if (missionTime.HasValue)
                {
                    launchUt = snapshot!.Ut - missionTime.Value;
                }
            }

            return new VesselIdentity
            {
                VesselId = vesselId!,
                Name = GetString(identity, "name") ?? "",
                VesselType = ParseVesselType(GetString(identity, "vesselType")),
                Situation = ParseSituation(GetString(identity, "situation")),
                ParentBodyIndex = parentBodyIndex,
                LaunchUt = launchUt,
                Meta = BuildMeta(vesselId!),
            };
        }

        public static VesselOrbit? BuildOrbit(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "orbit", out var orbit))
            {
                // Either the group build threw (omitted) or it returned an
                // explicit null (no orbit driver -- e.g. a just-spawned EVA
                // before it attaches) -- both mean "no orbit data this
                // tick," never a fabricated record.
                return null;
            }

            return MapOrbit(orbit, vesselId, snapshot!);
        }

        /// <summary>
        /// The typed-mapping half of <see cref="BuildOrbit"/>, factored out
        /// so <see cref="BuildTarget"/> can reuse the EXACT same elements
        /// mapping for a target's orbit (<c>VesselTarget.Orbit</c> reuses
        /// <see cref="VesselOrbit"/> itself -- see that field's doc comment
        /// on why that reuse is load-bearing, not incidental). Returns
        /// <c>null</c> on any missing required field, same rules as
        /// <see cref="BuildOrbit"/>.
        /// </summary>
        private static VesselOrbit? MapOrbit(IDictionary<string, object?> orbit, string vesselId, KspSnapshot snapshot)
        {
            var sma = GetDouble(orbit, "sma");
            var ecc = GetDouble(orbit, "ecc");
            var inc = GetDouble(orbit, "inc");
            // lan/argPe are DELIBERATELY excluded from the "all required"
            // guard below: KSP's own Orbit.LAN is NaN for a near-equatorial
            // orbit (inc ~ 0) and argumentOfPeriapsis is NaN for a
            // near-circular orbit (ecc ~ 0) -- both routine, common orbit
            // shapes, not error states. GetDouble already maps that non-finite
            // input to null (R1/F-1); gating the WHOLE record on them being
            // present would silently drop vessel.orbit for every equatorial/
            // circular orbit, which is worse than the wart this channel
            // exists to kill. VesselOrbit.Lan/ArgPe are individually nullable
            // for exactly this reason -- see their doc comments.
            var lan = GetDouble(orbit, "lan");
            var argPe = GetDouble(orbit, "argPe");
            var maae = GetDouble(orbit, "meanAnomalyAtEpoch");
            var epoch = GetDouble(orbit, "epoch");
            var mu = GetDouble(orbit, "mu");
            var referenceBodyName = GetString(orbit, "referenceBody");

            if (!sma.HasValue || !ecc.HasValue || !inc.HasValue ||
                !maae.HasValue || !epoch.HasValue || !mu.HasValue ||
                referenceBodyName == null)
            {
                // A partial orbit record is worse than none -- every field
                // here (other than lan/argPe, see above) is required for
                // self-sufficient propagation.
                return null;
            }

            var referenceBodyIndex = ResolveBodyIndex(snapshot, referenceBodyName);
            if (referenceBodyIndex == null)
            {
                return null;
            }

            OrbitEncounter? encounter = null;
            if (TryGetGroup(orbit, "encounter", out var rawEncounter))
            {
                var transitionType = ParseTransitionType(GetString(rawEncounter, "transitionType"));
                var transitionUt = GetDouble(rawEncounter, "transitionUt");
                // Fix A (O-9 reproduced) defensive backstop: KspHost.BuildOrbit
                // now gates the RAW capture on nextPatch.activePatch +
                // transitionType in {ENCOUNTER,ESCAPE} (see its doc comment),
                // but this mapper applies the SAME transitionType restriction
                // again here so an ALREADY-RECORDED phantom payload (captured
                // before that fix existed - e.g. the 809/816 FINAL-transition
                // orbit samples in the M1 reference recording) still maps to
                // a null encounter on replay, not a fabricated one.
                if (transitionUt.HasValue &&
                    (transitionType == TransitionType.Encounter || transitionType == TransitionType.Escape))
                {
                    int? encounterBodyIndex = null;
                    var encounterBodyName = GetString(rawEncounter, "body");
                    if (encounterBodyName != null)
                    {
                        encounterBodyIndex = ResolveBodyIndex(snapshot, encounterBodyName);
                    }

                    encounter = new OrbitEncounter
                    {
                        TransitionType = transitionType,
                        TransitionUt = transitionUt.Value,
                        BodyIndex = encounterBodyIndex,
                    };
                }
            }

            var patches = MapOrbitPatches(orbit.TryGetValue("patches", out var rawPatches) ? rawPatches : null);

            return new VesselOrbit
            {
                ReferenceBodyIndex = referenceBodyIndex.Value,
                Sma = sma.Value,
                Ecc = ecc.Value,
                Inc = inc.Value,
                Lan = lan,
                ArgPe = argPe,
                MeanAnomalyAtEpoch = maae.Value,
                Epoch = epoch.Value,
                Mu = mu.Value,
                Encounter = encounter,
                Patches = patches,
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>
        /// Maps a raw patch-chain list (<c>Gonogo.KSP.KspHost.
        /// BuildOrbitPatchChain</c>'s doc comment has the raw per-entry
        /// shape) into typed <see cref="OrbitPatch"/> records. A malformed
        /// entry (missing a required field) is skipped rather than aborting
        /// the whole chain -- a later patch's soundness doesn't depend on an
        /// earlier one's, and dropping one bad tail entry beats losing the
        /// whole trajectory preview.
        /// </summary>
        private static List<OrbitPatch> MapOrbitPatches(object? raw)
        {
            var result = new List<OrbitPatch>();
            if (raw is not IEnumerable<object?> list)
            {
                return result;
            }

            foreach (var rawPatch in list)
            {
                if (rawPatch is not IDictionary<string, object?> patch)
                {
                    continue;
                }

                var sma = GetDouble(patch, "sma");
                var ecc = GetDouble(patch, "ecc");
                var inc = GetDouble(patch, "inc");
                var lan = GetDouble(patch, "lan");
                var argPe = GetDouble(patch, "argPe");
                var maae = GetDouble(patch, "meanAnomalyAtEpoch");
                var epoch = GetDouble(patch, "epoch");
                var period = GetDouble(patch, "period");
                var startUt = GetDouble(patch, "startUt");
                var endUt = GetDouble(patch, "endUt");
                var peA = GetDouble(patch, "peA");
                var apA = GetDouble(patch, "apA");
                var semiLatusRectum = GetDouble(patch, "semiLatusRectum");
                var semiMinorAxis = GetDouble(patch, "semiMinorAxis");
                var referenceBody = GetString(patch, "referenceBody");

                if (!sma.HasValue || !ecc.HasValue || !inc.HasValue || !epoch.HasValue ||
                    !period.HasValue || !startUt.HasValue || !endUt.HasValue ||
                    !peA.HasValue || !apA.HasValue || !semiLatusRectum.HasValue ||
                    !semiMinorAxis.HasValue || referenceBody == null)
                {
                    continue;
                }

                result.Add(new OrbitPatch
                {
                    Sma = sma.Value,
                    Ecc = ecc.Value,
                    Inc = inc.Value,
                    // lan/argPe: see OrbitPatch.cs's doc comment -- non-nullable
                    // by design, 0 substituted for the routine near-circular/
                    // near-equatorial NaN case (GetDouble already maps that to
                    // null via R1/F-1).
                    Lan = lan ?? 0,
                    ArgPe = argPe ?? 0,
                    MeanAnomalyAtEpoch = maae ?? 0,
                    Epoch = epoch.Value,
                    Period = period.Value,
                    StartUt = startUt.Value,
                    EndUt = endUt.Value,
                    PatchStartTransition = ParseTransitionType(GetString(patch, "patchStartTransition")),
                    PatchEndTransition = ParseTransitionType(GetString(patch, "patchEndTransition")),
                    PeA = peA.Value,
                    ApA = apA.Value,
                    SemiLatusRectum = semiLatusRectum.Value,
                    SemiMinorAxis = semiMinorAxis.Value,
                    ReferenceBody = referenceBody,
                    ClosestEncounterBody = GetString(patch, "closestEncounterBody"),
                });
            }

            return result;
        }

        public static VesselOrbitTruth? BuildOrbitTruth(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "orbit", out var orbit))
            {
                return null;
            }

            var position = GetVec3(orbit, "truthPosition");
            var velocity = GetVec3(orbit, "truthVelocity");
            var frameRotating = GetBool(orbit, "truthFrameRotating");

            if (position == null || velocity == null || !frameRotating.HasValue)
            {
                return null;
            }

            return new VesselOrbitTruth
            {
                Position = position,
                Velocity = velocity,
                FrameRotating = frameRotating.Value,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselFlight? BuildFlight(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "flight", out var flight))
            {
                return null;
            }

            var latitude = GetDouble(flight, "latitude");
            var longitude = GetDouble(flight, "longitude");
            var altitudeAsl = GetDouble(flight, "altitudeAsl");
            var altitudeTerrain = GetDouble(flight, "altitudeTerrain");
            var verticalSpeed = GetDouble(flight, "verticalSpeed");
            var surfaceSpeed = GetDouble(flight, "surfaceSpeed");
            var orbitalSpeed = GetDouble(flight, "orbitalSpeed");
            var gForce = GetDouble(flight, "gForce");
            // Raw KspHost key is "dynamicPressure" (already kPa,
            // vessel.dynamicPressurekPa) -- renamed to the explicit,
            // unit-suffixed VesselFlight.DynamicPressureKPa per R4.
            var dynamicPressure = GetDouble(flight, "dynamicPressure");
            var mach = GetDouble(flight, "mach");
            var atmDensity = GetDouble(flight, "atmDensity");
            var externalTemperature = GetDouble(flight, "externalTemperature");
            var atmosphericTemperature = GetDouble(flight, "atmosphericTemperature");

            if (!latitude.HasValue || !longitude.HasValue || !altitudeAsl.HasValue ||
                !altitudeTerrain.HasValue || !verticalSpeed.HasValue || !surfaceSpeed.HasValue ||
                !orbitalSpeed.HasValue || !gForce.HasValue || !dynamicPressure.HasValue ||
                !mach.HasValue || !atmDensity.HasValue || !externalTemperature.HasValue ||
                !atmosphericTemperature.HasValue)
            {
                return null;
            }

            return new VesselFlight
            {
                Latitude = latitude.Value,
                Longitude = longitude.Value,
                AltitudeAsl = altitudeAsl.Value,
                AltitudeTerrain = altitudeTerrain.Value,
                VerticalSpeed = verticalSpeed.Value,
                SurfaceSpeed = surfaceSpeed.Value,
                OrbitalSpeed = orbitalSpeed.Value,
                GForce = gForce.Value,
                DynamicPressureKPa = dynamicPressure.Value,
                Mach = mach.Value,
                AtmDensity = atmDensity.Value,
                ExternalTemperature = externalTemperature.Value,
                AtmosphericTemperature = atmosphericTemperature.Value,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselAttitude? BuildAttitude(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "attitude", out var attitude))
            {
                // KspHost.BuildAttitude returns null when there's no
                // reference body / no reference transform yet (e.g. a
                // just-spawned EVA) -- two named frames or nothing, never a
                // partial/undefined-frame record (kills V-9).
                return null;
            }

            var pitch = GetDouble(attitude, "pitch");
            var heading = GetDouble(attitude, "heading");
            var roll = GetDouble(attitude, "roll");
            var pitchRootFrame = GetDouble(attitude, "pitchRootFrame");
            var headingRootFrame = GetDouble(attitude, "headingRootFrame");
            var rollRootFrame = GetDouble(attitude, "rollRootFrame");
            if (!pitch.HasValue || !heading.HasValue || !roll.HasValue
                || !pitchRootFrame.HasValue || !headingRootFrame.HasValue || !rollRootFrame.HasValue)
            {
                return null;
            }

            return new VesselAttitude
            {
                Pitch = pitch.Value,
                Heading = heading.Value,
                Roll = roll.Value,
                PitchRootFrame = pitchRootFrame.Value,
                HeadingRootFrame = headingRootFrame.Value,
                RollRootFrame = rollRootFrame.Value,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselResources? BuildResources(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "resources", out var resources))
            {
                // No vessel data at all this tick -- distinct from the
                // (much more common) "vessel present, carries zero tracked
                // resources" case, which is an EMPTY map below, not a null
                // channel (R1/R-1/R-3/R-4 -- see VesselResources' class doc
                // comment for the full three-way absence rule).
                return null;
            }

            var map = new Dictionary<string, ResourceAmount>();
            foreach (var kvp in resources)
            {
                if (kvp.Value is not IDictionary<string, object?> raw)
                {
                    continue;
                }

                var current = GetDouble(raw, "current");
                var max = GetDouble(raw, "max");
                if (!current.HasValue || !max.HasValue)
                {
                    // A malformed per-resource entry is skipped, not
                    // fabricated with a sentinel -- this key is simply
                    // absent from the map this tick (R1(c)).
                    continue;
                }

                // R7 Fix 2: Active = true -- every resource this producer emits
                // is one it actually reported this tick (a present-but-zero
                // resource is a real reading, not an absence).
                map[kvp.Key] = new ResourceAmount { Current = current.Value, Max = max.Value, Active = true };
            }

            return new VesselResources
            {
                Resources = map,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselThermal? BuildThermal(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "thermal", out var thermal))
            {
                // KspHost.BuildThermal returns null when the vessel
                // currently has no parts at all -- a coarser absence than
                // an individual null ratio (see VesselThermal's class doc
                // comment for the two-tier distinction).
                return null;
            }

            ThermalHottestPart? hottestPart = null;
            var hottestInternal = GetDouble(thermal, "hottestPartInternalTemp");
            var hottestMax = GetDouble(thermal, "hottestPartMaxTemp");
            var hottestSkin = GetDouble(thermal, "hottestPartSkinTemp");
            var hottestSkinMax = GetDouble(thermal, "hottestPartSkinMaxTemp");
            if (hottestInternal.HasValue && hottestMax.HasValue && hottestSkin.HasValue && hottestSkinMax.HasValue)
            {
                hottestPart = new ThermalHottestPart
                {
                    InternalTemp = hottestInternal.Value,
                    MaxTemp = hottestMax.Value,
                    SkinTemp = hottestSkin.Value,
                    SkinMaxTemp = hottestSkinMax.Value,
                    Name = GetString(thermal, "hottestPartName") ?? "",
                };
            }

            return new VesselThermal
            {
                // Individually null (never 0.0) whenever no part this tick
                // had a valid maxTemp/skinMaxTemp to ratio against -- kills
                // P-5's int-where-object-expected sentinel and the implied
                // divide-by-zero risk.
                MaxSkinTempRatio = GetDouble(thermal, "maxSkinTempRatio"),
                MaxInternalTempRatio = GetDouble(thermal, "maxInternalTempRatio"),
                HottestPart = hottestPart,
                HeatShieldTempCelsius = GetDouble(thermal, "heatShieldTempCelsius"),
                HeatShieldFlux = GetDouble(thermal, "heatShieldFlux"),
                HottestEngineTemp = GetDouble(thermal, "hottestEngineTemp"),
                HottestEngineMaxTemp = GetDouble(thermal, "hottestEngineMaxTemp"),
                HottestEngineTempRatio = GetDouble(thermal, "hottestEngineTempRatio"),
                AnyEnginesOverheating = GetBool(thermal, "anyEnginesOverheating"),
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselControl? BuildControl(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "control", out var control))
            {
                return null;
            }

            bool[]? actionGroups = null;
            var ag1 = GetBool(control, "ag1");
            var ag2 = GetBool(control, "ag2");
            var ag3 = GetBool(control, "ag3");
            var ag4 = GetBool(control, "ag4");
            var ag5 = GetBool(control, "ag5");
            var ag6 = GetBool(control, "ag6");
            var ag7 = GetBool(control, "ag7");
            var ag8 = GetBool(control, "ag8");
            var ag9 = GetBool(control, "ag9");
            var ag10 = GetBool(control, "ag10");
            if (ag1.HasValue && ag2.HasValue && ag3.HasValue && ag4.HasValue && ag5.HasValue &&
                ag6.HasValue && ag7.HasValue && ag8.HasValue && ag9.HasValue && ag10.HasValue)
            {
                // KspHost only ever writes all ten (when actionGroups != null)
                // or none of them -- never a partial set.
                actionGroups = new[] { ag1.Value, ag2.Value, ag3.Value, ag4.Value, ag5.Value, ag6.Value, ag7.Value, ag8.Value, ag9.Value, ag10.Value };
            }

            return new VesselControl
            {
                // Every field here is individually nullable (R1(a)) -- the
                // record itself is present whenever a vessel is, per
                // VesselControl's class doc comment.
                Sas = GetBool(control, "sas"),
                SasMode = ParseSasMode(GetString(control, "sasMode")),
                Rcs = GetBool(control, "rcs"),
                Gear = GetBool(control, "gear"),
                Brakes = GetBool(control, "brakes"),
                Lights = GetBool(control, "lights"),
                Abort = GetBool(control, "abort"),
                PrecisionControl = GetBool(control, "precisionControl"),
                // V-3: deliberately NOT clamped to [0,1] -- see VesselControl.Throttle's doc comment.
                Throttle = GetDouble(control, "throttle"),
                ActionGroups = actionGroups,
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>
        /// The <c>vessel.physics.mode</c> channel — the active vessel's
        /// physics-simulation regime (<see cref="PhysicsMode"/>), mapped from
        /// the raw <c>vessel.physics.mode</c> string
        /// <c>Gonogo.KSP.KspHost.BuildPhysics</c> derives from
        /// <c>Vessel.loaded</c>/<c>Vessel.packed</c>. Null only when there's no
        /// vessel to attribute the sample to (or the raw group is absent);
        /// otherwise a present-but-unrecognized string maps to
        /// <see cref="PhysicsMode.Unknown"/> (same convention as
        /// <see cref="ParseSasMode"/>), never a dropped record.
        /// </summary>
        public static VesselPhysicsMode? BuildPhysicsMode(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "physics", out var physics))
            {
                return null;
            }

            return new VesselPhysicsMode
            {
                Mode = ParsePhysicsMode(GetString(physics, "mode")),
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselComms? BuildComms(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "comms", out var comms))
            {
                // KspHost.BuildComms returns null when vessel.connection is
                // null -- the whole channel is absent (M-4: never a fake
                // 0/0d/disconnected-looking reading).
                return null;
            }

            var connected = GetBool(comms, "connected");
            var signalStrength = GetDouble(comms, "signalStrength");
            if (!connected.HasValue || !signalStrength.HasValue)
            {
                return null;
            }

            return new VesselComms
            {
                Connected = connected.Value,
                SignalStrength = signalStrength.Value,
                ControlState = ParseControlState(GetString(comms, "controlState")),
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselPropulsion? BuildPropulsion(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "propulsion", out var propulsion))
            {
                return null;
            }

            var totalMass = GetDouble(propulsion, "totalMass");
            var dryMass = GetDouble(propulsion, "dryMass");
            var currentThrust = GetDouble(propulsion, "currentThrust");
            var availableThrust = GetDouble(propulsion, "availableThrust");
            if (!totalMass.HasValue || !dryMass.HasValue || !currentThrust.HasValue || !availableThrust.HasValue)
            {
                return null;
            }

            return new VesselPropulsion
            {
                TotalMass = totalMass.Value,
                DryMass = dryMass.Value,
                CurrentThrust = currentThrust.Value,
                AvailableThrust = availableThrust.Value,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselManeuver? BuildManeuver(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            var nodes = new List<ManeuverNode>();
            if (vessel.TryGetValue("maneuverNodes", out var rawNodes) && rawNodes is IEnumerable<object?> list)
            {
                foreach (var rawNode in list)
                {
                    if (rawNode is not IDictionary<string, object?> node)
                    {
                        continue;
                    }

                    var ut = GetDouble(node, "ut");
                    if (!ut.HasValue)
                    {
                        // Ut is the one field a node can't do without -- it's
                        // the whole reason the node exists (when to burn).
                        // Fix F: every dv component below is now individually
                        // optional (a non-finite one maps to null via
                        // GetDouble's R1/F-1 rule) -- ONLY a missing/non-finite
                        // Ut is still fatal to the whole node, never a dv
                        // component alone (a non-finite dv used to silently
                        // drop the entire node, understating how many burns
                        // were actually queued).
                        continue;
                    }

                    nodes.Add(new ManeuverNode
                    {
                        // Empty string only for a pre-M3-R3 recording that
                        // never captured an id -- see ManeuverNode.Id's doc
                        // comment. A live capture always has one (KspHost
                        // assigns it via the shared ReferenceIdRegistry
                        // before this raw dict is ever built).
                        Id = GetString(node, "id") ?? "",
                        Ut = ut.Value,
                        DvRadial = GetDouble(node, "dvRadial"),
                        DvNormal = GetDouble(node, "dvNormal"),
                        DvPrograde = GetDouble(node, "dvPrograde"),
                        DvTotal = GetDouble(node, "dvTotal"),
                        Patches = MapOrbitPatches(node.TryGetValue("patches", out var rawNodePatches) ? rawNodePatches : null),
                    });
                }
            }

            // ALWAYS an array (R2) -- absent/null "maneuverNodes" (the
            // common no-nodes-queued case) normalizes to [], never a null
            // collection. The record itself only goes null when there's no
            // vessel to attribute it to.
            return new VesselManeuver
            {
                Nodes = nodes,
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselTarget? BuildTarget(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "target", out var target))
            {
                // The common case -- nothing targeted. Never a sentinel
                // zero-distance/zero-vector record (V-8/O-9).
                return null;
            }

            // R7 Fix 3: relativeVelocity is now Vec3? (matching relativePosition)
            // -- a missing value is carried as null rather than collapsing the
            // whole record or fabricating a sentinel (0,0,0). The channel is
            // still absent entirely when there is no target at all (above).
            var relativeVelocity = GetVec3(target, "relativeVelocity");

            VesselOrbit? orbit = null;
            if (TryGetGroup(target, "orbit", out var rawOrbit))
            {
                orbit = MapOrbit(rawOrbit, vesselId, snapshot!);
            }

            var kind = ClassifyTargetKind(GetString(target, "type"));

            // M3 R3: the target's OWN stable id, closing the §6.4 round-trip
            // gap -- see VesselTarget.VesselId/BodyIndex's doc comments.
            // Only ever one of the two is populated, mirroring SetTargetArgs'
            // own Kind-discriminated shape.
            string? targetVesselId = null;
            int? targetBodyIndex = null;
            if (kind == TargetKind.Vessel)
            {
                targetVesselId = GetString(target, "targetVesselId");
            }
            else if (kind == TargetKind.Body)
            {
                var bodyName = GetString(target, "name");
                if (bodyName != null)
                {
                    targetBodyIndex = ResolveBodyIndex(snapshot!, bodyName);
                }
            }

            return new VesselTarget
            {
                Name = GetString(target, "name") ?? "",
                Kind = kind,
                VesselId = targetVesselId,
                BodyIndex = targetBodyIndex,
                // Null only when the transform data needed to compute it
                // wasn't available this tick -- see Vec3 in the class doc
                // comment (one canonical shape everywhere -- kills V-8).
                RelativePosition = GetVec3(target, "relativePosition"),
                RelativeVelocity = relativeVelocity,
                Orbit = orbit,
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>The <c>vessel.dock</c> channel — see <see cref="DockAlignment"/>'s class doc comment. Null whenever <c>Gonogo.KSP.KspHost.BuildDock</c> omitted the raw group (no target, target isn't a docking port, or the active vessel has no free port).</summary>
        public static DockAlignment? BuildDock(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "dock", out var dock))
            {
                return null;
            }

            var relativePosition = GetVec3(dock, "relativePosition");
            var relativeVelocity = GetVec3(dock, "relativeVelocity");
            var distance = GetDouble(dock, "distance");
            if (relativePosition == null || relativeVelocity == null || !distance.HasValue)
            {
                // A partial dock record is worse than none -- same "all
                // required fields or the whole record is absent" rule as
                // vessel.orbit/flight.
                return null;
            }

            return new DockAlignment
            {
                RelativePosition = relativePosition,
                RelativeVelocity = relativeVelocity,
                Distance = distance.Value,
                ForwardDot = GetDouble(dock, "forwardDot"),
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>The <c>vessel.surface</c> channel — see <see cref="VesselSurface"/>'s class doc comment. Null whenever <c>Gonogo.KSP.KspHost.BuildSurface</c> omitted the raw group (no reference body yet, or the vessel is orbiting/escaping -- not near any surface).</summary>
        public static VesselSurface? BuildSurface(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "surface", out var surface))
            {
                return null;
            }

            return new VesselSurface
            {
                Biome = GetString(surface, "biome"),
                LandedAt = GetString(surface, "landedAt"),
                HeightFromTerrain = GetDouble(surface, "heightFromTerrain"),
                Meta = BuildMeta(vesselId),
            };
        }

        public static VesselCrew? BuildCrew(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "misc", out var misc))
            {
                return null;
            }

            var count = GetInt(misc, "crewCount");
            if (!count.HasValue)
            {
                return null;
            }

            var result = new VesselCrew
            {
                Count = count.Value,
                Meta = BuildMeta(vesselId),
            };

            // Roster + capacity (G-13 additive growth). Optional group: absent
            // on older recorded sessions, so read defensively and leave the
            // count-only shape intact when it isn't present.
            if (TryGetGroup(vessel, "crew", out var crew))
            {
                result.Capacity = GetInt(crew, "capacity") ?? 0;
                if (crew.TryGetValue("members", out var rawMembers)
                    && rawMembers is IEnumerable<object?> members)
                {
                    foreach (var rawMember in members)
                    {
                        if (rawMember is IDictionary<string, object?> member)
                        {
                            result.Crew.Add(BuildCrewMember(member));
                        }
                    }
                }
            }

            return result;
        }

        private static CrewMember BuildCrewMember(IDictionary<string, object?> raw) => new CrewMember
        {
            Name = GetString(raw, "name"),
            Trait = GetString(raw, "trait"),
            ExperienceLevel = GetInt(raw, "experienceLevel"),
            Type = GetString(raw, "type"),
            RosterStatus = GetString(raw, "rosterStatus"),
        };

        public static VesselStructure? BuildStructure(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "misc", out var misc))
            {
                return null;
            }

            var currentStage = GetInt(misc, "currentStage");
            if (!currentStage.HasValue)
            {
                return null;
            }

            return new VesselStructure
            {
                CurrentStage = currentStage.Value,
                // Null when the vessel has no parts this tick (R1(a)) --
                // never -1 or 0 masquerading as a real stage/part count.
                StageCount = GetInt(misc, "stageCount"),
                PartCount = GetInt(misc, "partCount"),
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>
        /// The <c>time.warp</c> channel -- GLOBAL game state, decoupled from
        /// active-vessel presence (fold-in fix, M1 Task 3 review): the only
        /// gate is whether <c>snapshot.Values["time"]</c> itself is present,
        /// so this emits at the Space Center / tracking station / any scene
        /// with no active vessel, not just in flight. See
        /// <see cref="WarpState"/>'s class doc comment for why its
        /// <see cref="Meta"/> is stamped with the non-vessel <c>"game"</c>
        /// source rather than <c>"vessel:&lt;guid&gt;"</c>.
        /// </summary>
        public static WarpState? BuildWarp(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null || !TryGetGroup(snapshot.Values, "time", out var time))
            {
                return null;
            }

            var warpRate = GetDouble(time, "warpRate");
            var warpRateIndex = GetInt(time, "warpRateIndex");
            var paused = GetBool(time, "paused");
            if (!warpRate.HasValue || !warpRateIndex.HasValue || !paused.HasValue)
            {
                return null;
            }

            return new WarpState
            {
                WarpRate = warpRate.Value,
                WarpRateIndex = warpRateIndex.Value,
                WarpMode = ParseWarpMode(GetString(time, "warpMode")),
                Paused = paused.Value,
                Meta = BuildGameMeta(),
            };
        }

        /// <summary>
        /// The active vessel's subject id (KSP's <c>Vessel.id</c> GUID, as a
        /// string) if a vessel + its identity group are both present this
        /// tick -- shared by every <c>Build*</c> guard above AND
        /// <see cref="VesselEpochSampler"/> (so "what counts as the current
        /// subject" lives in exactly one place).
        /// </summary>
        public static string? TryGetActiveVesselId(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            return vessel != null && TryGetSubjectId(vessel, out var vesselId) ? vesselId : null;
        }

        // ----------------------------------------------------------------
        // Wire adapters -- see the class doc comment for why these exist.
        // ----------------------------------------------------------------

        public static object? BuildIdentityWire(KspSnapshot? snapshot) =>
            BuildIdentity(snapshot) is { } identity ? ToWire(identity) : null;

        public static object? BuildOrbitWire(KspSnapshot? snapshot) =>
            BuildOrbit(snapshot) is { } orbit ? ToWire(orbit) : null;

        public static object? BuildOrbitTruthWire(KspSnapshot? snapshot) =>
            BuildOrbitTruth(snapshot) is { } truth ? ToWire(truth) : null;

        public static object? BuildFlightWire(KspSnapshot? snapshot) =>
            BuildFlight(snapshot) is { } flight ? ToWire(flight) : null;

        public static object? BuildAttitudeWire(KspSnapshot? snapshot) =>
            BuildAttitude(snapshot) is { } attitude ? ToWire(attitude) : null;

        public static object? BuildResourcesWire(KspSnapshot? snapshot) =>
            BuildResources(snapshot) is { } resources ? ToWire(resources) : null;

        public static object? BuildThermalWire(KspSnapshot? snapshot) =>
            BuildThermal(snapshot) is { } thermal ? ToWire(thermal) : null;

        public static object? BuildControlWire(KspSnapshot? snapshot) =>
            BuildControl(snapshot) is { } control ? ToWire(control) : null;

        public static object? BuildPhysicsModeWire(KspSnapshot? snapshot) =>
            BuildPhysicsMode(snapshot) is { } physics ? ToWire(physics) : null;

        public static object? BuildCommsWire(KspSnapshot? snapshot) =>
            BuildComms(snapshot) is { } comms ? ToWire(comms) : null;

        public static object? BuildPropulsionWire(KspSnapshot? snapshot) =>
            BuildPropulsion(snapshot) is { } propulsion ? ToWire(propulsion) : null;

        public static object? BuildManeuverWire(KspSnapshot? snapshot) =>
            BuildManeuver(snapshot) is { } maneuver ? ToWire(maneuver) : null;

        public static object? BuildTargetWire(KspSnapshot? snapshot) =>
            BuildTarget(snapshot) is { } target ? ToWire(target) : null;

        public static object? BuildCrewWire(KspSnapshot? snapshot) =>
            BuildCrew(snapshot) is { } crew ? ToWire(crew) : null;

        public static object? BuildStructureWire(KspSnapshot? snapshot) =>
            BuildStructure(snapshot) is { } structure ? ToWire(structure) : null;

        public static object? BuildWarpWire(KspSnapshot? snapshot) =>
            BuildWarp(snapshot) is { } warp ? ToWire(warp) : null;

        public static object? BuildDockWire(KspSnapshot? snapshot) =>
            BuildDock(snapshot) is { } dock ? ToWire(dock) : null;

        public static object? BuildSurfaceWire(KspSnapshot? snapshot) =>
            BuildSurface(snapshot) is { } surface ? ToWire(surface) : null;

        private static Dictionary<string, object?> ToWire(VesselIdentity id) => new Dictionary<string, object?>
        {
            ["vesselId"] = id.VesselId,
            ["name"] = id.Name,
            ["vesselType"] = (int)id.VesselType,
            ["situation"] = (int)id.Situation,
            ["parentBodyIndex"] = id.ParentBodyIndex,
            ["launchUt"] = id.LaunchUt,
            ["meta"] = ToWire(id.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselOrbit orbit) => new Dictionary<string, object?>
        {
            ["referenceBodyIndex"] = orbit.ReferenceBodyIndex,
            ["sma"] = orbit.Sma,
            ["ecc"] = orbit.Ecc,
            ["inc"] = orbit.Inc,
            ["lan"] = orbit.Lan,
            ["argPe"] = orbit.ArgPe,
            ["meanAnomalyAtEpoch"] = orbit.MeanAnomalyAtEpoch,
            ["epoch"] = orbit.Epoch,
            ["mu"] = orbit.Mu,
            ["encounter"] = orbit.Encounter != null ? ToWire(orbit.Encounter) : null,
            ["patches"] = orbit.Patches.Select(p => (object?)ToWire(p)).ToList(),
            ["meta"] = ToWire(orbit.Meta),
        };

        private static Dictionary<string, object?> ToWire(OrbitEncounter encounter) => new Dictionary<string, object?>
        {
            ["transitionType"] = (int)encounter.TransitionType,
            ["transitionUt"] = encounter.TransitionUt,
            ["bodyIndex"] = encounter.BodyIndex,
        };

        private static Dictionary<string, object?> ToWire(OrbitPatch patch) => new Dictionary<string, object?>
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
            ["patchStartTransition"] = (int)patch.PatchStartTransition,
            ["patchEndTransition"] = (int)patch.PatchEndTransition,
            ["peA"] = patch.PeA,
            ["apA"] = patch.ApA,
            ["semiLatusRectum"] = patch.SemiLatusRectum,
            ["semiMinorAxis"] = patch.SemiMinorAxis,
            ["referenceBody"] = patch.ReferenceBody,
            ["closestEncounterBody"] = patch.ClosestEncounterBody,
        };

        private static Dictionary<string, object?> ToWire(VesselOrbitTruth truth) => new Dictionary<string, object?>
        {
            ["position"] = ToWire(truth.Position),
            ["velocity"] = ToWire(truth.Velocity),
            ["frameRotating"] = truth.FrameRotating,
            ["meta"] = ToWire(truth.Meta),
        };

        private static Dictionary<string, object?> ToWire(Vec3 v) => new Dictionary<string, object?>
        {
            ["x"] = v.X,
            ["y"] = v.Y,
            ["z"] = v.Z,
        };

        private static Dictionary<string, object?> ToWire(VesselFlight flight) => new Dictionary<string, object?>
        {
            ["latitude"] = flight.Latitude,
            ["longitude"] = flight.Longitude,
            ["altitudeAsl"] = flight.AltitudeAsl,
            ["altitudeTerrain"] = flight.AltitudeTerrain,
            ["verticalSpeed"] = flight.VerticalSpeed,
            ["surfaceSpeed"] = flight.SurfaceSpeed,
            ["orbitalSpeed"] = flight.OrbitalSpeed,
            ["gForce"] = flight.GForce,
            ["dynamicPressureKPa"] = flight.DynamicPressureKPa,
            ["mach"] = flight.Mach,
            ["atmDensity"] = flight.AtmDensity,
            ["externalTemperature"] = flight.ExternalTemperature,
            ["atmosphericTemperature"] = flight.AtmosphericTemperature,
            ["meta"] = ToWire(flight.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselAttitude attitude) => new Dictionary<string, object?>
        {
            ["pitch"] = attitude.Pitch,
            ["heading"] = attitude.Heading,
            ["roll"] = attitude.Roll,
            ["pitchRootFrame"] = attitude.PitchRootFrame,
            ["headingRootFrame"] = attitude.HeadingRootFrame,
            ["rollRootFrame"] = attitude.RollRootFrame,
            ["meta"] = ToWire(attitude.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselResources resources) => new Dictionary<string, object?>
        {
            ["resources"] = resources.Resources.ToDictionary(kvp => kvp.Key, kvp => (object?)ToWire(kvp.Value)),
            ["meta"] = ToWire(resources.Meta),
        };

        private static Dictionary<string, object?> ToWire(ResourceAmount amount) => new Dictionary<string, object?>
        {
            ["current"] = amount.Current,
            ["max"] = amount.Max,
            ["active"] = amount.Active,
        };

        private static Dictionary<string, object?> ToWire(VesselThermal thermal) => new Dictionary<string, object?>
        {
            ["maxSkinTempRatio"] = thermal.MaxSkinTempRatio,
            ["maxInternalTempRatio"] = thermal.MaxInternalTempRatio,
            ["hottestPart"] = thermal.HottestPart != null ? ToWire(thermal.HottestPart) : null,
            ["heatShieldTempCelsius"] = thermal.HeatShieldTempCelsius,
            ["heatShieldFlux"] = thermal.HeatShieldFlux,
            ["hottestEngineTemp"] = thermal.HottestEngineTemp,
            ["hottestEngineMaxTemp"] = thermal.HottestEngineMaxTemp,
            ["hottestEngineTempRatio"] = thermal.HottestEngineTempRatio,
            ["anyEnginesOverheating"] = thermal.AnyEnginesOverheating,
            ["meta"] = ToWire(thermal.Meta),
        };

        private static Dictionary<string, object?> ToWire(ThermalHottestPart part) => new Dictionary<string, object?>
        {
            ["internalTemp"] = part.InternalTemp,
            ["maxTemp"] = part.MaxTemp,
            ["skinTemp"] = part.SkinTemp,
            ["skinMaxTemp"] = part.SkinMaxTemp,
            ["name"] = part.Name,
        };

        private static Dictionary<string, object?> ToWire(VesselControl control) => new Dictionary<string, object?>
        {
            ["sas"] = control.Sas,
            ["sasMode"] = control.SasMode.HasValue ? (int)control.SasMode.Value : null,
            ["rcs"] = control.Rcs,
            ["gear"] = control.Gear,
            ["brakes"] = control.Brakes,
            ["lights"] = control.Lights,
            ["abort"] = control.Abort,
            ["precisionControl"] = control.PrecisionControl,
            ["throttle"] = control.Throttle,
            ["actionGroups"] = control.ActionGroups?.Select(b => (object?)b).ToList(),
            ["meta"] = ToWire(control.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselPhysicsMode physics) => new Dictionary<string, object?>
        {
            ["mode"] = (int)physics.Mode,
            ["meta"] = ToWire(physics.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselComms comms) => new Dictionary<string, object?>
        {
            ["connected"] = comms.Connected,
            ["signalStrength"] = comms.SignalStrength,
            ["controlState"] = (int)comms.ControlState,
            ["meta"] = ToWire(comms.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselPropulsion propulsion) => new Dictionary<string, object?>
        {
            ["totalMass"] = propulsion.TotalMass,
            ["dryMass"] = propulsion.DryMass,
            ["currentThrust"] = propulsion.CurrentThrust,
            ["availableThrust"] = propulsion.AvailableThrust,
            ["meta"] = ToWire(propulsion.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselManeuver maneuver) => new Dictionary<string, object?>
        {
            ["nodes"] = maneuver.Nodes.Select(n => (object?)ToWire(n)).ToList(),
            ["meta"] = ToWire(maneuver.Meta),
        };

        private static Dictionary<string, object?> ToWire(ManeuverNode node) => new Dictionary<string, object?>
        {
            ["id"] = node.Id,
            ["ut"] = node.Ut,
            ["dvRadial"] = node.DvRadial,
            ["dvNormal"] = node.DvNormal,
            ["dvPrograde"] = node.DvPrograde,
            ["dvTotal"] = node.DvTotal,
            ["patches"] = node.Patches.Select(p => (object?)ToWire(p)).ToList(),
        };

        private static Dictionary<string, object?> ToWire(VesselTarget target) => new Dictionary<string, object?>
        {
            ["name"] = target.Name,
            ["kind"] = (int)target.Kind,
            ["vesselId"] = target.VesselId,
            ["bodyIndex"] = target.BodyIndex,
            ["relativePosition"] = target.RelativePosition != null ? ToWire(target.RelativePosition) : null,
            ["relativeVelocity"] = target.RelativeVelocity != null ? ToWire(target.RelativeVelocity) : null,
            ["orbit"] = target.Orbit != null ? ToWire(target.Orbit) : null,
            ["meta"] = ToWire(target.Meta),
        };

        private static Dictionary<string, object?> ToWire(DockAlignment dock) => new Dictionary<string, object?>
        {
            ["relativePosition"] = ToWire(dock.RelativePosition),
            ["relativeVelocity"] = ToWire(dock.RelativeVelocity),
            ["distance"] = dock.Distance,
            ["forwardDot"] = dock.ForwardDot,
            ["meta"] = ToWire(dock.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselSurface surface) => new Dictionary<string, object?>
        {
            ["biome"] = surface.Biome,
            ["landedAt"] = surface.LandedAt,
            ["heightFromTerrain"] = surface.HeightFromTerrain,
            ["meta"] = ToWire(surface.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselCrew crew) => new Dictionary<string, object?>
        {
            ["count"] = crew.Count,
            ["capacity"] = crew.Capacity,
            ["crew"] = crew.Crew.Select(ToWire).ToList<object?>(),
            ["meta"] = ToWire(crew.Meta),
        };

        private static Dictionary<string, object?> ToWire(CrewMember member) => new Dictionary<string, object?>
        {
            ["name"] = member.Name,
            ["trait"] = member.Trait,
            ["experienceLevel"] = member.ExperienceLevel,
            ["type"] = member.Type,
            ["rosterStatus"] = member.RosterStatus,
        };

        private static Dictionary<string, object?> ToWire(VesselStructure structure) => new Dictionary<string, object?>
        {
            ["currentStage"] = structure.CurrentStage,
            ["stageCount"] = structure.StageCount,
            ["partCount"] = structure.PartCount,
            ["meta"] = ToWire(structure.Meta),
        };

        private static Dictionary<string, object?> ToWire(WarpState warp) => new Dictionary<string, object?>
        {
            ["warpRate"] = warp.WarpRate,
            ["warpRateIndex"] = warp.WarpRateIndex,
            ["warpMode"] = (int)warp.WarpMode,
            ["paused"] = warp.Paused,
            ["meta"] = ToWire(warp.Meta),
        };

        /// <summary>
        /// Fix C: the PAYLOAD's own nested "meta" key carries only what a
        /// payload mapper actually produces -- <c>source</c>/<c>quality</c>
        /// -- never a fabricated duplicate of the envelope's real
        /// <c>seq</c>/<c>deliveredAt</c>/<c>vantage</c>/<c>validAt</c> (those
        /// are stamped once, for real, by <c>Sitrep.Core.Courier.MakeMeta</c>
        /// onto <c>StreamData&lt;T&gt;.Meta</c> at delivery time). See
        /// <see cref="PayloadMeta"/>'s class doc comment for the full
        /// rationale.
        /// </summary>
        private static Dictionary<string, object?> ToWire(PayloadMeta meta) => new Dictionary<string, object?>
        {
            ["source"] = meta.Source,
            ["quality"] = (int)meta.Quality,
        };

        // ----------------------------------------------------------------
        // Shared helpers
        // ----------------------------------------------------------------

        private static PayloadMeta BuildMeta(string vesselId)
        {
            return new PayloadMeta
            {
                Source = "vessel:" + vesselId,
                // Quality defaults to OnRails -- KspHost doesn't yet capture
                // the vessel's packed/loaded (on-rails vs off-rails) state
                // (a future capture addition), so this is a documented,
                // deliberate simplification for M1 Task 1, not a silent
                // "always trust conics" claim. Off-rails detection is scoped
                // to whichever future task wires up physicsMode/packed
                // capture (mirrors O-2's "deliberately deferred" ruling in
                // the taxonomy design doc).
                Quality = Quality.OnRails,
            };
        }

        /// <summary>
        /// <see cref="PayloadMeta"/> for the genuinely-global <c>time.warp</c>
        /// channel (fold-in fix, M1 Task 3 review) -- <c>Source = "game"</c>,
        /// never <c>"vessel:&lt;guid&gt;"</c>, since warp/pause isn't
        /// attributable to any vessel (it emits with no active vessel at
        /// all -- see <see cref="BuildWarp"/>).
        /// </summary>
        private static PayloadMeta BuildGameMeta()
        {
            return new PayloadMeta
            {
                Source = "game",
                Quality = Quality.OnRails,
            };
        }

        private static bool TryGetSubjectId(IDictionary<string, object?> vessel, out string vesselId)
        {
            if (TryGetGroup(vessel, "identity", out var identity))
            {
                var id = GetString(identity, "id");
                if (!string.IsNullOrEmpty(id))
                {
                    vesselId = id!;
                    return true;
                }
            }
            vesselId = "";
            return false;
        }

        private static IDictionary<string, object?>? GetVesselGroup(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }
            return snapshot.Values.TryGetValue("vessel", out var raw) && raw is IDictionary<string, object?> vessel
                ? vessel
                : null;
        }

        private static bool TryGetGroup(IDictionary<string, object?> parent, string key, out IDictionary<string, object?> group)
        {
            if (parent.TryGetValue(key, out var raw) && raw is IDictionary<string, object?> dict)
            {
                group = dict;
                return true;
            }
            group = null!;
            return false;
        }

        /// <summary>
        /// Resolves a body NAME (KspHost's raw vessel.orbit.referenceBody /
        /// identity.parentBody / encounter.body all carry names, not indices)
        /// to its stable <c>system.bodies</c> index, by scanning
        /// <c>snapshot.Values["bodies"]</c> -- the same raw list
        /// <see cref="SystemViewProvider"/> reads. Returns null if the bodies
        /// list is absent or the name doesn't match any entry (never a
        /// sentinel index like -1).
        /// </summary>
        private static int? ResolveBodyIndex(KspSnapshot snapshot, string bodyName) =>
            SharedMappers.ResolveBodyIndex(snapshot, bodyName);

        private static Situation ParseSituation(string? raw) => SharedMappers.ParseSituation(raw);

        private static VesselType ParseVesselType(string? raw) => SharedMappers.ParseVesselType(raw);

        // The Contract enums carry compile-time-only Reinforced.Typings
        // attributes whose assembly is PrivateAssets="all" (not in bin at
        // runtime). Reflective enum parsing (Enum.TryParse/Parse) eagerly
        // resolves EVERY custom-attribute type on the enum → FileNotFoundException
        // on net10.0 (and a real crash risk on KSP's Mono). So these parsers are
        // hand-rolled switches — case-insensitive as the originals were, Unknown
        // fallback — and NO code path resolves a Contract enum's attributes.

        private static TransitionType ParseTransitionType(string? raw)
        {
            return raw?.ToLowerInvariant() switch
            {
                "initial" => TransitionType.Initial,
                "final" => TransitionType.Final,
                "encounter" => TransitionType.Encounter,
                "escape" => TransitionType.Escape,
                "maneuver" => TransitionType.Maneuver,
                "collision" => TransitionType.Collision,
                _ => TransitionType.Unknown,
            };
        }

        private static SasMode? ParseSasMode(string? raw)
        {
            if (raw == null)
            {
                return null;
            }
            return raw.ToLowerInvariant() switch
            {
                "stabilityassist" => SasMode.StabilityAssist,
                "prograde" => SasMode.Prograde,
                "retrograde" => SasMode.Retrograde,
                "normal" => SasMode.Normal,
                "antinormal" => SasMode.Antinormal,
                "radialin" => SasMode.RadialIn,
                "radialout" => SasMode.RadialOut,
                "target" => SasMode.Target,
                "antitarget" => SasMode.AntiTarget,
                "maneuver" => SasMode.Maneuver,
                _ => SasMode.Unknown,
            };
        }

        private static PhysicsMode ParsePhysicsMode(string? raw)
        {
            return raw?.ToLowerInvariant() switch
            {
                "onrails" => PhysicsMode.OnRails,
                "packed" => PhysicsMode.Packed,
                "unpacked" => PhysicsMode.Unpacked,
                _ => PhysicsMode.Unknown,
            };
        }

        private static ControlState ParseControlState(string? raw)
        {
            return raw?.ToLowerInvariant() switch
            {
                "none" => ControlState.None,
                "probe" => ControlState.Probe,
                "kerbal" => ControlState.Kerbal,
                "partial" => ControlState.Partial,
                "full" => ControlState.Full,
                "probenone" => ControlState.ProbeNone,
                "probepartial" => ControlState.ProbePartial,
                "probefull" => ControlState.ProbeFull,
                "kerbalnone" => ControlState.KerbalNone,
                "kerbalpartial" => ControlState.KerbalPartial,
                "kerbalfull" => ControlState.KerbalFull,
                _ => ControlState.Unknown,
            };
        }

        private static WarpMode ParseWarpMode(string? raw)
        {
            return raw?.ToLowerInvariant() switch
            {
                "high" => WarpMode.High,
                "low" => WarpMode.Low,
                _ => WarpMode.Unknown,
            };
        }

        /// <summary>
        /// See <see cref="TargetKind"/>'s doc comment: <c>type</c> is a
        /// <see cref="VesselType"/>-shaped string when the target IS a
        /// vessel, the literal <c>"CelestialBody"</c> for a body target, or
        /// an arbitrary CLR type name for anything else (docking port,
        /// waypoint, ...) -- collapsed to the three cases a consumer needs.
        /// </summary>
        private static TargetKind ClassifyTargetKind(string? raw)
        {
            if (raw == "CelestialBody")
            {
                return TargetKind.Body;
            }
            if (SharedMappers.IsKnownVesselType(raw))
            {
                return TargetKind.Vessel;
            }
            return TargetKind.Other;
        }

        // Scalar readers (GetString/GetBool/GetInt/GetDouble/GetVec3) live in
        // the shared SnapshotDict -- see that class's doc comment for the
        // R1/F-1 non-finite-is-absent rule GetDouble/GetVec3 both apply.
        private static string? GetString(IDictionary<string, object?> raw, string key) => SnapshotDict.GetString(raw, key);
        private static bool? GetBool(IDictionary<string, object?> raw, string key) => SnapshotDict.GetBool(raw, key);
        private static int? GetInt(IDictionary<string, object?> raw, string key) => SnapshotDict.GetInt(raw, key);
        private static double? GetDouble(IDictionary<string, object?> raw, string key) => SnapshotDict.GetDouble(raw, key);
        private static Vec3? GetVec3(IDictionary<string, object?> raw, string key) => SnapshotDict.GetVec3(raw, key);
    }
}
