using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace GonogoFerramAerospaceResearchUplink.Tests
{
    /// <summary>
    /// The absence rules, which are the substance of this Uplink. Each test names
    /// the state a real vehicle is in when FAR produces the placeholder under
    /// test, because "FAR writes zero here" is only worth guarding if there is a
    /// flight in which it happens.
    /// </summary>
    public class AeroCaptureTests
    {
        /// <summary>A reading in steady flight, with nothing degenerate about it.</summary>
        private static AeroRaw Flying() => new AeroRaw
        {
            Ut = 100.0,
            AngleOfAttackDeg = 4.5,
            SideslipDeg = -0.25,
            StallFraction = 0.1,
            LiftCoefficient = 0.42,
            DragCoefficient = 0.09,
            LiftToDragRatio = 4.6,
            ReferenceAreaSqM = 18.0,
            LiftForceKn = 61.0,
            DragForceKn = 13.2,
            DynamicPressureKpa = 12.0,
            IndicatedAirspeed = 140.0,
            EquivalentAirspeed = 138.0,
            TerminalVelocity = 310.0,
            BallisticCoefficient = 420.0,
            SpecificExcessPower = 22.0,
            AeroModelValid = true,
        };

        private static Dictionary<string, object?> Built(AeroRaw raw) =>
            AeroCapture.Build(raw) ?? throw new Xunit.Sdk.XunitException("expected a payload");

        [Fact]
        public void NoReadingAtAllPublishesAnExplicitAbsence()
        {
            Assert.Null(AeroCapture.Build(null));
        }

        /// <summary>
        /// The single most important guard here. FAR computes stall fraction as
        /// stalled wing area over total wing area, so a craft with no aerodynamic
        /// wing surfaces divides zero by zero: every launch vehicle carries a NaN
        /// stall fraction for its whole ascent. Published raw it would render as
        /// "not stalled", which is a claim about the vehicle rather than about the
        /// model.
        /// </summary>
        [Fact]
        public void AWinglessCraftHasNoStallFractionRatherThanZero()
        {
            var raw = Flying();
            raw.StallFraction = double.NaN;

            var payload = Built(raw);

            Assert.Null(payload["stallFraction"]);
            // and the rest of the reading survives: a rocket still has an angle
            // of attack, and losing it with the stall fraction would cost the
            // ascent readout the number it exists for.
            Assert.Equal(4.5, Assert.IsType<double>(payload["angleOfAttack"]));
        }

        /// <summary>
        /// On the pad, and through any vacuum coast, FAR substitutes zeros for the
        /// whole force-and-coefficient group rather than leaving it undefined. A
        /// zero angle of attack is the reading a vehicle holding prograde
        /// produces, so a substituted one is indistinguishable from a flown one.
        /// </summary>
        [Fact]
        public void WithNoAirflowTheAerodynamicStateIsAbsentRatherThanZero()
        {
            var raw = Flying();
            raw.DynamicPressureKpa = 0.0;
            raw.AngleOfAttackDeg = 0.0;
            raw.SideslipDeg = 0.0;
            raw.StallFraction = 0.0;
            raw.LiftCoefficient = 0.0;
            raw.DragCoefficient = 0.0;
            raw.LiftToDragRatio = 0.0;
            raw.LiftForceKn = 0.0;
            raw.DragForceKn = 0.0;

            var payload = Built(raw);

            Assert.Null(payload["angleOfAttack"]);
            Assert.Null(payload["sideslip"]);
            Assert.Null(payload["stallFraction"]);
            Assert.Null(payload["liftCoefficient"]);
            Assert.Null(payload["dragCoefficient"]);
            Assert.Null(payload["liftToDragRatio"]);
        }

        /// <summary>
        /// The other half of that rule, and the reason it is not simply "drop
        /// everything below the floor": with no airflow there really is no lift
        /// and no drag, so those zeros are measurements. The reference area is
        /// geometry and does not need airflow either.
        /// </summary>
        [Fact]
        public void WithNoAirflowTheForcesAndTheGeometryStillRead()
        {
            var raw = Flying();
            raw.DynamicPressureKpa = 0.0;
            raw.LiftForceKn = 0.0;
            raw.DragForceKn = 0.0;

            var payload = Built(raw);

            Assert.Equal(0.0, Assert.IsType<double>(payload["liftForce"]));
            Assert.Equal(0.0, Assert.IsType<double>(payload["dragForce"]));
            Assert.Equal(18.0, Assert.IsType<double>(payload["referenceArea"]));
        }

        /// <summary>
        /// FAR sets both to exactly zero in one branch when it declines to compute
        /// them, which is every tick a vessel produces no drag. Neither quantity
        /// can legitimately be zero, so the zero is the decline.
        /// </summary>
        [Fact]
        public void TheDeclinedBallisticCoefficientAndTerminalVelocityAreAbsent()
        {
            var raw = Flying();
            raw.BallisticCoefficient = 0.0;
            raw.TerminalVelocity = 0.0;

            var payload = Built(raw);

            Assert.Null(payload["ballisticCoefficient"]);
            Assert.Null(payload["terminalVelocity"]);
        }

        /// <summary>
        /// Terminal velocity is a square root over atmospheric density, so it goes
        /// infinite the moment there is no atmosphere to divide by. An infinity is
        /// not merely unrenderable, it has no JSON spelling at all.
        /// </summary>
        [Fact]
        public void AnInfiniteTerminalVelocityIsAbsent()
        {
            var raw = Flying();
            raw.TerminalVelocity = double.PositiveInfinity;

            Assert.Null(Built(raw)["terminalVelocity"]);
        }

        /// <summary>Lift over drag, with no drag, on a vehicle that is producing lift.</summary>
        [Fact]
        public void AnInfiniteLiftToDragRatioIsAbsent()
        {
            var raw = Flying();
            raw.LiftToDragRatio = double.PositiveInfinity;

            Assert.Null(Built(raw)["liftToDragRatio"]);
        }

        /// <summary>
        /// FAR derives the density it scales equivalent airspeed by from per-part
        /// dynamic pressure over speed squared, so a stationary vessel divides
        /// zero by zero. Indicated airspeed comes off a different derivation and
        /// stays finite, which is why the two are asserted separately rather than
        /// as a pair.
        /// </summary>
        [Fact]
        public void AStationaryVesselHasNoEquivalentAirspeedButStillHasAnIndicatedOne()
        {
            var raw = Flying();
            raw.EquivalentAirspeed = double.NaN;
            raw.IndicatedAirspeed = 0.0;

            var payload = Built(raw);

            Assert.Null(payload["equivalentAirspeed"]);
            Assert.Equal(0.0, Assert.IsType<double>(payload["indicatedAirspeed"]));
        }

        /// <summary>
        /// The sign is the whole point of this one: an X-plane that can no longer
        /// climb is at negative specific excess power, and that is the moment an
        /// operator most needs to read it. The zero test the two coefficients
        /// above get would throw exactly that away.
        /// </summary>
        [Fact]
        public void NegativeSpecificExcessPowerIsAReadingRatherThanAnAbsence()
        {
            var raw = Flying();
            raw.SpecificExcessPower = -8.5;

            Assert.Equal(-8.5, Assert.IsType<double>(Built(raw)["specificExcessPower"]));
        }

        /// <summary>
        /// The qualifier survives when the readings do not. The tick after a stage
        /// separation is precisely when an operator needs to be told the model has
        /// not caught up, and it is also a tick the readings may be degenerate in.
        /// </summary>
        [Fact]
        public void TheVoxelisationQualifierIsPublishedEvenWithNoAirflow()
        {
            var raw = Flying();
            raw.DynamicPressureKpa = 0.0;
            raw.AeroModelValid = false;

            Assert.False(Assert.IsType<bool>(Built(raw)["aeroModelValid"]));
        }

        /// <summary>
        /// The mapper and the wire type must name the same fields. Nothing else in
        /// the build connects them: the uplink hand-builds this dict and
        /// <c>JsonWriter</c> walks the live tree, so a property renamed on
        /// <see cref="AeroState"/> and not here would ship a payload whose keys the
        /// generated client type does not have, with no compiler anywhere to say
        /// so.
        /// </summary>
        [Fact]
        public void TheDictKeysAreExactlyTheContractTypesProperties()
        {
            var expected = typeof(AeroState)
                .GetProperties()
                .Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name.Substring(1))
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToArray();

            var actual = Built(Flying()).Keys.OrderBy(n => n, StringComparer.Ordinal).ToArray();

            Assert.Equal(expected, actual);
        }
    }
}
