#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Which vessel the game is flying right now: its id and name, and nothing
/// of where it is or how it is doing. Changing the active vessel is a change of
/// scene that every command centre can see whatever the radio link to the new
/// vessel, so this is read with no signal delay and does not depend on a link.
/// Useful for naming the craft the operator is flying while its telemetry has
/// not arrived. Used by the dashboard header.
///
/// <para>The payload is <c>null</c> (no key emitted) outside the flight scene.
/// It carries no per-payload <c>Meta</c> of its own (the envelope's applies).
/// Position, situation, distance and link state of the vessel are not here and
/// reach a centre only through <c>vessel.identity</c> and the other
/// <c>vessel.*</c> Topics, delayed.</para>
/// <internal>
/// Produced by Sitrep.Host.SystemViewProvider.BuildActiveVessel from the
/// capture's <c>"activeVessel"</c> group, on the same convention as
/// <c>ksp.switchableVessels</c>.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
[SitrepTopic("ksp.activeVessel", DisplayName = "Active vessel")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ActiveVessel
{
    /// <summary>The vessel's stable guid, the same id <c>vessel.identity</c> carries once its telemetry arrives.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The vessel's display name.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

}
