using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>system.bodies</c> channel payload: every celestial body in the
/// game, as a tree, wrapped as <c>{ "bodies": [ ... ] }</c>. The whole payload
/// is <c>null</c>, not an empty list, when no sample has been taken yet, so
/// "no data yet" and "zero bodies" stay distinct.
///
/// <para>Carries no <c>Meta</c> field: unlike the <c>vessel.*</c> family, its
/// <see cref="Meta"/> rides the envelope (<c>StreamData.Meta</c>), never the
/// payload body.</para>
/// <internal>
/// Typing-only mirror of Sitrep.Host.SystemViewProvider.BuildSystemBodies'
/// hand-built shape; the provider emits the value tree JsonWriter walks.
/// </internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
[SitrepTopic("system.bodies")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SystemBodies
{
    /// <summary>Every body. The tree is expressed through <see cref="BodyEntry.ParentIndex"/>.</summary>
    public IReadOnlyList<BodyEntry> Bodies { get; set; } = new List<BodyEntry>();
}

/// <summary>
/// One celestial body in the <see cref="SystemBodies"/> tree: an explicit
/// parent-index tree, with null rather than a numeric sentinel for any
/// missing value. There is no eccentric anomaly field; solve it from
/// <see cref="Orbit"/> at the time you need it.
/// <internal>
/// Mirrors the per-body dict SystemViewProvider.BuildBody emits. No
/// eccentricAnomaly field because an orbit-patch formatter that carries one
/// tends to fill it with the body's eccentricity instead.
/// </internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class BodyEntry
{
    /// <summary>Body name (e.g. "Kerbin"); null when the game has not populated it.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>This body's position in the list, stable for the session and the key <see cref="ParentIndex"/> and <see cref="VesselRosterEntry.BodyIndex"/> refer to. Never null.</summary>
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }

    /// <summary>Index of the body this one orbits; null only for the root star, never a sentinel like -1.</summary>
    [SitrepUnit(Units.Id)]
    public int? ParentIndex { get; set; }

    /// <summary>Mean radius, metres; null when the game does not have it yet (never 0 or -1 as a stand-in).</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepStatic]
    public double? Radius { get; set; }

    /// <summary>Orbital elements about the parent body; null only for the root star, which has no parent to orbit.</summary>
    public OrbitEntry? Orbit { get; set; }

    /// <summary>
    /// How far <see cref="Orbit"/> may be carried forward, and what kind of
    /// prediction that is. Never null, and the same <see cref="PropagationHorizon"/>
    /// a craft's elements carry: <c>UntilUt</c> is an absolute UT here exactly as
    /// it is there.
    ///
    /// <para><b>Under stock this is always Unbounded and Analytic, and that is not
    /// a placeholder.</b> A body rides a fixed conic about a fixed parent, so where
    /// it is at any UT can be computed on demand from <see cref="Orbit"/>, with no
    /// drift to bound.</para>
    ///
    /// <para><b>Under n-body physics a body's elements drift like a craft's.</b>
    /// The elements are then the conic osculating an integrated ephemeris at the
    /// sample instant, and extrapolating them past this horizon draws a moon
    /// where no model put it. The horizon comes from the installed physics mod,
    /// through <see cref="IBodyEphemerisHorizon"/>.</para>
    ///
    /// <para>Per body rather than once for the system, because the bound is
    /// local: a moon deep in a giant's satellite system and a lone planet are
    /// perturbed by orders of magnitude differently.</para>
    /// </summary>
    public PropagationHorizon Horizon { get; set; } = new();

    /// <summary>
    /// Standard gravitational parameter μ = G·M, m³/s² (KSP
    /// <c>CelestialBody.gravParameter</c>). Null when the game has not
    /// populated it.
    /// </summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    [SitrepStatic]
    public double? GravParameter { get; set; }

    /// <summary>
    /// Body mass, kilograms (<c>CelestialBody.Mass</c>). Null when the game has
    /// not populated it.
    /// </summary>
    [SitrepUnit(Units.Kilograms)]
    [SitrepStatic]
    public double? Mass { get; set; }

    /// <summary>
    /// Surface gravity in multiples of g₀ (<c>CelestialBody.GeeASL</c>),
    /// verbatim. Null when the game has not populated it.
    ///
    /// <para>This is the configured value, not a derived one: KSP computes mass
    /// and gravParameter from it (<c>Mass = Radius² · (GeeASL ·
    /// PhysicsGlobals.GravitationalAcceleration) / G</c>), so reconstructing it
    /// as μ/r²/g₀ runs the game's arithmetic backwards and can only lose
    /// precision.</para>
    /// </summary>
    [SitrepUnit(Units.GForce)]
    [SitrepStatic]
    public double? SurfaceGravity { get; set; }

    /// <summary>
    /// Hill-sphere radius, metres (<c>CelestialBody.hillSphere</c>).
    ///
    /// <para>Null for the root star, where KSP's own value is
    /// <c>double.PositiveInfinity</c> and there is no parent to be bound by.</para>
    ///
    /// <para>Use this rather than computing it: KSP's expression is
    /// <c>a·(1−e)·(m/M)^(1/3)</c>, while the textbook form carries a factor of
    /// three under the root, <c>a·(1−e)·∛(m/3M)</c>, which comes out about 31%
    /// smaller than the game's.</para>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? HillSphere { get; set; }

    /// <summary>Sphere-of-influence radius, metres (<c>CelestialBody.sphereOfInfluence</c>); null when absent.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SphereOfInfluence { get; set; }

    /// <summary>Sidereal rotation period, seconds (<c>CelestialBody.rotationPeriod</c>); a negative value denotes retrograde rotation. Null when absent. A body rotates exactly when this is finite and non-zero; there is no separate flag.</summary>
    [SitrepUnit(Units.Seconds)]
    [SitrepStatic]
    public double? RotationPeriod { get; set; }

    /// <summary>
    /// The body's rotation angle at UT 0, degrees
    /// (<c>CelestialBody.initialRotation</c>); null when absent.
    ///
    /// <para>The PHASE that <see cref="RotationPeriod"/>'s rate is measured
    /// from, and the pair is what makes a body-fixed coordinate into a place:
    /// the angle at any UT is
    /// <c>initialRotation + 360 · ut / rotationPeriod</c>, and turning a
    /// latitude/longitude by it gives a position in the same frame this
    /// payload's orbital elements are measured in. The turn is about the
    /// reference +Z pole alone, so no separate spin axis is needed.</para>
    ///
    /// <para>Zero is a real value, not a stand-in: a body whose prime meridian
    /// happens to face the reference direction at UT 0 reports it.</para>
    /// <internal>
    /// Read by KspHost.BuildBodyEntry and mapped by SystemViewProvider.BuildBody.
    ///
    /// The turn is about +Z and nothing else, which is why a client needs no
    /// spin axis beside this. <c>CelestialBody.updateBody</c> builds every
    /// body's frame as <c>PlanetaryFrame(0, 90, directRotAngle)</c>, and that
    /// reduces to a rotation about the reference pole; the global
    /// <c>Planetarium.InverseRotAngle</c> in <c>directRotAngle</c> is the
    /// floating world frame's own offset and cancels for anything expressed
    /// against the elements rather than against Unity's world.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    [SitrepStatic]
    public double? InitialRotation { get; set; }

    /// <summary>Whether the body is tidally locked to its parent (<c>CelestialBody.tidallyLocked</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    [SitrepStatic]
    public bool? TidallyLocked { get; set; }

    /// <summary>Atmosphere descriptor; null when the body has no atmosphere (<c>CelestialBody.atmosphere</c> is false), never an all-null placeholder.</summary>
    public AtmosphereEntry? Atmosphere { get; set; }

    /// <summary>Whether the body has a liquid ocean (<c>CelestialBody.ocean</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    [SitrepStatic]
    public bool? HasOcean { get; set; }

    /// <summary>KSP's per-body flavour text (<c>CelestialBody.bodyDescription</c>); null when absent. May be a raw, unresolved <c>#autoLOC...</c> localization tag, which is not text to show.</summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    /// <summary>Whether KSC and the launch sites sit on this body (<c>CelestialBody.isHomeWorld</c>); true on exactly one body, null when absent. The authoritative home-body marker: a client locates home by this flag, never by index.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsHome { get; set; }

    // Deliberately NO "eccentricAnomaly" field: see the class doc.
    //
    // Mass, SurfaceGravity and HillSphere are carried even though a client
    // could derive each from GravParameter, Radius and Orbit: a client-side
    // derivation can disagree with the game's own (see HillSphere).
    //
    // These stay deliberately absent, because the game genuinely has no
    // opinion:
    //   escapeVelocity  CelestialBody has no such member at all (member dump)
    //   trueAnomaly     Orbit.trueAnomaly is the LIVE value; a delayed console
    //                   needs it solved at a view time the game knows nothing
    //                   about, which is what the client's Kepler solve is for
    //   rotates         conveyed by RotationPeriod being finite and non-zero
}

