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
/// "Retract Solar Panel" one light-time later, which is how a client confirms a
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
    /// <summary><c>Part.flightID</c> stringified: the same join key <see
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
    /// Payload provenance. <c>Source</c> is <c>"vessel:&lt;guid&gt;"</c> for the
    /// active vessel, or <c>""</c> when no vessel id was known.
    /// </summary>
    public PayloadMeta Meta { get; set; } = new();
}
