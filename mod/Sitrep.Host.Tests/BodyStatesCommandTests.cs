using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <c>system.bodies.statesAt</c>: where a body is at instants the CALLER chose,
    /// from whichever propagation provider the install elected.
    ///
    /// <para>Registered into the vantage-aware store, so the dispatch gate is
    /// asserted here and not only the registration. That distinction is not
    /// theoretical: <see cref="VantageCommandDispatchTests"/> exists because the
    /// live game refused the trajectory query as unknown while every unit test
    /// asserting its registration passed.</para>
    /// </summary>
    public class BodyStatesCommandTests
    {
        [Fact]
        public void TheDispatcherRecognisesTheCommand()
        {
            // Not started and not disposed: this reads registration state only, and
            // Stop() joins a thread Start() never created.
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            Assert.True(
                engine.RecognisesCommandForTests(ChannelEngine.BodyStatesAtCommand),
                "a command registered into the vantage-aware store must also pass "
                    + "the dispatch gate, or it is refused as unknown before the "
                    + "handler is reached");
        }

        [Fact]
        public void TheCommandIsDeclaredWithoutAnUplink()
        {
            // The engine's, not a mod's: the question is about the solar system the
            // install is running, and the answer comes from whichever provider was
            // elected rather than from anyone's plugin.
            Assert.Equal("system.bodies.statesAt", ChannelEngine.BodyStatesAtCommand);
        }

        [Fact]
        public void TheRequestCannotNameAVantage()
        {
            // The same property that must not exist on the trajectory query, for the
            // same reason: a client able to name its own vantage could name somebody
            // else's and be shown what they can see.
            var named = typeof(BodyStatesRequest).GetProperties().Select(p => p.Name);

            Assert.DoesNotContain("Vantage", named);
        }

        [Fact]
        public void TheRequestNamesTheCentreItWantsTheAnswerIn()
        {
            // A body solve answers relative to the frame's centre, and
            // PropagationTarget.Body leaves ParentBodyIndex at -1, so there is no
            // parent on the target for the engine to fall back to. Without this
            // field the reply would be about a frame nobody named.
            var named = typeof(BodyStatesRequest).GetProperties().Select(p => p.Name);

            Assert.Contains("CentreBodyIndex", named);
        }

        [Fact]
        public void TheRequestNamesTheModelItWantsTheAnswerFrom()
        {
            // The model is part of the QUESTION, not a property of whoever answers
            // it. A transfer search is a two-body question by design and must keep
            // getting the two-body answer whatever an install's provider would
            // otherwise hand back.
            var named = typeof(BodyStatesRequest).GetProperties().Select(p => p.Name);

            Assert.Contains("Model", named);
        }

        [Fact]
        public void ARequestThatNamesNoModelDefaultsToNothing()
        {
            // The zero value is Unspecified rather than Analytic, so a caller that
            // forgets the field is refused instead of silently inheriting whatever
            // this install would otherwise have produced. Had Analytic been zero,
            // the field would be decoration: every existing caller would pass the
            // check without ever having made the choice.
            Assert.Equal(TrajectoryKind.Unspecified, new BodyStatesRequest().Model);
        }

        [Fact]
        public void ARefusalCarriesNoStates()
        {
            // A caller reading Solved as "did the call work" would plot an empty
            // grid for an install with no elected provider, which looks like a
            // transfer that cannot be flown rather than a mod that is not answering.
            var reply = BodyStatesReply.Refused("no propagation provider is elected");

            Assert.False(reply.Solved);
            Assert.Empty(reply.States);
            Assert.NotNull(reply.Refusal);
        }

        [Fact]
        public void SolvedIsNotInferredFromAnEmptyList()
        {
            // The control on the assertion above. A caller that asked about no
            // instants gets a solved reply with no states, and that is a different
            // fact from a refusal: reading them the same would draw the same empty
            // plot for a caller's own empty grid and for a broken install.
            var answered = new BodyStatesReply { Solved = true };

            Assert.True(answered.Solved);
            Assert.Empty(answered.States);
            Assert.Null(answered.Refusal);
        }
    }
}
