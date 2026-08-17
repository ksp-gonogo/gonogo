using System;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// <see cref="OrbitElements"/> takes every angle in RADIANS, and KSP's
    /// <c>Orbit</c> reports inclination, LAN and argument of periapsis in
    /// DEGREES while reporting mean anomaly at epoch in radians. Handing KSP's
    /// numbers straight across compiles, runs, and produces a confidently wrong
    /// position, the orbit is rotated by whatever the degree values happen to
    /// be, so a craft can come out on the wrong side of its star.
    ///
    /// <para>It stayed hidden because the bodies it was first checked against
    /// have inclination, LAN and argument of periapsis all equal to zero, where
    /// degrees and radians are the same number. Only an inclined orbit with a
    /// non-zero node tells the two apart.</para>
    /// </summary>
    public class KspDegreeElementsTests
    {
        private const double KerbolMu = 1.1723327948702891e18;

        /// <summary>Kerbin, whose angles are all zero, the case that hid this.</summary>
        private static OrbitElements Kerbin() => OrbitElements.FromKspDegrees(
            sma: 13_599_840_256.0,
            ecc: 0.0,
            incDegrees: 0.0,
            lanDegrees: 0.0,
            argPeDegrees: 0.0,
            meanAnomalyAtEpochRadians: 3.14,
            epoch: 0.0,
            mu: KerbolMu);

        /// <summary>
        /// Asteroid VOH-765, lifted verbatim from the live save that exposed
        /// this. Its inclination, node and periapsis argument are all non-zero,
        /// which is what makes it a witness.
        /// </summary>
        private static OrbitElements Asteroid() => OrbitElements.FromKspDegrees(
            sma: 15_171_239_191.226875,
            ecc: 0.10507156709573846,
            incDegrees: 2.2892824550635074,
            lanDegrees: 151.56227919875971,
            argPeDegrees: 198.86218629922854,
            meanAnomalyAtEpochRadians: 5.9933497459748937,
            epoch: 3_839_682.2320472528,
            mu: KerbolMu);

        private const double SaveUt = 147_406.08938908955;

        [Fact]
        public void DegreesAreConvertedAndRadiansAreLeftAlone()
        {
            var elements = OrbitElements.FromKspDegrees(
                sma: 1.0, ecc: 0.0,
                incDegrees: 180.0, lanDegrees: 90.0, argPeDegrees: 45.0,
                meanAnomalyAtEpochRadians: 1.25, epoch: 0.0, mu: 1.0);

            Assert.Equal(Math.PI, elements.Inc, 12);
            Assert.Equal(Math.PI / 2.0, elements.Lan, 12);
            Assert.Equal(Math.PI / 4.0, elements.ArgPe, 12);
            Assert.Equal(1.25, elements.MeanAnomalyAtEpoch, 12);
        }

        /// <summary>
        /// The live regression. This separation was measured in-game at the
        /// save's own UT: 5,582,261,680 m from a Kerbin ground station, which
        /// at this range is the Kerbin-relative distance to within the station's
        /// own 600 km radius.
        ///
        /// <para>Feeding the degree values through unconverted puts the answer
        /// at about 25,527,000,000 m, off by a factor of four and a half, and
        /// entirely plausible-looking in a log.</para>
        /// </summary>
        [Fact]
        public void TheRealAsteroidReconcilesWithWhatTheGameReported()
        {
            IPropagationProvider propagator = new KeplerProvider();

            var asteroid = propagator.SolveConic(Asteroid(), SaveUt).Position;
            var kerbin = propagator.SolveConic(Kerbin(), SaveUt).Position;

            var separation = (asteroid - kerbin).Magnitude();

            // Tolerance covers the three minutes between the log line and the
            // save being written, over which the asteroid moves ~300 km.
            Assert.InRange(separation, 5_581_000_000.0, 5_584_000_000.0);
        }

        [Fact]
        public void TakingTheDegreesAsRadiansIsWrongByBillionsOfMetres()
        {
            IPropagationProvider propagator = new KeplerProvider();

            var unconverted = new OrbitElements(
                sma: 15_171_239_191.226875,
                ecc: 0.10507156709573846,
                inc: 2.2892824550635074,
                lan: 151.56227919875971,
                argPe: 198.86218629922854,
                meanAnomalyAtEpoch: 5.9933497459748937,
                epoch: 3_839_682.2320472528,
                mu: KerbolMu);

            var wrong = (propagator.SolveConic(unconverted, SaveUt).Position
                - propagator.SolveConic(Kerbin(), SaveUt).Position).Magnitude();

            Assert.True(wrong > 20_000_000_000.0,
                "the unconverted form should be grossly wrong; got " + wrong);
        }
    }
}