/// <summary>
/// A body's atmosphere, present on a <see cref="BodyEntry"/> only when the body
/// actually has one (null otherwise, never an all-null placeholder).
/// <internal>
/// Mirrors the nested dict SystemViewProvider.BuildAtmosphere emits.
/// </internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class AtmosphereEntry
{
    /// <summary>Atmosphere height, metres (<c>CelestialBody.atmosphereDepth</c>); null when absent.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepStatic]
    public double? Depth { get; set; }

    /// <summary>Whether the atmosphere is breathable / oxygenated (<c>CelestialBody.atmosphereContainsOxygen</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    [SitrepStatic]
    public bool? HasOxygen { get; set; }

    /// <summary>Sea-level pressure, kPa (<c>CelestialBody.atmospherePressureSeaLevel</c>); null when absent.</summary>
    [SitrepUnit(Units.Kilopascals)]
    [SitrepStatic]
    public double? SeaLevelPressure { get; set; }

    /// <summary>
    /// Altitudes of the <see cref="Pressures"/> samples, metres above sea
    /// level, ascending from 0; null when the stream does not report a
    /// profile. Same length as <see cref="Pressures"/>. Fixed for the session.
    /// <internal>
    /// It costs 16 to 48 points per atmospheric body, which on a real RO
    /// install (33 bodies, 11 with air) is 5.2 kB added to a 23.3 kB
    /// system.bodies emit, re-sent every second for a table that is fixed for
    /// the session. If the channel is given a change-gate that can see a
    /// payload has not moved, this is the field that gains most from it.
    /// Measured against the ten pressure curves the RSS install ships, the worst
    /// reconstruction error is 1.51%, and 1.12% on every body but Pluto, whose
    /// near-vacuum air runs the point cap out.
    /// </internal>
    /// </summary>
    /// <remarks>
    /// <para>Spacing is chosen per body rather than fixed, because the shape
    /// varies enormously: RSS Earth's table runs to 94 km and Saturn's to
    /// 1,270 km. Points are placed so that linear interpolation of log
    /// pressure between neighbouring samples stays within about 1% of the
    /// game's curve, up to 48 points per body. Interpolate in log pressure,
    /// not linearly.</para>
    ///
    /// <para>The table ends six decades below sea level, not at
    /// <see cref="Depth"/>. Above that the game's own curve is a cubic
    /// plunging into a hard zero at the ceiling, which no interpolation in log
    /// space can follow and which carries no pressure worth stating. A
    /// consumer draws to the last sample and takes <see cref="Depth"/> as
    /// where the air formally ends.</para>
    /// </remarks>
    [SitrepUnit(Units.Metres)]
    [SitrepStatic]
    public double[]? PressureAltitudes { get; set; }

    /// <summary>
    /// Pressure at each <see cref="PressureAltitudes"/> entry, kPa, as the
    /// game's own <c>CelestialBody.GetPressure</c> returns it; null when the
    /// stream does not report a profile.
    /// </summary>
    /// <remarks>
    /// <para>Sampled rather than modelled because the exponential
    /// <c>P0·exp(-h/H)</c> a client can build from sea-level pressure and a
    /// scale height is not what KSP evaluates, and <c>CelestialBody</c> has no
    /// scale-height field to build it from. A body with
    /// <c>atmosphereUsePressureCurve</c> set follows a tabulated curve, as
    /// stock's own atmospheres and RealAtmospheres-style packs do; against the
    /// RSS Earth curve the exponential is out by a factor of sixteen at
    /// altitude. The sampled values are correct for stock and for any planet
    /// pack.</para>
    ///
    /// <para>Rounded to six significant figures. The curve path evaluates in
    /// float32 inside Unity's own <c>AnimationCurve</c>, so more digits would
    /// be inventing precision, and six is far below the 1% spacing
    /// tolerance.</para>
    /// </remarks>
    [SitrepUnit(Units.Kilopascals)]
    [SitrepStatic]
    public double[]? Pressures { get; set; }
}

