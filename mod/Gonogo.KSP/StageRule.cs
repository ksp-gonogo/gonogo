using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// What stock's own space bar checks before it stages, and the part of it
    /// the console skipped.
    ///
    /// <para><b>What was wrong.</b> <c>Stage()</c> checked for an active vessel
    /// and called <c>StageManager.ActivateNextStage()</c>.
    /// <c>FlightInputHandler</c> is:</para>
    ///
    /// <code>
    /// if (InputLockManager.IsUnlocked(ControlTypes.STAGING))
    ///     if (GameSettings.LAUNCH_STAGES.GetKeyDown())
    ///         if (!activeVessel.ActionControlBlocked(KSPActionGroup.Stage))
    ///             StageManager.ActivateNextStage();
    ///         activeVessel.ActionGroups.ToggleGroup(KSPActionGroup.Stage);
    /// </code>
    ///
    /// <para>Two gates and one side effect. <c>ControlTypes.STAGING</c> is
    /// locked by tutorials and by <c>manualStageLock</c>, and we staged straight
    /// through it. <c>Vessel.ActionControlBlocked(KSPActionGroup.Stage)</c> is
    /// the Making History mission override, narrow but real in a mission
    /// save.</para>
    ///
    /// <para>And note where <c>ToggleGroup</c> sits: OUTSIDE the
    /// <c>ActionControlBlocked</c> arm, INSIDE the lock. A blocked stage still
    /// fires the group; a locked one fires nothing. So the toggle belongs to the
    /// keypress, not to the staging, which is why it is described here rather
    /// than left to the caller to remember.</para>
    /// </summary>
    internal static class StageRule
    {
        /// <summary>
        /// The refusal for a stage command, or null when stock's space bar would
        /// have done something.
        /// </summary>
        public static Refusal? RefusalFor(bool hasVessel, bool stagingUnlocked)
        {
            if (!hasVessel)
            {
                return new Refusal(CommandErrorCode.NoVessel, "");
            }
            if (!stagingUnlocked)
            {
                return new Refusal(CommandErrorCode.NotClearToProceed, "staging is locked right now");
            }
            return null;
        }

        /// <summary>
        /// Whether the stack actually advances. False is NOT a refusal: stock
        /// still fires the Stage action group when
        /// <c>ActionControlBlocked</c> holds the stack, so a mission that has
        /// overridden staging gets its group actions and no separation.
        /// </summary>
        public static bool AdvancesTheStack(bool actionControlBlocked) => !actionControlBlocked;
    }
}
