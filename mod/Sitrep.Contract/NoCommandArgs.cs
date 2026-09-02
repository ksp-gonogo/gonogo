#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The empty args shape, for the core commands that operate on the current
/// flight or the active vessel and so take nothing:
/// <c>vessel.control.stage</c>, <c>vessel.target.clear</c>, <c>ksp.recover</c>,
/// <c>ksp.revertToLaunch</c> and <c>ksp.toTrackingStation</c>.
///
/// <para><b>Send no <c>args</c> at all for these five.</b> The SDK's
/// <c>send()</c> takes no second argument for a command typed this way, and
/// anything you do put on the wire is read and discarded. Every other command
/// requires its args.</para>
///
/// <internal>
/// <para>Each of the five is tagged onto this class with
/// <see cref="SitrepCommandAttribute"/>, so a command with no arguments is still
/// enumerable and still names its result. The handlers bind <c>TArgs</c> as
/// <c>object?</c> and ignore what arrives, so this type describes the ABSENCE
/// rather than a wire shape: it generates as an empty interface, which is what
/// makes <c>send()</c>'s argument optional for these and required for the
/// rest.</para>
///
/// <para>An Uplink with its own no-args commands declares its own marker in its
/// own slice, never this one: it belongs to core.</para>
/// </internal>
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
