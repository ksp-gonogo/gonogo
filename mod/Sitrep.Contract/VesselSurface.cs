#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.surface</c> channel payload — the landing/ground-survey
/// capture-add (M3 R3): data a LandingStatus/GroundSurvey widget needs that
/// <c>vessel.flight</c> doesn't already carry. <c>vessel.flight.AltitudeTerrain</c>
/// (KSP's <c>radarAltitude</c>, measured from the vessel's centre of mass)
/// already ships — <see cref="HeightFromTerrain"/> here is a DIFFERENT,
/// additional reading (KSP's own <c>heightFromTerrain</c>, which accounts
/// for the vessel's physical extent — effectively "how far is my LOWEST
/// point from the ground," the number a landing-gear/suicide-burn widget
/// actually cares about, not the CoM-to-ground distance).
///
/// <para>Whole-channel absence means "not near any surface right now" —
/// guarded on <see cref="Sitrep.Contract.Situation.Orbiting"/>/
/// <see cref="Sitrep.Contract.Situation.Escaping"/> on the capture side
/// (<c>Gonogo.KSP.KspHost.BuildSurface</c>), never a stale/garbage AGL
/// reading from deep space (KSP keeps whatever it last computed for
/// <c>heightFromTerrain</c> even when there's no meaningful "terrain"
/// underneath at all).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.surface")]
public class VesselSurface
{
    /// <summary>KSP's biome name at the vessel's current lat/long (e.g. "Highlands", "Shores"). Null when the body has no biome map (e.g. gas giants) or the lookup failed this tick.</summary>
    public string? Biome { get; set; }

    /// <summary>The named launch/landing site the vessel is currently at (e.g. "KSC_LaunchPad", "Runway") — null when landed/splashed somewhere with no named site, or when not landed/splashed at all.</summary>
    public string? LandedAt { get; set; }

    /// <summary>Metres — KSP's own <c>heightFromTerrain</c>, accounting for the vessel's physical extent (see the class doc comment for how this differs from <c>vessel.flight.altitudeTerrain</c>). Null if unavailable this tick.</summary>
    public double? HeightFromTerrain { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
