using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="VesselViewProvider"/>'s four M1 core
    /// mappers against synthetic <c>Values["vessel"]</c> dicts shaped
    /// exactly like <c>Gonogo.KSP.KspHost.BuildVesselEntry</c>'s raw
    /// capture. Covers the wart-fixes (O-1/O-9/V-10/V-12/V-13), the
    /// three-typed-absence discipline (present -&gt; typed POCO; absent
    /// group -&gt; null field/channel, never a sentinel), subject
    /// provenance (<c>meta.source</c>), and the wire-adapter's real
    /// serialization path.
    /// </summary>
    public class VesselViewProviderTests
    {
        private const string VesselGuid = "11111111-2222-3333-4444-555555555555";

        // ----------------------------------------------------------------
        // No active vessel -- every channel guards to null, not a sentinel.
        // ----------------------------------------------------------------

        [Fact]
        public void AllFourChannelsReturnNullWhenSnapshotHasNoVesselKey()
        {
            var snapshot = new KspSnapshot { Ut = 100.0, Values = new Dictionary<string, object?>() };

            Assert.Null(VesselViewProvider.BuildIdentity(snapshot));
            Assert.Null(VesselViewProvider.BuildOrbit(snapshot));
            Assert.Null(VesselViewProvider.BuildOrbitTruth(snapshot));
            Assert.Null(VesselViewProvider.BuildFlight(snapshot));
            Assert.Null(VesselViewProvider.TryGetActiveVesselId(snapshot));
        }

        [Fact]
        public void AllFourChannelsReturnNullWhenIdentityGroupIsMissing()
        {
            // "vessel" key present but its "identity" sub-group failed to
            // build (KspHost.TryBuildGroup omits it on exception) -- no
            // subject id means no channel can be attributed.
            var snapshot = new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["flight"] = new Dictionary<string, object?> { ["latitude"] = 1.0 },
                    },
                },
            };

            Assert.Null(VesselViewProvider.BuildIdentity(snapshot));
            Assert.Null(VesselViewProvider.BuildOrbit(snapshot));
            Assert.Null(VesselViewProvider.BuildOrbitTruth(snapshot));
            Assert.Null(VesselViewProvider.BuildFlight(snapshot));
        }

        // ----------------------------------------------------------------
        // vessel.identity
        // ----------------------------------------------------------------

        [Fact]
        public void BuildIdentityMapsRawGroupToTypedRecordWithResolvedParentBodyIndexAndDerivedLaunchUt()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?>
                {
                    ["id"] = VesselGuid,
                    ["name"] = "Kerbal X",
                    ["vesselType"] = "Ship",
                    ["situation"] = "ORBITING",
                    ["parentBody"] = "Kerbin",
                },
                flight: new Dictionary<string, object?> { ["missionTime"] = 40.0 },
                bodies: KerbinAndMun());
            snapshot.Ut = 140.0;

            var identity = VesselViewProvider.BuildIdentity(snapshot);

            Assert.NotNull(identity);
            Assert.Equal(VesselGuid, identity!.VesselId);
            Assert.Equal("Kerbal X", identity.Name);
            Assert.Equal(VesselType.Ship, identity.VesselType);
            Assert.Equal(Situation.Orbiting, identity.Situation);
            Assert.Equal(1, identity.ParentBodyIndex); // Kerbin resolved to its bodies-list index
            Assert.Equal(100.0, identity.LaunchUt); // sampleUt(140) - missionTime(40)
            Assert.Equal("vessel:" + VesselGuid, identity.Meta.Source);
            Assert.Equal(Quality.OnRails, identity.Meta.Quality);
            Assert.Equal(140.0, identity.Meta.ValidAt);
        }

        [Fact]
        public void BuildIdentityLeavesParentBodyIndexAndLaunchUtNullWhenTheirInputsAreAbsent()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid, ["name"] = "EVA Kerbal", ["vesselType"] = "EVA", ["situation"] = "FLYING" },
                flight: null,
                bodies: null);

            var identity = VesselViewProvider.BuildIdentity(snapshot);

            Assert.NotNull(identity);
            Assert.Null(identity!.ParentBodyIndex); // no parentBody / no bodies list -> null, not -1
            Assert.Null(identity.LaunchUt); // no missionTime -> null, not 0
            Assert.Equal(VesselType.EVA, identity.VesselType);
            Assert.Equal(Situation.Flying, identity.Situation);
        }

        [Fact]
        public void BuildIdentityFallsBackToUnknownForUnrecognizedRawEnumStrings()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid, ["vesselType"] = "SomeFutureType", ["situation"] = "SOME_FUTURE_SITUATION" },
                flight: null,
                bodies: null);

            var identity = VesselViewProvider.BuildIdentity(snapshot);

            Assert.Equal(VesselType.Unknown, identity!.VesselType);
            Assert.Equal(Situation.Unknown, identity.Situation);
        }

        // ----------------------------------------------------------------
        // vessel.orbit
        // ----------------------------------------------------------------

        [Fact]
        public void BuildOrbitMapsRawElementsWithNoEccentricAnomalyFieldAndNullEncounterByDefault()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["sma"] = 700_000.0,
                    ["ecc"] = 0.01,
                    ["inc"] = 5.0,
                    ["lan"] = 10.0,
                    ["argPe"] = 20.0,
                    ["meanAnomalyAtEpoch"] = 1.2,
                    ["epoch"] = 90.0,
                    ["mu"] = 3.5316e12,
                    ["referenceBody"] = "Kerbin",
                    ["encounter"] = null,
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit);
            Assert.Equal(1, orbit!.ReferenceBodyIndex);
            Assert.Equal(700_000.0, orbit.Sma);
            Assert.Equal(0.01, orbit.Ecc);
            Assert.Equal(5.0, orbit.Inc);
            Assert.Equal(10.0, orbit.Lan);
            Assert.Equal(20.0, orbit.ArgPe);
            Assert.Equal(1.2, orbit.MeanAnomalyAtEpoch);
            Assert.Equal(90.0, orbit.Epoch);
            Assert.Equal(3.5316e12, orbit.Mu);
            Assert.Null(orbit.Encounter);
            Assert.Equal("vessel:" + VesselGuid, orbit.Meta.Source);

            // O-1: structurally impossible for VesselOrbit to carry an
            // eccentricAnomaly field -- prove it doesn't leak through the
            // REAL wire-serialization path either.
            var wire = VesselViewProvider.BuildOrbitWire(snapshot);
            var streamData = new Sitrep.Contract.StreamData<object?>
            {
                Topic = VesselViewProvider.OrbitTopic,
                Payload = wire,
                Meta = new Meta { Source = "vessel", ValidAt = 0, Vantage = "host", Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            Assert.DoesNotContain("eccentricAnomaly", json);
            Assert.Contains("\"sma\":700000", json);
        }

        [Fact]
        public void BuildOrbitMapsAPresentEncounterToATypedRecord()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["sma"] = 700_000.0,
                    ["ecc"] = 0.01,
                    ["inc"] = 0.0,
                    ["lan"] = 0.0,
                    ["argPe"] = 0.0,
                    ["meanAnomalyAtEpoch"] = 0.0,
                    ["epoch"] = 0.0,
                    ["mu"] = 3.5316e12,
                    ["referenceBody"] = "Kerbin",
                    ["encounter"] = new Dictionary<string, object?>
                    {
                        ["transitionType"] = "ENCOUNTER",
                        ["transitionUt"] = 12345.0,
                        ["body"] = "Mun",
                    },
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit!.Encounter);
            Assert.Equal(TransitionType.Encounter, orbit.Encounter!.TransitionType);
            Assert.Equal(12345.0, orbit.Encounter.TransitionUt);
            Assert.Equal(2, orbit.Encounter.BodyIndex); // Mun resolved
        }

        [Fact]
        public void BuildOrbitReturnsNullWhenOrbitGroupIsExplicitlyNullNoOrbitDriver()
        {
            // Mirrors KspHost.TryBuildGroup's real shape for "no orbit
            // driver" (e.g. a just-spawned EVA): the "orbit" KEY is present
            // on the vessel dict, but its VALUE is null -- distinct from the
            // key being absent entirely, though BuildOrbit treats both the
            // same way (R1: absence is absence, however it's spelled).
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?> { ["id"] = VesselGuid },
                        ["orbit"] = null,
                    },
                    ["bodies"] = KerbinAndMun(),
                },
            };

            Assert.Null(VesselViewProvider.BuildOrbit(snapshot));
        }

        [Fact]
        public void BuildOrbitTreatsNonFiniteLanAndArgPeAsAbsentNotAsNaNOnTheWire()
        {
            // Routine, not edge: KSP's Orbit.LAN is NaN for a near-equatorial
            // orbit (inc ~ 0) and argumentOfPeriapsis is NaN for a
            // near-circular orbit (ecc ~ 0) -- both happen on ordinary
            // launches. R1/F-1: a non-finite value in the mapper is a bug,
            // never a wire value -- it must surface as an absent (null)
            // field, NOT gate the whole vessel.orbit record to null (an
            // equatorial-circular orbit is still a perfectly valid orbit).
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["sma"] = 700_000.0,
                    ["ecc"] = 0.0,
                    ["inc"] = 0.0,
                    ["lan"] = double.NaN,
                    ["argPe"] = double.NaN,
                    ["meanAnomalyAtEpoch"] = 1.2,
                    ["epoch"] = 90.0,
                    ["mu"] = 3.5316e12,
                    ["referenceBody"] = "Kerbin",
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit); // NOT gated to null just because lan/argPe are undefined
            Assert.Null(orbit!.Lan); // undefined ascending node -> null, never NaN or 0
            Assert.Null(orbit.ArgPe); // undefined periapsis -> null, never NaN or 0
            Assert.Equal(700_000.0, orbit.Sma); // the rest of the record is unaffected

            // Prove it holds through the REAL wire-serialization path too --
            // a bare NaN token isn't valid JSON, and a stringified "NaN"
            // would poison a numeric field.
            var wire = VesselViewProvider.BuildOrbitWire(snapshot);
            var streamData = new Sitrep.Contract.StreamData<object?>
            {
                Topic = VesselViewProvider.OrbitTopic,
                Payload = wire,
                Meta = new Meta { Source = "vessel", ValidAt = 0, Vantage = "host", Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            Assert.DoesNotContain("NaN", json);
            Assert.DoesNotContain("Infinity", json);
            Assert.Contains("\"lan\":null", json);
            Assert.Contains("\"argPe\":null", json);
        }

        [Fact]
        public void BuildOrbitTreatsInfiniteScalarsAsAbsentToo()
        {
            // Same rule (R1/F-1) applied to +/-Infinity, not just NaN --
            // GetDouble's non-finite check must cover both.
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["sma"] = 700_000.0,
                    ["ecc"] = 0.0,
                    ["inc"] = 0.0,
                    ["lan"] = double.PositiveInfinity,
                    ["argPe"] = double.NegativeInfinity,
                    ["meanAnomalyAtEpoch"] = 1.2,
                    ["epoch"] = 90.0,
                    ["mu"] = 3.5316e12,
                    ["referenceBody"] = "Kerbin",
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit);
            Assert.Null(orbit!.Lan);
            Assert.Null(orbit.ArgPe);
        }

        [Fact]
        public void BuildOrbitReturnsNullWhenReferenceBodyCannotBeResolved()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["sma"] = 1.0,
                    ["ecc"] = 0.0,
                    ["inc"] = 0.0,
                    ["lan"] = 0.0,
                    ["argPe"] = 0.0,
                    ["meanAnomalyAtEpoch"] = 0.0,
                    ["epoch"] = 0.0,
                    ["mu"] = 1.0,
                    ["referenceBody"] = "NotInBodiesList",
                },
                bodies: KerbinAndMun());

            Assert.Null(VesselViewProvider.BuildOrbit(snapshot));
        }

        // ----------------------------------------------------------------
        // vessel.orbit.truth
        // ----------------------------------------------------------------

        [Fact]
        public void BuildOrbitTruthMapsTruthVectorsAndFrameFlag()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>
                {
                    ["truthPosition"] = new[] { 1.0, 2.0, 3.0 },
                    ["truthVelocity"] = new[] { 4.0, 5.0, 6.0 },
                    ["truthFrameRotating"] = true,
                },
                bodies: null);

            var truth = VesselViewProvider.BuildOrbitTruth(snapshot);

            Assert.NotNull(truth);
            Assert.Equal(1.0, truth!.Position.X);
            Assert.Equal(2.0, truth.Position.Y);
            Assert.Equal(3.0, truth.Position.Z);
            Assert.Equal(4.0, truth.Velocity.X);
            Assert.True(truth.FrameRotating);
            Assert.Equal("vessel:" + VesselGuid, truth.Meta.Source);
        }

        [Fact]
        public void BuildOrbitTruthReturnsNullWhenVectorsAreMissing()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                orbit: new Dictionary<string, object?>(),
                bodies: null);

            Assert.Null(VesselViewProvider.BuildOrbitTruth(snapshot));
        }

        // ----------------------------------------------------------------
        // vessel.flight
        // ----------------------------------------------------------------

        [Fact]
        public void BuildFlightMapsAllMeasurementsAndRenamesDynamicPressureToKPaSuffixed()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                flight: new Dictionary<string, object?>
                {
                    ["latitude"] = -0.05,
                    ["longitude"] = 179.9,
                    ["altitudeAsl"] = 71000.0,
                    ["altitudeTerrain"] = 70500.0,
                    ["verticalSpeed"] = 12.5,
                    ["surfaceSpeed"] = 2200.0,
                    ["orbitalSpeed"] = 2300.0,
                    ["gForce"] = 1.1,
                    ["dynamicPressure"] = 3.4,
                    ["mach"] = 6.2,
                    ["atmDensity"] = 0.02,
                    ["missionTime"] = 400.0,
                });

            var flight = VesselViewProvider.BuildFlight(snapshot);

            Assert.NotNull(flight);
            Assert.Equal(-0.05, flight!.Latitude);
            Assert.Equal(179.9, flight.Longitude);
            Assert.Equal(3.4, flight.DynamicPressureKPa);
            Assert.Equal("vessel:" + VesselGuid, flight.Meta.Source);
        }

        [Fact]
        public void BuildFlightReturnsNullWhenFlightGroupIsMissing()
        {
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildFlight(snapshot));
        }

        [Fact]
        public void BuildFlightReturnsNullOnAnyMissingRequiredMeasurementRatherThanAPartialRecord()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                flight: new Dictionary<string, object?>
                {
                    ["latitude"] = 0.0,
                    // longitude deliberately missing
                    ["altitudeAsl"] = 1.0,
                    ["altitudeTerrain"] = 1.0,
                    ["verticalSpeed"] = 1.0,
                    ["surfaceSpeed"] = 1.0,
                    ["orbitalSpeed"] = 1.0,
                    ["gForce"] = 1.0,
                    ["dynamicPressure"] = 1.0,
                    ["mach"] = 1.0,
                    ["atmDensity"] = 1.0,
                });

            Assert.Null(VesselViewProvider.BuildFlight(snapshot));
        }

        // ----------------------------------------------------------------
        // ParseSituation -- table-driven over EVERY raw string the private
        // switch handles, so a typo'd literal (which would silently degrade
        // to Situation.Unknown) can't hide untested. Exercised through the
        // public BuildIdentity surface since ParseSituation itself is
        // private.
        // ----------------------------------------------------------------

        public static IEnumerable<object?[]> SituationCases()
        {
            yield return new object?[] { "LANDED", Situation.Landed };
            yield return new object?[] { "SPLASHED", Situation.Splashed };
            yield return new object?[] { "PRELAUNCH", Situation.PreLaunch };
            yield return new object?[] { "ORBITING", Situation.Orbiting };
            yield return new object?[] { "ESCAPING", Situation.Escaping };
            yield return new object?[] { "FLYING", Situation.Flying };
            yield return new object?[] { "SUB_ORBITAL", Situation.SubOrbital };
            yield return new object?[] { "DOCKED", Situation.Docked };
            yield return new object?[] { "SOME_TYPO_OR_FUTURE_VALUE", Situation.Unknown };
            yield return new object?[] { null, Situation.Unknown };
        }

        [Theory]
        [MemberData(nameof(SituationCases))]
        public void BuildIdentityMapsEveryRawSituationStringToItsTypedEnumValue(string? raw, Situation expected)
        {
            var identityGroup = new Dictionary<string, object?> { ["id"] = VesselGuid };
            if (raw != null)
            {
                identityGroup["situation"] = raw;
            }
            var snapshot = SnapshotWith(identity: identityGroup);

            var identity = VesselViewProvider.BuildIdentity(snapshot);

            Assert.Equal(expected, identity!.Situation);
        }

        // ----------------------------------------------------------------
        // Fix 2: POCO <-> ToWire drift guard. Reflection-based so a future
        // POCO field added without updating the corresponding private
        // ToWire(...) flattening method fails LOUDLY here instead of
        // silently vanishing off the wire -- see VesselViewProvider's class
        // doc comment on why ToWire exists at all (JsonWriter can't
        // serialize an arbitrary POCO directly).
        // ----------------------------------------------------------------

        public static IEnumerable<object[]> PocoToWireFixtures()
        {
            var meta = new Meta
            {
                Source = "vessel:" + VesselGuid,
                ValidAt = 100.0,
                Seq = 7,
                DeliveredAt = 101.0,
                Vantage = "host",
                Quality = Quality.Loaded,
                Active = true,
                Staleness = Staleness.HeldStale,
                Confidence = 0.5,
            };

            yield return new object[]
            {
                new VesselIdentity
                {
                    VesselId = VesselGuid,
                    Name = "Kerbal X",
                    VesselType = VesselType.Ship,
                    Situation = Situation.Orbiting,
                    ParentBodyIndex = 1,
                    LaunchUt = 40.0,
                    Meta = meta,
                },
            };

            yield return new object[]
            {
                new VesselOrbit
                {
                    ReferenceBodyIndex = 1,
                    Sma = 700_000.0,
                    Ecc = 0.01,
                    Inc = 5.0,
                    Lan = 10.0,
                    ArgPe = 20.0,
                    MeanAnomalyAtEpoch = 1.2,
                    Epoch = 90.0,
                    Mu = 3.5316e12,
                    Encounter = new OrbitEncounter { TransitionType = TransitionType.Encounter, TransitionUt = 12345.0, BodyIndex = 2 },
                    Meta = meta,
                },
            };

            yield return new object[]
            {
                new OrbitEncounter { TransitionType = TransitionType.Encounter, TransitionUt = 12345.0, BodyIndex = 2 },
            };

            yield return new object[]
            {
                new VesselOrbitTruth
                {
                    Position = new Vec3(1, 2, 3),
                    Velocity = new Vec3(4, 5, 6),
                    FrameRotating = true,
                    Meta = meta,
                },
            };

            yield return new object[]
            {
                new VesselFlight
                {
                    Latitude = -0.05,
                    Longitude = 179.9,
                    AltitudeAsl = 71000.0,
                    AltitudeTerrain = 70500.0,
                    VerticalSpeed = 12.5,
                    SurfaceSpeed = 2200.0,
                    OrbitalSpeed = 2300.0,
                    GForce = 1.1,
                    DynamicPressureKPa = 3.4,
                    Mach = 6.2,
                    AtmDensity = 0.02,
                    Meta = meta,
                },
            };

            yield return new object[] { new Vec3(1, 2, 3) };

            yield return new object[] { meta };
        }

        [Theory]
        [MemberData(nameof(PocoToWireFixtures))]
        public void ToWireIncludesAKeyForEveryPublicReadablePropertyOfThePoco(object pocoInstance)
        {
            var pocoType = pocoInstance.GetType();

            var toWireMethod = typeof(VesselViewProvider).GetMethod(
                "ToWire",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static,
                binder: null,
                types: new[] { pocoType },
                modifiers: null);

            Assert.True(toWireMethod != null, $"VesselViewProvider has no private static ToWire({pocoType.Name}) overload -- either it was renamed/removed, or this test fixture needs updating.");

            var wire = toWireMethod!.Invoke(null, new[] { pocoInstance }) as IDictionary<string, object?>;
            Assert.NotNull(wire);

            var properties = pocoType.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            Assert.NotEmpty(properties);

            foreach (var property in properties)
            {
                if (!property.CanRead)
                {
                    continue;
                }

                var wireKey = char.ToLowerInvariant(property.Name[0]) + property.Name.Substring(1);
                Assert.True(
                    wire!.ContainsKey(wireKey),
                    $"{pocoType.Name}.{property.Name} has no corresponding \"{wireKey}\" key in ToWire's output -- a POCO field was added without wiring it onto the wire.");
            }
        }

        // ----------------------------------------------------------------
        // helpers
        // ----------------------------------------------------------------

        private static List<object?> KerbinAndMun() => new List<object?>
        {
            new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
            new Dictionary<string, object?> { ["name"] = "Mun", ["index"] = 2 },
        };

        private static KspSnapshot SnapshotWith(
            Dictionary<string, object?>? identity = null,
            Dictionary<string, object?>? flight = null,
            Dictionary<string, object?>? orbit = null,
            List<object?>? bodies = null)
        {
            var vessel = new Dictionary<string, object?>();
            if (identity != null)
            {
                vessel["identity"] = identity;
            }
            if (flight != null)
            {
                vessel["flight"] = flight;
            }
            if (orbit != null)
            {
                vessel["orbit"] = orbit;
            }

            var values = new Dictionary<string, object?> { ["vessel"] = vessel };
            if (bodies != null)
            {
                values["bodies"] = bodies;
            }

            return new KspSnapshot { Ut = 0.0, Values = values };
        }
    }
}
