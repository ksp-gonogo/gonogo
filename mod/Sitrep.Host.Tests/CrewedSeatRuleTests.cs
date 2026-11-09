using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class CrewedSeatRuleTests
    {
        [Fact]
        public void CrewAboardTheActiveCraftAreASeatWhateverItsAntennas()
        {
            Assert.True(CrewedSeatRule.QualifiesAsSeat(isActiveCraft: true, crewAboard: 1, isControlSource: false, reachable: false));
        }

        [Fact]
        public void CrewAboardAnotherCraftAreNotASeatOnThatAccount()
        {
            Assert.False(CrewedSeatRule.QualifiesAsSeat(isActiveCraft: false, crewAboard: 2, isControlSource: false, reachable: false));
        }

        [Fact]
        public void TheActiveCraftWithNoCrewAndNoControlSourceIsNotASeat()
        {
            Assert.False(CrewedSeatRule.QualifiesAsSeat(isActiveCraft: true, crewAboard: 0, isControlSource: false, reachable: false));
        }

        [Fact]
        public void AReachableControlSourceStaysACentreAsBefore()
        {
            Assert.True(CrewedSeatRule.QualifiesAsSeat(isActiveCraft: false, crewAboard: 0, isControlSource: true, reachable: true));
        }

        [Fact]
        public void AControlSourceNothingCanReachStaysOutAsBefore()
        {
            Assert.False(CrewedSeatRule.QualifiesAsSeat(isActiveCraft: false, crewAboard: 0, isControlSource: true, reachable: false));
        }

        [Fact]
        public void CrewAboardTheActiveCraftAreASeatBeforeCommNetHasANodeForIt()
        {
            Assert.True(CrewedSeatRule.QualifiesAsSeat(hasNode: false, isActiveCraft: true, crewAboard: 1, isControlSource: false, reachable: false));
        }

        [Fact]
        public void ACraftWithNoNodeAndNoCrewAboardIsNoSeat()
        {
            Assert.False(CrewedSeatRule.QualifiesAsSeat(hasNode: false, isActiveCraft: true, crewAboard: 0, isControlSource: false, reachable: false));
            Assert.False(CrewedSeatRule.QualifiesAsSeat(hasNode: false, isActiveCraft: false, crewAboard: 2, isControlSource: false, reachable: false));
        }

        [Fact]
        public void WithANodeTheOriginalRuleStandsUnchanged()
        {
            Assert.True(CrewedSeatRule.QualifiesAsSeat(hasNode: true, isActiveCraft: false, crewAboard: 0, isControlSource: true, reachable: true));
            Assert.False(CrewedSeatRule.QualifiesAsSeat(hasNode: true, isActiveCraft: false, crewAboard: 0, isControlSource: true, reachable: false));
        }
    }
}
