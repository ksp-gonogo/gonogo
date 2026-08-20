namespace Sitrep.Contract
{
    /// <summary>
    /// The closest-approach capability seam: the exact shape
    /// <see cref="ICommsBackend"/> and <see cref="IActionGroupsBackend"/>
    /// established, and for the same reason: ONE client interface, SWAPPABLE
    /// authority.
    ///
    /// <para><b>Why a seam here.</b> KSP's own closest-approach maths
    /// (<c>Orbit.SolveClosestApproach</c>/<c>NextCloseApproachTime</c>) is a
    /// two-body Kepler solve. Under an n-body physics mod that solve is simply
    /// WRONG: the real encounter comes from the actual integrated trajectory, not
    /// from osculating Kepler elements. So the approach
    /// solve, and ONLY the approach solve, sits behind this seam: core
    /// registers a stock Kepler backend as the always-present vanilla, and a
    /// reflection-isolated uplink for such a mod registers a higher-priority
    /// provider that is elected only when that mod is actually loaded.
    /// Everything else about a target,
    /// the available list, names, current distance, relative velocity; stays
    /// stock and is NOT behind this seam (the boundary Jon fixed: approach
    /// only).</para>
    ///
    /// <para><b>Why this interface is here and not in Sitrep.Host.</b> It was
    /// written for an outside backend to implement, its own doc said as much,
    /// and then put in an assembly no outside author can install or build
    /// against. An Uplink may reference this assembly and its own contract
    /// slice, so anything an Uplink is expected to implement has to live here;
    /// the id it registers against does too, which is what
    /// <see cref="TargetApproachCapability"/> is for. Registering the capability
    /// and resolving the winner stay in <c>Sitrep.Host</c>, they are core's
    /// side of the seam rather than an implementor's.</para>
    ///
    /// <para><b>KSP-free by design.</b> Exactly like
    /// <see cref="IActionGroupsBackend"/>, no KSP type crosses this boundary:
    /// the backend reads LIVE KSP internally and returns only the contract
    /// <see cref="ClosestApproach"/> shape. That is what lets this interface sit
    /// in an assembly that never references Assembly-CSharp while its
    /// implementations read the live game.</para>
    ///
    /// <para><b>Threading: read before adding a backend.</b> An implementation
    /// reads LIVE KSP (the active vessel + its current target), so it is only
    /// ever called from the main-thread capture, the same main-thread seam the
    /// comms capture uses. Never call a backend from a channel-source
    /// closure.</para>
    ///
    /// <para><b>Conics are not the whole answer.</b> A backend that computes an
    /// approach from osculating elements is wrong under n-body for exactly the
    /// reason a conic trajectory is, so a correct one needs propagated states
    /// rather than elements. <see cref="IPropagationProvider"/> is the seam that
    /// supplies those, and the two are not yet wired together: this interface
    /// hands a backend a UT and nothing else, and a backend reaches its own
    /// source of truth. Wiring them is a design change, not a rename.</para>
    /// </summary>
    public interface ITargetApproachSolver
    {
        /// <summary>Stable id of this backend, for diagnostics + election assertions (mirrors <see cref="ICommsBackend.BackendId"/>).</summary>
        string BackendId { get; }

        /// <summary>
        /// The next closest approach between the active vessel and its CURRENT
        /// target (both read live from KSP by the backend, like
        /// <see cref="IActionGroupsBackend.Groups"/>),
        /// at or after <paramref name="fromUt"/> (Universal Time, seconds).
        /// Returns null when there is nothing to report, no target, no shared
        /// reference frame (a cross-SOI approach is not a single two-body
        /// problem), no orbit, or no encounter within the horizon; never a
        /// sentinel zero record.
        /// </summary>
        ClosestApproach? Solve(double fromUt);
    }

    /// <summary>
    /// The capability id both halves name, here for the same reason
    /// <see cref="DelayedScienceCapability"/> is: both halves must spell it
    /// identically and only one of them is published. The election helper that
    /// registers this capability is unpublished, so leaving the constant with it
    /// left an implementor re-declaring the string as its own constant with a
    /// test to pin the two equal, and two spellings of one identity drift
    /// silently into a capability that simply never elects.
    /// </summary>
    public static class TargetApproachCapability
    {
        public const string CapabilityId = "targetApproach";
    }
}
