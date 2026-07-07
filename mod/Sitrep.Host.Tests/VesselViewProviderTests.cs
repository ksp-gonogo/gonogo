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
