#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Take no args: stage, clear the target, hold fly-by-wire, recover, revert to launch, or go to the Tracking Station or Space Center. The empty args shape, for the core commands that operate on the current
/// flight or the active vessel and so take nothing:
/// <c>vessel.control.stage</c>, <c>vessel.target.clear</c>,
/// <c>vessel.control.holdFlyByWire</c>, <c>ksp.recover</c>,
/// <c>ksp.revertToLaunch</c>, <c>ksp.toTrackingStation</c> and
/// <c>ksp.toSpaceCenter</c>.
///
/// <para>Takes no arguments: send <c>args: {}</c>. Anything sent in
/// <c>args</c> is ignored.</para>
/// <internal>
/// The SDK's <c>send()</c> takes no second argument for a command typed this
/// way.
/// </internal>
///
/// <internal>
/// <para>Each of the seven is tagged onto this class with
/// <see cref="SitrepCommandAttribute"/>, so a command with no arguments is still
/// enumerable and still names its result. The handlers bind <c>TArgs</c> as
/// <c>object?</c> and ignore what arrives, so this type describes the absence
/// rather than a wire shape: it generates as an empty interface, which is what
/// makes <c>send()</c>'s argument optional for these and required for the
/// rest.</para>
///
/// <para>An Uplink with its own no-args commands declares its own marker in its
/// own slice, never this one: it belongs to core.</para>
/// </internal>
/// </summary>
/// <category>Command arguments</category>
/// <categoryDescription>
/// What each core command takes, one type per command or per family of commands
/// that share a shape, each naming the command ids it is sent with. Look a command
/// up here to see what it needs and which values it refuses.
/// </categoryDescription>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.stage", Payload = typeof(int), Summary = "Activate the next stage.")]
[SitrepCommand("vessel.target.clear", Summary = "Clear the active vessel's target.")]
[SitrepCommand("vessel.control.holdFlyByWire", Summary = "Keep an armed fly-by-wire override from lapsing.")]
[SitrepCommand("ksp.recover", Delay = DelayRole.TrueNow, Summary = "Recover the active vessel.", AllowMetaVantage = true)]
[SitrepCommand("ksp.revertToLaunch", Delay = DelayRole.TrueNow, Summary = "Revert the flight to its launch.", AllowMetaVantage = true)]
[SitrepCommand("ksp.toTrackingStation", Delay = DelayRole.TrueNow, Summary = "Leave the flight for the Tracking Station.", AllowMetaVantage = true)]
[SitrepCommand("ksp.toSpaceCenter", Delay = DelayRole.TrueNow, Summary = "Leave the flight for the Space Center.", AllowMetaVantage = true)]
public class NoCommandArgs
{
}
