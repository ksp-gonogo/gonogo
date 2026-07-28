using Sitrep.Contract;

namespace Sitrep.Host.Targeting
{
    /// <summary>
    /// The closest-approach capability seam: the exact shape
    /// <see cref="Sitrep.Host.Comms.ICommsBackend"/> and
    /// <see cref="Sitrep.Host.ActionGroups.IActionGroupsBackend"/> established,
    /// and for the same reason: ONE client interface, SWAPPABLE authority.
    ///
    /// <para><b>Why a seam here.</b> KSP's own closest-approach maths
    /// (<c>Orbit.SolveClosestApproach</c>/<c>NextCloseApproachTime</c>) is a
    /// two-body Kepler solve. Under an n-body physics mod (Principia) that
    /// solve is simply WRONG, the real encounter comes from Principia's
    /// trajectory prediction, not osculating Kepler elements. So the approach
    /// solve, and ONLY the approach solve, sits behind this seam: core
    /// registers a stock Kepler backend as the always-present vanilla, and a
    /// future reflection-isolated Principia uplink registers a higher-priority
    /// provider that is elected only when Principia is actually loaded (see
    /// <see cref="TargetApproachElection"/>). Everything else about a target,
    /// the available list, names, current distance, relative velocity; stays
    /// stock and is NOT behind this seam (the boundary Jon fixed: approach
    /// only).</para>
    ///
    /// <para><b>KSP-free by design.</b> Exactly like
    /// <see cref="Sitrep.Host.ActionGroups.IActionGroupsBackend"/>, no KSP type
    /// crosses this boundary: the backend reads LIVE KSP internally and returns
    /// only the contract <see cref="ClosestApproach"/> shape. That is what lets
    /// this interface live in <c>Sitrep.Host</c> (which never references
    /// Assembly-CSharp) while its implementations live in <c>Gonogo.KSP</c> (the
    /// stock Kepler backend) and a separate Principia uplink assembly.</para>
    ///
    /// <para><b>Threading: read before adding a backend.</b> An implementation
    /// reads LIVE KSP (the active vessel + its current target), so it is only
    /// ever called from the main-thread capture (<c>Gonogo.KSP.KspHost</c>),
    /// the same main-thread seam <c>CommsCoreUplink.CaptureOnMain</c> uses.
    /// Never call a backend from a channel-source closure.</para>
    /// </summary>
    public interface ITargetApproachSolver
    {
        /// <summary>Stable id of this backend, for diagnostics + election assertions (mirrors <see cref="Sitrep.Host.Comms.ICommsBackend.BackendId"/>).</summary>
        string BackendId { get; }

        /// <summary>
        /// The next closest approach between the active vessel and its CURRENT
        /// target (both read live from KSP by the backend, like
        /// <see cref="Sitrep.Host.ActionGroups.IActionGroupsBackend.Groups"/>),
        /// at or after <paramref name="fromUt"/> (Universal Time, seconds).
        /// Returns null when there is nothing to report, no target, no shared
        /// reference frame (a cross-SOI approach is not a single two-body
        /// problem), no orbit, or no encounter within the horizon; never a
        /// sentinel zero record.
        /// </summary>
        ClosestApproach? Solve(double fromUt);
    }
}
