using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the four M1 "core" vessel channels,
    /// <c>vessel.identity</c>/<c>vessel.orbit</c>/<c>vessel.orbit.truth</c>/
    /// <c>vessel.flight</c>: the Task 1 foundation for the vessel telemetry
    /// uplink. See local_docs/telemetry-mod/m1-provider-taxonomy-design.md
    /// §2.2 and telemachus-api-issues.md O-1/O-8/O-9/O-10/V-10/V-12/V-13.
    /// Reads <see cref="KspSnapshot.Values"/>'s <c>"vessel"</c> groups (see
    /// <c>Gonogo.KSP.KspHost.BuildVesselEntry</c>'s doc comment for the raw
    /// shape) and produces the typed <c>Sitrep.Contract</c> POCOs. Every
    /// <c>Build*</c> method returns <c>null</c> (never a partially-populated
    /// record) when its required raw data is missing (R1: absence is typed,
    /// never a sentinel default).
    ///
    /// <para><b>Subject provenance</b> (the M1 "must-ship, unretrofittable"
    /// rule: design doc §6.1/§8.1): every payload's <c>Meta.Source</c> is
    /// stamped <c>"vessel:&lt;guid&gt;"</c> from <c>vessel.identity.id</c>, so
    /// a sample is always attributable to the vessel it describes even across
    /// a vessel switch. Epoching that switch into a clean keyframe boundary is
    /// <see cref="VesselEpochSampler"/>'s job (a registered
    /// <see cref="ISnapshotSampler"/>): this class only produces payloads,
    /// never touches the emitter.</para>
    ///
    /// <para><b>Wire adapter (the <c>*Wire</c> methods):</b>
    /// <see cref="Sitrep.Core.Serialization.JsonWriter.AppendValue"/> only
    /// knows how to serialize <c>null</c>/bool/numeric/string/
    /// <c>IDictionary&lt;string, object?&gt;</c>/<c>IEnumerable</c>: an
    /// arbitrary typed POCO (like <see cref="VesselIdentity"/>) falls through
    /// to its "unsupported CLR value type" throw, which
    /// <c>ChannelEngine</c>'s delivery-time guard would treat as a genuinely
    /// poisoned payload and fail-soft the WHOLE uplink (see
    /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests.
    /// GenuinelyUnserializablePayloadFailsSoftTheOwningUplinkInsteadOfRecurringSilently</c>,
    /// which deliberately pins that behavior for a genuinely-unrecognized
    /// type). Rather than widen <c>JsonWriter</c> itself: a shared,
    /// widely-depended-on class where doing so would blur that intentional
    /// safety net: each payload type gets a small, explicit
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
        public const string CalendarTopic = "time.calendar";

        // ---- M3 R3 capture-adds ----
        public const string DockTopic = "vessel.dock";
        public const string SurfaceTopic = "vessel.surface";
        public const string LandingTopic = "vessel.landing";

        /// <summary>All M1 vessel(+time.warp, see <see cref="WarpState"/>'s doc comment for the scoping note) topics, shared by <see cref="Gonogo.KSP.VesselUplink"/>'s manifest (in Gonogo.KSP) and <see cref="VesselEpochSampler"/>'s force-keyframe fan-out.</summary>
        public static readonly IReadOnlyList<string> Topics = new[]
        {
            IdentityTopic, OrbitTopic, OrbitTruthTopic, FlightTopic,
            AttitudeTopic, ResourcesTopic, ThermalTopic, ControlTopic, PhysicsModeTopic, CommsTopic,
            PropulsionTopic, ManeuverTopic, TargetTopic, CrewTopic, StructureTopic, WarpTopic,
            CalendarTopic, DockTopic, SurfaceTopic, LandingTopic,
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
                Horizon = ElementHorizon(snapshot.Ut, sma.Value, mu.Value),
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>
        /// The horizon these elements carry.
        ///
        /// <para><see cref="PropagationHorizonKind.Unbounded"/> because the only
        /// <c>IPropagationProvider</c> that exists is <c>KeplerProvider</c>, an
        /// analytic two-body solver whose <c>CanPropagate</c> ignores its window
        /// parameters entirely: it has no horizon, and saying so is a claim
        /// rather than a default.</para>
        ///
        /// <para>This is the ONE place to change when a provider that INTEGRATES
        /// is elected, i.e. an n-body backend. Such a provider must
        /// return <see cref="PropagationHorizonKind.Until"/> with a per-sample
        /// UT, because the horizon is a local property: the same save at the same
        /// instant has horizons differing by orders of magnitude between craft,
        /// scaling as <c>2 (mu_perturber / mu_primary) (r / d)^3</c>. A measured
        /// 20 km Minmus orbit drifts ~11 m per hour under two-body extrapolation
        /// while an ordinary high-Kerbin orbit perturbed by the Mun drifts ~19 km
        /// per hour, which is why one global answer cannot be right.</para>
        ///
        /// <para>Until then the client-side gate never refuses. That is the
        /// system working with a provider that has no limit, not a dead branch:
        /// do not delete it as unreachable.</para>
        /// </summary>
        /// <summary>
        /// Whether the ELECTED propagation provider integrates. Late-bound
        /// because the capability kernel is not resolved when this static class
        /// is first touched, the same reason the actuator's own resolvers are.
        ///
        /// <para>A bool rather than the provider, so this class never links the
        /// propagation interfaces, and so nothing here can branch on a provider
        /// ID. The TYPE check that produces it lives at the election site, which
        /// is the only place entitled to recognise its own registrations.</para>
        /// </summary>
        private static Func<bool>? _electedIsIntegrating;

        /// <summary>Installs the integrating-provider resolver; see <see cref="_electedIsIntegrating"/>.</summary>
        public static void SetIntegratingProviderSource(Func<bool> resolver)
        {
            _electedIsIntegrating = resolver;
        }

        /// <summary>
        /// The horizon and shape these elements carry.
        ///
        /// <para>Under the stock analytic solver: <c>Analytic</c> and
        /// <c>Unbounded</c>, both stated rather than defaulted, because
        /// <c>Unspecified</c> is what a producer that forgot would send and that
        /// has to stay distinguishable.</para>
        ///
        /// <para>Under a provider that INTEGRATES: <c>Integrated</c>, and a
        /// horizon a quarter of a characteristic cycle ahead of this sample. If
        /// the cycle cannot be computed the horizon stays <c>Unspecified</c>
        /// rather than claiming <c>Until</c> with a fabricated UT: a client reads
        /// that as unpropagatable, which is the safe direction.</para>
        /// </summary>
        private static PropagationHorizon ElementHorizon(double sampleUt, double sma, double mu)
        {
            var integrating = false;
            try
            {
                integrating = _electedIsIntegrating?.Invoke() ?? false;
            }
            catch (Exception)
            {
                // A resolver fault must not cost the whole orbit payload. False is
                // the conservative read: it publishes the analytic answer, which
                // is what an install with no n-body backend has anyway.
                integrating = false;
            }

            if (!integrating)
            {
                return AnalyticHorizon();
            }

            var untilUt = IntegratedHorizon.UntilUt(sampleUt, CycleSecondsOf(sma, mu));
            return new PropagationHorizon
            {
                TrajectoryKind = TrajectoryKind.Integrated,
                Kind = untilUt == null ? PropagationHorizonKind.Unspecified : PropagationHorizonKind.Until,
                UntilUt = untilUt,
            };
        }

        /// <summary>The orbital period, or null when the elements cannot produce one.</summary>
        private static double? CycleSecondsOf(double sma, double mu)
        {
            if (sma <= 0.0 || mu <= 0.0 ||
                double.IsNaN(sma) || double.IsNaN(mu) ||
                double.IsInfinity(sma) || double.IsInfinity(mu))
            {
                return null;
            }
            return 2.0 * Math.PI * Math.Sqrt(sma * sma * sma / mu);
        }

        private static PropagationHorizon AnalyticHorizon() =>
            new PropagationHorizon
            {
                Kind = PropagationHorizonKind.Unbounded,
                // The stock solver is analytic by construction, so a conic
                // renderer is exactly right for what it produces. Stated rather
                // than defaulted: `Unspecified` is what a producer that forgot
                // would send, and that must stay distinguishable.
                TrajectoryKind = TrajectoryKind.Analytic,
            };

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
                if (rawPatch is IDictionary<string, object?> patch && MapOrbitPatch(patch) is { } mapped)
                {
                    result.Add(mapped);
                }
            }

            return result;
        }

        /// <summary>
        /// One raw patch to its contract form, or null when it is missing a
        /// field the shape cannot do without.
        ///
        /// <para>Public because a maneuver-plan provider capturing in
        /// <c>Gonogo.KSP</c> answers in contract types and needs the same
        /// mapping, and a second implementation of it there would be free to
        /// disagree with this one.</para>
        /// </summary>
        public static OrbitPatch? MapOrbitPatch(IDictionary<string, object?> patch)
        {
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
                return null;
            }

            return new OrbitPatch
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
                // Not in the required-field gate above: absent on a
                // recording captured before these existed, and the patch is
                // still fully usable by every consumer that predates them.
                Mu = GetDouble(patch, "mu"),
                ReferenceBodyIndex = GetInt(patch, "referenceBodyIndex"),
                ClosestEncounterBodyIndex = GetInt(patch, "closestEncounterBodyIndex"),
            };
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
                HeatShieldTemp = GetDouble(thermal, "heatShieldTemp"),
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

            // The NAMED action-group list, as captured by whichever backend the
            // "actionGroups" capability elected (KspHost.BuildControl resolves
            // it on the main thread -- see IActionGroupsBackend's threading
            // note). This provider stays backend-agnostic: it maps whatever
            // entries arrived, however many, whatever they're called. That is
            // what lets an AGX backend (up to 250 player-named groups) ride
            // this same path with no change here.
            //
            // Absent key => null (the contract's "no action-group data this
            // tick"), never an empty list -- an empty list would wrongly assert
            // "this vessel has zero groups" and blank the client. A recording
            // predating the named list simply has no "actionGroups" key and so
            // reads null, which is the honest answer for it.
            ActionGroupState[]? actionGroups = null;
            if (control.TryGetValue("actionGroups", out var rawGroups) && rawGroups is IEnumerable<object?> groupList)
            {
                var groups = new List<ActionGroupState>();
                foreach (var rawGroup in groupList)
                {
                    if (rawGroup is not IDictionary<string, object?> group)
                    {
                        continue;
                    }

                    var index = GetInt(group, "index");
                    var state = GetBool(group, "state");
                    if (!index.HasValue || !state.HasValue)
                    {
                        // Index is the identity (it's what a setActionGroup
                        // command names) and State is the whole point of the
                        // read -- a group missing either is not a group. Skip
                        // it rather than inventing a default, same discipline
                        // as BuildManeuver's missing-Ut rule.
                        continue;
                    }

                    groups.Add(new ActionGroupState
                    {
                        Index = index.Value,
                        // Fall back to the stock-style label rather than "" so a
                        // backend that reported an index but no name still
                        // renders as something a human can read.
                        Name = GetString(group, "name") ?? ("AG" + index.Value),
                        State = state.Value,
                    });
                }
                actionGroups = groups.ToArray();
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
                // Commanded fly-by-wire axis echoes (the read-anchors for the
                // vessel.control.{pitch,yaw,roll,translationX/Y/Z} setAxes stream
                // channels): KspHost.BuildControl reads FlightCtrlState. -1..1,
                // null when no ctrlState.
                Pitch = GetDouble(control, "pitch"),
                Yaw = GetDouble(control, "yaw"),
                Roll = GetDouble(control, "roll"),
                TranslationX = GetDouble(control, "translationX"),
                TranslationY = GetDouble(control, "translationY"),
                TranslationZ = GetDouble(control, "translationZ"),
                ActionGroups = actionGroups,
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>
        /// The <c>vessel.physics.mode</c> channel: the active vessel's
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

            // The two thrust latches are individually nullable and legitimately
            // absent (a craft that has never lit an engine has neither), so
            // unlike the four figures above they never gate the record.

            return new VesselPropulsion
            {
                TotalMass = totalMass.Value,
                DryMass = dryMass.Value,
                CurrentThrust = currentThrust.Value,
                AvailableThrust = availableThrust.Value,
                ThrustStartedUt = GetDouble(propulsion, "thrustStartedUt"),
                LastThrustEndUt = GetDouble(propulsion, "lastThrustEndUt"),
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
                        // Absent whenever nothing supplies a burn-duration
                        // model, which is the common case and an honest one:
                        // never substituted from Ut. See IgnitionUt's doc.
                        IgnitionUt = GetDouble(node, "ignitionUt"),
                        CutoffUt = GetDouble(node, "cutoffUt"),
                        Frame = ParseManeuverFrame(GetString(node, "frame")),
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
                // Absent means no planner exists for this craft, which the
                // empty Nodes list above cannot say on its own.
                Planner = GetString(vessel, "maneuverPlanner"),
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

            // Mod-side closest approach (the elected IPropagationProvider's
            // result, stamped by KspHost.BuildTarget). Absent group -> null,
            // never a sentinel zero record.
            ClosestApproach? closestApproach = null;
            if (TryGetGroup(target, "closestApproach", out var rawCa))
            {
                closestApproach = new ClosestApproach
                {
                    Time = GetDouble(rawCa, "time") ?? 0.0,
                    Distance = GetDouble(rawCa, "distance") ?? 0.0,
                };
            }

            var kind = ClassifyTargetKind(GetString(target, "type"));

            // M3 R3: the target's OWN stable id, closing the §6.4 round-trip
            // gap -- see VesselTarget.VesselId/BodyIndex's doc comments.
            // Only ever one of the two is populated, mirroring SetTargetArgs'
            // own Kind-discriminated shape.
            string? targetVesselId = null;
            int? targetBodyIndex = null;
            uint? targetPartId = null;
            if (kind == TargetKind.Vessel)
            {
                targetVesselId = GetString(target, "targetVesselId");
            }
            else if (kind == TargetKind.Part)
            {
                // A docking port: the OWNING vessel's guid plus the port's own
                // Part.flightID (a part id is unique only within its vessel).
                targetVesselId = GetString(target, "targetVesselId");
                targetPartId = (uint?)GetDouble(target, "partId");
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
                PartId = targetPartId,
                // Null only when the transform data needed to compute it
                // wasn't available this tick -- see Vec3 in the class doc
                // comment (one canonical shape everywhere -- kills V-8).
                RelativePosition = GetVec3(target, "relativePosition"),
                RelativeVelocity = relativeVelocity,
                Orbit = orbit,
                ClosestApproach = closestApproach,
                Meta = BuildMeta(vesselId),
            };
        }

        /// <summary>The <c>vessel.dock</c> channel: see <see cref="DockAlignment"/>'s class doc comment. Null whenever <c>Gonogo.KSP.KspHost.BuildDock</c> omitted the raw group (no target, target isn't a docking port, or the active vessel has no free port).</summary>
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

        /// <summary>The <c>vessel.surface</c> channel: see <see cref="VesselSurface"/>'s class doc comment. Null whenever <c>Gonogo.KSP.KspHost.BuildSurface</c> omitted the raw group (no reference body yet, or the vessel is orbiting/escaping -- not near any surface).</summary>
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

        /// <summary>The <c>vessel.landing</c> channel: see <see cref="VesselLanding"/>'s class doc comment. Null whenever <c>Gonogo.KSP.KspHost.BuildLanding</c> omitted the raw group (the relevance gate is closed: not descending toward a solid, PQS-backed surface). A trivial copy: the atmosphere maths already ran source-side (<see cref="LandingModel"/>) and its scalar results are on the raw group; terrain fields fill in as the PQS sampler lands.</summary>
        public static VesselLanding? BuildLanding(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!TryGetGroup(vessel, "landing", out var landing))
            {
                return null;
            }

            return new VesselLanding
            {
                Outcome = GetString(landing, "outcome"),
                SampleSource = GetString(landing, "sampleSource"),
                TerrainElevationUnderVessel = GetDouble(landing, "terrainElevationUnderVessel"),
                SlopeAngleUnderVessel = GetDouble(landing, "slopeAngleUnderVessel"),
                PredictedLatitude = GetDouble(landing, "predictedLatitude"),
                PredictedLongitude = GetDouble(landing, "predictedLongitude"),
                PredictedTerrainElevation = GetDouble(landing, "predictedTerrainElevation"),
                PredictedSlopeAngle = GetDouble(landing, "predictedSlopeAngle"),
                PredictedSlopeHeading = GetDouble(landing, "predictedSlopeHeading"),
                PredictedRoughness = GetDouble(landing, "predictedRoughness"),
                RoughnessFootprintMeters = GetDouble(landing, "roughnessFootprintMeters"),
                SlopeSampleRadiusMeters = GetDouble(landing, "slopeSampleRadiusMeters"),
                PredictedBiome = GetString(landing, "predictedBiome"),
                TerrainPatchSize = GetInt(landing, "terrainPatchSize"),
                TerrainPatchExtentMeters = GetDouble(landing, "terrainPatchExtentMeters"),
                TerminalVelocity = GetDouble(landing, "terminalVelocity"),
                ProjectedTouchdownSpeed = GetDouble(landing, "projectedTouchdownSpeed"),
                AtmosphericTimeToImpact = GetDouble(landing, "atmosphericTimeToImpact"),
                DescentRegime = GetString(landing, "descentRegime"),
                ParachuteState = GetString(landing, "parachuteState"),
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
        /// The <c>time.calendar</c> channel: how long a day and a year are in
        /// the running game.
        ///
        /// <para>Global game state, same as <see cref="BuildWarp"/> and for
        /// the same reason: it has no vessel, and a consumer needs it in every
        /// scene. It reads from the same <c>time</c> group, so it is present
        /// exactly when warp is.</para>
        ///
        /// <para>A missing or non-positive day or year is treated as no
        /// payload rather than published: a consumer dividing by a zero
        /// day-length would render every duration as infinity, which is worse
        /// than falling back to the stock calendar it already assumes. See
        /// <see cref="TimeCalendar"/> for why the channel exists at
        /// all.</para>
        /// </summary>
        public static TimeCalendar? BuildCalendar(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null || !TryGetGroup(snapshot.Values, "time", out var time))
            {
                return null;
            }

            var minute = GetDouble(time, "minuteSeconds");
            var hour = GetDouble(time, "hourSeconds");
            var day = GetDouble(time, "daySeconds");
            var year = GetDouble(time, "yearSeconds");
            var kerbinTime = GetBool(time, "kerbinTime");

            if (!minute.HasValue || !hour.HasValue || !day.HasValue || !year.HasValue)
            {
                return null;
            }

            if (minute.Value <= 0 || hour.Value <= 0 || day.Value <= 0 || year.Value <= 0)
            {
                return null;
            }

            return new TimeCalendar
            {
                MinuteSeconds = minute.Value,
                HourSeconds = hour.Value,
                DaySeconds = day.Value,
                YearSeconds = year.Value,
                KerbinTime = kerbinTime ?? true,
                Meta = BuildGameMeta(),
            };
        }

        public static object? BuildCalendarWire(KspSnapshot? snapshot) =>
            BuildCalendar(snapshot) is { } calendar ? ToWire(calendar) : null;

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

        public static object? BuildLandingWire(KspSnapshot? snapshot) =>
            BuildLanding(snapshot) is { } landing ? ToWire(landing) : null;

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
            // Never conditional, unlike `encounter`: the horizon is not nullable
            // and an omitted one would decode as "nobody said", which the client
            // gate treats as unpropagatable. Correct as a fail-safe, wrong as a
            // routine state.
            ["horizon"] = ToWire(orbit.Horizon),
            ["meta"] = ToWire(orbit.Meta),
        };

        private static Dictionary<string, object?> ToWire(OrbitEncounter encounter) => new Dictionary<string, object?>
        {
            ["transitionType"] = (int)encounter.TransitionType,
            ["transitionUt"] = encounter.TransitionUt,
            ["bodyIndex"] = encounter.BodyIndex,
        };

        private static Dictionary<string, object?> ToWire(PropagationHorizon horizon) => new Dictionary<string, object?>
        {
            ["kind"] = (int)horizon.Kind,
            ["trajectoryKind"] = (int)horizon.TrajectoryKind,
            ["untilUt"] = horizon.UntilUt,
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
            ["mu"] = patch.Mu,
            ["referenceBodyIndex"] = patch.ReferenceBodyIndex,
            ["closestEncounterBodyIndex"] = patch.ClosestEncounterBodyIndex,
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
            ["heatShieldTemp"] = thermal.HeatShieldTemp,
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
            // The fly-by-wire axis ECHOES. They exist so the operator watches a
            // delayed axis command ARRIVE, exactly as the throttle channel does,
            // which cannot happen while they are read off the vessel and then
            // dropped on the way to the wire.
            ["pitch"] = control.Pitch,
            ["yaw"] = control.Yaw,
            ["roll"] = control.Roll,
            ["translationX"] = control.TranslationX,
            ["translationY"] = control.TranslationY,
            ["translationZ"] = control.TranslationZ,
            ["actionGroups"] = control.ActionGroups?.Select(g => (object?)ToWire(g)).ToList(),
            ["meta"] = ToWire(control.Meta),
        };

        private static Dictionary<string, object?> ToWire(ActionGroupState group) => new Dictionary<string, object?>
        {
            ["index"] = group.Index,
            ["name"] = group.Name,
            ["state"] = group.State,
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
            // Both latches. BuildPropulsion set them and this dropped them, so
            // they were mapped, serialised away, and read as undefined forever
            // on the client. Caught by the every-property-reaches-the-wire
            // ratchet, which is exactly the defect it exists for.
            ["thrustStartedUt"] = propulsion.ThrustStartedUt,
            ["lastThrustEndUt"] = propulsion.LastThrustEndUt,
            ["meta"] = ToWire(propulsion.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselManeuver maneuver) => new Dictionary<string, object?>
        {
            ["nodes"] = maneuver.Nodes.Select(n => (object?)ToWire(n)).ToList(),
            ["planner"] = maneuver.Planner,
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
            ["ignitionUt"] = node.IgnitionUt,
            ["cutoffUt"] = node.CutoffUt,
            ["frame"] = node.Frame == null ? null : (object)(int)node.Frame.Value,
            ["patches"] = node.Patches.Select(p => (object?)ToWire(p)).ToList(),
        };

        private static Dictionary<string, object?> ToWire(VesselTarget target) => new Dictionary<string, object?>
        {
            ["name"] = target.Name,
            ["kind"] = (int)target.Kind,
            ["vesselId"] = target.VesselId,
            ["bodyIndex"] = target.BodyIndex,
            ["partId"] = target.PartId,
            ["relativePosition"] = target.RelativePosition != null ? ToWire(target.RelativePosition) : null,
            ["relativeVelocity"] = target.RelativeVelocity != null ? ToWire(target.RelativeVelocity) : null,
            ["orbit"] = target.Orbit != null ? ToWire(target.Orbit) : null,
            ["closestApproach"] = target.ClosestApproach != null ? ToWire(target.ClosestApproach) : null,
            ["meta"] = ToWire(target.Meta),
        };

        private static Dictionary<string, object?> ToWire(ClosestApproach ca) => new Dictionary<string, object?>
        {
            ["time"] = ca.Time,
            ["distance"] = ca.Distance,
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

        private static Dictionary<string, object?> ToWire(VesselLanding landing) => new Dictionary<string, object?>
        {
            ["outcome"] = landing.Outcome,
            ["sampleSource"] = landing.SampleSource,
            ["terrainElevationUnderVessel"] = landing.TerrainElevationUnderVessel,
            ["slopeAngleUnderVessel"] = landing.SlopeAngleUnderVessel,
            ["predictedLatitude"] = landing.PredictedLatitude,
            ["predictedLongitude"] = landing.PredictedLongitude,
            ["predictedTerrainElevation"] = landing.PredictedTerrainElevation,
            ["predictedSlopeAngle"] = landing.PredictedSlopeAngle,
            ["predictedSlopeHeading"] = landing.PredictedSlopeHeading,
            ["predictedRoughness"] = landing.PredictedRoughness,
            ["roughnessFootprintMeters"] = landing.RoughnessFootprintMeters,
            ["slopeSampleRadiusMeters"] = landing.SlopeSampleRadiusMeters,
            ["predictedBiome"] = landing.PredictedBiome,
            ["terrainPatch"] = landing.TerrainPatch,
            ["terrainPatchSize"] = landing.TerrainPatchSize,
            ["terrainPatchExtentMeters"] = landing.TerrainPatchExtentMeters,
            ["terminalVelocity"] = landing.TerminalVelocity,
            ["projectedTouchdownSpeed"] = landing.ProjectedTouchdownSpeed,
            ["atmosphericTimeToImpact"] = landing.AtmosphericTimeToImpact,
            ["descentRegime"] = landing.DescentRegime,
            ["parachuteState"] = landing.ParachuteState,
            ["meta"] = ToWire(landing.Meta),
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

        private static Dictionary<string, object?> ToWire(TimeCalendar calendar) => new Dictionary<string, object?>
        {
            ["minuteSeconds"] = calendar.MinuteSeconds,
            ["hourSeconds"] = calendar.HourSeconds,
            ["daySeconds"] = calendar.DaySeconds,
            ["yearSeconds"] = calendar.YearSeconds,
            ["kerbinTime"] = calendar.KerbinTime,
            ["meta"] = ToWire(calendar.Meta),
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
        // hand-rolled switches: case-insensitive as the originals were, Unknown
        // fallback: and NO code path resolves a Contract enum's attributes.

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

        /// <summary>
        /// Null for an ABSENT frame, which is a node off a recording captured
        /// before the field existed, and <see cref="ManeuverFrame.Unknown"/>
        /// for a present but unrecognised one. Those are different facts:
        /// absent means nobody said, unknown means somebody said something we
        /// do not model, and only the second is a reason to distrust the
        /// components.
        /// </summary>
        private static ManeuverFrame? ParseManeuverFrame(string? raw)
        {
            if (raw == null)
            {
                return null;
            }
            return raw.ToLowerInvariant() switch
            {
                "radialnormalprograde" => ManeuverFrame.RadialNormalPrograde,
                "tangentnormalbinormal" => ManeuverFrame.TangentNormalBinormal,
                _ => ManeuverFrame.Unknown,
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
            if (raw == "Part")
            {
                // A part target -- in practice a docking port. The producer
                // (KspHost.BuildTarget) emits the literal "Part" for any
                // ITargetable PartModule so it is not mistaken for a vessel
                // (GetVessel() returns the OWNING vessel, whose vesselType
                // would otherwise classify the port as a Vessel).
                return TargetKind.Part;
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
