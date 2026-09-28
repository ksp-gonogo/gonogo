#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.surface</c> channel payload: surface data a landing widget
/// needs that <c>vessel.flight</c> doesn't already carry.
/// <c>vessel.flight.AltitudeTerrain</c> is the height of the vessel's root
/// part above the terrain; <see cref="HeightFromTerrain"/> is the height of the
/// vessel's LOWEST point, the number a landing-gear or suicide-burn readout
/// cares about. The two differ by how far the vessel reaches below its root.
///
/// <para>Whole-channel absence means the vessel has no reference body yet.
/// The channel is present in every situation, orbiting included.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.surface")]
public class VesselSurface
{
    /// <summary>KSP's biome name at the vessel's current lat/long (e.g. "Highlands", "Shores"). Null when the body has no biome map (e.g. gas giants) or the lookup failed this tick.</summary>
    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    /// <summary>The named launch/landing site the vessel is currently at (e.g. "KSC_LaunchPad", "Runway"), null when landed/splashed somewhere with no named site, or when not landed/splashed at all.</summary>
    [SitrepUnit(Units.Text)]
    public string? LandedAt { get; set; }

    /// <summary>
    /// Metres from the vessel's lowest point down to the terrain, never below 0.
    /// Null whenever KSP did not measure the terrain beneath the vessel this
    /// tick: its terrain raycast found nothing below, or the vessel is packed or
    /// unloaded and KSP is holding an earlier value.
    /// <internal>
    /// KSP's heightFromTerrain is a raycast from the root part's origin;
    /// Gonogo.KSP.KspHost lowers it by the part geometry's reach below that
    /// origin (LandingModel.LowestPointHeight).
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? HeightFromTerrain { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
