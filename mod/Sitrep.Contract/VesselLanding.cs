#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.landing</c> Topic payload: landing data for the active
/// vessel that needs KSP's PQS terrain heightmap (slope, roughness and
/// elevation at the touchdown site), plus an atmosphere-aware descent estimate
/// built from the vessel's measured drag. The vacuum ballistic figures (which
/// need no terrain) are not here; a client solves those itself.
///
/// <para>The whole payload is absent unless the vessel is descending toward a
/// solid surface: the body must have a solid surface and PQS terrain, and the
/// vessel must be descending towards it within the prediction horizon. So it
/// never carries a leftover reading from orbit, or a 0 from a body with no
/// terrain.</para>
///
/// <para>Every field is nullable, and null means that input is unavailable
/// this tick (no terrain fit, not in an atmosphere, and so on), never an
/// unverified 0.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.landing")]
public class VesselLanding
{
    /// <summary>
    /// Which class of landing readout is valid this tick, so a client can render
    /// the state rather than infer it from which fields are null. One of
    /// <c>"atmospheric-aware"</c> (the atmospheric descent fields are solved),
    /// <c>"terrain-assessed"</c> (no atmospheric solution, but a terrain slope
    /// fit exists) or <c>"vacuum-solved"</c> (neither). <c>"no-solution"</c> is
    /// part of the vocabulary but not currently produced.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Outcome { get; set; }

    /// <summary>
    /// Where the terrain fields were sampled this tick: <c>"predicted"</c> (at
    /// the mod's predicted touchdown point, the site the vessel is heading for)
    /// or <c>"sub-vessel"</c> (directly under the vessel, when there is no
    /// touchdown prediction). Show it, so the operator knows whether they are
    /// seeing downrange or under-ship terrain. Null when no terrain was
    /// sampled.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? SampleSource { get; set; }

    // KSP exposes no cheap terrain normal, so the two under-vessel fields are unpopulated; the sub-vessel fallback of the plane fit covers that case.

    /// <summary>Terrain elevation in metres above the body's mean radius
    /// directly beneath the vessel. Not currently produced, so always null:
    /// when <see cref="SampleSource"/> is <c>"sub-vessel"</c>,
    /// <see cref="PredictedTerrainElevation"/> carries the under-ship
    /// elevation.</summary>
    [SitrepUnit(Units.Metres)]
    public double? TerrainElevationUnderVessel { get; set; }

    /// <summary>Terrain slope directly beneath the vessel in degrees, 0 flat.
    /// Not currently produced, so always null: when <see cref="SampleSource"/>
    /// is <c>"sub-vessel"</c>, <see cref="PredictedSlopeAngle"/> carries the
    /// under-ship slope.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? SlopeAngleUnderVessel { get; set; }

    /// <summary>Latitude in degrees of the point the terrain fields were
    /// sampled at: the predicted touchdown point, or the vessel's own latitude
    /// when <see cref="SampleSource"/> is <c>"sub-vessel"</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedLatitude { get; set; }

    /// <summary>Longitude in degrees of the sampled point, on the same terms as
    /// <see cref="PredictedLatitude"/> and always present together with it.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedLongitude { get; set; }

    /// <summary>Terrain elevation in metres at the sampled point, KSP's
    /// <c>CelestialBody.TerrainAltitude(lat, lon, allowNegative: true)</c>, so
    /// ocean floor reads as negative rather than clamping to 0.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictedTerrainElevation { get; set; }

    /// <summary>Terrain slope in degrees at the sampled point, from a plane fit
    /// over sampled heights (so a bowl is not mistaken for an incline). The
    /// tip-over risk readout, available while still descending. Null when the
    /// plane fit fails.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedSlopeAngle { get; set; }

    /// <summary>The downhill direction at the sampled point in degrees, 0 north,
    /// clockwise: which way the lander falls if it tips. Null when the slope is
    /// too slight to give a direction.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? PredictedSlopeHeading { get; set; }

    /// <summary>The residual standard deviation, in metres, of sampled terrain
    /// height at the sampled point after the fitted slope plane is removed (so
    /// tilt is not counted as roughness), over
    /// <see cref="RoughnessFootprintMeters"/>. The boulder-risk proxy.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictedRoughness { get; set; }

    /// <summary>The footprint radius in metres that
    /// <see cref="PredictedRoughness"/> was sampled over, so a client can label
    /// and grade it.</summary>
    [SitrepUnit(Units.Metres)]
    public double? RoughnessFootprintMeters { get; set; }

    /// <summary>The radius in metres the slope plane-fit samples span.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SlopeSampleRadiusMeters { get; set; }

    /// <summary>KSP's biome name at the sampled point (for the vessel's current
    /// position, read <c>vessel.surface.biome</c>), from
    /// <c>ScienceUtil.GetExperimentBiome</c>. Null when the body has no biome
    /// map.</summary>
    [SitrepUnit(Units.Text)]
    public string? PredictedBiome { get; set; }

    /// <summary>The distance in metres of each <see cref="GroundTrackElevations"/>
    /// sample along the predicted ground track, signed: 0 is the point on the
    /// ground beneath the vessel, positive is toward the predicted site and on past
    /// it, negative is behind the vessel. Ascending, the same length as
    /// <see cref="GroundTrackElevations"/>. The strip always holds the ground
    /// directly beneath the vessel, with at least one vessel height (and never less
    /// than 120 m) of ground behind it, and runs on to the far edge of the footprint
    /// of a cone of 60 degrees either side of the vessel's travel vector: where the
    /// cone's two edges, in the plane of the vessel's motion, meet the ground. A
    /// flat or climbing approach has an edge that never meets it, and that edge is
    /// cut at the horizon. The strip also reaches the predicted site and a tenth of
    /// its distance past it. The number of samples is fixed, so they are closer
    /// together the narrower the strip, which narrows as the vessel descends. Null when no track could be sampled.</summary>
    [SitrepUnit(Units.Metres)]
    public double[]? GroundTrackDistances { get; set; }

