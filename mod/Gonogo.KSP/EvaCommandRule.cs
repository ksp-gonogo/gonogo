using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// What a command answers when gonogo is reporting the craft a kerbal
    /// stepped out of and the stock call underneath it cannot reach that craft.
    ///
    /// <para><b>Why the seam does not cover these.</b>
    /// <see cref="ActiveVesselScope"/> moved every active-vessel-scoped read
    /// onto the craft rather than the kerbal. A write cannot be moved the same
    /// way, because the stock calls take no vessel and resolve one themselves:
    /// <c>FlightInputHandler</c> applies its control state only to the loaded
    /// vessel that is <c>== FlightGlobals.ActiveVessel</c> and leaves every
    /// other one's throttle untouched, <c>StageManager.ActivateStage</c> reads
    /// the same property and the UI stage stack built for it, and
    /// <c>FlightGlobals.SetVesselTarget</c> ends in
    /// <c>ActiveVessel.targetObject = tgt</c>. Rerouting our own read of "the
    /// vessel" changes none of that.</para>
    ///
    /// <para><b>Why <see cref="CommandErrorCode.WrongState"/>.</b> The entity is
    /// in a state this command does not work in, and the state does not resolve
    /// by waiting: it resolves when the kerbal boards, which is an act rather
    /// than a wait. <see cref="CommandErrorCode.NotClearToProceed"/> would be
    /// wrong for a sharper reason than tone - its documented authority is
    /// <c>FlightGlobals.ClearToSave()</c>, which reads KSP's active vessel and
    /// therefore judges the kerbal, so it is the one check that structurally
    /// cannot see this.</para>
    ///
    /// <para>Carved out of its callers so it carries no KSP type and a headless
    /// test can enter it, the same discipline as <see cref="StageRule"/> and
    /// <see cref="ManeuverWriteAuthority"/> beside it.</para>
    /// </summary>
    internal static class EvaCommandRule
    {
        /// <summary>
        /// KSP applies the throttle to the vessel it is flying and to no other,
        /// and the fly-by-wire override writes every axis except this one, so
        /// there is no second route to it either.
        /// </summary>
        public const string Throttle =
            "KSP applies the throttle to the vessel it is flying, which is not this one";

        /// <summary>The stage stack belongs to whatever KSP is flying, and a kerbal has none.</summary>
        public const string Stage =
            "KSP fires the stages of the vessel it is flying, which is not this one";

        /// <summary>
        /// A target set now would land on the kerbal's own
        /// <c>targetObject</c> and go with them when they board.
        /// </summary>
        public const string Target =
            "a target set now would be set on the vessel KSP is flying, which is not this one";

        /// <summary>
        /// <c>Vessel.MakeInactive</c> calls <c>DetachPatchedConicsSolver</c>,
        /// which destroys the solver the moment a kerbal steps out. The plan
        /// itself survives, saved into <c>flightPlanNode</c> on the way out, but
        /// there is nothing live to edit until the kerbal boards.
        /// </summary>
        public const string Maneuver =
            "this vessel's maneuver solver is not available while KSP is flying another vessel";

        /// <summary>
        /// The refusal, or null when the command may proceed.
        /// </summary>
        /// <param name="reportingTheCraftAKerbalLeft">
        /// <see cref="ActiveVesselScope.SubstitutedForEva"/>: gonogo is
        /// reporting a craft that is not what KSP is flying.
        /// </param>
        /// <param name="detail">
        /// Which of the constants above applies. The code is the load-bearing
        /// half; the sentence names the stock mechanism that cannot be reached,
        /// because "not right now" sends an operator back to try again.
        /// </param>
        public static Refusal? RefusalFor(bool reportingTheCraftAKerbalLeft, string detail) =>
            reportingTheCraftAKerbalLeft
                ? new Refusal(CommandErrorCode.WrongState, detail)
                : (Refusal?)null;
    }
}
