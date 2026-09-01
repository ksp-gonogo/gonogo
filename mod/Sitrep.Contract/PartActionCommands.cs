#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for <c>vessel.invokePartAction</c>: fire one button of one part's
/// right-click Part Action Window, the remote-control equivalent of the player
/// clicking it in-game.
///
/// <para>This is an actuation of a part ON the craft, so the command rides
/// light-time (<c>Delayed = true</c>) exactly like <c>vessel.control.*</c> and
/// the robotics commands it is modelled on.</para>
///
/// <para><b>No state field, unlike every other actuation command.</b> The
/// contract's usual discipline is "absolute set, never toggle" (see
/// <see cref="ServoSetEnabledArgs"/>), but a <c>BaseEvent</c> has no settable
/// value: KSP models these as fire-this-button, and the button's own label is
/// what changes ("Deploy" becomes "Retract"). So this command is a pure
/// invoke, in the same position as <c>robotics.rotor.reverse</c>: the lone
/// stateless member of its family, for a reason that comes from KSP rather than
/// from convenience. The operator's read-back is the
/// <c>vessel.partActions.&lt;flightId&gt;</c> channel re-reporting the new
/// button set one light-time later.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.invokePartAction")]
public class InvokePartActionArgs
{
    /// <summary>
    /// The part's <c>flightID.ToString()</c>: the same id the read side stamps
    /// on <see cref="PartActions.PartId"/> and <see cref="VesselPart.Id"/>, so a
    /// widget round-trips the exact id it already holds with no correlation
    /// step. An id that no longer resolves (the part was staged away, undocked,
    /// or the vessel unloaded) comes back
    /// <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.NotFound"/>
    /// rather than silently doing nothing.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// The <see cref="PartActionEntry.Name"/> of the button to fire
    /// (<c>BaseEvent.name</c>, the stable code id, NEVER the localized
    /// <see cref="PartActionEntry.Label"/>). An event name the resolved part no
    /// longer exposes comes back <see cref="CommandErrorCode.ModeUnavailable"/>:
    /// the part is there but that button is not, which is a genuinely different
    /// failure from an unresolvable part.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string EventName { get; set; } = "";
}
