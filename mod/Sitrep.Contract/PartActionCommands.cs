#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Fire one button of one part's
/// right-click Part Action Window, the remote-control equivalent of the player
/// clicking it in-game.
///
/// <para>It acts on a part aboard the craft, so it waits on the signal delay,
/// like <c>vessel.control.*</c> and the robotics commands.</para>
///
/// <para>It has no state field, unlike the other actuation commands (see
/// <see cref="ServoSetEnabledArgs"/>). KSP models these as buttons with no
/// settable value, and the button's own label is what changes ("Deploy"
/// becomes "Retract"). Read the result back from
/// <c>vessel.partActions.&lt;flightId&gt;</c>, which reports the new set of
/// buttons one signal delay later.</para>
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
    /// The part's flight id, as a string: the same id
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

    /// <summary>
    /// The <see cref="PartActionEntry.ModuleIndex"/> of the button, which names
    /// the module when a part carries several of one class. Left out, the first
    /// module with an event of that name is pressed, as before.
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public int? ModuleIndex { get; set; }
}

/// <summary>
/// Set one field of one part's right-click Part Action Window on the craft,
/// the remote-control equivalent of the player moving a slider or flipping a
/// toggle in-game: a thrust limiter, a parachute's deploy altitude and
/// pressure, an engine's gimbal switch.
///
/// <para>It acts on a part aboard the craft, so it waits on the signal delay,
/// like <c>vessel.invokePartAction</c>. The value is written through the
/// game's own field path, and on the part's symmetry counterparts when the
/// field's control says the game does the same.</para>
///
/// <para>The value rides the command queue as <c>commandedValue</c>, so a
/// slider can draw the value the operator sent beside the value the craft
/// last reported.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.setPartField", SetsValue = nameof(SetPartFieldArgs.Value))]
public class SetPartFieldArgs
{
    /// <summary>
    /// The part's flight id, as a string: the same id
    /// <see cref="InvokePartActionArgs.PartId"/> and <see cref="VesselPart.Id"/>
    /// carry. An id that no longer resolves fails with
    /// <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// The module class name that owns the field (<c>ModuleEnginesFX</c>), or
    /// empty for a field on the part itself. A module the part does not carry
    /// fails with <see cref="CommandErrorCode.CapabilityMismatch"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Module { get; set; } = "";

    /// <summary>
    /// The field's code name (<c>thrustPercentage</c>), never its localized
    /// label. A field the module does not have, or one the game's window does
    /// not offer for flight, fails with
    /// <see cref="CommandErrorCode.CapabilityMismatch"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Field { get; set; } = "";

    /// <summary>
    /// The value to set. A switch takes 1 for on and 0 for off, a list of
    /// options takes the option's position from 0, and a slider takes its own
    /// figure in the field's own unit. A figure outside the field's range, or
    /// a switch or list position it does not have, fails with
    /// <see cref="CommandErrorCode.Range"/>.
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public double Value { get; set; }
}
