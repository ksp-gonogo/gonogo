using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The command that walks the whole chain: a client's vantage, the archive, the
    /// seeded provider, an arc. What is asserted here is the wiring; the rules each
    /// stage applies are tested where they live.
    /// </summary>
    public class PlanForVantageCommandTests
    {
        [Fact]
        public void TheCommandIsDeclaredWithoutAnUplink()
        {
            // Registered by the engine rather than by a mod, because the question is
            // not any one mod's: the physics comes from whichever provider is
            // elected, and what makes the answer honest is the archive and the
            // vantage, both of which are core's.
            Assert.Equal("vessel.trajectory.forVantage", ChannelEngine.PlanForVantageCommand);
        }

        [Fact]
        public void TheRequestCannotNameAVantage()
        {
            // The one property that must NOT exist. A client able to name its own
            // vantage could name somebody else's and be shown what they can see,
            // which is the entire delay model defeated by a string field.
            var named = typeof(VantagePlanRequest).GetProperties().Select(p => p.Name).ToArray();

            Assert.DoesNotContain("Vantage", named);
        }

        [Fact]
        public void TheReplyCarriesWhatItWasComputedFromAndForWhom()
        {
            // An arc detached from its seed instant is a path with no claim about
            // when, and one detached from its vantage cannot be told apart from
            // another command centre's answer after a vantage switch.
            var reply = VantagePlanReply.From(
                SeededTrajectory.From(new TrajectoryArc { FromUt = 100, ToUt = 900 }, 100),
                "MissionControl");

            Assert.True(reply.Solved);
            Assert.Equal(100, reply.SeededAtUt);
            Assert.Equal("MissionControl", reply.Vantage);
            Assert.Null(reply.Refusal);
        }

        [Fact]
        public void ARefusalIsNotAnEmptyTrajectory()
        {
            // A client that read Solved as "did the call work" rather than "is there
            // an arc" would draw nothing and say nothing, which looks like a craft
            // going nowhere.
            var reply = VantagePlanReply.Refused("nothing has arrived at this vantage");

            Assert.False(reply.Solved);
            Assert.Null(reply.Arc);
            Assert.NotNull(reply.Refusal);
        }
    }
}
