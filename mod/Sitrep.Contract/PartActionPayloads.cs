using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One button in a part's right-click Part Action Window (PAW): a single KSP
/// <c>BaseEvent</c>, from the <c>Part</c> itself or from one of its
/// <c>PartModule</c>s. The full PAW is the union of both, and the module half
/// is where most actions live: scanners, antennas, solar panels, deploy.
///
/// <para><see cref="Name"/> is the invoke key and <see cref="Label"/> is the
/// display text. They are separate because <c>BaseEvent.name</c> is a stable
/// code identifier while <c>guiName</c> is localized, so invoking by label
/// breaks when the player switches language. The invoke command
/// (<see cref="InvokePartActionArgs"/>) takes <see cref="Name"/>.</para>
///
/// <para>Only buttons that appear in the flight PAW at all (<c>guiActive</c>)
/// are listed. The gating flags <see cref="Active"/>,
/// <see cref="GuiActiveUnfocused"/>, <see cref="AdvancedTweakable"/> and
/// <see cref="RequireFullControl"/> are reported rather than filtered on, so
/// display policy (EVA-range actions, advanced tweakables) is the client's
/// decision.</para>
///
/// <para>An inactive button is listed, not dropped: KSP shows it greyed out,
/// and dropping it would make the list jump around as craft state
/// changes.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartActionEntry
{
    /// <summary><c>BaseEvent.name</c>: the stable code identifier, and the key
    /// <see cref="InvokePartActionArgs.EventName"/> carries back.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary><c>BaseEvent.guiName</c>: the localized text the player sees on
    /// the PAW button.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary><c>BaseEvent.group?.displayName</c>: the PAW group this button
    /// sits under, so a client can group like the real window. <c>null</c> for
    /// an ungrouped button.</summary>
    [SitrepUnit(Units.Text)]
    public string? Group { get; set; }

    /// <summary>
    /// Which <c>PartModule</c> owns this event (<c>PartModule.moduleName</c>),
    /// or <c>null</c> when the event is on the <c>Part</c> itself. It is the only
    /// way to tell apart two same-named events on different modules of one
    /// part ("Toggle" on which module?).
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ModuleName { get; set; }

    /// <summary>
    /// The position of the owning module among the part's modules, or <c>null</c>
    /// for an event on the part itself. A part can carry several modules of one
    /// class (three process controllers), each with a button of the same name, and
    /// <see cref="Name"/> with <see cref="ModuleName"/> alone cannot tell them
    /// apart. <see cref="InvokePartActionArgs.ModuleIndex"/> carries it back.
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public int? ModuleIndex { get; set; }

    /// <summary><c>BaseEvent.active</c>: the button is currently enabled. A
    /// <c>false</c> entry is present but inert, so render it disabled rather
    /// than hiding it (hiding would make the list jump around as state
    /// changes).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }

    /// <summary><c>BaseEvent.guiActiveUnfocused</c>: the button also shows when
    /// near but not focused (the EVA-range set).</summary>
    [SitrepUnit(Units.Flag)]
    public bool GuiActiveUnfocused { get; set; }

    /// <summary><c>BaseEvent.advancedTweakable</c>: KSP hides this behind its
    /// own advanced-tweakables setting; a client can mirror that
    /// preference.</summary>
    [SitrepUnit(Units.Flag)]
    public bool AdvancedTweakable { get; set; }

    /// <summary><c>BaseEvent.requireFullControl</c>: the button needs full
    /// vessel control (not a partially crewed or probe-limited state) to
    /// fire.</summary>
    [SitrepUnit(Units.Flag)]
    public bool RequireFullControl { get; set; }

    /// <summary>The button can be pressed from a console but opens a window on the game's own screen, without locking the craft.</summary>
    [SitrepUnit(Units.Flag)]
    public bool OpensGameWindow { get; set; }
}

