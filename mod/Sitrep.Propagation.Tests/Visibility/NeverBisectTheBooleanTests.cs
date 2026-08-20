using System;
using System.Linq;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The regression guard for the one mistake this whole search exists to
    /// avoid: treating <c>connected(UT)</c> as if it were monotone and bisecting
    /// it directly between the ends of a window.
    ///
    /// <para>Each test below runs the wrong method alongside the right one on the
    /// same geometry and asserts that they disagree. A future rewrite that
    /// quietly reintroduces endpoint bisection cannot pass them, and the failure
    /// message names the discrepancy rather than a tolerance.</para>
    /// </summary>
    public class NeverBisectTheBooleanTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinRotationPeriod = 21_549.425;

        private const int Kerbin = 0;

        /// <summary>
        /// The wrong method, written out so the test can execute it: read the
        /// boolean at both ends of the window, and if they differ, halve toward
        /// the transition. It has no way to notice a second crossing, and no way
        /// to notice that it walked past the first.
        /// </summary>
        private static double? BisectTheBoolean(IVisibilityGeometry geometry, double lowUt, double highUt)
        {
            bool lowClear = ChordOcclusion.Unobstructed(geometry.MarginAt(lowUt));
            if (lowClear == ChordOcclusion.Unobstructed(geometry.MarginAt(highUt)))
            {
                return null;
            }

            for (int i = 0; i < 200 && (highUt - lowUt) > 0.01; i++)
            {
                double midUt = lowUt + ((highUt - lowUt) * 0.5);
                if (ChordOcclusion.Unobstructed(geometry.MarginAt(midUt)) == lowClear)
                {
                    lowUt = midUt;
                }
                else
                {
                    highUt = midUt;
                }
            }

            return lowUt + ((highUt - lowUt) * 0.5);
        }

        private static OrbitToGroundStationGeometry LowKerbinOrbitOverAnEquatorialStation()
        {
            var craft = PropagationTarget.Vessel("test-craft", Kerbin, new OrbitElements(
                sma: KerbinRadius + 100_000.0,
                ecc: 0.0,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: KerbinMu));

            RotatingGroundStation station = RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinRotationPeriod,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

            return new OrbitToGroundStationGeometry(craft, station, KerbinRadius);
        }

        /// <summary>
        /// Every crossing over three orbits, found the sound way, so each test
        /// below can carve out a window whose endpoints it knows the state of.
        /// </summary>
        private static VisibilitySweepResult Reference(OrbitToGroundStationGeometry geometry)
        {
            return VisibilitySweep.Run(geometry, 0.0, 3.0 * geometry.PeriodSeconds!.Value, 1.0, 0.01);
        }

        [Fact]
        public void OverAWindowThatOpensAndClosesClearTheBooleanBisectionSeesNoOutageAtAll()
        {
            // A window spanning one whole blackout, starting and ending a minute
            // clear of it. The two endpoints agree, so the wrong method concludes
            // "no transition" and reports full coverage across an hour in which
            // the vessel spent a quarter of an orbit behind Kerbin.
            OrbitToGroundStationGeometry geometry = LowKerbinOrbitOverAnEquatorialStation();
            VisibilitySweepResult reference = Reference(geometry);

            double loss = reference.Changes.First(c => !c.BecameClear).Ut;
            double acquisition = reference.Changes.First(c => c.Ut > loss && c.BecameClear).Ut;
            double blackout = acquisition - loss;
            Assert.True(blackout > 600.0, $"expected a substantial blackout, measured {blackout:F0} s");

            double windowStart = loss - 60.0;
            double windowEnd = acquisition + 60.0;

            Assert.Null(BisectTheBoolean(geometry, windowStart, windowEnd));

            VisibilitySweepResult swept = VisibilitySweep.Run(geometry, windowStart, windowEnd, 3.0, 0.01);
            Assert.Equal(2, swept.Changes.Count);
            Assert.False(swept.Changes[0].BecameClear);
            Assert.True(swept.Changes[1].BecameClear);
            Assert.Equal(loss, swept.Changes[0].Ut, 1);
            Assert.Equal(acquisition, swept.Changes[1].Ut, 1);
        }

        [Fact]
        public void AcrossThreeCrossingsTheBooleanBisectionConvergesOnTheWrongOne()
        {
            // Endpoints that DO disagree, so the wrong method returns a number and
            // looks like it worked. Losses at 100 s and 900 s with a reacquisition
            // at 200 s between them: the very first probe, at the window's
            // midpoint, finds a clear path and throws away the whole first half.
            // The answer is off by 800 s and carries no hint that it might be.
            //
            // The roots are dictated here rather than taken from an orbit because
            // WHICH root endpoint bisection stumbles onto depends on where the
            // midpoints happen to land. Sometimes it is the right one. That is the
            // point: the method is not approximately right, it is unsound, and a
            // test that only sampled a lucky geometry would not say so.
            var geometry = new AnalyticGeometry(t =>
                (t >= 100.0 && t < 200.0) || t >= 900.0 ? -1.0 : 1.0);

            double? naive = BisectTheBoolean(geometry, 0.0, 1_000.0);
            Assert.NotNull(naive);
            Assert.Equal(900.0, naive!.Value, 1);

            VisibilitySweepResult swept = VisibilitySweep.Run(geometry, 0.0, 1_000.0, 10.0, 0.01);
            Assert.Equal(3, swept.Changes.Count);
            Assert.Equal(100.0, swept.Changes[0].Ut, 1);
            Assert.Equal(200.0, swept.Changes[1].Ut, 1);
            Assert.Equal(900.0, swept.Changes[2].Ut, 1);
        }

        [Fact]
        public void OverSeveralOrbitsTheBooleanBisectionCanOnlyEverReportOneOfManyCrossings()
        {
            // The structural objection, on real geometry: a low orbit crosses the
            // horizon twice per revolution, and no amount of halving between two
            // endpoints can return more than a single number.
            OrbitToGroundStationGeometry geometry = LowKerbinOrbitOverAnEquatorialStation();
            VisibilitySweepResult reference = Reference(geometry);

            // Twice a revolution, less however much the window's ends truncate.
            Assert.True(
                reference.Changes.Count >= 5,
                $"three orbits should cross the horizon at least five times, found {reference.Changes.Count}");

            double? naive = BisectTheBoolean(geometry, reference.StartUt, reference.EndUt);
            int reportableByBisection = naive.HasValue ? 1 : 0;
            Assert.True(reference.Changes.Count > reportableByBisection + 1);
        }

        [Fact]
        public void TheSweepFindsBothEdgesOfAWindowWhoseEndpointsAgree()
        {
            // The same trap in its purest form, with a synthetic margin: any
            // method that only inspects the two endpoints is blind to a state that
            // opens and closes strictly inside them.
            var geometry = new AnalyticGeometry(t => (t >= 400.0 && t <= 700.0) ? -1.0 : 1.0);

            Assert.Null(BisectTheBoolean(geometry, 0.0, 1_000.0));

            VisibilitySweepResult swept = VisibilitySweep.Run(geometry, 0.0, 1_000.0, 10.0, 0.01);
            Assert.Equal(2, swept.Changes.Count);
            Assert.Equal(400.0, swept.Changes[0].Ut, 1);
            Assert.Equal(700.0, swept.Changes[1].Ut, 1);
        }
    }
}
