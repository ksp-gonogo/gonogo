using System.Collections.Generic;
using System.Linq;
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
            // NOTE: no ValidAt assertion here (Fix C) -- PayloadMeta no
            // longer carries it at all; see the dedicated "payload meta is
            // slim" tests below for the positive/negative proof.
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
        public void BuildOrbitMapsAPresentEscapeEncounterToATypedRecordToo()
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
                        ["transitionType"] = "ESCAPE",
                        ["transitionUt"] = 54321.0,
                        ["body"] = "Kerbin",
                    },
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit!.Encounter);
            Assert.Equal(TransitionType.Escape, orbit.Encounter!.TransitionType);
        }

        // ---- Fix A (O-9 reproduced): KSP's own nextPatch is routinely
        // non-null but INACTIVE, or ends the current patch in a FINAL/
        // INITIAL transition rather than a genuine SOI change -- neither is
        // a real upcoming encounter/escape. Gonogo.KSP.KspHost gates the raw
        // capture on nextPatch.activePatch + transitionType in
        // {ENCOUNTER,ESCAPE} (layer 1); this defensive backstop (layer 2)
        // means even an ALREADY-RECORDED phantom payload (captured before
        // that fix existed -- exactly what the real reference recording
        // contains, 809/816 orbit samples) maps to encounter:null on
        // replay too, never a fabricated transition. ----

        [Theory]
        [InlineData("FINAL")]
        [InlineData("INITIAL")]
        public void BuildOrbitRejectsAPhantomEncounterFromAnInactiveOrNonTransitionPatch(string transitionType)
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
                    // Exactly the raw shape KspHost captured for the 809/816
                    // phantom orbit samples in the real reference recording --
                    // a finite transitionUt and a real-looking body, but a
                    // FINAL/INITIAL transitionType (never a genuine encounter).
                    ["encounter"] = new Dictionary<string, object?>
                    {
                        ["transitionType"] = transitionType,
                        ["transitionUt"] = 99999.0,
                        ["body"] = (string?)null,
                    },
                },
                bodies: KerbinAndMun());

            var orbit = VesselViewProvider.BuildOrbit(snapshot);

            Assert.NotNull(orbit);
            Assert.Null(orbit!.Encounter);

            // Prove it on the real wire path too, not just the typed record.
            var wire = VesselViewProvider.BuildOrbitWire(snapshot);
            Assert.IsType<Dictionary<string, object?>>(wire);
            Assert.Null(((Dictionary<string, object?>)wire!)["encounter"]);
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
                    ["externalTemperature"] = 289.4,
                    ["atmosphericTemperature"] = 250.1,
                    ["missionTime"] = 400.0,
                });

            var flight = VesselViewProvider.BuildFlight(snapshot);

            Assert.NotNull(flight);
            Assert.Equal(-0.05, flight!.Latitude);
            Assert.Equal(179.9, flight.Longitude);
            Assert.Equal(3.4, flight.DynamicPressureKPa);
            Assert.Equal(289.4, flight.ExternalTemperature);
            Assert.Equal(250.1, flight.AtmosphericTemperature);
            Assert.Equal("vessel:" + VesselGuid, flight.Meta.Source);
        }

        [Fact]
        public void BuildFlightReturnsNullWhenAtmosphericTemperaturesAreMissing()
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
                    // externalTemperature / atmosphericTemperature deliberately missing
                });

            Assert.Null(VesselViewProvider.BuildFlight(snapshot));
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
        // M1 Task 2 -- remaining vessel read channels + time.warp
        // ----------------------------------------------------------------

        // ---- vessel.attitude ----

        [Fact]
        public void BuildAttitudeMapsTheOneDocumentedFrame()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                attitude: new Dictionary<string, object?> { ["pitch"] = 12.5, ["heading"] = 270.0, ["roll"] = -3.0 });

            var attitude = VesselViewProvider.BuildAttitude(snapshot);

            Assert.NotNull(attitude);
            Assert.Equal(12.5, attitude!.Pitch);
            Assert.Equal(270.0, attitude.Heading);
            Assert.Equal(-3.0, attitude.Roll);
            Assert.Equal("vessel:" + VesselGuid, attitude.Meta.Source);
        }

        [Fact]
        public void BuildAttitudeReturnsNullWhenGroupIsMissingNoReferenceBodyOrTransform()
        {
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildAttitude(snapshot));
        }

        // ---- vessel.resources ----

        [Fact]
        public void BuildResourcesMapsThreeWayAbsenceNotCarriedVsEmptyVsWholeChannelAbsent()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                resources: new Dictionary<string, object?>
                {
                    // Carried but currently empty -- a real, meaningful {0, >0}, never Telemachus's -1 sentinel (R-1).
                    ["ElectricCharge"] = new Dictionary<string, object?> { ["current"] = 0.0, ["max"] = 150.0 },
                    ["LiquidFuel"] = new Dictionary<string, object?> { ["current"] = 40.0, ["max"] = 100.0 },
                    // "MonoPropellant" deliberately NOT included -- not-carried (structural, R-1/R-3/R-4).
                });

            var resources = VesselViewProvider.BuildResources(snapshot);

            Assert.NotNull(resources);
            Assert.Equal("vessel:" + VesselGuid, resources!.Meta.Source);
            Assert.True(resources.Resources.ContainsKey("ElectricCharge"));
            Assert.Equal(0.0, resources.Resources["ElectricCharge"].Current);
            Assert.Equal(150.0, resources.Resources["ElectricCharge"].Max);
            Assert.Equal(40.0, resources.Resources["LiquidFuel"].Current);
            Assert.False(resources.Resources.ContainsKey("MonoPropellant")); // not-carried -> key absent, never a sentinel
        }

        [Fact]
        public void BuildResourcesReturnsEmptyMapNotNullWhenVesselCarriesNoTrackedResourcesAtAll()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                resources: new Dictionary<string, object?>());

            var resources = VesselViewProvider.BuildResources(snapshot);

            Assert.NotNull(resources); // vessel present -> channel present, even though the map is empty
            Assert.Empty(resources!.Resources);
        }

        [Fact]
        public void BuildResourcesReturnsNullWhenNoVesselAtAll()
        {
            Assert.Null(VesselViewProvider.BuildResources(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
        }

        // ---- vessel.thermal ----

        [Fact]
        public void BuildThermalMapsRatiosAndHottestPart()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                thermal: new Dictionary<string, object?>
                {
                    ["maxSkinTempRatio"] = 0.4,
                    ["maxInternalTempRatio"] = 0.6,
                    ["hottestPartInternalTemp"] = 500.0,
                    ["hottestPartMaxTemp"] = 1200.0,
                    ["hottestPartSkinTemp"] = 800.0,
                    ["hottestPartSkinMaxTemp"] = 2400.0,
                });

            var thermal = VesselViewProvider.BuildThermal(snapshot);

            Assert.NotNull(thermal);
            Assert.Equal(0.4, thermal!.MaxSkinTempRatio);
            Assert.Equal(0.6, thermal.MaxInternalTempRatio);
            Assert.NotNull(thermal.HottestPart);
            Assert.Equal(500.0, thermal.HottestPart!.InternalTemp);
            Assert.Equal(2400.0, thermal.HottestPart.SkinMaxTemp);
        }

        [Fact]
        public void BuildThermalLeavesRatiosNullWhenNoPartHasAValidMaxTempTypedNotZero()
        {
            // KspHost seeds these at -Infinity and maps that to an omitted/null
            // key when no part qualifies -- P-5's "no valid part" case must
            // surface as a typed null ratio, never an indistinguishable-from-
            // real-data 0.0.
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                thermal: new Dictionary<string, object?>());

            var thermal = VesselViewProvider.BuildThermal(snapshot);

            Assert.NotNull(thermal); // vessel HAS parts (thermal group present) -- just none with a valid maxTemp
            Assert.Null(thermal!.MaxSkinTempRatio);
            Assert.Null(thermal.MaxInternalTempRatio);
            Assert.Null(thermal.HottestPart);
        }

        [Fact]
        public void BuildThermalReturnsNullWhenVesselHasNoPartsAtAll()
        {
            // Distinct, coarser absence: no "thermal" group at all (KspHost's
            // BuildThermal returns null outright when parts.Count == 0).
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildThermal(snapshot));
        }

        // ---- vessel.control ----

        [Fact]
        public void BuildControlMapsEveryFieldAndActionGroupArray()
        {
            var control = new Dictionary<string, object?>
            {
                ["sas"] = true,
                ["sasMode"] = "Prograde",
                ["rcs"] = false,
                ["gear"] = true,
                ["brakes"] = false,
                ["lights"] = true,
                ["abort"] = true,
                ["precisionControl"] = true,
                ["throttle"] = 2.0, // V-3: deliberately unclamped -- not silently "fixed"
            };
            for (var i = 1; i <= 10; i++)
            {
                control["ag" + i] = i % 2 == 0;
            }

            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid }, control: control);

            var vesselControl = VesselViewProvider.BuildControl(snapshot);

            Assert.NotNull(vesselControl);
            Assert.True(vesselControl!.Sas);
            Assert.Equal(SasMode.Prograde, vesselControl.SasMode);
            Assert.False(vesselControl.Rcs);
            Assert.True(vesselControl.Abort);
            Assert.True(vesselControl.PrecisionControl);
            Assert.Equal(2.0, vesselControl.Throttle); // NOT clamped to 1.0
            Assert.NotNull(vesselControl.ActionGroups);
            Assert.Equal(10, vesselControl.ActionGroups!.Length);
            Assert.False(vesselControl.ActionGroups[0]); // ag1
            Assert.True(vesselControl.ActionGroups[1]); // ag2
        }

        [Fact]
        public void BuildControlLeavesEveryFieldNullWhenControlGroupIsEmptyNeverASentinel()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                control: new Dictionary<string, object?>());

            var control = VesselViewProvider.BuildControl(snapshot);

            Assert.NotNull(control); // vessel present -> record present
            Assert.Null(control!.Sas);
            Assert.Null(control.SasMode);
            Assert.Null(control.Abort);
            Assert.Null(control.PrecisionControl);
            Assert.Null(control.Throttle);
            Assert.Null(control.ActionGroups);
        }

        // ---- vessel.comms ----

        [Fact]
        public void BuildCommsMapsTypedControlStateEnum()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                comms: new Dictionary<string, object?> { ["connected"] = true, ["signalStrength"] = 0.85, ["controlState"] = "Full" });

            var comms = VesselViewProvider.BuildComms(snapshot);

            Assert.NotNull(comms);
            Assert.True(comms!.Connected);
            Assert.Equal(0.85, comms.SignalStrength);
            Assert.Equal(ControlState.Full, comms.ControlState);
        }

        [Fact]
        public void BuildCommsReturnsNullWhenVesselHasNoConnectionNeverAFakeZeroReading()
        {
            // KspHost.BuildComms returns null outright when vessel.connection
            // is null -- M-4: never a 0/0d disconnected-looking reading.
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildComms(snapshot));
        }

        // ---- vessel.propulsion ----

        [Fact]
        public void BuildPropulsionMapsMassAndThrustTheTwrInputs()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                propulsion: new Dictionary<string, object?>
                {
                    ["totalMass"] = 12.5,
                    ["dryMass"] = 8.0,
                    ["currentThrust"] = 200.0,
                    ["availableThrust"] = 250.0,
                });

            var propulsion = VesselViewProvider.BuildPropulsion(snapshot);

            Assert.NotNull(propulsion);
            Assert.Equal(12.5, propulsion!.TotalMass);
            Assert.Equal(8.0, propulsion.DryMass);
            Assert.Equal(200.0, propulsion.CurrentThrust);
            Assert.Equal(250.0, propulsion.AvailableThrust);
        }

        [Fact]
        public void BuildPropulsionReturnsNullWhenGroupIsMissing()
        {
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildPropulsion(snapshot));
        }

        // ---- vessel.maneuver ----

        [Fact]
        public void BuildManeuverMapsNamedDvComponentsImpossibleToMisOrder()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["ut"] = 12345.0, ["dvRadial"] = 1.0, ["dvNormal"] = 2.0, ["dvPrograde"] = 300.0, ["dvTotal"] = 300.02 },
                });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.NotNull(maneuver);
            var node = Assert.Single(maneuver!.Nodes);
            Assert.Equal(12345.0, node.Ut);
            Assert.Equal(1.0, node.DvRadial);
            Assert.Equal(2.0, node.DvNormal);
            Assert.Equal(300.0, node.DvPrograde);
            Assert.Equal(300.02, node.DvTotal);
        }

        [Fact]
        public void BuildManeuverNormalizesNullNodesListToEmptyArrayNeverNull()
        {
            // KspHost.BuildManeuverNodes returns null for "no nodes queued" --
            // R2: the mapper must normalize that to [], never propagate null.
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid }, maneuverNodesKeyPresent: true);

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.NotNull(maneuver);
            Assert.Empty(maneuver!.Nodes);
        }

        [Fact]
        public void BuildManeuverNormalizesAbsentKeyToEmptyArrayToo()
        {
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.NotNull(maneuver);
            Assert.Empty(maneuver!.Nodes);
        }

        [Fact]
        public void BuildManeuverReturnsNullOnlyWhenThereIsNoVesselAtAll()
        {
            Assert.Null(VesselViewProvider.BuildManeuver(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
        }

        // ---- Fix F: a non-finite dv component must never silently drop the
        // WHOLE node -- only that one component goes null, the rest (and the
        // node itself) are preserved. ----

        [Fact]
        public void BuildManeuverPreservesANodeWithANonFiniteDvComponentInsteadOfDroppingIt()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["ut"] = 12345.0, ["dvRadial"] = 1.0, ["dvNormal"] = double.NaN, ["dvPrograde"] = 300.0, ["dvTotal"] = 300.02 },
                });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.NotNull(maneuver);
            // Before the fix, GetDouble("dvNormal") mapping to null caused
            // the WHOLE node to be filtered out by the old "all dv fields
            // required" guard -- Nodes would be empty here.
            var node = Assert.Single(maneuver!.Nodes);
            Assert.Equal(12345.0, node.Ut);
            Assert.Equal(1.0, node.DvRadial);
            Assert.Null(node.DvNormal); // the non-finite component -> null, never NaN, never a dropped node
            Assert.Equal(300.0, node.DvPrograde);
            Assert.Equal(300.02, node.DvTotal);
        }

        [Fact]
        public void BuildManeuverStillDropsANodeMissingItsRequiredUt()
        {
            // Ut is the one field a node can't do without -- it's the whole
            // reason the node exists (when to burn). Every dv component is
            // now individually optional (Fix F), but Ut alone remains fatal
            // to the node, same as before.
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["dvRadial"] = 1.0, ["dvNormal"] = 2.0, ["dvPrograde"] = 300.0, ["dvTotal"] = 300.02 },
                });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.NotNull(maneuver);
            Assert.Empty(maneuver!.Nodes);
        }

        // ---- M3 R3: maneuver-node stable id ----

        [Fact]
        public void BuildManeuverMapsTheRawIdFieldOntoTheTypedNode()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["id"] = "node-abc-123", ["ut"] = 12345.0 },
                });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            var node = Assert.Single(maneuver!.Nodes);
            Assert.Equal("node-abc-123", node.Id);
        }

        [Fact]
        public void BuildManeuverDistinguishesTwoNodesByIdEvenWithIdenticalDv()
        {
            // The whole point of a stable id is telling nodes apart when
            // everything else (Ut aside) is the same -- proves the mapper
            // doesn't collapse/dedupe on any other field.
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["id"] = "node-1", ["ut"] = 100.0, ["dvPrograde"] = 50.0 },
                    new Dictionary<string, object?> { ["id"] = "node-2", ["ut"] = 200.0, ["dvPrograde"] = 50.0 },
                });

            var maneuver = VesselViewProvider.BuildManeuver(snapshot);

            Assert.Equal(2, maneuver!.Nodes.Count);
            Assert.Equal(new[] { "node-1", "node-2" }, maneuver.Nodes.Select(n => n.Id));
        }

        [Fact]
        public void BuildManeuverDefaultsIdToEmptyStringForAPreExistingRecordingWithNoIdField()
        {
            // A recording captured before this field existed simply has no
            // "id" key in its raw node dict -- must not throw, and must not
            // fabricate a fake id; "" is the documented pre-M3-R3 sentinel
            // (ManeuverNode.Id's doc comment), distinguishable from any real
            // GUID-shaped id a live capture always assigns.
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                maneuverNodes: new List<object?>
                {
                    new Dictionary<string, object?> { ["ut"] = 12345.0 },
                });

            var node = Assert.Single(VesselViewProvider.BuildManeuver(snapshot)!.Nodes);
            Assert.Equal("", node.Id);
        }

        // ---- vessel.target ----

        [Fact]
        public void BuildTargetMapsOneVec3ShapeForVesselTarget()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Munar Relay",
                    ["type"] = "Relay", // a VesselType-shaped string -> classified as Vessel
                    ["relativePosition"] = new[] { 10.0, 20.0, 30.0 },
                    ["relativeVelocity"] = new[] { 1.0, 2.0, 3.0 },
                });

            var target = VesselViewProvider.BuildTarget(snapshot);

            Assert.NotNull(target);
            Assert.Equal("Munar Relay", target!.Name);
            Assert.Equal(TargetKind.Vessel, target.Kind);
            Assert.Equal(10.0, target.RelativePosition!.X);
            Assert.Equal(1.0, target.RelativeVelocity!.X);
            Assert.Null(target.Orbit);
        }

        [Fact]
        public void BuildTargetClassifiesCelestialBodyAndOtherKinds()
        {
            var bodySnapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Mun",
                    ["type"] = "CelestialBody",
                    ["relativeVelocity"] = new[] { 0.0, 0.0, 0.0 },
                });
            Assert.Equal(TargetKind.Body, VesselViewProvider.BuildTarget(bodySnapshot)!.Kind);

            var otherSnapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Docking Port",
                    ["type"] = "ModuleDockingNode",
                    ["relativeVelocity"] = new[] { 0.0, 0.0, 0.0 },
                });
            Assert.Equal(TargetKind.Other, VesselViewProvider.BuildTarget(otherSnapshot)!.Kind);
        }

        [Fact]
        public void BuildTargetMapsNestedOrbitReusingVesselOrbitForSingleViewTimePropagation()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Munar Relay",
                    ["type"] = "Relay",
                    ["relativeVelocity"] = new[] { 1.0, 2.0, 3.0 },
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 800_000.0,
                        ["ecc"] = 0.0,
                        ["inc"] = 0.0,
                        ["lan"] = 0.0,
                        ["argPe"] = 0.0,
                        ["meanAnomalyAtEpoch"] = 0.0,
                        ["epoch"] = 0.0,
                        ["mu"] = 3.5316e12,
                        ["referenceBody"] = "Kerbin",
                    },
                },
                bodies: KerbinAndMun());

            var target = VesselViewProvider.BuildTarget(snapshot);

            Assert.NotNull(target!.Orbit);
            Assert.Equal(800_000.0, target.Orbit!.Sma);
            Assert.Equal(1, target.Orbit.ReferenceBodyIndex);
        }

        [Fact]
        public void BuildTargetReturnsNullWhenNothingTargetedTheCommonCase()
        {
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildTarget(snapshot));
        }

        // ---- M3 R3: target's own stable id ----

        [Fact]
        public void BuildTargetMapsVesselIdOnlyForAVesselKindTarget()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Munar Relay",
                    ["type"] = "Relay",
                    ["targetVesselId"] = "22222222-3333-4444-5555-666666666666",
                    ["relativeVelocity"] = new[] { 0.0, 0.0, 0.0 },
                });

            var target = VesselViewProvider.BuildTarget(snapshot)!;

            Assert.Equal(TargetKind.Vessel, target.Kind);
            Assert.Equal("22222222-3333-4444-5555-666666666666", target.VesselId);
            Assert.Null(target.BodyIndex);
        }

        [Fact]
        public void BuildTargetResolvesBodyIndexOnlyForABodyKindTarget()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Mun",
                    ["type"] = "CelestialBody",
                    ["relativeVelocity"] = new[] { 0.0, 0.0, 0.0 },
                },
                bodies: KerbinAndMun());

            var target = VesselViewProvider.BuildTarget(snapshot)!;

            Assert.Equal(TargetKind.Body, target.Kind);
            Assert.Null(target.VesselId);
            Assert.Equal(2, target.BodyIndex); // "Mun" -> index 2 per KerbinAndMun()
        }

        [Fact]
        public void BuildTargetLeavesBothIdFieldsNullForAnOtherKindTarget()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                target: new Dictionary<string, object?>
                {
                    ["name"] = "Docking Port",
                    ["type"] = "ModuleDockingNode",
                    ["targetVesselId"] = "should-be-ignored-for-non-vessel-kind",
                    ["relativeVelocity"] = new[] { 0.0, 0.0, 0.0 },
                });

            var target = VesselViewProvider.BuildTarget(snapshot)!;

            Assert.Equal(TargetKind.Other, target.Kind);
            Assert.Null(target.VesselId);
            Assert.Null(target.BodyIndex);
        }

        // ---- vessel.dock ----

        [Fact]
        public void BuildDockMapsRelativeStateAndForwardDot()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                dock: new Dictionary<string, object?>
                {
                    ["relativePosition"] = new[] { 1.0, 2.0, 3.0 },
                    ["relativeVelocity"] = new[] { 0.1, 0.2, 0.3 },
                    ["distance"] = 3.74,
                    ["forwardDot"] = -0.98,
                });

            var dock = VesselViewProvider.BuildDock(snapshot);

            Assert.NotNull(dock);
            Assert.Equal(1.0, dock!.RelativePosition.X);
            Assert.Equal(0.2, dock.RelativeVelocity.Y);
            Assert.Equal(3.74, dock.Distance);
            Assert.Equal(-0.98, dock.ForwardDot);
        }

        [Fact]
        public void BuildDockReturnsNullWhenNotDockingRelevantTheCommonCase()
        {
            // KspHost.BuildDock omits the "dock" group entirely whenever
            // nothing is targeted / the target isn't a port / this vessel
            // has no free port -- the group is simply absent, same
            // whole-record-absent convention as vessel.target.
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildDock(snapshot));
        }

        [Fact]
        public void BuildDockReturnsNullOnAnyMissingRequiredField()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                dock: new Dictionary<string, object?>
                {
                    ["relativePosition"] = new[] { 1.0, 2.0, 3.0 },
                    // relativeVelocity/distance missing
                });

            Assert.Null(VesselViewProvider.BuildDock(snapshot));
        }

        // ---- vessel.surface ----

        [Fact]
        public void BuildSurfaceMapsBiomeLandedAtAndHeightFromTerrain()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                surface: new Dictionary<string, object?>
                {
                    ["biome"] = "Highlands",
                    ["landedAt"] = "KSC_LaunchPad",
                    ["heightFromTerrain"] = 1.25,
                });

            var surface = VesselViewProvider.BuildSurface(snapshot);

            Assert.NotNull(surface);
            Assert.Equal("Highlands", surface!.Biome);
            Assert.Equal("KSC_LaunchPad", surface.LandedAt);
            Assert.Equal(1.25, surface.HeightFromTerrain);
        }

        [Fact]
        public void BuildSurfaceLeavesFieldsIndividuallyNullRatherThanDroppingTheWholeRecord()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                surface: new Dictionary<string, object?>
                {
                    ["heightFromTerrain"] = 500.0,
                    // biome/landedAt absent -- e.g. a body with no biome map
                    // or a wild landing spot with no named site.
                });

            var surface = VesselViewProvider.BuildSurface(snapshot);

            Assert.NotNull(surface);
            Assert.Null(surface!.Biome);
            Assert.Null(surface.LandedAt);
            Assert.Equal(500.0, surface.HeightFromTerrain);
        }

        [Fact]
        public void BuildSurfaceReturnsNullWhenGroupIsAbsentEgOrbitingOrEscaping()
        {
            // KspHost.BuildSurface omits the "surface" group entirely while
            // ORBITING/ESCAPING -- never a stale AGL/biome reading from deep
            // space.
            var snapshot = SnapshotWith(identity: new Dictionary<string, object?> { ["id"] = VesselGuid });

            Assert.Null(VesselViewProvider.BuildSurface(snapshot));
        }

        // ---- vessel.crew ----

        [Fact]
        public void BuildCrewMapsCount()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                misc: new Dictionary<string, object?> { ["crewCount"] = 3 });

            var crew = VesselViewProvider.BuildCrew(snapshot);

            Assert.NotNull(crew);
            Assert.Equal(3, crew!.Count);
        }

        [Fact]
        public void BuildCrewReturnsNullWhenNoVessel()
        {
            Assert.Null(VesselViewProvider.BuildCrew(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
        }

        // ---- vessel.structure ----

        [Fact]
        public void BuildStructureMapsCurrentStageStageCountAndPartCount()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                misc: new Dictionary<string, object?> { ["currentStage"] = 2, ["stageCount"] = 5, ["partCount"] = 42 });

            var structure = VesselViewProvider.BuildStructure(snapshot);

            Assert.NotNull(structure);
            Assert.Equal(2, structure!.CurrentStage);
            Assert.Equal(5, structure.StageCount);
            Assert.Equal(42, structure.PartCount);
        }

        [Fact]
        public void BuildStructureLeavesStageCountAndPartCountNullWhenVesselHasNoParts()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                misc: new Dictionary<string, object?> { ["currentStage"] = 0 });

            var structure = VesselViewProvider.BuildStructure(snapshot);

            Assert.NotNull(structure);
            Assert.Null(structure!.StageCount);
            Assert.Null(structure.PartCount);
        }

        // ---- time.warp ----

        [Fact]
        public void BuildWarpMapsOrthogonalTypedFieldsNeverAMagicInt()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                time: new Dictionary<string, object?> { ["warpRate"] = 4.0, ["warpRateIndex"] = 3, ["warpMode"] = "HIGH", ["paused"] = false });

            var warp = VesselViewProvider.BuildWarp(snapshot);

            Assert.NotNull(warp);
            Assert.Equal(4.0, warp!.WarpRate);
            Assert.Equal(3, warp.WarpRateIndex);
            Assert.Equal(WarpMode.High, warp.WarpMode);
            Assert.False(warp.Paused);
            // GLOBAL channel -- never attributed to the active vessel, even
            // when one happens to be present this tick (fold-in fix, M1
            // Task 3 review).
            Assert.Equal("game", warp.Meta.Source);
        }

        [Fact]
        public void BuildWarpMapsPausedOrthogonallyFromWarpMode()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid },
                time: new Dictionary<string, object?> { ["warpRate"] = 1.0, ["warpRateIndex"] = 0, ["warpMode"] = "LOW", ["paused"] = true });

            var warp = VesselViewProvider.BuildWarp(snapshot);

            Assert.NotNull(warp);
            Assert.True(warp!.Paused);
            Assert.Equal(WarpMode.Low, warp.WarpMode);
        }

        [Fact]
        public void BuildWarpEmitsWithNoActiveVesselAndIsNotAttributedToOne()
        {
            // Fold-in fix (M1 Task 3 review): time.warp is GLOBAL game state
            // (Gonogo.KSP.KspHost.BuildTime reads it unconditionally) -- it
            // must emit at the Space Center / tracking station too, not just
            // in flight. An earlier draft gated this on active-vessel
            // presence (returning null here); that silenced the channel
            // exactly where warp control matters most.
            var snapshot = new KspSnapshot
            {
                Ut = 42.0,
                Values = new Dictionary<string, object?>
                {
                    ["time"] = new Dictionary<string, object?> { ["warpRate"] = 1.0, ["warpRateIndex"] = 0, ["warpMode"] = "HIGH", ["paused"] = false },
                },
            };

            var warp = VesselViewProvider.BuildWarp(snapshot);

            Assert.NotNull(warp);
            Assert.Equal(1.0, warp!.WarpRate);
            // NOTE: no ValidAt assertion here (Fix C) -- PayloadMeta no
            // longer carries it; see the "payload meta is slim" tests below.
            // Not "vessel:<guid>" -- there is no vessel to attribute this to,
            // and the channel must not pretend otherwise.
            Assert.Equal("game", warp.Meta.Source);
        }

        [Fact]
        public void BuildWarpReturnsNullOnlyWhenTimeGroupItselfIsAbsent()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(VesselViewProvider.BuildWarp(snapshot));
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
            // PayloadMeta (Fix C), not the full envelope Meta -- these are
            // PAYLOAD POCOs (VesselOrbit.Meta etc.), which only ever carry
            // source+quality; seq/deliveredAt/vantage/validAt live solely on
            // the envelope Meta Sitrep.Core.Courier stamps.
            var meta = new PayloadMeta
            {
                Source = "vessel:" + VesselGuid,
                Quality = Quality.Loaded,
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

            // ---- M1 Task 2 POCOs ----

            yield return new object[]
            {
                new VesselAttitude { Pitch = 12.5, Heading = 270.0, Roll = -3.0, Meta = meta },
            };

            yield return new object[]
            {
                new VesselResources
                {
                    Resources = new Dictionary<string, ResourceAmount>
                    {
                        ["ElectricCharge"] = new ResourceAmount { Current = 0, Max = 150 },
                    },
                    Meta = meta,
                },
            };

            yield return new object[] { new ResourceAmount { Current = 0, Max = 150 } };

            yield return new object[]
            {
                new VesselThermal
                {
                    MaxSkinTempRatio = 0.4,
                    MaxInternalTempRatio = 0.6,
                    HottestPart = new ThermalHottestPart { InternalTemp = 500, MaxTemp = 1200, SkinTemp = 800, SkinMaxTemp = 2400 },
                    Meta = meta,
                },
            };

            yield return new object[] { new ThermalHottestPart { InternalTemp = 500, MaxTemp = 1200, SkinTemp = 800, SkinMaxTemp = 2400 } };

            yield return new object[]
            {
                new VesselControl
                {
                    Sas = true,
                    SasMode = SasMode.Prograde,
                    Rcs = false,
                    Gear = true,
                    Brakes = false,
                    Lights = true,
                    Throttle = 0.5,
                    ActionGroups = new[] { true, false, true, false, true, false, true, false, true, false },
                    Meta = meta,
                },
            };

            yield return new object[]
            {
                new VesselComms { Connected = true, SignalStrength = 0.85, ControlState = ControlState.Full, Meta = meta },
            };

            yield return new object[]
            {
                new VesselPropulsion { TotalMass = 12.5, DryMass = 8.0, CurrentThrust = 200.0, AvailableThrust = 250.0, Meta = meta },
            };

            yield return new object[]
            {
                new VesselManeuver
                {
                    Nodes = new List<ManeuverNode>
                    {
                        new ManeuverNode { Ut = 12345.0, DvRadial = 1.0, DvNormal = 2.0, DvPrograde = 300.0, DvTotal = 300.02 },
                    },
                    Meta = meta,
                },
            };

            yield return new object[] { new ManeuverNode { Ut = 12345.0, DvRadial = 1.0, DvNormal = 2.0, DvPrograde = 300.0, DvTotal = 300.02 } };

            yield return new object[]
            {
                new VesselTarget
                {
                    Name = "Munar Relay",
                    Kind = TargetKind.Vessel,
                    RelativePosition = new Vec3(10, 20, 30),
                    RelativeVelocity = new Vec3(1, 2, 3),
                    Orbit = null,
                    Meta = meta,
                },
            };

            yield return new object[] { new VesselCrew { Count = 3, Meta = meta } };

            yield return new object[]
            {
                new VesselStructure { CurrentStage = 2, StageCount = 5, PartCount = 42, Meta = meta },
            };

            yield return new object[]
            {
                new WarpState { WarpRate = 4.0, WarpRateIndex = 3, WarpMode = WarpMode.High, Paused = false, Meta = meta },
            };

            yield return new object[]
            {
                new DockAlignment
                {
                    RelativePosition = new Vec3(1, 2, 3),
                    RelativeVelocity = new Vec3(0.1, 0.2, 0.3),
                    Distance = 3.74,
                    ForwardDot = -0.98,
                    Meta = meta,
                },
            };

            yield return new object[]
            {
                new VesselSurface { Biome = "Highlands", LandedAt = "KSC_LaunchPad", HeightFromTerrain = 1.25, Meta = meta },
            };
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
        // Fix C: payload meta is slim -- source/quality only, never a
        // fabricated duplicate of the ENVELOPE meta's real
        // seq/deliveredAt/vantage/validAt (those are stamped once, for
        // real, by Sitrep.Core.Courier.MakeMeta onto StreamData<T>.Meta).
        // ----------------------------------------------------------------

        [Fact]
        public void PayloadMetaWireShapeCarriesOnlySourceAndQualityNeverEnvelopeDuplicateFields()
        {
            var snapshot = SnapshotWith(
                identity: new Dictionary<string, object?> { ["id"] = VesselGuid, ["name"] = "Kerbal X", ["vesselType"] = "Ship", ["situation"] = "ORBITING" });

            var wire = VesselViewProvider.BuildIdentityWire(snapshot);
            var wireDict = Assert.IsType<Dictionary<string, object?>>(wire);
            var metaDict = Assert.IsType<Dictionary<string, object?>>(wireDict["meta"]);

            Assert.True(metaDict.ContainsKey("source"));
            Assert.Equal("vessel:" + VesselGuid, metaDict["source"]);
            Assert.True(metaDict.ContainsKey("quality"));

            // Before Fix C these four were always present, fabricated as
            // 0/""/0/"" every time (dead duplicates of the real values the
            // envelope alone stamps).
            Assert.False(metaDict.ContainsKey("seq"), "payload meta must not fabricate a duplicate of the envelope's real seq");
            Assert.False(metaDict.ContainsKey("deliveredAt"), "payload meta must not fabricate a duplicate of the envelope's real deliveredAt");
            Assert.False(metaDict.ContainsKey("vantage"), "payload meta must not fabricate a duplicate of the envelope's real vantage");
            Assert.False(metaDict.ContainsKey("validAt"), "payload meta must not fabricate a duplicate of the envelope's real validAt");
        }

        [Fact]
        public void PayloadMetaHasNoValidAtEvenAtTheNowUtSentinelZero()
        {
            // KspHost.NowUt() returns 0 as a fallback sentinel when
            // Planetarium.GetUniversalTime() throws -- e.g. at the main
            // menu, before any save is loaded (KspHost.cs:79-83). Before
            // Fix C that 0 leaked onto EVERY payload's own meta as a
            // fabricated "validAt":0; PayloadMeta doesn't carry the field
            // at all now, so there's nothing left for the sentinel to leak
            // into. Uses time.warp (BuildWarp), the one channel that
            // legitimately emits with snapshot.Ut == 0 and no active vessel.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["time"] = new Dictionary<string, object?> { ["warpRate"] = 1.0, ["warpRateIndex"] = 0, ["warpMode"] = "HIGH", ["paused"] = false },
                },
            };

            var wire = VesselViewProvider.BuildWarpWire(snapshot);
            var wireDict = Assert.IsType<Dictionary<string, object?>>(wire);
            var metaDict = Assert.IsType<Dictionary<string, object?>>(wireDict["meta"]);

            Assert.False(metaDict.ContainsKey("validAt"));
            Assert.Equal("game", metaDict["source"]);
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
            List<object?>? bodies = null,
            Dictionary<string, object?>? attitude = null,
            Dictionary<string, object?>? resources = null,
            Dictionary<string, object?>? thermal = null,
            Dictionary<string, object?>? control = null,
            Dictionary<string, object?>? comms = null,
            Dictionary<string, object?>? propulsion = null,
            Dictionary<string, object?>? misc = null,
            Dictionary<string, object?>? target = null,
            List<object?>? maneuverNodes = null,
            bool maneuverNodesKeyPresent = false,
            Dictionary<string, object?>? time = null,
            Dictionary<string, object?>? dock = null,
            Dictionary<string, object?>? surface = null)
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
            if (attitude != null)
            {
                vessel["attitude"] = attitude;
            }
            if (resources != null)
            {
                vessel["resources"] = resources;
            }
            if (thermal != null)
            {
                vessel["thermal"] = thermal;
            }
            if (control != null)
            {
                vessel["control"] = control;
            }
            if (comms != null)
            {
                vessel["comms"] = comms;
            }
            if (propulsion != null)
            {
                vessel["propulsion"] = propulsion;
            }
            if (misc != null)
            {
                vessel["misc"] = misc;
            }
            if (target != null)
            {
                vessel["target"] = target;
            }
            if (maneuverNodes != null || maneuverNodesKeyPresent)
            {
                vessel["maneuverNodes"] = maneuverNodes;
            }
            if (dock != null)
            {
                vessel["dock"] = dock;
            }
            if (surface != null)
            {
                vessel["surface"] = surface;
            }

            var values = new Dictionary<string, object?> { ["vessel"] = vessel };
            if (bodies != null)
            {
                values["bodies"] = bodies;
            }
            if (time != null)
            {
                values["time"] = time;
            }

            return new KspSnapshot { Ut = 0.0, Values = values };
        }
    }
}
