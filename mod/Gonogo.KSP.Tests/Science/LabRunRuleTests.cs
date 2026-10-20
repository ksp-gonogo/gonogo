using Xunit;

namespace Gonogo.KSP.Tests.Science
{
    /// <summary>
    /// A lab switched on is not the same as a lab producing science: the
    /// converter stops on the conditions below, and the operator needs to tell a
    /// working lab from an idle one.
    /// </summary>
    public class LabRunRuleTests
    {
        [Fact]
        public void ASwitchedOffLabIsNotProducing()
        {
            Assert.False(LabRunRule.Producing(false, true, 100, 0, 500));
        }

        [Fact]
        public void ASwitchedOnOperationalLabHoldingDataProduces()
        {
            Assert.True(LabRunRule.Producing(true, true, 100, 10, 500));
        }

        [Fact]
        public void ASwitchedOnLabWithNoDataIsNotProducing()
        {
            Assert.False(LabRunRule.Producing(true, true, 0, 10, 500));
        }

        [Fact]
        public void ASwitchedOnLabAtItsScienceCapIsNotProducing()
        {
            Assert.False(LabRunRule.Producing(true, true, 100, 500, 500));
        }

        [Fact]
        public void ASwitchedOnLabThatIsNotOperationalIsNotProducing()
        {
            Assert.False(LabRunRule.Producing(true, false, 100, 0, 500));
        }

        [Fact]
        public void AnOperabilityThatCouldNotBeReadLeavesProducingUnknown()
        {
            Assert.Null(LabRunRule.Producing(true, null, 100, 0, 500));
        }

        [Fact]
        public void TheGamesStatusLineIsTheIssueOnlyWhileSwitchedOnAndIdle()
        {
            Assert.Equal("Not enough power", LabRunRule.IssueFor(true, false, "Not enough power"));
            Assert.Null(LabRunRule.IssueFor(true, true, "Working"));
            Assert.Null(LabRunRule.IssueFor(false, false, "Inactive"));
            Assert.Null(LabRunRule.IssueFor(true, null, "Not enough power"));
            Assert.Null(LabRunRule.IssueFor(true, false, " "));
        }
    }
}
