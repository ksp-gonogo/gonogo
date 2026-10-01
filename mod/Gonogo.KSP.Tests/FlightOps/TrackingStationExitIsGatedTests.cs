using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// The defect this suite exists for, read off the shipped source because
    /// <see cref="Gonogo.KSP.KspFlightOpsActuator"/> reaches <c>HighLogic</c>,
    /// <c>FlightGlobals</c> and <c>GamePersistence</c> and not one line of it
    /// runs headlessly.
    ///
    /// <para><c>ksp.toTrackingStation</c> shipped as a bare
    /// <c>HighLogic.LoadScene(GameScenes.TRACKSTATION)</c>: no save, no gate,
    /// nothing. Leaving flight that way is a RELOAD, not a move (see
    /// <see cref="Gonogo.KSP.SceneExitRule"/>), and it cost the rig 240,355
    /// seconds of universal time, the funds earned since the last write, and a
    /// construction queue, twice.</para>
    ///
    /// <para>Reading source is a blunt instrument and it is the only one that
    /// reaches this method, the same trade
    /// <c>AwayScienceArmIsWiredTests</c> already makes. The decision itself is
    /// exercised properly in <see cref="SceneExitRuleTests"/>; what is checked
    /// here is that the actuator asks it.</para>
    /// </summary>
    public class TrackingStationExitIsGatedTests
    {
        private static string ToTrackingStationBody() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "public CommandResult ToTrackingStation()");

        /// <summary>
        /// The replication. A scene load reached directly from this method is
        /// the whole defect: it destroys every live scenario module unharvested
        /// and then lets the on-disk copy win.
        /// </summary>
        [Fact]
        public void TheSceneLoadIsReachedThroughTheRuleRatherThanCalledDirectly()
        {
            var body = ToTrackingStationBody();

            Assert.Contains("SceneExitRule.SaveThenLeave", body);
            // The scene load exists exactly once and only as the rule's last
            // argument, so it is unreachable except from the rule's last line.
            // Substring-counted rather than "does not contain": the call has to
            // be somewhere, and a second one added beside it is precisely the
            // regression this suite is for.
            Assert.Equal(1, Occurrences(body, "HighLogic.LoadScene"));
            Assert.Contains("() => HighLogic.LoadScene(GameScenes.TRACKSTATION)", body);
        }

        private static int Occurrences(string haystack, string needle)
        {
            var count = 0;
            var at = haystack.IndexOf(needle, System.StringComparison.Ordinal);
            while (at >= 0)
            {
                count++;
                at = haystack.IndexOf(needle, at + needle.Length, System.StringComparison.Ordinal);
            }
            return count;
        }

        /// <summary>
        /// The gate is KSP's own authority for this question, and it is the same
        /// one <c>Recover()</c> five methods away already asks. It is asked
        /// only when there is a flight to judge: <c>ClearToSave</c>'s first line
        /// dereferences <c>ActiveVessel</c> with no null check, and this command
        /// is legitimately issued from the space centre.
        /// </summary>
        [Fact]
        public void TheFlightIsAskedWhetherItIsClearToSave()
        {
            var arm = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "private static string? NotClearToLeaveFlight()");

            Assert.Contains("FlightGlobals.ClearToSave()", arm);
            Assert.Contains("GameWords.Phrase(clear)", arm);
            Assert.Contains("HighLogic.LoadedSceneIsFlight", arm);
            Assert.Contains("FlightGlobals.ActiveVessel == null", arm);
            Assert.Contains("NotClearToLeaveFlight()", ToTrackingStationBody());
        }

        /// <summary>
        /// <c>BACKUP</c> rotates a timestamped copy of the existing
        /// <c>persistent.sfs</c> into <c>Backup/</c> before writing, which is
        /// what <c>FlightAutoSave</c> does. <c>OVERWRITE</c>, which stock's two
        /// exit buttons use, is how a bad save becomes the only save, and this
        /// command's whole subject is losing save state.
        /// </summary>
        [Fact]
        public void TheSaveRotatesABackupRatherThanOverwriting()
        {
            var body = ToTrackingStationBody();

            Assert.Contains("SaveMode.BACKUP", body);
            Assert.DoesNotContain("SaveMode.OVERWRITE", body);
        }

        private static string Body(string signature) =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"), signature);

        /// <summary>
        /// <c>ksp.toSpaceCenter</c> and <c>ksp.switchVessel</c> (from the Tracking Station) leave through the
        /// same rule, via the one helper that holds the single save, so neither
        /// can reach a scene load or a save of its own.
        /// </summary>
        [Fact]
        public void TheOtherSceneMovesLeaveThroughTheSameRule()
        {
            foreach (var signature in new[] { "public CommandResult ToSpaceCenter()", "public CommandResult SwitchVessel(string vesselId)" })
            {
                var body = Body(signature);

                Assert.Contains("SaveThenLeaveTo(", body);
                Assert.DoesNotContain("GamePersistence.SaveGame", body);
                Assert.DoesNotContain("SaveMode.OVERWRITE", body);
            }

            var helper = Body("private static CommandResult SaveThenLeaveTo(string? destinationRefusal, Action leave)");
            Assert.Contains("SceneExitRule.SaveThenLeave", helper);
            Assert.Contains("SaveMode.BACKUP", helper);
            Assert.DoesNotContain("SaveMode.OVERWRITE", helper);
            Assert.Contains("NotClearToLeaveFlight()", helper);
            Assert.Equal(0, Occurrences(helper, "HighLogic.LoadScene"));
        }

        [Fact]
        public void ToSpaceCenterIsRefusedOutsideFlightAndTheTrackingStation()
        {
            var body = Body("public CommandResult ToSpaceCenter()");

            Assert.Contains("GameScenes.FLIGHT", body);
            Assert.Contains("GameScenes.TRACKSTATION", body);
            Assert.Contains("CommandErrorCode.WrongScene", body);
            Assert.Contains("Flight.CanLeaveToSpaceCenter", body);
            Assert.Contains("TrackingStation.CanLeaveToSpaceCenter", body);
            Assert.Equal(1, Occurrences(body, "HighLogic.LoadScene"));
            Assert.Contains("HighLogic.LoadScene(GameScenes.SPACECENTER)", body);
        }

        [Fact]
        public void SwitchVesselFromTheTrackingStationRefusesWhatStockRefusesAndLoadsTheSavedIndex()
        {
            var body = Body("public CommandResult SwitchVessel(string vesselId)");

            Assert.Contains("scene != GameScenes.TRACKSTATION", body);
            Assert.Contains("DiscoveryLevels.Owned", body);
            Assert.Contains("CanFlyVessel", body);
            Assert.Contains("MISSION_BUILDER", body);
            // The index is read inside the leave closure, after the save has written the file it indexes.
            Assert.Contains("() => FlightDriver.StartAndFocusVessel(\"persistent\", FlightGlobals.Vessels.IndexOf(found))", body);
        }
    }
}