/// <summary>
/// A body's Keplerian orbital elements, present on every
/// <see cref="BodyEntry"/> except the root star. Each element is
/// independently <c>null</c> when its value is absent or non-finite, never a
/// NaN token on the wire. Every orbit has a defined node and periapsis, an
/// equatorial or circular one included, so a <c>null</c> <see cref="Lan"/> or
/// <see cref="ArgPe"/> is a genuine absence and never stands for either shape.
/// <internal>
/// Emitted by SystemViewProvider.BuildOrbit through the shared
/// non-finite-is-absent rule. KSP's Orbit takes Vector3d.right as an
/// equatorial orbit's node and sets argumentOfPeriapsis to 0 for a circular
/// one, so neither element is NaN for either shape.
/// </internal>
///
/// <para>Units follow KSP's own, which are mixed: <see cref="Sma"/> in
/// metres; <see cref="Inc"/>, <see cref="Lan"/> and <see cref="ArgPe"/> in
/// degrees; <see cref="MeanAnomalyAtEpoch"/> in radians; <see cref="Epoch"/>
/// in UT seconds. There is no eccentric anomaly field (see
/// <see cref="BodyEntry"/>).</para>
/// <internal>
/// Emitted by SystemViewProvider.BuildOrbit.
/// </internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class OrbitEntry
{
    /// <summary>Semi-major axis, metres.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Sma { get; set; }

    /// <summary>Eccentricity.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Ecc { get; set; }

    /// <summary>Inclination, degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Inc { get; set; }

    /// <summary>Longitude of ascending node, degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Lan { get; set; }

    /// <summary>Argument of periapsis, degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? ArgPe { get; set; }

    /// <summary>Mean anomaly at epoch, radians.</summary>
    [SitrepUnit(Units.Radians)]
    public double? MeanAnomalyAtEpoch { get; set; }

    /// <summary>Epoch UT, seconds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Epoch { get; set; }

}

