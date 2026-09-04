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
    }
}
