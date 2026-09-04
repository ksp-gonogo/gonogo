using System;
using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// <see cref="SceneExitRule"/>'s four refusals and its one success, in the
    /// order they are decided. Every one of them is about the same property:
    /// the scene is not left unless the state that would be reverted has
    /// provably been written first.
    /// </summary>
    public class SceneExitRuleTests
    {
        private sealed class Recorder
        {
            public int SaveCalls;
            public int LeaveCalls;
            public string? SaveReturns = "saves/Career/persistent.sfs";
            public Exception? SaveThrows;

            public string? Save()
            {
                SaveCalls++;
                if (SaveThrows != null) throw SaveThrows;
                return SaveReturns;
            }

            public void Leave() => LeaveCalls++;
        }

        [Fact]
        public void ItSavesBeforeItLeaves()
        {
            var recorder = new Recorder();

            var result = SceneExitRule.SaveThenLeave(
                null, null, recorder.Save, recorder.Leave);

            Assert.True(result.Success);
            Assert.Equal(1, recorder.SaveCalls);
            Assert.Equal(1, recorder.LeaveCalls);
        }

        /// <summary>
        /// The replication, at the decision. <c>NOT_IN_ATMOSPHERE</c> is the arm
        /// that fires for any vessel KSP calls FLYING, which is the whole of a
        /// launch and the whole of a re-entry, and it is also exactly when the
        /// autosave has been skipped for as long as the arm has held. That is
        /// the 240,355-second case.
        /// </summary>
        [Theory]
        [InlineData("not in atmosphere")]
        [InlineData("not under acceleration")]
        [InlineData("not while about to crash")]
        [InlineData("not while moving over surface")]
        [InlineData("not while on a ladder")]
        public void ItLeavesNothingAndSavesNothingWhenTheFlightIsNotClearToSave(string arm)
        {
            var recorder = new Recorder();

            var result = SceneExitRule.SaveThenLeave(
                null, arm, recorder.Save, recorder.Leave);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotClearToProceed, result.ErrorCode);
            Assert.Equal(arm, result.Detail);
            Assert.Equal(0, recorder.LeaveCalls);
            // Not merely "does not leave": a save KSP has declared unwritable is
            // the write that puts a mid-aerodynamic FlightState on disk, which
            // is why every one of these arms exists.
            Assert.Equal(0, recorder.SaveCalls);
        }

        /// <summary>
        /// <c>GamePersistence.SaveGame</c> returns an empty string when
        /// <c>Parameters.Flight.CanAutoSave</c> is false, and stock's own
        /// <c>PauseMenu.saveAndExit</c> ignores it. Reporting success on a write
        /// that did not happen, and then reverting the flight, is the failure
        /// this whole rule is here to refuse.
        /// </summary>
        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void ItDoesNotLeaveWhenTheSaveReturnedNoFile(string? written)
        {
            var recorder = new Recorder { SaveReturns = written };

            var result = SceneExitRule.SaveThenLeave(
                null, null, recorder.Save, recorder.Leave);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Equal(SceneExitRule.SaveDidNotHappen, result.Detail);
            Assert.Equal(1, recorder.SaveCalls);
            Assert.Equal(0, recorder.LeaveCalls);
        }

        /// <summary>
        /// A throwing save is a save that did not provably happen, so it takes
        /// the same branch. Fail-closed: the cost of refusing a scene change is
        /// an operator pressing again, the cost of the other direction is the
        /// flight.
        /// </summary>
        [Fact]
        public void ItDoesNotLeaveWhenTheSaveThrew()
        {
            var recorder = new Recorder { SaveThrows = new InvalidOperationException("disk on fire") };

            var result = SceneExitRule.SaveThenLeave(
                null, null, recorder.Save, recorder.Leave);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Contains("disk on fire", result.Detail!);
            Assert.Equal(0, recorder.LeaveCalls);
        }

        /// <summary>
        /// The two permission flags stock requires before it will even DRAW the
        /// Tracking Station button. Checked first: a destination the game
        /// forbids is not worth writing a save for.
        /// </summary>
        [Fact]
        public void ItRefusesAForbiddenDestinationWithoutTouchingTheSave()
        {
            var recorder = new Recorder();

            var result = SceneExitRule.SaveThenLeave(
                "this game does not permit going to the tracking station",
                null,
                recorder.Save,
                recorder.Leave);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotClearToProceed, result.ErrorCode);
            Assert.Equal("this game does not permit going to the tracking station", result.Detail);
            Assert.Equal(0, recorder.SaveCalls);
            Assert.Equal(0, recorder.LeaveCalls);
        }

        /// <summary>
        /// A forbidden destination is reported ahead of an unsavable flight.
        /// Both are true and only one of them is the operator's next move:
        /// waiting out an arm to reach a scene the save will never allow is the
        /// wrong thing to be told to do.
        /// </summary>
        [Fact]
        public void TheForbiddenDestinationIsReportedAheadOfTheFlightArm()
        {
            var recorder = new Recorder();

            var result = SceneExitRule.SaveThenLeave(
                "this game does not permit going to the tracking station",
                "not in atmosphere",
                recorder.Save,
                recorder.Leave);

            Assert.Equal("this game does not permit going to the tracking station", result.Detail);
        }

        /// <summary>
        /// Outside the flight scene there is no flight to judge, so the arm is
        /// absent rather than clear, and the save still happens: the space
        /// centre holds live scenario modules too (funds, science, a career
        /// mod's construction queue), and the tracking station re-reads all of
        /// them off disk exactly the same way.
        /// </summary>
        [Fact]
        public void ItStillSavesWhenThereIsNoFlightToJudge()
        {
            var recorder = new Recorder();

            var result = SceneExitRule.SaveThenLeave(
                null, null, recorder.Save, recorder.Leave);

            Assert.True(result.Success);
            Assert.Equal(1, recorder.SaveCalls);
            Assert.Equal(1, recorder.LeaveCalls);
        }
    }
}
