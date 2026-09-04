using System;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// What a command does when it is about to load a scene that re-reads the
    /// save from disk.
    ///
    /// <para><b>Leaving flight is a RELOAD, not a move.</b> Nothing writes on
    /// scene exit. <c>ScenarioRunner.OnGameSceneLoadRequested</c> destroys every
    /// live <c>ScenarioModule</c> without harvesting it, so funds, science and a
    /// career mod's construction queue go with it; then
    /// <c>SpaceTracking.Start</c> reads <c>persistent.sfs</c> and calls
    /// <c>Game.Load()</c>, which ends in <c>Planetarium.SetUniversalTime</c>.
    /// A bare <c>HighLogic.LoadScene</c> therefore does not merely lose the
    /// delta since the last save, it REVERTS to that save: on the rig, 240,355
    /// seconds of universal time, the funds earned since, and an emptied
    /// construction queue, twice.</para>
    ///
    /// <para><b>Stock never does that.</b> It has two exits from flight and
    /// neither leaves without either saving or asking.
    /// <c>AltimeterSliderButtons.returnToSpaceCenter</c>, the one a console
    /// command corresponds to, saves when <c>FlightGlobals.ClearToSave()</c> is
    /// <c>CLEAR</c> and does nothing at all when it is not. The pause menu does
    /// reach a bare <c>LoadScene</c>, on its "Leave Anyway" button, but only
    /// behind a dialog naming the blocking arm and how long ago the last save
    /// was. A console has no dialog, so it refuses and names the arm instead:
    /// the refusal is reversible by the operator (throttle down, circularise,
    /// land, wait) and the loss is not.</para>
    ///
    /// <para><b>The save's return value is the load-bearing half.</b>
    /// <c>GamePersistence.SaveGame</c> returns an empty string when
    /// <c>Parameters.Flight.CanAutoSave</c> is false, and stock's own
    /// <c>PauseMenu.saveAndExit</c> ignores it. Copying stock naively therefore
    /// reproduces a silent no-op that reports success and reverts the flight
    /// anyway. The one thing this rule may never do is leave without evidence
    /// that the write happened.</para>
    ///
    /// <para>Carved out of its caller so it carries no KSP type and a headless
    /// test can enter it, the same discipline as <see cref="EvaCommandRule"/>
    /// and <see cref="StageRule"/> beside it. The caller keeps the live reads:
    /// which arm <c>ClearToSave</c> came back with, which permission flags the
    /// game set, and what <c>SaveGame</c> returned.</para>
    /// </summary>
    internal static class SceneExitRule
    {
        /// <summary>
        /// KSP was asked for the save and did not write one. The cause is
        /// almost always <c>Parameters.Flight.CanAutoSave</c> turned off for
        /// this game, which is a difficulty setting rather than a state that
        /// passes, hence <see cref="CommandErrorCode.ModeUnavailable"/> rather
        /// than <see cref="CommandErrorCode.NotClearToProceed"/>: nothing an
        /// operator waits for.
        /// </summary>
        public const string SaveDidNotHappen =
            "KSP wrote no save, and leaving without one would revert this game to its last";

        /// <summary>
        /// Save, then leave. Refuses instead, without leaving, whenever the
        /// write is forbidden, refused, or unproven.
        /// </summary>
        /// <param name="destinationRefusal">
        /// Why the game forbids the destination scene at all
        /// (<c>Parameters.Flight.CanLeaveToTrackingStation</c> and friends), or
        /// null when it permits it. Asked FIRST: a destination the game forbids
        /// is not worth writing a save for, and waiting out a flight arm to
        /// reach a scene that will never open is the wrong thing to tell an
        /// operator to do.
        /// </param>
        /// <param name="notClearToSave">
        /// Which <c>ClearToSaveStatus</c> arm refused, in the game's own words
        /// (<c>GameWords.Phrase</c>), or null when the flight is clear or
        /// when there is no flight to judge. Absent and clear are deliberately
        /// the same answer here: outside the flight scene the arm does not
        /// apply, and the save still has to happen, because the space centre
        /// holds live scenario modules the destination will re-read off disk
        /// exactly the same way.
        /// </param>
        /// <param name="save">
        /// <c>GamePersistence.SaveGame(..., SaveMode.BACKUP)</c>. The written
        /// path on success; empty or null when KSP declined.
        /// </param>
        /// <param name="leave"><c>HighLogic.LoadScene</c>, reached only from the last line.</param>
        public static CommandResult SaveThenLeave(
            string? destinationRefusal,
            string? notClearToSave,
            Func<string?> save,
            Action leave)
        {
            if (!string.IsNullOrEmpty(destinationRefusal))
            {
                return CommandResult.Fail(CommandErrorCode.NotClearToProceed, destinationRefusal);
            }

            if (!string.IsNullOrEmpty(notClearToSave))
            {
                return CommandResult.Fail(CommandErrorCode.NotClearToProceed, notClearToSave);
            }

            string? written;
            try
            {
                written = save();
            }
            catch (Exception ex)
            {
                // A throwing save is a save that did not provably happen, so it
                // takes the same branch as a refused one. Fail-closed: the cost
                // of refusing a scene change is an operator pressing again, and
                // the cost of the other direction is the flight.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable, SaveDidNotHappen + " (" + ex.Message + ")");
            }

            if (string.IsNullOrEmpty(written))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, SaveDidNotHappen);
            }

            leave();
            return CommandResult.Ok();
        }
    }
}
