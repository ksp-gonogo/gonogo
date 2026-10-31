using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// Where a craft a centre last knew coasting or burning is reckoned to be
    /// later, against the Kepler solution and a hand-worked constant push.
    /// </summary>
    public class PlacePredictionTests
    {
        private const double KerbinMu = 3.5316e12;
        private const string Probe = "vessel:probe";

        /// <summary>A circular orbit 100 km above Kerbin.</summary>
        private static readonly OrbitElements LowOrbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static CraftState Heard(CraftCapability? capability, double capturedUt = 1000.0) =>
            CraftState.Orbiting(Probe, capturedUt, 1, LowOrbit, null, null, true, new Dictionary<string, CraftLink>()).WithCapability(capability);

        private static CraftCapability Burning(double deltaV, ThrustAcceleration? thrust) =>
            new CraftCapability(deltaV, thrust?.Magnitude, null, false, true, thrust);

        private static StateVector Start() =>
            new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, LowOrbit), 1000.0);

        private static double Distance(Vector3d a, Vector3d b) => (a - b).Magnitude();

        [Fact]
        public void ACraftLastKnownCoastingIsWhereItsOrbitPutsIt()
        {
            var known = Heard(new CraftCapability(2000.0, 10.0, null, false, false));

            var place = PlacePrediction.PlaceAt(known, 1600.0)!.Value;

            var expected = new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, LowOrbit), 1600.0).Position;
            Assert.Equal(0.0, Distance(expected, place.Place.Position), 6);
            Assert.Equal(CraftPlaceBasis.Coasting, place.Place.Basis);
            Assert.Equal(1, place.Place.BodyIndex);
            Assert.Equal(0.0, place.RadiusM);
        }

        [Fact]
        public void ACraftWhoseThrustWasNotReadIsNotPlaced()
        {
            Assert.Null(PlacePrediction.PlaceAt(Heard(new CraftCapability(2000.0, 10.0, null, false)), 1060.0));
            Assert.Null(PlacePrediction.PlaceAt(Heard(null), 1060.0));
        }

        [Fact]
        public void ACraftBurningWithNoThrustVectorReadIsNotPlacedAndKeepsTheFlatOutBound()
        {
            var known = Heard(Burning(2000.0, null));

            Assert.Null(PlacePrediction.PlaceAt(known, 1060.0));
            Assert.Equal(PositionUncertainty.FreeFall(2000.0, null, 60.0) * PositionUncertainty.Gravity(LowOrbit, 60.0)!.Value, PositionUncertainty.Bound(known, 1000.0, 1060.0)!.Value, 3);
        }

        [Fact]
        public void ACraftBurningProgradeIsAheadOfWhereCoastingWouldLeaveItByAboutAHalfATSquared()
        {
            var thrust = new ThrustAcceleration(10.0, 0.0, 0.0);
            var known = Heard(Burning(2000.0, thrust));

            var burning = PlacePrediction.PlaceAt(known, 1060.0)!.Value;

            var coasting = new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, LowOrbit), 1060.0).Position;
            var ahead = burning.Place.Position - coasting;
            var progradeAtStart = Start().Velocity * (1.0 / Start().Velocity.Magnitude());
            // 10 m/s² for a minute: 10 × 60² / 2 = 18 000 m, bent a little by gravity.
            Assert.InRange(ahead.Magnitude(), 17_000.0, 19_000.0);
            Assert.True(Vector3d.Dot(ahead, progradeAtStart) > 0.9 * ahead.Magnitude());
            Assert.Equal(CraftPlaceBasis.Burning, burning.Place.Basis);
        }

        [Fact]
        public void ABurnStopsPushingWhenItsDeltaVIsSpent()
        {
            var spendInTenSeconds = Heard(Burning(100.0, new ThrustAcceleration(10.0, 0.0, 0.0)));
            var neverEnds = Heard(Burning(100_000.0, new ThrustAcceleration(10.0, 0.0, 0.0)));

            var spent = PlacePrediction.PlaceAt(spendInTenSeconds, 1300.0)!.Value.Place.Position;
            var running = PlacePrediction.PlaceAt(neverEnds, 1300.0)!.Value.Place.Position;

            Assert.True(Distance(spent, running) > 100_000.0);
        }

        [Fact]
        public void TheRadiusIsTheHeldBurnsOwnDisplacementScaledByTheAssumedThrustError()
        {
            var known = Heard(Burning(2000.0, new ThrustAcceleration(10.0, 0.0, 0.0)));

            var radius = PlacePrediction.PlaceAt(known, 1060.0)!.Value.RadiusM;

            var error = Math.Sqrt(PlacePrediction.DirectionError * PlacePrediction.DirectionError + PlacePrediction.MagnitudeError * PlacePrediction.MagnitudeError);
            var expected = error * PositionUncertainty.Gravity(LowOrbit, 60.0)!.Value * 18_000.0;
            Assert.Equal(expected, radius, 3);
            Assert.Equal(radius, PositionUncertainty.Bound(known, 1000.0, 1060.0)!.Value, 6);
            Assert.True(radius < PositionUncertainty.FreeFall(2000.0, 10.0, 60.0));
        }

        [Fact]
        public void ABurnIsNotCarriedForwardPastTheStepsItIsIntegratedOver()
        {
            var known = Heard(Burning(2000.0, new ThrustAcceleration(10.0, 0.0, 0.0)));

            Assert.NotNull(PlacePrediction.PlaceAt(known, 1000.0 + PlacePrediction.MaxSteps));
            Assert.Null(PlacePrediction.PlaceAt(known, 1000.0 + PlacePrediction.MaxSteps + 1.0));
        }

        [Fact]
        public void ACraftBurningInAnAtmosphereIsCarriedOnItsHeldThrustAndWheelsOrRotorsAreNotPlaced()
        {
            var thrust = new ThrustAcceleration(10.0, 0.0, 0.0);
            var known = Heard(new CraftCapability(2000.0, 10.0, 150.0, false, true, thrust));

            var place = PlacePrediction.PlaceAt(known, 1060.0)!.Value;

            Assert.Equal(CraftPlaceBasis.Burning, place.Place.Basis);
            Assert.True(Distance(place.Place.Position, new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, LowOrbit), 1060.0).Position) > 1_000.0);
            Assert.Null(PlacePrediction.PlaceAt(Heard(new CraftCapability(2000.0, 10.0, 150.0, true, true, thrust)), 1060.0));
        }

        [Fact]
        public void ACraftCoastingInAnAtmosphereIsWhereItsOrbitPutsItWithTheAirsRadius()
        {
            var known = Heard(new CraftCapability(0.0, 0.0, 150.0, false, false));

            var place = PlacePrediction.PlaceAt(known, 1001.0)!.Value;

            Assert.Equal(CraftPlaceBasis.Coasting, place.Place.Basis);
            Assert.Equal(0.0, Distance(place.Place.Position, new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, LowOrbit), 1001.0).Position), 6);
            Assert.True(place.RadiusM > 0.5 * PositionUncertainty.AeroFloorAccelerationMs2 - 1e-9);
            Assert.Equal(0.0, PlacePrediction.PlaceAt(known, 1000.0)!.Value.RadiusM);
        }

        [Fact]
        public void ACraftInAnAtmosphereWhoseThrustIsUnknownIsPlacedOnItsOrbitWithTheEnginesInTheRadius()
        {
            var known = Heard(new CraftCapability(2000.0, 30.0, 150.0, false, true));

            var place = PlacePrediction.PlaceAt(known, 1001.0)!.Value;

            Assert.Equal(CraftPlaceBasis.Coasting, place.Place.Basis);
            Assert.True(place.RadiusM >= 0.5 * 30.0);
        }

        [Fact]
        public void TheSplitOfAThrustGivesBackTheSameVectorInTheFrameItWasTakenIn()
        {
            var state = Start();
            var thrust = new ThrustAcceleration(3.0, -4.0, 12.0);

            var vector = thrust.InFrameOf(state.Position, state.Velocity)!.Value;

            Assert.Equal(13.0, vector.Magnitude(), 9);
            Assert.Equal(3.0, Vector3d.Dot(vector, state.Velocity * (1.0 / state.Velocity.Magnitude())), 9);
        }
    }
}
