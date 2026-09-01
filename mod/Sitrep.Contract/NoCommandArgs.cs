#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The empty args shape, for the core commands that operate on the current
/// flight or the active vessel and so take nothing:
/// <c>vessel.control.stage</c>, <c>vessel.target.clear</c>,
/// <c>ksp.recover</c>, <c>ksp.revertToLaunch</c> and
/// <c>ksp.toTrackingStation</c>. Each is tagged onto this class with
/// <see cref="SitrepCommandAttribute"/>, so a command with no arguments is
/// still enumerable and still names its result.
///
/// <para>The handlers bind <c>TArgs</c> as <c>object?</c> and ignore what
/// arrives, so this type describes the ABSENCE rather than a wire shape: it
/// generates as an empty interface, which is what makes the SDK's
/// <c>send()</c> take no argument for these five and an argument for
/// everything else. An Uplink with its own no-args commands declares its own
/// marker in its own slice (<c>MechJebNoArgs</c> is the precedent), never this
/// one: it belongs to core.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.stage", Payload = typeof(int))]
[SitrepCommand("vessel.target.clear")]
[SitrepCommand("ksp.recover")]
[SitrepCommand("ksp.revertToLaunch")]
[SitrepCommand("ksp.toTrackingStation")]
public class NoCommandArgs
{
}
