namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a vessel that has no patched-conics solver should be given one.
    /// Stock attaches the solver when a vessel loads, so a Tracking Station
    /// upgraded while the vessel is flying leaves it without one until the next
    /// load, although the tier now allows it.
    ///
    /// <para>Carved out of <c>KspVesselActuator</c> so it carries no KSP type and
    /// a test can enter it. The tier itself is not asked here:
    /// <c>Vessel.AttachPatchedConicsSolver</c> checks it and does nothing below
    /// the tier, so the game's own switch stays the only one.</para>
    /// </summary>
    internal static class PatchedConicsAttachRule
    {
        /// <summary>
        /// A craft a kerbal has stepped out of is excluded: the game detached its
        /// solver on purpose and the plan is held in a saved node until they board.
        /// </summary>
        public static bool ShouldAttach(
            bool hasVessel,
            bool reportingTheCraftAKerbalLeft,
            bool solverAttached) =>
            hasVessel && !reportingTheCraftAKerbalLeft && !solverAttached;
    }
}
