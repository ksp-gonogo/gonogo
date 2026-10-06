#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for <c>vessel.invokePartAction</c>: fire one button of one part's
/// right-click Part Action Window, the remote-control equivalent of the player
/// clicking it in-game.
///
/// <para>It acts on a part aboard the craft, so it is delayed by light time
/// (<see cref="DelayRole.Delayed"/>), like <c>vessel.control.*</c> and the
/// robotics commands.</para>
///
/// <para>It has no state field, unlike the other actuation commands (see
/// <see cref="ServoSetEnabledArgs"/>). KSP models these as buttons with no
/// settable value, and the button's own label is what changes ("Deploy"
/// becomes "Retract"). Read the result back from
/// <c>vessel.partActions.&lt;flightId&gt;</c>, which reports the new set of
/// buttons one light time later.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.invokePartAction")]
public class InvokePartActionArgs
{
    /// <summary>
    /// The part's <c>flightID.ToString()</c>: the same id
    /// <see cref="PartActions.PartId"/> and <see cref="VesselPart.Id"/> carry,
    /// so a widget sends back the id it already holds. An id that no longer
    /// resolves (the part was staged away or undocked, or the vessel unloaded)
    /// fails with <see cref="CommandErrorCode.NotFound"/> rather than doing
    /// nothing.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// The <see cref="PartActionEntry.Name"/> of the button to fire
    /// (<c>BaseEvent.name</c>, the stable code id, never the localized
    /// <see cref="PartActionEntry.Label"/>). An event name the part no longer
    /// offers fails with <see cref="CommandErrorCode.ModeUnavailable"/>: the
    /// part is there but that button is not, where a missing part fails with
    /// <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string EventName { get; set; } = "";
}