/// <summary>
/// One row of a part's right-click Part Action Window that is not a button: a
/// label, a switch, a slider, a list of options, a cycle or a resource bar, in
/// the order the game draws them.
///
/// <para><see cref="Module"/> and <see cref="Name"/> are the key
/// <see cref="SetPartFieldArgs"/> takes back, and <see cref="Label"/> is the
/// localized text the player sees. Only rows the game offers in flight are
/// listed. A row with <see cref="Editable"/> false is shown but cannot be
/// changed from a console.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartWindowItem
{
    /// <summary>
    /// What the row is: <c>"label"</c>, <c>"toggle"</c>, <c>"slider"</c>,
    /// <c>"option"</c>, <c>"cycle"</c> or <c>"resource"</c>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Kind { get; set; } = "";

    /// <summary>The module class that owns the field, or empty for a field on the part itself. For a resource, empty.</summary>
    [SitrepUnit(Units.Id)]
    public string Module { get; set; } = "";

    /// <summary>The field's code name, or the resource's name for a resource.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary>The localized text the player sees on the row.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>The PAW group the row sits under, or <c>null</c> when it is ungrouped.</summary>
    [SitrepUnit(Units.Text)]
    public string? Group { get; set; }

    /// <summary>The value as the game prints it, with its unit and without the row's label. Empty for a label whose owning mod has not given it a value: some mods fill their labels only while the game's own window for the part is open, so an empty label is not a reading of nothing. For an option or a cycle, the name of the chosen entry with its localisation resolved.</summary>
    [SitrepUnit(Units.Text)]
    public string Text { get; set; } = "";

    /// <summary>
    /// The value as a number: the figure of a slider, 1 or 0 for a switch, the
    /// position of the chosen entry for an option or a cycle, the amount of a
    /// resource. <c>null</c> for a label.
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Number { get; set; }

    /// <summary>A slider's lowest figure. <c>null</c> for any other row.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Min { get; set; }

    /// <summary>A slider's highest figure, or a resource's capacity.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Max { get; set; }

    /// <summary>A slider's step.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Step { get; set; }

    /// <summary>The entries of an option or a cycle, as the game prints them, localisation resolved. For a switch, its two state words in order off then on (the game's own, such as "Free" and "Locked"), and <see cref="Text"/> is the one the switch is at. <c>null</c> for any other row.</summary>
    [SitrepUnit(Units.Text)]
    public List<string>? Options { get; set; }

    /// <summary>A resource's flow switch: true when it flows. <c>null</c> for any other row.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Flows { get; set; }

    /// <summary>The game hides the row behind its advanced-tweakables setting, as it does <see cref="PartActionEntry.AdvancedTweakable"/> for a button.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Advanced { get; set; }

    /// <summary>The row can be changed from a console with <c>vessel.setPartField</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Editable { get; set; }
}

/// <summary>
/// The payload of one <c>vessel.partActions.&lt;flightId&gt;</c> channel: the
/// PAW buttons currently available on a single part of the active vessel.
/// <c>&lt;flightId&gt;</c> is the part's <c>Part.flightID</c>, the same value as
/// <see cref="VesselPart.Id"/>. There is no fixed Topic id: subscribe to the
/// computed sub-topic directly (in TypeScript, with <c>useStream</c>).
///
/// <para>The channel is per part and subscription-gated: only the parts a
/// client is subscribed to are enumerated, so a vessel of hundreds of parts
/// costs nothing until one is open.</para>
///
/// <para>It is a stream rather than a one-shot query because the action set is
/// its own read-back. Invoking "Extend Solar Panel" changes this list to
/// "Retract Solar Panel" one signal delay later, which is how a client confirms a
/// delayed command landed without optimistically changing its own UI.</para>
/// <internal>
/// Registered as a dynamic namespace by Gonogo.KSP.VesselUplink; the element
/// types of the mod's dynamic per-subject namespaces are untagged because the
/// topic string is computed at runtime.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartActions
{
    /// <summary>The part's flight id, as a string: the same join key <see
    /// cref="VesselPart.Id"/>, <c>parts.power</c> and <c>robotics.servos</c>
    /// use, repeated so the payload identifies its part without the topic
    /// string.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// The part's currently-available PAW buttons, the union of the part's own
    /// events and every one of its modules' events, limited to those shown in
    /// the flight PAW (<c>guiActive</c>). Disabled buttons are included; see
    /// <see cref="PartActionEntry.Active"/>. Always present, possibly empty (a
    /// structural part with no actions): an empty list means the part has no
    /// actions, not that the list is missing.
    /// </summary>
    public List<PartActionEntry> Actions { get; set; } = new();

    /// <summary>
    /// The part's buttons that only someone at the game's own screen can finish.
    /// They cannot be pressed from a console and
    /// <c>vessel.invokePartAction</c> refuses them, so draw them disabled. Always
    /// present, possibly empty.
    /// </summary>
    public List<PartActionEntry> GameWindows { get; set; } = new();

    /// <summary>
    /// The part's window rows that are not buttons, in the order the game draws
    /// them. Always present, possibly empty. A new list beside
    /// <see cref="Actions"/>, which keeps carrying buttons only.
    /// </summary>
    public List<PartWindowItem> Window { get; set; } = new();

    /// <summary>
    /// Payload provenance. <c>Source</c> is <c>"vessel:&lt;guid&gt;"</c> for the
    /// active vessel, or <c>""</c> when no vessel id was known.
    /// </summary>
    public PayloadMeta Meta { get; set; } = new();
}
