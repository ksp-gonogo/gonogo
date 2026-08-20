using System;
using System.Linq;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The sweep driven by a real propagated orbit against a real rotating
    /// station. Kerbin's own numbers throughout, because the question that
    /// produced this code is a Kerbin one.
    /// </summary>
    public class OrbitVisibilityTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinRotationPeriod = 21_549.425;

        private const int Kerbin = 0;

        /// <summary>RealAntennas tests against the bare radius.</summary>
        private const double BareOccluder = KerbinRadius;

        /// <summary>Stock CommNet's atmospheric multiplier, 0.75.</summary>
        private const double StockAtmosphereOccluder = 0.75 * KerbinRadius;

        private static RotatingGroundStation EquatorialStation()
        {
            return RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);
        }

        private static RotatingGroundStation PolarStation()
        {
            return RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 90.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);
        }

        /// <summary>
        /// The craft as the geometry now takes it: named, along with the body it
        /// orbits, rather than handed over as a bare conic. Kerbin is index 0 here
        /// because these are all same-body cases, so no body table is involved and
        /// the index only has to agree with itself.
        /// </summary>
        private static PropagationTarget CircularCraft(double sma, double incDeg = 0.0)
        {
            return PropagationTarget.Vessel("test-craft", Kerbin, new OrbitElements(
                sma: sma,
                ecc: 0.0,
                inc: incDeg * Math.PI / 180.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: KerbinMu));
        }

        [Fact]
        public void AKeostationaryVesselParkedOverTheStationIsNeverOccluded()
        {
            // Matched periods and a common starting longitude: the vessel hangs
            // over the station forever, so the sweep must find nothing at all
            // across three whole rotations.
            double keostationarySma = Math.Cbrt(
                KerbinMu * KerbinRotationPeriod * KerbinRotationPeriod / (4.0 * Math.PI * Math.PI));

            var geometry = new OrbitToGroundStationGeometry(
                CircularCraft(keostationarySma), EquatorialStation(), BareOccluder);

            VisibilitySweepResult result = VisibilitySweep.Run(
                geometry, 0.0, 3.0 * KerbinRotationPeriod, stepSeconds: 5.0);

            Assert.True(result.ClearAtStart);
            Assert.Empty(result.Changes);
        }

        [Fact]
        public void ALowEquatorialVesselIsAlwaysOccludedFromThePole()
        {
            // A 100 km equatorial orbit seen from the north pole: the chord's
            // closest approach to the centre is ~456 km at every point of the
            // orbit, comfortably inside a 600 km occluder, and the pole sits on
            // the spin axis so the body's rotation cannot help.
            var geometry = new OrbitToGroundStationGeometry(
                CircularCraft(KerbinRadius + 100_000.0), PolarStation(), BareOccluder);

            VisibilitySweepResult result = VisibilitySweep.Run(
                geometry, 0.0, 3.0 * geometry.PeriodSeconds!.Value, stepSeconds: 3.0);

            Assert.False(result.ClearAtStart);
            Assert.Empty(result.Changes);
        }

        [Fact]
        public void ALowPassOpensAndClosesOnceEachTimeItComesRound()
        {
            var geometry = new OrbitToGroundStationGeometry(
                CircularCraft(KerbinRadius + 100_000.0), EquatorialStation(), BareOccluder);

            VisibilitySweepResult result = VisibilitySweep.Run(
                geometry, 0.0, 3.0 * geometry.PeriodSeconds!.Value, stepSeconds: 3.0);

            // Overhead at UT 0, so: clear, then loss/acquisition alternating.
            Assert.True(result.ClearAtStart);
            Assert.False(result.Changes[0].BecameClear);
            for (int i = 1; i < result.Changes.Count; i++)
            {
                Assert.NotEqual(result.Changes[i - 1].BecameClear, result.Changes[i].BecameClear);
            }

            Assert.InRange(result.Changes.Count(c => !c.BecameClear), 3, 4);
        }

        [Fact]
        public void TheBareRadiusPredictsAMarkedlyLongerBlackoutThanTheStockOccluder()
        {
            // The reason the occluding radius has to be settled rather than
            // guessed: the same orbit, the same station, the same UT window, and
            // the two candidate radii disagree by minutes on every pass.
            PropagationTarget craft = CircularCraft(KerbinRadius + 100_000.0);
            RotatingGroundStation station = EquatorialStation();

            var bare = new OrbitToGroundStationGeometry(craft, station, BareOccluder);
            var stock = new OrbitToGroundStationGeometry(craft, station, StockAtmosphereOccluder);

            double window = 2.0 * bare.PeriodSeconds!.Value;
            double bareBlackout = TotalBlockedSeconds(VisibilitySweep.Run(bare, 0.0, window, 1.0, 0.01), window);
            double stockBlackout = TotalBlockedSeconds(VisibilitySweep.Run(stock, 0.0, window, 1.0, 0.01), window);

            Assert.True(
                bareBlackout - stockBlackout > 600.0,
                $"bare {bareBlackout:F0} s vs stock {stockBlackout:F0} s over {window:F0} s");
        }

        [Fact]
        public void ARetrogradeOrbitComesRoundMoreOftenThanAProgradeOneOfTheSameSize()
        {
            // Retrograde adds the body's spin to the relative angular rate where
            // prograde subtracts it, so passes are more frequent. If the 3-1-3
            // rotation ever lost the sign of the inclination, this would fail.
            RotatingGroundStation station = EquatorialStation();
            double sma = KerbinRadius + 100_000.0;

            var prograde = new OrbitToGroundStationGeometry(CircularCraft(sma, 0.0), station, BareOccluder);
            var retrograde = new OrbitToGroundStationGeometry(CircularCraft(sma, 180.0), station, BareOccluder);

            double window = 6.0 * prograde.PeriodSeconds!.Value;
            int progradePasses = VisibilitySweep.Run(prograde, 0.0, window, 2.0)
                .Changes.Count(c => c.BecameClear);
            int retrogradePasses = VisibilitySweep.Run(retrograde, 0.0, window, 2.0)
                .Changes.Count(c => c.BecameClear);

            Assert.True(
                retrogradePasses > progradePasses,
                $"retrograde {retrogradePasses} vs prograde {progradePasses} acquisitions in {window:F0} s");
        }

        [Fact]
        public void APolarOrbitIsSweptWithoutTheEquatorialPlaneBeingAssumed()
        {
            var geometry = new OrbitToGroundStationGeometry(
                CircularCraft(KerbinRadius + 100_000.0, incDeg: 90.0), EquatorialStation(), BareOccluder);

            VisibilitySweepResult result = VisibilitySweep.Run(
                geometry, 0.0, 3.0 * geometry.PeriodSeconds!.Value, stepSeconds: 3.0);

            Assert.NotEmpty(result.Changes);
            foreach (VisibilityChange change in result.Changes)
            {
                // The refined instant really is the crossing: the margin has the
                // post-change sign just after it and the opposite just before.
                Assert.Equal(change.BecameClear, ChordOcclusion.Unobstructed(geometry.MarginAt(change.Ut + 1.0)));
                Assert.NotEqual(change.BecameClear, ChordOcclusion.Unobstructed(geometry.MarginAt(change.Ut - 1.0)));
            }
        }

        private static double TotalBlockedSeconds(VisibilitySweepResult result, double window)
        {
            double blocked = 0.0;
            double cursor = result.StartUt;
            bool clear = result.ClearAtStart;

            foreach (VisibilityChange change in result.Changes)
            {
                if (!clear)
                {
                    blocked += change.Ut - cursor;
                }

                cursor = change.Ut;
                clear = change.BecameClear;
            }

            if (!clear)
            {
                blocked += (result.StartUt + window) - cursor;
            }

            return blocked;
        }
    }
}
