using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One button in a part's right-click Part Action Window: a single KSP
/// <c>BaseEvent</c>, either from the <c>Part</c> itself or from one of its
/// <c>PartModule</c>s (the full PAW is the UNION of both, and the module half
/// is where the interesting actions live: scanners, antennas, solar, deploy).
///
/// <para><see cref="Name"/> is the invoke key and <see cref="Label"/> is the
/// display text: they are deliberately separate because <c>BaseEvent.name</c>
/// is a stable code identifier while <c>guiName</c> is localized, so a client
/// that invoked by label would break the moment the player switches language.
/// The invoke command (<see cref="InvokePartActionArgs"/>) takes
/// <see cref="Name"/>.</para>
///
/// <para><b>The gating flags are carried, not applied.</b> The producer filters
/// to "is this button in the flight PAW at all" (<c>guiActive</c>) and then
/// reports <see cref="Active"/>/<see cref="GuiActiveUnfocused"/>/
/// <see cref="AdvancedTweakable"/>/<see cref="RequireFullControl"/> rather than
/// filtering on them, so display policy (does this operator want EVA-range
/// actions? advanced tweakables?) stays a client decision. Baking that policy
/// into the wire would make it unchangeable without a contract revision.</para>
///
/// <para><see cref="Active"/> specifically is CARRIED, not filtered: KSP itself
/// shows an inert PAW button greyed out rather than removing it, and a client
/// that dropped <c>!active</c> entries would make the list jump around as craft
/// state changes. Filtering on it would also make <see cref="Active"/> a field
/// that is true by construction, which says nothing.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartActionEntry
{
    /// <summary><c>BaseEvent.name</c>: the STABLE code identifier, and the key <see cref="InvokePartActionArgs.EventName"/> carries back.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary><c>BaseEvent.guiName</c>: the localized text the player sees on the PAW button.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary><c>BaseEvent.group?.displayName</c>: the PAW group this button sits under, so a client can group like the real window. <c>null</c> for an ungrouped button.</summary>
    [SitrepUnit(Units.Text)]
    public string? Group { get; set; }

    /// <summary>
    /// Which <c>PartModule</c> owns this event (<c>PartModule.moduleName</c>),
    /// or <c>null</c> when the event is on the <c>Part</c> itself. Carried
    /// because it is the only way a client can tell two same-named events on
    /// different modules of one part apart, and because it reads as useful
    /// provenance ("Toggle" on which module?).
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ModuleName { get; set; }

    /// <summary><c>BaseEvent.active</c>: the button is currently enabled. A <c>false</c> entry is present-but-inert, so a client renders it disabled rather than hiding it (hiding would make the PAW jump around as state changes).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }

    /// <summary><c>BaseEvent.guiActiveUnfocused</c>: the button also shows when near but not focused (the EVA-range set), so a client can hint that.</summary>
    [SitrepUnit(Units.Flag)]
    public bool GuiActiveUnfocused { get; set; }

    /// <summary><c>BaseEvent.advancedTweakable</c>: KSP hides this behind its own advanced-tweakables setting; a client can mirror that preference.</summary>
    [SitrepUnit(Units.Flag)]
    public bool AdvancedTweakable { get; set; }

    /// <summary><c>BaseEvent.requireFullControl</c>: the button needs full vessel control (not a partially-crewed/probe-limited state) to fire.</summary>
    [SitrepUnit(Units.Flag)]
    public bool RequireFullControl { get; set; }
}

/// <summary>
/// The payload of one <c>vessel.partActions.&lt;flightId&gt;</c> channel: the
/// PAW buttons currently available on a single part of the active vessel.
///
/// <para><b>Why a dynamic per-part namespace</b> rather than a field on
/// <c>vessel.parts</c>: a vessel is 50-200+ parts and each exposes ~5-15 PAW
/// events across its modules, so materializing every part's list on the
/// all-parts keyframe would multiply it for data only needed while an operator
/// has one part open. The per-part namespace is subscription-gated instead, the
/// producer enumerates ONLY the parts a client is actually subscribed to, so
/// nothing open costs nothing. See <c>Gonogo.KSP.VesselUplink</c>'s
/// registration.</para>
///
/// <para><b>Why a stream and not a one-shot query:</b> the action set is its own
/// read-back. Invoking "Extend Solar Panel" flips this list to "Retract Solar
/// Panel" one light-time later, which is how a client confirms a delayed
/// command landed WITHOUT optimistically flipping its own UI. A request/response
/// enumeration would hand back a snapshot that goes stale the instant its own
/// command arrives.</para>
///
/// <para><b>Not a <c>[SitrepTopic]</c>-tagged root:</b> the topic string is
/// computed at runtime (<c>vessel.partActions.</c> + the part's
/// <c>flightID</c>), so there is no fixed name to tag, same posture as the
/// mod's other dynamic per-subject namespaces, whose element types are
/// likewise untagged. The client subscribes to the computed sub-topic
/// directly.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartActions
{
    /// <summary><c>Part.flightID</c> stringified: the same join key <see cref="VesselPart.Id"/>, <c>parts.power</c> and <c>robotics.servos</c> use, echoed so a payload is self-describing away from its topic string.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// The part's currently-available PAW buttons, the union of the part's own
    /// events and every one of its modules' events, filtered to
    /// <c>guiActive</c> (see <see cref="PartActionEntry.Active"/> for why the
    /// enabled flag is carried rather than filtered on). Always present,
    /// possibly empty (a structural part with no actions); an empty list is a
    /// real answer, not an absence.
    /// </summary>
    public List<PartActionEntry> Actions { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}
