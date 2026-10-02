using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Which loaded Making History mission the capture reports
    /// (<see cref="MakingHistoryReads.PickMission"/>). The walk that reads the
    /// mission needs a live game and was never run in one, so the one decision
    /// that does not is checked here.
    /// </summary>
    public class MakingHistoryReadsTests
    {
        private static IReadOnlyList<(bool Started, bool Ended)> Missions(params (bool, bool)[] m) => m;

        [Fact]
        public void NoMissionsPicksNothing()
        {
            Assert.Equal(-1, MakingHistoryReads.PickMission(Missions()));
        }

        [Fact]
        public void ARunningMissionWinsOverAFinishedOneBeforeIt()
        {
            Assert.Equal(1, MakingHistoryReads.PickMission(Missions((true, true), (true, false))));
        }

        [Fact]
        public void AFinishedMissionIsKeptSoTheOutcomeStaysVisible()
        {
            Assert.Equal(1, MakingHistoryReads.PickMission(Missions((false, false), (true, true))));
        }

        [Fact]
        public void AMissionNotYetStartedIsStillReported()
        {
            Assert.Equal(0, MakingHistoryReads.PickMission(Missions((false, false))));
        }
    }
}
