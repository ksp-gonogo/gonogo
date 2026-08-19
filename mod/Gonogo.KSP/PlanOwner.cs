namespace Gonogo.KSP
{
    /// <summary>
    /// Who owns the flight plan, as far as the maneuver WRITE path needs to know.
    ///
    /// <para>Three states because there are three facts, and collapsing any pair
    /// loses one. Deliberately NOT a provider id: <c>VesselManeuver.Planner</c>'s
    /// own doc says "nothing outside the election may branch on the VALUE", so the
    /// question the actuator asks is about AUTHORITY ("will a write into stock's
    /// solver be seen") and the identity stays on the wire for a readout to name.
    /// The election site answers this, because that is the only place that already
    /// knows which instance is stock's own backend.</para>
    ///
    /// <para>Lives in its own file, carrying no KSP or Unity type, so the write
    /// guard's rule is testable without a live game (see
    /// <c>Gonogo.KSP.Tests/Maneuver/ManeuverPlanOwnershipTests.cs</c>).</para>
    /// </summary>
    public enum PlanOwner
    {
        /// <summary>
        /// No planner at all: an un-upgraded Tracking Station leaves
        /// <c>Vessel.patchedConicSolver</c> null, so the craft cannot hold a plan
        /// rather than merely not holding one. Not a foreign plan, and it falls
        /// through to the existing solver-null guard rather than being refused as
        /// somebody else's.
        /// </summary>
        None,

        /// <summary>Stock's own backend is elected, so a write into its solver is read back.</summary>
        Stock,

        /// <summary>
        /// Somebody else owns the plan. A write into stock's solver would never be
        /// read, leaving a node the operator can see that does nothing.
        /// </summary>
        Foreign,
    }
}

namespace Gonogo.KSP
{
    /// <summary>
    /// The maneuver WRITE-path rule, carved out of <c>KspVesselActuator</c> so it
    /// carries no KSP or Unity type and can be tested without a live game.
    ///
    /// <para>Same discipline as <c>CommNetOcclusion</c>, which was split out of
    /// <c>CommNetBackend</c> for exactly this reason. It is not a cosmetic split:
    /// the actuator's command bodies reference Unity types
    /// (<c>UnityEngine.PhysicsModule</c> among them) that the reference-assembly
    /// set does not ship, so a headless test cannot ENTER those methods at all.
    /// The rule can be exercised directly; that the three commands consult it is
    /// asserted structurally instead. See
    /// <c>Gonogo.KSP.Tests/Maneuver/ManeuverPlanOwnershipTests.cs</c>.</para>
    /// </summary>
    internal static class ManeuverPlanWriteRule
    {
        /// <summary>
        /// The refusal for a write into stock's solver, or <c>null</c> when the
        /// write may proceed. Only <see cref="PlanOwner.Foreign"/> refuses:
        /// <see cref="PlanOwner.None"/> is a craft that cannot hold a plan, which
        /// has its own existing answer further down.
        /// </summary>
        internal static Sitrep.Contract.CommandErrorCode? RefusalFor(PlanOwner owner) =>
            owner == PlanOwner.Foreign
                ? Sitrep.Contract.CommandErrorCode.PlanNotOwned
                : (Sitrep.Contract.CommandErrorCode?)null;
    }
}
