#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.identity</c> channel payload: who the active vessel is, what
/// kind of craft it is, and where it is.
///
/// <para>There is no mission time field. <see cref="LaunchUt"/> is fixed after
/// liftoff, so mission elapsed time is <c>viewUt - launchUt</c>, computed by the
/// client.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.identity")]
public class VesselIdentity
{
    /// <summary>The stable subject id: KSP's <c>Vessel.id</c> GUID as a string. The id vessel-scoped commands take, and the <c>&lt;guid&gt;</c> in <see cref="Meta"/>'s <c>"vessel:&lt;guid&gt;"</c> source.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The vessel's name, KSP's <c>Vessel.vesselName</c>. Empty when it could not be read.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The vessel's type, from KSP's <c>Vessel.vesselType</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType VesselType { get; set; }

    /// <summary>The vessel's situation (landed, flying, orbiting and so on), from KSP's <c>Vessel.situation</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation Situation { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body the vessel orbits; null when the vessel has no orbit yet (for example a just-spawned EVA kerbal).</summary>
    [SitrepUnit(Units.Id)]
    public int? ParentBodyIndex { get; set; }

    /// <summary>The universal time the vessel's mission clock started from, fixed from liftoff. <c>null</c> while the vessel is in <c>PreLaunch</c> and whenever the clock is unknown, never the current time.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LaunchUt { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
