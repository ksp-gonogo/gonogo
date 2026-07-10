#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>ksp.revertToEditor</c>'s args — which editor the flight reverts back
/// into. <see cref="Editor"/> is a small opaque string (<c>"vab"</c> or
/// <c>"sph"</c>, case-insensitive) rather than the KSP <c>EditorFacility</c>
/// enum, so the wire contract never leaks a native KSP type; the host bridges
/// the string to the real facility (unrecognised value fails admission with
/// <see cref="CommandErrorCode.Range"/> before the game is ever touched).
///
/// <para><c>ksp.revertToLaunch</c>, <c>ksp.toTrackingStation</c> and
/// <c>ksp.recover</c> take no args (they operate on the current flight /
/// active vessel), so they have no arg type here.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RevertToEditorArgs
{
    /// <summary><c>"vab"</c> or <c>"sph"</c> (case-insensitive). Any other value yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/>.</summary>
    public string Editor { get; set; } = "";
}

/// <summary>
/// <c>ksp.switchVessel</c>'s args — the STABLE opaque vessel id
/// (<c>vessel.id.ToString()</c>, the same id <see cref="SetTargetArgs.VesselId"/>
/// uses), resolved server-side against <c>FlightGlobals.Vessels</c>. Never a
/// live roster array index a client would have to track itself: the same
/// index-vs-stable-id hazard the target commands already fixed (T-1). An empty
/// id fails admission with <see cref="CommandErrorCode.NotFound"/> before the
/// game is ever touched.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SwitchVesselArgs
{
    public string VesselId { get; set; } = "";
}
