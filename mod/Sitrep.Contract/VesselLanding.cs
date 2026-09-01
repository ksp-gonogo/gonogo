#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.landing</c> channel payload: terrain-informed landing data
/// that needs KSP's PQS heightmap, which no client-side derivation can source
/// (no client-side height grid is anywhere near fine-grained enough for a
/// lander-scale slope), plus an atmosphere-aware descent estimate that needs
/// per-part drag the client does not have.
///
/// <para>Distinct from the vacuum ballistic scalars a client solves for
/// itself, which need no terrain and stay client-side.</para>
///
/// <para>Whole-channel absence means "not descending toward a solid surface",
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
#if SITREP_CODEGEN
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
    [SitrepUnit(Units.Text)]
    public string? Outcome { get; set; }

    /// <summary>
    /// Which sampling source produced the terrain fields this tick:
    /// <c>"predicted"</c> (sampled at the mod's predicted downrange touchdown
    /// point: the site you are heading for) or <c>"sub-vessel"</c> (the
    /// graceful fallback: sampled directly under the vessel when no touchdown
    /// solution is available). The client surfaces this so the operator knows
    /// whether they are seeing downrange or under-ship terrain. Null when no
    /// terrain was sampled.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? SampleSource { get; set; }

    // ── Tier 1: under-vessel terrain (forward-compat placeholders) ───────────
    // Not populated in the current build: a Deck capture (pre-flight V1)
    // confirmed KSP does not surface a cheap terrain normal on vessel.surface,
    // so under-vessel slope is NOT derived from Vessel.terrainNormal. Slope
    // comes from the Tier-2 PQS plane-fit instead (which the sub-vessel fallback
    // runs directly under the vessel anyway, strictly better than a float
    // normal). These stay in the shape so a future terrain-normal publish can
    // light them up without a contract change.

    /// <summary>Metres: terrain elevation above the body mean radius directly beneath the vessel. Currently null (see the Tier-1 note); the sub-vessel-fallback <see cref="PredictedTerrainElevation"/> carries the under-ship elevation.</summary>
    [SitrepUnit(Units.Metres)]
    public double? TerrainElevationUnderVessel { get; set; }

    /// <summary>Degrees, 0 = flat: under-vessel terrain slope. Currently null (see the Tier-1 note); under-vessel slope comes from the Tier-2 plane-fit via the sub-vessel sampling fallback.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? SlopeAngleUnderVessel { get; set; }

    // ── Tier 2: PQS-sampled at the PREDICTED touchdown point ─────────────────

    /// <summary>Degrees: predicted touchdown latitude. Terrain-independent: the client patch-walk supplies the point; this channel samples terrain there. Null when no touchdown is predicted within the horizon.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedLatitude { get; set; }

    /// <summary>Degrees: predicted touchdown longitude. Always defined together with <see cref="PredictedLatitude"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedLongitude { get; set; }

    /// <summary>Metres: terrain elevation at the predicted touchdown point. <c>CelestialBody.TerrainAltitude(lat, lon, allowNegative: true)</c> so ocean floor reads honestly rather than clamping to a fabricated 0.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictedTerrainElevation { get; set; }

    /// <summary>Degrees: terrain slope at the predicted touchdown point, from a plane fit over sampled heights (not an abs-average, which cannot tell a bowl from an incline). The tipover-risk readout, available while still descending.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedSlopeAngle { get; set; }

    /// <summary>Degrees, 0 = north, clockwise: the downhill direction at the predicted point (which way the lander falls if it tips). Null below the noise floor.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedSlopeHeading { get; set; }

    /// <summary>Metres: RESIDUAL standard deviation of sampled terrain height at the predicted point, AFTER removing the fitted slope plane (so tilt is not double-counted as roughness). Sampled over <see cref="RoughnessFootprintMeters"/> so it lives on the client's calibrated sigma grade. The boulder-risk proxy.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictedRoughness { get; set; }

    /// <summary>Metres: the footprint radius the roughness sigma was sampled over. Ships so the client can label honestly and grade it on the shared sigma scale.</summary>
    [SitrepUnit(Units.Metres)]
    public double? RoughnessFootprintMeters { get; set; }

    /// <summary>Metres: the (tighter) radius the slope plane-fit samples span.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SlopeSampleRadiusMeters { get; set; }

    /// <summary>KSP's biome name at the PREDICTED touchdown point (not the current position, that is <c>vessel.surface.biome</c>). Via <c>ScienceUtil.GetExperimentBiome</c> (which takes degrees). Null when the body has no biome map.</summary>
    [SitrepUnit(Units.Text)]
    public string? PredictedBiome { get; set; }

    // ── Reticle relief patch (phase-later; cached, resampled on point drift) ─

    /// <summary>Flattened row-major NxN grid of terrain elevations (metres) around the predicted point, for the reticle's shaded relief. Null until the relief patch ships / when over the PQS budget (the reticle falls back to a flat roughness tint). Length is <see cref="TerrainPatchSize"/> squared.</summary>
    [SitrepUnit(Units.Metres)]
    public double[]? TerrainPatch { get; set; }

    /// <summary>The N of the NxN <see cref="TerrainPatch"/> grid. Null when no patch.</summary>
    [SitrepUnit(Units.Count)]
    public int? TerrainPatchSize { get; set; }

    /// <summary>Metres: the full width the <see cref="TerrainPatch"/> grid spans.</summary>
    [SitrepUnit(Units.Metres)]
    public double? TerrainPatchExtentMeters { get; set; }

    // ── Atmosphere-aware descent (instantaneous terminal-velocity model) ─────

    /// <summary>m/s: terminal velocity at the CURRENT altitude/config, from the measured aggregate drag force against local gravity. Null outside an atmosphere. An ESTIMATE assuming current config holds (attitude, no pending chute).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TerminalVelocity { get; set; }

    /// <summary>m/s: projected touchdown speed under a terminal descent to the ground (terminal velocity scaled to ground density). The atmosphere-aware replacement for the (wrong) vacuum impact speed. Null outside an atmosphere.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? ProjectedTouchdownSpeed { get; set; }

    /// <summary>Seconds: atmosphere-aware time to impact, integrating the terminal-velocity profile down the density column. Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? AtmosphericTimeToImpact { get; set; }

    /// <summary>The instantaneous descent regime: <c>"at-terminal"</c> / <c>"decelerating"</c> / <c>"accelerating"</c>. Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Text)]
    public string? DescentRegime { get; set; }

    /// <summary>The aggregate aerodynamic drag force divided by the vessel's weight (local gravity): the numeric form of <see cref="DescentRegime"/>. &gt;1 decelerating (drag beats gravity), 1 at terminal, &lt;1 still accelerating. A dimensionless 0..N ratio like TWR, not a 0..1 fraction. Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? DragToWeightRatio { get; set; }

    /// <summary>Parachute state affecting the estimate: <c>"none"</c> / <c>"armed"</c> (a future step change the instant model cannot see, flag the estimate) / <c>"deployed"</c> (drag already in the measurement, self-corrected). Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Text)]
    public string? ParachuteState { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
