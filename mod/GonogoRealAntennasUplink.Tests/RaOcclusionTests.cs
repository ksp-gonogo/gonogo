using Gonogo.RealAntennasUplink;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// RealAntennas' declared occlusion geometry: the bare body radius, with no
    /// multiplier and no regard for atmosphere.
    ///
    /// <para>This is RA's half of the disagreement with stock CommNet, which
    /// shrinks a body before testing a radio path against it. Core pins stock's
    /// half below the bare radius; this file pins RA's AT it, against the real
    /// declaration the backend hands the election, so between them a predicted
    /// blackout under either install is covered by the project that owns it.</para>
    /// </summary>
    public class RaOcclusionTests
    {
        // Kerbin and the Mun: one body with an atmosphere and one without, which
        // is the only axis any backend currently discriminates on.
        private const double KerbinRadiusMeters = 600_000.0;
        private const double MunRadiusMeters = 200_000.0;

        [Fact]
        public void AtmosphericBody_OccludesAtTheBareRadius()
        {
            Assert.Equal(KerbinRadiusMeters, RaOcclusion.Model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true), 6);
        }

        [Fact]
        public void AirlessBody_OccludesAtTheBareRadius()
        {
            Assert.Equal(MunRadiusMeters, RaOcclusion.Model.OccludingRadiusMeters(MunRadiusMeters, hasAtmosphere: false), 6);
        }

        [Fact]
        public void IgnoresAtmosphere()
        {
            var model = RaOcclusion.Model;

            Assert.Equal(
                model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: false),
                model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true),
                6);
        }

        /// <summary>
        /// The id travels with every resolved radius, so it must say RA's
        /// geometry and never stock's: a predictor naming the wrong model would
        /// misreport which assumption its blackout window rests on.
        /// </summary>
        [Fact]
        public void NamesItselfAndNotStock()
        {
            Assert.Equal("realantennas-bare-radius", RaOcclusion.Model.ModelId);
            Assert.NotEqual("commnet-scaled-radius", RaOcclusion.Model.ModelId);
            Assert.Equal(RaOcclusion.ModelName, RaOcclusion.Model.ModelName);
            Assert.False(string.IsNullOrWhiteSpace(RaOcclusion.Model.ModelName));
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(0.0)]
        [InlineData(-5.0)]
        public void NonPositiveRadius_OccludesNothing(double radius)
        {
            Assert.Equal(0.0, RaOcclusion.Model.OccludingRadiusMeters(radius, hasAtmosphere: true), 6);
            Assert.Equal(0.0, RaOcclusion.Model.OccludingRadiusMeters(radius, hasAtmosphere: false), 6);
        }
    }
}
