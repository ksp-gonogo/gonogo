using Gonogo.KSP.SilenceTracking;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// The frame self-check and its decomposition log only when their key
    /// changes, and they run at frame cadence while a prediction keeps failing.
    /// A key that moves every frame is a log line every frame, so these pin
    /// which movements count as the same failure.
    /// </summary>
    public class SilenceTraceKeyTests
    {
        [Fact]
        public void AnInterplanetaryResidualDriftingByKilometresPerFrameKeepsOneKey()
        {
            // Two samples 22 ms apart at about 1.2 AU of residual.
            Assert.Equal(
                SilenceTrace.FrameCheckKey(180_271_016_501.0),
                SilenceTrace.FrameCheckKey(180_271_019_842.0));
        }

        [Fact]
        public void ALowOrbitResidualStillPrintsAtKilometreResolution()
        {
            Assert.NotEqual(
                SilenceTrace.FrameCheckKey(63_100.0),
                SilenceTrace.FrameCheckKey(64_100.0));
        }

        [Fact]
        public void AChangeOfScalePrintsAtAnyRange()
        {
            Assert.NotEqual(
                SilenceTrace.FrameCheckKey(1.8e11),
                SilenceTrace.FrameCheckKey(1.8e10));
        }

        [Fact]
        public void TheDecompositionOfAMovingCraftKeepsOneKeyFrameToFrame()
        {
            Assert.Equal(
                SilenceTrace.DecomposeKey(148_185_931_148.0, 148_185_931_148.0, 0.0, 0.0),
                SilenceTrace.DecomposeKey(148_185_937_402.0, 148_185_937_402.0, 0.0, 0.0));
        }

        [Fact]
        public void TheDecompositionPrintsWhenEitherTermDisagreesDifferently()
        {
            Assert.NotEqual(
                SilenceTrace.DecomposeKey(700_000.0, 700_000.0, 0.0, 0.0),
                SilenceTrace.DecomposeKey(700_000.0, 760_000.0, 0.0, 0.0));
        }
    }
}