    /// <summary>Terrain elevation in metres at each
    /// <see cref="GroundTrackDistances"/> entry, from the body's terrain model
    /// (ocean floor reads negative). Null when no track could be sampled.</summary>
    [SitrepUnit(Units.Metres)]
    public double[]? GroundTrackElevations { get; set; }

    /// <summary>A square of terrain elevations in metres around the predicted
    /// site, for a top-down view of it: <see cref="SiteHeightsSize"/> by
    /// <see cref="SiteHeightsSize"/> values row by row, the northern row first and
    /// the western column first in each row, so laying them out in that order puts
    /// north at the top. The grid is centred on the site and its width is
    /// <see cref="SiteHeightsExtentMeters"/>: wide enough to hold the ground
    /// between the vessel and the site, and about the vessel's height of it either
    /// side, so it narrows as the vessel descends and closes on the site, and it may
    /// be a second old. Null when no site could be sampled.</summary>
    [SitrepUnit(Units.Metres)]
    public double[]? SiteHeights { get; set; }

    /// <summary>The number of values along each side of <see cref="SiteHeights"/>.
    /// Null when there is no grid.</summary>
    [SitrepUnit(Units.Count)]
    public int? SiteHeightsSize { get; set; }

    /// <summary>The full width in metres that <see cref="SiteHeights"/> spans.
    /// Null when there is no grid.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SiteHeightsExtentMeters { get; set; }

    // The atmospheric fields below come from one instantaneous terminal-velocity model over the same measured drag, so they are present or absent together.

    /// <summary>Terminal velocity in m/s at the current altitude and
    /// configuration, from the measured aggregate drag force against local
    /// gravity. An estimate that assumes the current configuration holds (same
    /// attitude, no parachute yet to open). Null outside an atmosphere, or when
    /// the vessel's parts could not be read.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TerminalVelocity { get; set; }

    /// <summary>Projected touchdown speed in m/s under a terminal descent to the
    /// ground (terminal velocity scaled to ground-level density). In an
    /// atmosphere, use this rather than a vacuum impact speed. Null outside an
    /// atmosphere.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? ProjectedTouchdownSpeed { get; set; }

    /// <summary>Atmosphere-aware time to impact in seconds, integrating the
    /// terminal-velocity profile down the density column. Null outside an
    /// atmosphere.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? AtmosphericTimeToImpact { get; set; }

    /// <summary>The instantaneous descent regime: <c>"at-terminal"</c>,
    /// <c>"decelerating"</c> or <c>"accelerating"</c>. Null outside an
    /// atmosphere.</summary>
    [SitrepUnit(Units.Text)]
    public string? DescentRegime { get; set; }

    /// <summary>The aggregate aerodynamic drag force divided by the vessel's
    /// weight (local gravity): the numeric form of <see cref="DescentRegime"/>.
    /// &gt;1 decelerating (drag beats gravity), 1 at terminal, &lt;1 still
    /// accelerating. A dimensionless ratio from 0 upward like TWR, not a 0..1
    /// fraction. Null outside an atmosphere, and for a weightless vessel.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? DragToWeightRatio { get; set; }

    /// <summary>Parachute state affecting the estimate: <c>"none"</c> (no
    /// parachute is staged or open), <c>"armed"</c> (a parachute is staged and
    /// waiting to open: a future jump in drag the estimate cannot see, so flag
    /// it) or <c>"deployed"</c> (a parachute is open or semi-deployed, so its
    /// drag is already in the measurement). Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Text)]
    public string? ParachuteState { get; set; }

    /// <summary>How far the craft's parachutes have opened, taken from the one
    /// furthest along: <c>"none"</c> (the craft carries no parachute),
    /// <c>"stowed"</c> (packed, not yet staged), <c>"armed"</c> (staged and
    /// waiting for air thick enough to open in), <c>"semi-deployed"</c> (open
    /// as a streamer, slowing the craft a little), <c>"deployed"</c> (fully
    /// open) or <c>"cut"</c> (every one cut away). Unlike
    /// <see cref="ParachuteState"/> it tells semi-deployed from fully deployed,
    /// and a packed parachute from none. Null outside an atmosphere.</summary>
    [SitrepUnit(Units.Text)]
    public string? ParachuteDeployment { get; set; }

    /// <summary>Whether opening the parachutes not yet open would survive the
    /// current speed and air, as the game rates it from the heating a canopy
    /// would take: <c>"safe"</c>, <c>"risky"</c> (the canopy would heat but
    /// hold for a few seconds) or <c>"unsafe"</c> (it would burn through). The
    /// worst rating among the stowed and armed parachutes. Null outside an
    /// atmosphere, when every parachute is already open or cut, and for a
    /// parachute the game does not rate.</summary>
    [SitrepUnit(Units.Text)]
    public string? ParachuteDeploySafety { get; set; }

    /// <summary>The height above the ground or the sea at which an armed or
    /// semi-deployed parachute opens fully, the greatest when there are
    /// several, since that one opens first. Null when none is armed or
    /// semi-deployed, outside an atmosphere, and for a parachute the game does
    /// not report one for.</summary>
    [SitrepUnit(Units.Metres)]
    public double? ParachuteFullDeployAltitude { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
