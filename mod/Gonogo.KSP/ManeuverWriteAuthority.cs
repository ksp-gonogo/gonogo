using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which authority lets a maneuver node be written, carved out of
    /// <c>KspVesselActuator</c> so it carries no KSP or Unity type and can be
    /// entered by a test. Same discipline, and the same reason, as
    /// <see cref="ManeuverPlanWriteRule"/> beside it.
    ///
    /// <para><b>What was wrong.</b> All three write commands gated on
    /// <c>FlightGlobals.ActiveVessel.patchedConicSolver != null</c> and nothing
    /// else. That solver is attached by <c>Vessel.AttachPatchedConicsSolver</c>
    /// under <c>patchedConicsUnlocked()</c>, whose body reads
    /// <c>GameVariables.GetOrbitDisplayMode(GetFacilityLevel(TrackingStation)) == PatchedConics</c>
    /// at tsNormLevel 0.2 and up. That is the <b>Tracking Station</b>. Flight
    /// planning is <b>Mission Control</b>:
    /// <c>GameVariables.UnlockedFlightPlanning(mCtrlNormLevel)</c> is
    /// <c>mCtrlNormLevel &gt; 0.4f</c>, and <c>OrbitTargeter.LateUpdate</c>
    /// refuses to open the patch context menu without it, so below that tier the
    /// player has no route to a node at all. The two facilities upgrade
    /// independently: a three-tier career gives norm levels 0 / 0.5 / 1, so
    /// Tracking Station at tier 2 attaches a solver while Mission Control at
    /// tier 1 leaves planning locked. In that ordinary save the console planted
    /// nodes the player had not bought, and the craft flew them.</para>
    ///
    /// <para>Stock's own add-node handler
    /// (<c>MapContextMenuOptions.AddManeuver.OnSelect</c>) is one line of gate:
    /// <c>InputLockManager.IsUnlocked(ControlTypes.MANNODE_ADDEDIT)</c>, else
    /// "Cannot Add Maneuver Node (Control Locked)". <c>Vessel</c> itself sets
    /// that lock (with <c>MANNODE_DELETE</c>) under <c>vessel_noControl_</c>, so
    /// an out-of-signal probe is inside it, as are tutorials and dialogs.</para>
    ///
    /// <para><b>And where we were the stricter one.</b> A Tracking Station below
    /// patched conics used to come back <c>NoVessel</c>. There is a vessel; the
    /// fact is a facility tier, and an operator told "no vessel" goes looking
    /// for the wrong thing.</para>
    /// </summary>
    internal static class ManeuverWriteAuthority
    {
        /// <summary>
        /// The refusal for a maneuver write, or null when every authority
        /// allows it.
        ///
        /// <para><paramref name="flightPlanningUnlocked"/> is Mission Control's
        /// switch and is only asked of a write that PLANS. Removing a node is
        /// the undo, never a capability a player buys, and refusing one because
        /// the building it was planned from has since been downgraded would
        /// strand a node with no way to clear it.</para>
        ///
        /// <para>Every flag is read by the caller off the game, and a facility
        /// tier that is ABSENT rather than unread reads as its ceiling:
        /// <c>ScenarioUpgradeableFacilities</c> is a career/mission scenario
        /// (<c>KSPScenario((ScenarioCreationOptions)1056, ...)</c>) and is simply
        /// not in a sandbox save, where there are no facility tiers to be short
        /// of. That is not this rule being lenient, it is what the save means,
        /// and the facility GATES answer the same way off the same shared
        /// reading (<c>FacilityGateHelp.ReadFacilityTiers</c>) so a control and
        /// the dispatch behind it cannot disagree.</para>
        /// </summary>
        public static Refusal? RefusalFor(
            bool hasVessel,
            bool solverAttached,
            bool flightPlanningUnlocked,
            bool nodeEditingUnlocked,
            bool plans,
            string trackingStationName,
            string missionControlName)
        {
            if (!hasVessel)
            {
                return new Refusal(CommandErrorCode.NoVessel, "");
            }

            if (!solverAttached)
            {
                return new Refusal(
                    CommandErrorCode.NotUnlocked,
                    $"the {Named(trackingStationName, "Tracking Station")} does not plot patched conics yet");
            }

            if (plans && !flightPlanningUnlocked)
            {
                return new Refusal(
                    CommandErrorCode.NotUnlocked,
                    $"the {Named(missionControlName, "Mission Control")} has not unlocked flight planning yet");
            }

            if (!nodeEditingUnlocked)
            {
                return new Refusal(
                    CommandErrorCode.NotClearToProceed, "maneuver node editing is locked right now");
            }

            return null;
        }

        /// <summary>
        /// The facility as the game names it, or the English fallback when the
        /// Localizer had nothing. An empty clause reads as a sentence that came
        /// back blank, which is worse than a name in one language.
        /// </summary>
        private static string Named(string localised, string fallback) =>
            string.IsNullOrWhiteSpace(localised) ? fallback : localised;
    }
}
