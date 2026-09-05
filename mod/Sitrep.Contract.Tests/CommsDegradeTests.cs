using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// The three promises <c>comms.degrade</c> makes to a consumer that keys a
    /// quality decision on it: the scale is 0..1 whatever a backend hands over,
    /// ABSENT is a third answer rather than a low number, and a backend that
    /// declines to grade is distinguishable from one that grades the link
    /// perfect.
    ///
    /// <para>The failure these replicate is the one already shipping under
    /// <c>comms.signalStrength</c>: a bare 0..1 with no way to say "nobody
    /// measured this", read by a camera feed as <c>1 - value</c>. On an install
    /// whose backend cannot grade, the honest answer and the most alarming
    /// answer are the same number, and the feed blacks out a picture that is
    /// arriving. Every test below is that confusion made impossible.</para>
    ///
    /// <para>They live in this project deliberately: it models a runtime
    /// consumer holding the contract and nothing else, which is the position an
    /// out-of-tree Uplink reading this channel is in.</para>
    /// </summary>
    public class CommsDegradeTests
    {
        /// <summary>
        /// ABSENT IS NOT ZERO, the whole reason the rating is nullable.
        ///
        /// <para>Asserted through <see cref="CommsDegradeModels.LevelOf"/> as
        /// well as off the model, because the read is where a consumer would
        /// otherwise flatten the distinction with a <c>?? 0</c>.</para>
        /// </summary>
        [Fact]
        public void UnratedIsNotAZero()
        {
            var unrated = new RatedDegradeModel("test", "Test", null);
            var pristine = new RatedDegradeModel("test", "Test", 0.0);

            Assert.Null(unrated.Level);
            Assert.Equal(0.0, pristine.Level);
            Assert.NotEqual(pristine.Level, unrated.Level);

            Assert.Null(CommsDegradeModels.LevelOf(unrated));
            Assert.Equal(0.0, CommsDegradeModels.LevelOf(pristine));

            // And the one core declares is the unrated kind, not the perfect
            // kind: nothing elected means nothing graded.
            Assert.Null(CommsDegradeModels.Unknown.Level);
            Assert.Equal(CommsDegradeModels.UnknownModelId, CommsDegradeModels.Unknown.ModelId);
        }

        /// <summary>
        /// A backend that REFUSES to grade and one that grades the link perfect
        /// are told apart by two independent things: the rating itself, and the
        /// id that travels with it. Either alone would do; both is what lets a
        /// consumer act on the number and a surface report the provenance.
        /// </summary>
        [Fact]
        public void ARefusalIsDistinguishableFromAGradedZero()
        {
            var refuses = CommsDegradeModels.Unknown;
            var gradesPerfect = new RatedDegradeModel("stock-like", "Stock-like", 0.0);

            Assert.Null(refuses.Level);
            Assert.Equal(0.0, gradesPerfect.Level);
            Assert.NotEqual(refuses.ModelId, gradesPerfect.ModelId);

            // The comparison every consumer shares keeps the distinction too: a
            // refusal answers null rather than "no, the link is fine", which is
            // what a bare `>=` over a substituted zero would have said.
            Assert.Null(CommsDegradeModels.AtLeast(refuses, 0.5));
            Assert.False(CommsDegradeModels.AtLeast(gradesPerfect, 0.5));
        }

        /// <summary>
        /// A finite rating outside the scale CLAMPS to the end it overshot, so
        /// no consumer ever sees a number the contract promised could not exist.
        /// Both directions, because both are reachable: a headroom fraction can
        /// exceed 1 and a difference of two live reads can go slightly negative.
        /// </summary>
        [Fact]
        public void AFiniteRatingOutsideTheScaleClampsToTheEndItOvershot()
        {
            Assert.Equal(1.0, new RatedDegradeModel("x", "x", 1.4).Level);
            Assert.Equal(0.0, new RatedDegradeModel("x", "x", -0.25).Level);

            // The boundaries themselves are IN range and are not touched, which
            // is what makes the clamp a clamp rather than an exclusion.
            Assert.Equal(0.0, new RatedDegradeModel("x", "x", 0.0).Level);
            Assert.Equal(1.0, new RatedDegradeModel("x", "x", 1.0).Level);
            Assert.Equal(0.5, new RatedDegradeModel("x", "x", 0.5).Level);
        }

        /// <summary>
        /// A NON-finite rating becomes ABSENT rather than clamping, and that
        /// asymmetry with the case above is the point. A NaN is an arithmetic
        /// that did not run, so there is no end it overshot; worse, it fails
        /// every comparison silently, so a NaN that survived would read as "not
        /// degraded" to exactly the consumer this channel exists to serve.
        /// </summary>
        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        public void ANonFiniteRatingBecomesUnratedRatherThanClamping(double level)
        {
            var model = new RatedDegradeModel("x", "x", level);

            Assert.Null(model.Level);
            Assert.Null(CommsDegradeModels.AtLeast(model, 0.5));
        }

        /// <summary>
        /// The shared comparison's three answers, at the boundary that decides a
        /// quality ladder's rung. Meeting a threshold EXACTLY counts as meeting
        /// it, so ascending thresholds pick the highest rung the rating reaches
        /// rather than falling between two of them.
        /// </summary>
        [Fact]
        public void AtLeastAdmitsItsBoundaryAndAnswersNullWhenNobodyGraded()
        {
            var half = new RatedDegradeModel("x", "x", 0.5);

            Assert.True(CommsDegradeModels.AtLeast(half, 0.5));
            Assert.True(CommsDegradeModels.AtLeast(half, 0.4999));
            Assert.False(CommsDegradeModels.AtLeast(half, 0.5001));

            // No model at all is the same position as an unrated one: a consumer
            // holding neither has been told nothing either way.
            Assert.Null(CommsDegradeModels.AtLeast(null, 0.5));
            Assert.Null(CommsDegradeModels.LevelOf(null));

            // A threshold that is not a number is not a question, so it gets no
            // answer rather than the false a bare `>=` would return.
            Assert.Null(CommsDegradeModels.AtLeast(half, double.NaN));
        }

        /// <summary>
        /// The payload carries the rating AND the rule, and a producer holding
        /// no model publishes the honest "nobody graded this" rather than
        /// nothing: the channel is always-present, so a silent one would be
        /// indistinguishable from a stalled uplink.
        /// </summary>
        [Fact]
        public void ThePayloadCarriesTheRuleAndSurvivesAMissingModel()
        {
            var meta = new PayloadMeta { Source = "vessel:abc", Quality = Quality.Loaded };

            var graded = CommsDegradeModels.ToPayload(
                new RatedDegradeModel("some-rule", "Some rule", 0.25), meta);
            Assert.Equal("some-rule", graded.ModelId);
            Assert.Equal("Some rule", graded.ModelName);
            Assert.Equal(0.25, graded.Level);
            Assert.Equal("vessel:abc", graded.Meta.Source);

            var missing = CommsDegradeModels.ToPayload(null, meta);
            Assert.Equal(CommsDegradeModels.UnknownModelId, missing.ModelId);
            Assert.Null(missing.Level);
        }
    }
}
