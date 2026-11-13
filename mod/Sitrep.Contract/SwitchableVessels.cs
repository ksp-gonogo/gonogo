#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One vessel of the save the operator can switch to: who it is, and nothing
/// of where it is or how it is doing.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SwitchableVessel
{
    /// <summary>The vessel's stable guid, the id <c>ksp.switchVessel</c> takes.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The vessel's display name.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The vessel's type.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType? VesselType { get; set; }
}

/// <summary>
/// The other vessels in the save that the game's own vessel switching offers,
/// as <c>{ "entries": [ ... ] }</c>. Switching to a vessel is a change of
/// scene, which every command centre can do whatever the radio link to that
/// vessel, so this list does not depend on one: a vessel with no link to any
/// centre is on it. It names vessels and carries no position, distance,
/// situation or any other state of one, which a centre may learn only through
/// delayed telemetry.
///
/// <para>The active vessel is not on the list. The payload is <c>null</c>
/// (no key emitted) outside the flight scene, where there is no vessel to
/// switch from. Not delayed by signal delay: it is a fact about the save, and
/// carries no per-payload <c>Meta</c> of its own (the envelope's applies).</para>
/// <internal>
/// Read from FlightGlobals.Vessels with the same type filter and discovery
/// rule as <c>target.available</c>, so the list never names a vessel the game
/// itself would not offer. Produced by
/// Sitrep.Host.SystemViewProvider.BuildSwitchableVessels, on the same
/// convention as <c>ksp.revertAvailability</c>.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
[SitrepTopic("ksp.switchableVessels", DisplayName = "Switchable vessels")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SwitchableVessels
{
    /// <summary>Every other vessel of the save the game offers to switch to, in id order. Empty, never null, when there is none.</summary>
    public IReadOnlyList<SwitchableVessel> Entries { get; set; } = new List<SwitchableVessel>();
}