/// <summary>
/// The <c>system.vessels</c> channel payload: every known vessel, not just
/// the active one (for a "what could I target" listing), wrapped as
/// <c>{ "vessels": [ ... ] }</c>. The whole payload is <c>null</c> when
/// nothing is loaded (the main menu), distinct from an empty roster when the
/// game reports zero vessels. Like <see cref="SystemBodies"/>, it carries no
/// per-payload <c>Meta</c>: that rides the envelope.
/// <internal>
/// Typing-only mirror of SystemViewProvider.BuildSystemVessels' shape.
/// </internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
[SitrepTopic("system.vessels")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SystemVessels
{
    /// <summary>Every known vessel with a resolvable id, loaded or not. Debris and asteroids are included.</summary>
    public IReadOnlyList<VesselRosterEntry> Vessels { get; set; } = new List<VesselRosterEntry>();
}

/// <summary>
/// A roster vessel's control level, as stock CommNet reports it
/// (<c>Vessel.connection.GetControlLevel()</c>), for
/// <see cref="VesselRosterEntry.CommsControlSource"/>. Not the same type as
/// <see cref="Sitrep.Contract.CommsControlSource"/>, which belongs to the
/// active vessel's <c>comms.*</c> channels and whatever comms mod provides
/// them.
/// </summary>
/// <category>Solar system and fleet</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum RosterCommsControlSource
{
    /// <summary>A measurement: the vessel has no control source.</summary>
    None,

    /// <summary>Partial control: KSP's <c>PARTIAL_MANNED</c> or <c>PARTIAL_UNMANNED</c> level, such as a probe core with no link home.</summary>
    Partial,

    /// <summary>Full control: KSP's <c>FULL</c> level.</summary>
    Full,

    /// <summary>
    /// The game reported a control level this build does not name. Not
    /// <see cref="None"/>: nothing was measured to be absent, the level simply
    /// has no tier here yet.
    /// </summary>
    Unknown,
}

/// <summary>
/// One vessel in the <see cref="SystemVessels"/> roster. A vessel with no
/// resolvable stable id is left out rather than given a made-up one, so
/// <see cref="VesselId"/> is always present.
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class VesselRosterEntry
{
    /// <summary>Stable subject id (KSP vessel GUID). Always present, entries without one are dropped.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>Display name; defaults to the empty string, never null.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>Vessel type, as the numeric value of <see cref="Sitrep.Contract.VesselType"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType VesselType { get; set; }

    /// <summary>Flight situation, as the numeric value of <see cref="Sitrep.Contract.Situation"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation Situation { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of this vessel's main body; null when absent or unresolved.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>
    /// Kerbals aboard right now, read from the loaded vessel when it is
    /// loaded and from its saved state otherwise, so an unloaded background
    /// vessel still reports a real count. 0 is an uncrewed vessel; null means
    /// only that the read failed.
    /// <internal>
    /// KspHost.BuildVesselRosterEntry reads Vessel crew or ProtoVessel, and
    /// omits the raw key rather than fabricate a zero.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? CrewCount { get; set; }

    /// <summary>Seat capacity, read the same way as <see cref="CrewCount"/>. Null only if the read failed.</summary>
    [SitrepUnit(Units.Count)]
    public int? CrewCapacity { get; set; }

    /// <summary>
    /// Whether stock CommNet reports a live control link home for this
    /// vessel right now (<c>Vessel.connection.IsConnected</c>), read for every
    /// roster vessel, loaded or not. This is stock's reading, not the active
    /// vessel's <c>comms.*</c> channels, which a comms mod may provide.
    ///
    /// <para>Null when CommNet has no connection to read for this vessel, which
    /// means unknown, not "no link". Two causes: rarely, a scene transition;
    /// and always, for the <c>Debris</c>, <c>SpaceObject</c> (asteroids and
    /// comets) and <c>Unknown</c> vessel types, which CommNet never gives a
    /// connection (<c>CommNet.CommNetVessel.OnStart</c>). A debris or asteroid
    /// entry carries null here on every sample.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CommsConnected { get; set; }

    /// <summary>
    /// The same connection's control level. Null under the same condition as
    /// <see cref="CommsConnected"/>, including the permanent Debris,
    /// SpaceObject and Unknown vessel-type case described there.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public RosterCommsControlSource? CommsControlSource { get; set; }

    /// <summary>
    /// This vessel's own orbital elements, the same shape as
    /// <see cref="BodyEntry.Orbit"/>, about the body at
    /// <see cref="BodyIndex"/>. This is what positions a roster vessel: there
    /// is no separate position field, so derive its position from this orbit,
    /// joined by <see cref="VesselId"/>. Null when the vessel has no orbit yet
    /// (during a scene transition), never a sentinel.
    /// <internal>
    /// Filled by the same SystemViewProvider.BuildOrbit routine as BodyEntry.Orbit.
    /// </internal>
    /// </summary>
    public OrbitEntry? Orbit { get; set; }
}
