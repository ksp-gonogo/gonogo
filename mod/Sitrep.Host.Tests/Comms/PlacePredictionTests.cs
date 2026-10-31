using System;
using System.Linq;
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

        /// <summary>A craft 2 km above Kerbin at the equator, falling at 6 m/s under a parachute and turning with the planet at 175 m/s, as the inertial frame sees it.</summary>
        private static readonly Vector3d ChutePosition = new Vector3d(602_000.0, 0.0, 0.0);

        private static readonly Vector3d ChuteVelocity = new Vector3d(-6.0, 175.0, 0.0);

        private static OrbitElements OrbitThrough(Vector3d position, Vector3d velocity, double ut)
        {
            var r = position.Magnitude();
            var speed2 = Vector3d.Dot(velocity, velocity);
            var h = position.X * velocity.Y - position.Y * velocity.X;
            var scale = (speed2 - KerbinMu / r) / KerbinMu;
            var ex = scale * position.X - Vector3d.Dot(position, velocity) / KerbinMu * velocity.X;
            var ey = scale * position.Y - Vector3d.Dot(position, velocity) / KerbinMu * velocity.Y;
            var ecc = Math.Sqrt(ex * ex + ey * ey);
            var argPe = Math.Atan2(ey, ex);
            var sma = 1.0 / (2.0 / r - speed2 / KerbinMu);
            var nu = Math.Atan2(position.Y, position.X) - argPe;
            var eccentric = 2.0 * Math.Atan(Math.Sqrt((1.0 - ecc) / (1.0 + ecc)) * Math.Tan(nu / 2.0));
            var mean = eccentric - ecc * Math.Sin(eccentric);
            Assert.True(h > 0.0);
            return new OrbitElements(sma, ecc, 0.0, 0.0, argPe, mean, ut, KerbinMu);
        }

        private static CraftState Chute(CraftCapability capability)
        {
            var orbit = OrbitThrough(ChutePosition, ChuteVelocity, 1000.0);
            return CraftState.Orbiting(Probe, 1000.0, 1, orbit, null, null, true, new Dictionary<string, CraftLink>()).WithCapability(capability);
        }

        /// <summary>What the game would measure on the craft: the drag that holds it at terminal speed, equal and opposite to gravity.</summary>
        private static ThrustAcceleration HoldingUp()
        {
            var up = ChutePosition * (KerbinMu / Math.Pow(ChutePosition.Magnitude(), 3.0));
            var basis = ThrustAcceleration.Basis(ChutePosition, ChuteVelocity)!.Value;
            return new ThrustAcceleration(Vector3d.Dot(up, basis.Prograde), Vector3d.Dot(up, basis.Radial), Vector3d.Dot(up, basis.Normal));
        }

        private static Vector3d Straight(double seconds) => ChutePosition + ChuteVelocity * seconds;

        [Fact]
        public void ACraftAtTerminalSpeedUnderAParachuteHoldsItsVelocityWhereAFallingPathWouldDropAwayFromIt()
        {
            var held = Chute(new CraftCapability(0.0, 0.0, 6.0, false, false, null, HoldingUp()));
            var ballistic = Chute(new CraftCapability(0.0, 0.0, 6.0, false, false));

            Assert.Equal(0.0, Distance(PlacePrediction.PlaceAt(held, 1000.0)!.Value.Place.Position, ChutePosition), 3);
            foreach (var seconds in new[] { 1.0, 2.0, 5.0 })
            {
                Assert.True(Distance(PlacePrediction.PlaceAt(held, 1000.0 + seconds)!.Value.Place.Position, Straight(seconds)) < 0.1, "held: " + seconds);
                Assert.True(Distance(PlacePrediction.PlaceAt(ballistic, 1000.0 + seconds)!.Value.Place.Position, Straight(seconds)) > 0.4 * KerbinMu / Math.Pow(ChutePosition.Magnitude(), 2.0) * seconds * seconds, "ballistic: " + seconds);
            }
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(2.0)]
        [InlineData(3.0)]
        [InlineData(5.0)]
        public void AParachuteDescentStaysInsideItsRadiusWhetherTheCaptureIsFreshOrLate(double seconds)
        {
            var known = Chute(new CraftCapability(0.0, 0.0, 6.0, false, false, null, HoldingUp()));
            var place = PlacePrediction.PlaceAt(known, 1000.0 + seconds)!.Value;
            var pull = KerbinMu / Math.Pow(ChutePosition.Magnitude(), 2.0);

            // The canopy holds it: it keeps its speed.
            Assert.True(Distance(place.Place.Position, Straight(seconds)) <= place.RadiusM);
            // The canopy is cut away: it falls, 0.5 g t² behind a path that holds its speed.
            var falling = new KeplerProvider().Solve(PropagationTarget.Vessel(Probe, 1, OrbitThrough(ChutePosition, ChuteVelocity, 1000.0)), 1000.0 + seconds).Position;
            Assert.True(Distance(place.Place.Position, falling) <= place.RadiusM, $"cut away at {seconds} s: {Distance(place.Place.Position, falling):F1} m outside {place.RadiusM:F1} m");
            Assert.True(0.5 * pull * seconds * seconds <= place.RadiusM + 1e-6);
        }

        [Fact]
        public void TheRadiusOfACaptureThatIsLateFollowsItsAgeAsTheSquareOfItNotAConstant()
        {
            var known = Chute(new CraftCapability(0.0, 0.0, 6.0, false, false, null, HoldingUp()));

            var radii = new[] { 1.0, 3.0, 5.0 }.Select(seconds => PositionUncertainty.Bound(known, 1000.0, 1000.0 + seconds)!.Value).ToArray();

            Assert.True(radii[0] < radii[1] && radii[1] < radii[2]);
            Assert.True(radii[2] > 5.0 * radii[0], $"{radii[0]:F1} m at 1 s and {radii[2]:F1} m at 5 s");
        }

        private static double Pull => KerbinMu / Math.Pow(ChutePosition.Magnitude(), 2.0);

        /// <summary>The Mk16 on a 1 t craft: 450 drag when open and 1 when part open, a 0.1 t canopy, opening below 500 m, or at the given safe speed when the game holds it back.</summary>
        private static CanopyReading Mk16(double? safeSpeed = null) =>
            new CanopyReading(ParachuteDrag.PerPressure(8.0, 1.0 * 0.1, 1.0), ParachuteDrag.PerPressure(8.0, 450.0 * 0.1, 1.0), 500.0, safeSpeed);

        /// <summary>A capability with its parts read: what the engines can change, the canopies that can still open, the air density and the height the canopies open at.</summary>
        private static CraftCapability Read(double deltaV, bool thrusting, ThrustAcceleration measured, double engineChange, double airspeed, double deployHeight, params CanopyReading[] canopies) =>
            new CraftCapability(deltaV, engineChange, airspeed, false, thrusting, null, measured, engineChange, canopies, 1.1, deployHeight);

        private static double RadiusAt(CraftState known, double seconds) => PositionUncertainty.Bound(known, 1000.0, 1000.0 + seconds)!.Value;

        [Fact]
        public void ASteadyParachuteDescentIsFramedWithinAFewMetresWhenItsPartsCanChangeNothing()
        {
            // A deployed canopy, no engine, 9.75 m/s² held: 0.5 × (0.1 × 9.75 + 0.1) × t².
            var known = Chute(Read(0.0, false, HoldingUp(), 0.0, 5.0, 300.0));

            Assert.Equal(0.5 * (0.1 * Pull + 0.1) * 1.0, RadiusAt(known, 1.0), 1);
            Assert.Equal(0.5 * (0.1 * Pull + 0.1) * 4.0, RadiusAt(known, 2.0), 1);
            Assert.True(RadiusAt(known, 2.0) < 3.0);
        }

        private static CraftCapability WithSolidMotor(double burnSeconds) =>
            new CraftCapability(2000.0, 100.0, 150.0, false, true, null, new ThrustAcceleration(100.0, 0.0, 0.0), 0.0, new CanopyReading[0], 1.1, 300.0, null, new[] { new LockedEngineReading(100.0, burnSeconds) });

        [Fact]
        public void ASolidMotorThatBurnsPastTheEndOfTheRecordAddsNothingToTheRadius()
        {
            var known = Chute(WithSolidMotor(10.0));

            // Only the held error 0.5 × (0.1 × 100 + 0.1) × t²: 20 m at 2 s, where a throttled engine would add 200.
            Assert.Equal(0.5 * (0.1 * 100.0 + 0.1) * 4.0, RadiusAt(known, 2.0), 0);
            Assert.True(RadiusAt(known, 2.0) < 25.0);
        }

        [Fact]
        public void ASolidMotorThatBurnsOutInsideTheRecordCostsOnlyWhatItsBurnTimeCanBeWrongBy()
        {
            var known = Chute(WithSolidMotor(1.5));

            // Held 0.5 × (0.1 × 100 + 0.1) × 4 = 20.2 m, and the burn out by ± 0.25 s: 0.5 × 100 × (0.75² - 0.5²) = 15.6 m.
            Assert.Equal(20.2 + 15.6, RadiusAt(known, 2.0), 0);
        }

        [Fact]
        public void TheLiftoffOfTheRigDescentIsFramedWithinTensOfMetresWhereItWas241()
        {
            // Rig 189 at UT 312: 105 m/s² from a motor with 1.3 s left, framed at 209.5 m for the engine alone.
            var known = Chute(new CraftCapability(2000.0, 105.0, 122.0, false, true, null, new ThrustAcceleration(105.0, 0.0, 0.0), 0.0, new CanopyReading[0], 1.1, 88.0, null, new[] { new LockedEngineReading(105.0, 1.3) }));

            Assert.True(RadiusAt(known, 2.0) < 75.0, $"{RadiusAt(known, 2.0):F1} m");
        }

        [Fact]
        public void ACraftIsCarriedThroughTheBurnoutOfASolidMotorWhereHeldThrustWouldCarryItOnAhead()
        {
            var burnsOut = Chute(WithSolidMotor(1.0));
            var unread = Chute(WithSolidMotor(0.0));

            var apart = Distance(PlacePrediction.PlaceAt(burnsOut, 1002.0)!.Value.Place.Position, PlacePrediction.PlaceAt(unread, 1002.0)!.Value.Place.Position);

            // Thrust of 100 m/s² gone for the last second of two: 0.5 × 100 × 1².
            Assert.Equal(50.0, apart, 0);
        }

        [Fact]
        public void AMotorWhoseBurnTimeWasNotToldCountsAsBurningOutAtOnce()
        {
            var known = Chute(WithSolidMotor(0.0));

            Assert.True(RadiusAt(known, 2.0) > 200.0);
        }

        [Fact]
        public void AParachuteJustArmedIsNotFramedAsFullyOpenBeforeItsPartOpenAnimationCanEnd()
        {
            // Rig 189 at staging: 119 m/s, 702 m up, below the 1000 m opening height, framed at 273.6 m as if fully open at once.
            var semi = ParachuteDrag.PerPressure(8.0, 1.0 * 0.1, 1.0);
            var full = ParachuteDrag.PerPressure(8.0, 450.0 * 0.1, 1.0);
            var atOnce = Chute(Read(0.0, false, HoldingUp(), 0.0, 119.0, 702.0, new CanopyReading(semi, full, 1000.0, null)));
            var timed = Chute(Read(0.0, false, HoldingUp(), 0.0, 119.0, 702.0, new CanopyReading(semi, full, 1000.0, null, 2.2, 3.0, 0.0, 2.5)));

            Assert.True(RadiusAt(atOnce, 2.0) > 200.0);
            Assert.True(RadiusAt(timed, 2.0) < 60.0, $"{RadiusAt(timed, 2.0):F1} m");
        }

        [Fact]
        public void ACanopyPartWayThroughOpeningIsFramedByTheDragItsAnimationCanHaveReachedNotByFullDrag()
        {
            var semi = ParachuteDrag.PerPressure(8.0, 1.0 * 0.1, 1.0);
            var full = ParachuteDrag.PerPressure(8.0, 450.0 * 0.1, 1.0);
            var ramping = Chute(Read(0.0, false, HoldingUp(), 0.0, 119.0, 400.0, CanopyReading.Opening(semi, full, 3.0, 0.2, 2.5)));
            var instant = Chute(Read(0.0, false, HoldingUp(), 0.0, 119.0, 400.0, CanopyReading.Opening(semi, full)));

            Assert.True(RadiusAt(ramping, 2.0) < RadiusAt(instant, 2.0));
            Assert.True(RadiusAt(ramping, 2.0) > 20.0);
        }

        [Fact]
        public void TheBoundOfACraftInTheAirIsDescribedTermByTermWithTheSpeedAndHeightItWasReadAt()
        {
            var known = Chute(Read(0.0, false, HoldingUp(), 0.0, 105.0, 690.0, CanopyReading.Opening(1.0, 2.0)));

            var line = PlacePrediction.DescribeBound(known, 1002.0)!;

            Assert.Contains("airspeedMs=105.0", line);
            Assert.Contains("heightM=690", line);
            Assert.Contains("deployAltitudeM=none", line);
            Assert.Contains("canopies=1 lockedEngines=0", line);
            Assert.Null(PlacePrediction.DescribeBound(Chute(new CraftCapability(0.0, 0.0, 6.0, false, false)), 1002.0));
        }

        [Fact]
        public void ACanopyWhoseFullOpeningHasStartedIsFramedByItsDragClimbingToFullBeforeTheRecordEnds()
        {
            // Rig descent: 105 m/s, 690 m up, a canopy the game calls deployed while its drag still climbs; the camera's aim ran 75 m off in the second after.
            var semi = ParachuteDrag.PerPressure(8.0, 1.0 * 0.1, 1.0);
            var full = ParachuteDrag.PerPressure(8.0, 450.0 * 0.1, 1.0);
            var known = Chute(Read(0.0, false, HoldingUp(), 0.0, 105.0, 690.0, CanopyReading.Opening(semi, full)));

            Assert.True(RadiusAt(known, 2.0) >= 75.0, $"{RadiusAt(known, 2.0):F1} m");
        }

        [Fact]
        public void ARocketUnderThrustIsFramedByItsOwnEngineGoingToNothingAndWhatItsHeldAccelerationCanBeWrongBy()
        {
            // 35 m/s² from engines that can drop to nothing: 0.5 × 35 × t² on top of the held error 0.5 × (3.5 + 0.1) × t².
            var known = Chute(Read(2000.0, true, new ThrustAcceleration(35.0, 0.0, 0.0), 35.0, 150.0, 300.0));

            Assert.Equal((17.5 + 1.8) * 1.0, RadiusAt(known, 1.0), 0);
            Assert.Equal((17.5 + 1.8) * 4.0, RadiusAt(known, 2.0), 0);
        }

        [Fact]
        public void ACoastingCraftWithAnArmedParachuteIsFramedByTheCanopyFullyOpenOnceItCanFallBelowTheOpeningHeight()
        {
            // 1 t capsule, Mk16: 0.36 per half density speed squared fully open; at 1.1 kg/m³ and 100 m/s that is 1 980 m/s².
            var known = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 100.0, 300.0, Mk16()));

            var expected = PositionUncertainty.FreeFall(100.0 + Pull * 2.0, 1_980.0, 2.0) + 0.5 * (0.05 + 0.1) * 4.0;
            Assert.Equal(expected, RadiusAt(known, 2.0), 0);
        }

        [Fact]
        public void AnArmedParachuteHighAboveItsOpeningHeightCanOnlyBePartOpenAndOneThatCanFallBelowItCanBeFullyOpen()
        {
            // 700 m up at 100 m/s: after 1 s it can have fallen 105 m, still above 500 m, so part open: 4.4 m/s². After 2 s it can have fallen 220 m, below 500 m: fully open.
            var known = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 100.0, 700.0, Mk16()));
            var held = 0.5 * (0.05 + 0.1);

            Assert.Equal(PositionUncertainty.FreeFall(100.0 + Pull, 0.5 * 1.1 * 8e-4 * 1e4, 1.0) + held, RadiusAt(known, 1.0), 1);
            Assert.Equal(PositionUncertainty.FreeFall(100.0 + Pull * 2.0, 1_980.0, 2.0) + held * 4.0, RadiusAt(known, 2.0), 0);
            Assert.True(RadiusAt(known, 1.0) < 12.0);
        }

        [Fact]
        public void AnArmedParachuteTheGameHoldsBackCountsAtTheSpeedItWouldOpenAtNotTheSpeedOfTheCraft()
        {
            var free = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 100.0, 300.0, Mk16()));
            var waiting = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 100.0, 300.0, Mk16(60.0)));
            var slow = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 40.0, 300.0, Mk16(60.0)));

            Assert.True(RadiusAt(waiting, 2.0) < RadiusAt(free, 2.0));
            // At 60 m/s it opens with 0.5 × 1.1 × 0.36 × 60² = 713 m/s², whatever speed the craft has above that.
            var expected = PositionUncertainty.FreeFall(100.0 + Pull * 2.0, 0.5 * 1.1 * 0.36 * 3_600.0, 2.0) + 0.5 * (0.05 + 0.1) * 4.0;
            Assert.Equal(expected, RadiusAt(waiting, 2.0), 0);
            // Below its safe speed it counts at the speed the craft has.
            Assert.Equal(PositionUncertainty.FreeFall(40.0 + Pull * 2.0, 0.5 * 1.1 * 0.36 * 1_600.0, 2.0) + 0.5 * (0.05 + 0.1) * 4.0, RadiusAt(slow, 2.0), 0);
        }

        [Fact]
        public void TheStockMk16OnAOneTonneCapsuleFallsAtTheTerminalSpeedTheGameGivesIt()
        {
            // 450 drag on a 0.1 t canopy, a 1 t craft, the game's drag multiplier of 8: it settles at about 6.7 m/s at sea level, where the stock craft does.
            var perPressure = ParachuteDrag.PerPressure(8.0, 450.0 * 0.1, 1.0);

            var terminal = ParachuteDrag.TerminalSpeed(perPressure, 1.225, 9.81);

            Assert.InRange(terminal, 6.0, 7.0);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(3.0)]
        public void EveryRecordHoldsTheTrueDeviationOverItsLifeWhenAnEngineCutsOrAChuteOpens(double age)
        {
            // An engine that cuts at the capture: 35 m/s² taken away for the whole life.
            var rocket = Chute(Read(2000.0, true, new ThrustAcceleration(35.0, 0.0, 0.0), 35.0, 150.0, 300.0));
            // A canopy that goes to full drag at the capture: dv/dt = -c v² with c half the density times what the canopy gives per pressure.
            var armed = Chute(Read(0.0, false, new ThrustAcceleration(-0.5, 0.0, 0.0), 0.0, 100.0, 300.0, Mk16()));
            var c = 0.5 * 1.1 * 0.36;

            for (var life = 0.0; life <= 1.0; life += 0.25)
            {
                var t = age + life;
                Assert.True(0.5 * 35.0 * t * t <= RadiusAt(rocket, t), $"engine cut, age {age} s, +{life} s");
                Assert.True(100.0 * t - Math.Log(1.0 + c * 100.0 * t) / c <= RadiusAt(armed, t), $"chute opens, age {age} s, +{life} s");
            }
        }

        [Fact]
        public void AnUnreadCraftKeepsTheFloorAndAReadOneWithNothingToChangeDoesNot()
        {
            var unread = Chute(new CraftCapability(0.0, 0.0, 6.0, false, false, null, HoldingUp()));
            var read = Chute(Read(0.0, false, HoldingUp(), 0.0, 6.0, 300.0));

            Assert.True(RadiusAt(unread, 1.0) > 10.0);
            Assert.True(RadiusAt(read, 1.0) < 1.0);
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
