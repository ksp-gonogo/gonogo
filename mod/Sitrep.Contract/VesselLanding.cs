#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.landing</c> channel payload — terrain-informed landing data
/// that needs KSP's PQS heightmap, which no client-side derivation can source
/// (the only client candidate, SCANsat's 1x1-degree height grid, is coarser
/// than a lander-scale slope by orders of magnitude), plus an atmosphere-aware
/// descent estimate that needs per-part drag the client does not have.
///
/// <para>Distinct from the client-derived vacuum ballistic scalars (the
/// LandingStatus widget's own <c>solveSuicideBurn</c>), which need no terrain
/// and stay client-side.</para>
///
/// <para>Whole-channel absence means "not descending toward a solid surface" —
/// relevance-gated at the source on situation + a descent test +
/// <c>CelestialBody.hasSolidSurface</c> / a non-null <c>pqsController</c>, so
/// this never carries a stale reading from orbit or a fabricated 0.0 from a
/// body with no PQS. This is the third instance of the CaptureCrash house
/// pattern (one source-gated channel published to every screen), with a
/// continuous numeric gate rather than a categorical event.</para>
///
/// <para>Every field is nullable: a field is null when its input is
/// unavailable this tick (e.g. no PQS, no touchdown solution, not in
/// atmosphere). Never ship a 0.0 that was not verified.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.landing")]
public class VesselLanding
{
    // ── Outcome ────────────────────────────────────────────────────────────

    /// <summary>
    /// Which class of landing readout is valid this tick, so the client renders
    /// state rather than inferring it from a pile of nulls. One of:
    /// <c>"vacuum-solved"</c>, <c>"atmospheric-aware"</c>, <c>"no-solution"</c>,
    /// <c>"terrain-assessed"</c>. Null before the first classification.
    /// </summary>
    public string? Outcome { get; set; }

    // ── Tier 1: under-vessel terrain (cached Vessel.* fields, no PQS call) ───

    /// <summary>Metres — terrain elevation above the body mean radius directly beneath the vessel, from <c>Vessel.terrainAltitude</c> (a cached field, costs no PQS call). Null when the body has no solid surface / no pqsController.</summary>
    public double? TerrainElevationUnderVessel { get; set; }

    /// <summary>Degrees, 0 = flat — terrain slope beneath the vessel, from <c>Vessel.terrainNormal</c> against the body up vector. Null when the normal is not populated (unlanded / out of physics range).</summary>
    public double? SlopeAngleUnderVessel { get; set; }

    // ── Tier 2: PQS-sampled at the PREDICTED touchdown point ─────────────────

    /// <summary>Degrees — predicted touchdown latitude. Terrain-independent: the client patch-walk supplies the point; this channel samples terrain there. Null when no touchdown is predicted within the horizon.</summary>
    public double? PredictedLatitude { get; set; }

    /// <summary>Degrees — predicted touchdown longitude. Always defined together with <see cref="PredictedLatitude"/>.</summary>
    public double? PredictedLongitude { get; set; }

    /// <summary>Metres — terrain elevation at the predicted touchdown point. <c>CelestialBody.TerrainAltitude(lat, lon, allowNegative: true)</c> so ocean floor reads honestly rather than clamping to a fabricated 0.</summary>
    public double? PredictedTerrainElevation { get; set; }

    /// <summary>Degrees — terrain slope at the predicted touchdown point, from a plane fit over sampled heights (not an abs-average, which cannot tell a bowl from an incline). The tipover-risk readout, available while still descending.</summary>
    public double? PredictedSlopeAngle { get; set; }

    /// <summary>Degrees, 0 = north, clockwise — the downhill direction at the predicted point (which way the lander falls if it tips). Null below the noise floor.</summary>
    public double? PredictedSlopeHeading { get; set; }

    /// <summary>Metres — RESIDUAL standard deviation of sampled terrain height at the predicted point, AFTER removing the fitted slope plane (so tilt is not double-counted as roughness). Sampled over <see cref="RoughnessFootprintMeters"/> so it lives on GroundSurvey's calibrated sigma grade. The boulder-risk proxy.</summary>
    public double? PredictedRoughness { get; set; }

    /// <summary>Metres — the footprint radius the roughness sigma was sampled over. Ships so the client can label honestly and so the shared sigma-grade transfers between GroundSurvey (flown track) and the reticle (touchdown patch).</summary>
    public double? RoughnessFootprintMeters { get; set; }

    /// <summary>Metres — the (tighter) radius the slope plane-fit samples span.</summary>
    public double? SlopeSampleRadiusMeters { get; set; }

    /// <summary>KSP's biome name at the PREDICTED touchdown point (not the current position — that is <c>vessel.surface.biome</c>). Via <c>ScienceUtil.GetExperimentBiome</c> (which takes degrees). Null when the body has no biome map.</summary>
    public string? PredictedBiome { get; set; }

    // ── Reticle relief patch (phase-later; cached, resampled on point drift) ─

    /// <summary>Flattened row-major NxN grid of terrain elevations (metres) around the predicted point, for the reticle's shaded relief. Null until the relief patch ships / when over the PQS budget (the reticle falls back to a flat roughness tint). Length is <see cref="TerrainPatchSize"/> squared.</summary>
    public double[]? TerrainPatch { get; set; }

    /// <summary>The N of the NxN <see cref="TerrainPatch"/> grid. Null when no patch.</summary>
    public int? TerrainPatchSize { get; set; }

    /// <summary>Metres — the full width the <see cref="TerrainPatch"/> grid spans.</summary>
    public double? TerrainPatchExtentMeters { get; set; }

    // ── Atmosphere-aware descent (instantaneous terminal-velocity model) ─────

    /// <summary>m/s — terminal velocity at the CURRENT altitude/config, from the measured aggregate drag force against local gravity. Null outside an atmosphere. An ESTIMATE assuming current config holds (attitude, no pending chute).</summary>
    public double? TerminalVelocity { get; set; }

    /// <summary>m/s — projected touchdown speed under a terminal descent to the ground (terminal velocity scaled to ground density). The atmosphere-aware replacement for the (wrong) vacuum impact speed. Null outside an atmosphere.</summary>
    public double? ProjectedTouchdownSpeed { get; set; }

    /// <summary>Seconds — atmosphere-aware time to impact, integrating the terminal-velocity profile down the density column. Null outside an atmosphere.</summary>
    public double? AtmosphericTimeToImpact { get; set; }

    /// <summary>The instantaneous descent regime: <c>"at-terminal"</c> / <c>"decelerating"</c> / <c>"accelerating"</c>. Null outside an atmosphere.</summary>
    public string? DescentRegime { get; set; }

    /// <summary>Parachute state affecting the estimate: <c>"none"</c> / <c>"armed"</c> (a future step change the instant model cannot see — flag the estimate) / <c>"deployed"</c> (drag already in the measurement, self-corrected). Null outside an atmosphere.</summary>
    public string? ParachuteState { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
