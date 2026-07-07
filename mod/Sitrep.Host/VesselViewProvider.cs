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
    /// extension. See local_docs/telemetry-mod/m1-provider-taxonomy-design.md
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
    /// poisoned payload and fail-soft the WHOLE extension (see
    /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests.
    /// GenuinelyUnserializablePayloadFailsSoftTheOwningExtensionInsteadOfRecurringSilently</c>,
    /// which deliberately pins that behavior for a genuinely-unrecognized
    /// type). Rather than widen <c>JsonWriter</c> itself — a shared,
    /// widely-depended-on class where doing so would blur that intentional
    /// safety net — each payload type gets a small, explicit
    /// <c>ToWire</c> flattening into the same
    /// <c>Dictionary&lt;string, object?&gt;</c> tree shape
    /// <c>SystemViewProvider.BuildSystemBodies</c> already uses. The
    /// <c>Build*Wire</c> methods (typed mapper + flatten) are what
    /// <c>VesselExtension.Register</c> actually hands to
    /// <c>IExtensionHost.AddChannelSource</c>; the plain <c>Build*</c> methods
    /// are the typed logic itself, exercised directly by unit/replay
    /// tests.</para>
    /// </summary>
    public static class VesselViewProvider
    {
        public const string IdentityTopic = "vessel.identity";
        public const string OrbitTopic = "vessel.orbit";
        public const string OrbitTruthTopic = "vessel.orbit.truth";
        public const string FlightTopic = "vessel.flight";

        /// <summary>All four M1 vessel topics — shared by <see cref="Gonogo.KSP.VesselExtension"/>'s manifest (in Gonogo.KSP) and <see cref="VesselEpochSampler"/>'s force-keyframe fan-out.</summary>
        public static readonly IReadOnlyList<string> Topics = new[] { IdentityTopic, OrbitTopic, OrbitTruthTopic, FlightTopic };

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
                Meta = BuildMeta(vesselId!, snapshot!.Ut),
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

            var referenceBodyIndex = ResolveBodyIndex(snapshot!, referenceBodyName);
            if (referenceBodyIndex == null)
            {
                return null;
            }

            OrbitEncounter? encounter = null;
            if (TryGetGroup(orbit, "encounter", out var rawEncounter))
            {
                var transitionUt = GetDouble(rawEncounter, "transitionUt");
                if (transitionUt.HasValue)
                {
                    int? encounterBodyIndex = null;
                    var encounterBodyName = GetString(rawEncounter, "body");
                    if (encounterBodyName != null)
                    {
                        encounterBodyIndex = ResolveBodyIndex(snapshot!, encounterBodyName);
                    }

                    encounter = new OrbitEncounter
                    {
                        TransitionType = ParseTransitionType(GetString(rawEncounter, "transitionType")),
                        TransitionUt = transitionUt.Value,
                        BodyIndex = encounterBodyIndex,
                    };
                }
            }

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
                Meta = BuildMeta(vesselId, snapshot!.Ut),
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
                Meta = BuildMeta(vesselId, snapshot!.Ut),
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

            if (!latitude.HasValue || !longitude.HasValue || !altitudeAsl.HasValue ||
                !altitudeTerrain.HasValue || !verticalSpeed.HasValue || !surfaceSpeed.HasValue ||
                !orbitalSpeed.HasValue || !gForce.HasValue || !dynamicPressure.HasValue ||
                !mach.HasValue || !atmDensity.HasValue)
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
                Meta = BuildMeta(vesselId, snapshot!.Ut),
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
            ["meta"] = ToWire(orbit.Meta),
        };

        private static Dictionary<string, object?> ToWire(OrbitEncounter encounter) => new Dictionary<string, object?>
        {
            ["transitionType"] = (int)encounter.TransitionType,
            ["transitionUt"] = encounter.TransitionUt,
            ["bodyIndex"] = encounter.BodyIndex,
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
            ["meta"] = ToWire(flight.Meta),
        };

        private static Dictionary<string, object?> ToWire(Meta meta) => new Dictionary<string, object?>
        {
            ["source"] = meta.Source,
            ["validAt"] = meta.ValidAt,
            ["seq"] = meta.Seq,
            ["deliveredAt"] = meta.DeliveredAt,
            ["vantage"] = meta.Vantage,
            ["quality"] = (int)meta.Quality,
            ["active"] = meta.Active,
            ["staleness"] = (int)meta.Staleness,
            ["confidence"] = meta.Confidence,
        };

        // ----------------------------------------------------------------
        // Shared helpers
        // ----------------------------------------------------------------

        private static Meta BuildMeta(string vesselId, double ut)
        {
            return new Meta
            {
                Source = "vessel:" + vesselId,
                ValidAt = ut,
                // Quality defaults to OnRails -- KspHost doesn't yet capture
                // the vessel's packed/loaded (on-rails vs off-rails) state
                // (a future capture addition), so this is a documented,
                // deliberate simplification for M1 Task 1, not a silent
                // "always trust conics" claim. Off-rails detection is scoped
                // to whichever future task wires up physicsMode/packed
                // capture (mirrors O-2's "deliberately deferred" ruling in
                // the taxonomy design doc).
                Quality = Quality.OnRails,
                Active = true,
                Staleness = Staleness.Fresh,
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
        private static int? ResolveBodyIndex(KspSnapshot snapshot, string bodyName)
        {
            if (!snapshot.Values.TryGetValue("bodies", out var rawBodies) || rawBodies is not IEnumerable<object?> list)
            {
                return null;
            }

            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> body && GetString(body, "name") == bodyName)
                {
                    var index = GetInt(body, "index");
                    if (index.HasValue)
                    {
                        return index.Value;
                    }
                }
            }
            return null;
        }

        private static Situation ParseSituation(string? raw)
        {
            return raw switch
            {
                "LANDED" => Situation.Landed,
                "SPLASHED" => Situation.Splashed,
                "PRELAUNCH" => Situation.PreLaunch,
                "ORBITING" => Situation.Orbiting,
                "ESCAPING" => Situation.Escaping,
                "FLYING" => Situation.Flying,
                "SUB_ORBITAL" => Situation.SubOrbital,
                "DOCKED" => Situation.Docked,
                _ => Situation.Unknown,
            };
        }

        private static VesselType ParseVesselType(string? raw)
        {
            return raw != null && Enum.TryParse<VesselType>(raw, ignoreCase: true, out var parsed)
                ? parsed
                : VesselType.Unknown;
        }

        private static TransitionType ParseTransitionType(string? raw)
        {
            return raw != null && Enum.TryParse<TransitionType>(raw, ignoreCase: true, out var parsed)
                ? parsed
                : TransitionType.Unknown;
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
