#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Who the active vessel is, what
/// kind of craft it is, and where it is.
///
/// <para>There is no mission time field. <see cref="LaunchUt"/> is fixed after
/// liftoff, so mission elapsed time is the current UT (the <c>meta.validAt</c>
/// of the newest frame) minus <c>launchUt</c>, computed by the client.</para>
///
/// <para>The payload is <c>null</c> while there is no active vessel: at the
/// Space Center, in an editor, in the tracking station with nothing flying,
/// and after a revert, a destroy or a recovery. A vessel out of contact is
/// still the active vessel and keeps its last value.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.identity", DisplayName = "Active vessel identity")]
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

    /// <summary>Index into <c>trackingStation.bodies</c> of the body the vessel orbits; null when the vessel has no orbit yet (for example a just-spawned EVA kerbal).</summary>
    [SitrepUnit(Units.Id)]
    public int? ParentBodyIndex { get; set; }

    /// <summary>The universal time the vessel's mission clock started from, fixed from liftoff. <c>null</c> while the vessel is in <c>PreLaunch</c> and whenever the clock is unknown, never the current time.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LaunchUt { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
