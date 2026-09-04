using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The branch of RA's reach rule that decides between a degraded prediction
    /// and a blacked-out one.
    ///
    /// <para>Every other path through <see cref="RaReach"/> needs a running
    /// RealAntennas, but this one does not and is the one most worth pinning: a
    /// moved reflection surface, an install without RA, or a node with no
    /// antennas must all come back ABSENT. Zero would assert that RA carries the
    /// pair nowhere, and a contact predictor reading that goes permanently dark
    /// on the strength of a failed read rather than falling back to geometry.</para>
    /// </summary>
    public class RaReachFailSoftTests
    {
        /// <summary>
        /// No RealAntennas assembly loaded at all, which is what
        /// <c>RaReflection.Probe</c> returns null for. The backend would not be
        /// elected in that case, but the rule must still answer honestly rather
        /// than throw or claim a limit.
        /// </summary>
        [Fact]
        public void NoReflectionSurfaceDeclaresNothing()
        {
            var model = RaReach.Between(null, new object(), new object());

            Assert.Equal(CommsReachModels.UnknownModelId, model.ModelId);
            Assert.Null(model.MaxRangeMeters);
        }

        /// <summary>
        /// And the consequence a consumer actually depends on: an absent maximum
        /// answers "I cannot say" to the reach question, which is a third answer
        /// and not a false.
        /// </summary>
        [Fact]
        public void AnAbsentMaximumAnswersNeitherYesNorNo()
        {
            var model = RaReach.Between(null, new object(), new object());

            Assert.Null(CommsReachModels.Reaches(model, 1.0));
            Assert.Null(CommsReachModels.Reaches(model, 4e10));
        }
    }
}
