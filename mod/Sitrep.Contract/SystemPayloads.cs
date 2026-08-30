using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>system.bodies</c> channel payload: the celestial-body tree,
/// produced by <c>Sitrep.Host.SystemViewProvider.BuildSystemBodies</c>.
/// This type MIRRORS that provider's existing hand-built serialized shape
/// EXACTLY (a wrapper object <c>{ "bodies": [ ... ] }</c>); it is a
/// typing/codegen marker so a widget resolves a real payload type instead of
/// <c>unknown</c>, and does NOT participate in serialization (the provider
/// still emits the live value tree that <c>JsonWriter</c> walks; see
/// <see cref="SitrepTopicAttribute"/>). The whole payload is <c>null</c> (not
/// an empty-bodies object) when no sample has landed yet, the provider's
/// "no data yet" vs. "zero bodies" distinction.
///
/// <para>Deliberately carries NO <c>Meta</c> field: unlike the
/// <c>vessel.*</c> family, this <c>system</c>-domain snapshot has no
/// per-payload provenance: its <see cref="Meta"/> rides the envelope
/// (<c>StreamData.Meta</c>), never the payload body.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("system.bodies")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SystemBodies
{
    public IReadOnlyList<BodyEntry> Bodies { get; set; } = new List<BodyEntry>();
}

/// <summary>
/// One celestial body in the <see cref="SystemBodies"/> tree. Mirrors the
/// exact per-body dict <c>SystemViewProvider.BuildBody</c> emits: same field
/// names, casing and nullability. Shaped to make the classic orbit warts
/// unspellable: an explicit parent-index tree rather than flat indexed keys,
/// no numeric sentinels for missing data, and no <c>eccentricAnomaly</c> field
/// at all, because an orbit-patch formatter that carries one tends to fill it
/// with the body's ECCENTRICITY instead.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class BodyEntry
{
    /// <summary>Body name (e.g. "Kerbin"); null when the live game hasn't populated it.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>This body's position in the list: stable per session. Always present (the provider falls back to the list index when the raw field is missing), never null.</summary>
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }

    /// <summary>Index of the body this one orbits; null ONLY for the root star (no parent), never a sentinel like -1.</summary>
    [SitrepUnit(Units.Id)]
    public int? ParentIndex { get; set; }

    /// <summary>Mean radius, metres; null when the live game doesn't have it yet (never 0/-1 as a stand-in).</summary>
    [SitrepUnit(Units.Metres)]
    public double? Radius { get; set; }

    /// <summary>Orbital elements; null ONLY for the root star (orbit is meaningless without a parent), the "sun has a bogus orbit" wart suppressed at the source.</summary>
    public OrbitEntry? Orbit { get; set; }

    /// <summary>
    /// Standard gravitational parameter μ = G·M, m³/s² (KSP
    /// <c>CelestialBody.gravParameter</c>). Null when the live game hasn't
    /// populated it.
    /// </summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    public double? GravParameter { get; set; }

    /// <summary>
    /// Body mass, kilograms (<c>CelestialBody.Mass</c>).
    /// </summary>
    [SitrepUnit(Units.Kilograms)]
    public double? Mass { get; set; }

    /// <summary>
    /// Surface gravity in multiples of g₀ (<c>CelestialBody.GeeASL</c>),
    /// verbatim.
    ///
    /// This is the CONFIG PRIMITIVE, not a derived quantity: KSP computes mass
    /// and gravParameter FROM it (<c>Mass = Radius² · (GeeASL ·
    /// PhysicsGlobals.GravitationalAcceleration) / G</c>), so a client
    /// reconstructing it as μ/r²/g₀ is running the game's own arithmetic
    /// backwards and can only lose precision doing it.
    /// </summary>
    [SitrepUnit(Units.GForce)]
    public double? SurfaceGravity { get; set; }

    /// <summary>
    /// Hill-sphere radius, metres (<c>CelestialBody.hillSphere</c>).
    ///
    /// Null for the root star, where KSP's own value is
    /// <c>double.PositiveInfinity</c> and there is no parent to be bound by.
    ///
    /// On the wire because the textbook expression and KSP's disagree, and we
    /// shipped the textbook one. KSP computes
    /// <c>a·(1−e)·(m/M)^(1/3)</c>; the standard form carries a factor of three
    /// under the root, <c>a·(1−e)·∛(m/3M)</c>. Ours had the three, so every
    /// hill sphere the app has ever drawn was ∛(1/3) ≈ 0.693 of the game's,
    /// about 31% too small, in two widgets that render it as a fact.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? HillSphere { get; set; }

    /// <summary>Sphere-of-influence radius, metres (<c>CelestialBody.sphereOfInfluence</c>); null when absent.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SphereOfInfluence { get; set; }

    /// <summary>Sidereal rotation period, seconds (<c>CelestialBody.rotationPeriod</c>); a NEGATIVE value denotes retrograde rotation. Null when absent. Carries "does this body rotate" on its own (a body rotates iff this is finite and non-zero), so no separate bool is emitted for it.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? RotationPeriod { get; set; }

    /// <summary>Whether the body is tidally locked to its parent (<c>CelestialBody.tidallyLocked</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? TidallyLocked { get; set; }

    /// <summary>Atmosphere descriptor; null when the body has no atmosphere (<c>!CelestialBody.atmosphere</c>), the "airless vs. no-data" distinction the whole payload's null-not-sentinel rule preserves.</summary>
    public AtmosphereEntry? Atmosphere { get; set; }

    /// <summary>Whether the body has a liquid ocean (<c>CelestialBody.ocean</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasOcean { get; set; }

    /// <summary>KSP's per-body flavour text (<c>CelestialBody.bodyDescription</c>); null when absent. May be a raw <c>#autoLOC…</c> localization tag the client suppresses.</summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    /// <summary>Whether KSC and the launch sites sit on this body (<c>CelestialBody.isHomeWorld</c>); true on exactly one body, null when absent. The authoritative home-body marker: a client locates home by this flag, never by index.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsHome { get; set; }

    // Deliberately NO "eccentricAnomaly" field: see the class doc.
    //
    // Mass, SurfaceGravity, HillSphere and Orbit.Period ARE carried, even
    // though a client could derive each from GravParameter + Radius + Orbit and
    // save the wire bytes. That trade costs more than the bytes: four widgets
    // each rebuild the same numbers every frame, and a client-side derivation
    // can disagree with the game's own (see HillSphere). Two of the four were
    // being sampled into the host's dictionary and thrown away before they
    // reached this payload, which is the worst of both.
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
/// actually has one (null otherwise; never an all-null placeholder, matching
/// the payload's null-not-sentinel discipline). Mirrors the exact nested dict
/// <c>SystemViewProvider.BuildAtmosphere</c> emits.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class AtmosphereEntry
{
    /// <summary>Atmosphere height, metres (<c>CelestialBody.atmosphereDepth</c>); null when absent.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Depth { get; set; }

    /// <summary>Whether the atmosphere is breathable / oxygenated (<c>CelestialBody.atmosphereContainsOxygen</c>); null when absent.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasOxygen { get; set; }

    /// <summary>Sea-level pressure, kPa (<c>CelestialBody.atmospherePressureSeaLevel</c>); null when absent.</summary>
    [SitrepUnit(Units.Kilopascals)]
    public double? SeaLevelPressure { get; set; }

    /// <summary>
    /// Altitudes of the <see cref="Pressures"/> samples, metres above sea
    /// level, ascending from 0; null when the stream does not report a
    /// profile. Same length as <see cref="Pressures"/>.
    /// </summary>
    /// <remarks>
    /// <para>Spacing is chosen per body rather than fixed, because the shape
    /// varies enormously: RSS Earth's table runs to 94 km and Saturn's to
    /// 1,270 km, and a grid uniform in altitude spends most of its points on
    /// near-vacuum for the second while undersampling the first. The producer
    /// bisects until every segment's interior sits within 1% of the log-linear
    /// chord through its ends, which is the space a reader sees (the profile
    /// is drawn on a log pressure axis), and stops at 48 points. Measured
    /// against the ten real pressure curves the RSS install ships, the worst
    /// reconstruction error is 1.51%, and 1.12% on every body but Pluto, whose
    /// near-vacuum air runs the point cap out.</para>
    ///
    /// <para>It costs 16 to 48 points per atmospheric body, which on a real RO
    /// install (33 bodies, 11 with air) is 5.2 kB added to a 23.3 kB
    /// <c>system.bodies</c> emit. That channel re-sends itself every second,
    /// so this is a fifth again on the largest thing on the wire, for a table
    /// that is fixed for the session. It is carried here anyway because it is
    /// a physical fact about a body and belongs with the rest of them; if the
    /// channel is ever given a change-gate that can see a payload has not
    /// moved, this is the field that gains most from it.</para>
    ///
    /// <para>The table ends six decades below sea level, not at
    /// <see cref="Depth"/>. Above that the game's own curve is a cubic
    /// plunging into a hard zero at the ceiling, which no interpolation in log
    /// space can follow and which carries no pressure worth stating. A
    /// consumer draws to the last sample and takes <see cref="Depth"/> as
    /// where the air formally ends.</para>
    /// </remarks>
    [SitrepUnit(Units.Metres)]
    public double[]? PressureAltitudes { get; set; }

    /// <summary>
    /// Pressure at each <see cref="PressureAltitudes"/> entry, kPa, as the
    /// game's own <c>CelestialBody.GetPressure</c> answers it; null when the
    /// stream does not report a profile.
    /// </summary>
    /// <remarks>
    /// <para>Sampled rather than modelled because the exponential
    /// <c>P0·exp(-h/H)</c> a client can build from sea-level pressure and a
    /// scale height is not what KSP evaluates, and there is no scale-height
    /// field on <c>CelestialBody</c> to build it from honestly. A body with
    /// <c>atmosphereUsePressureCurve</c> set follows a tabulated curve, which
    /// is what stock's own atmospheres and every RealAtmospheres-style pack
    /// use; against the real RSS Earth curve the exponential is out by a
    /// factor of sixteen at altitude. Sampling the game's answer is correct
    /// for stock, for a planet pack and for a curve nobody has written yet,
    /// without the client modelling anything.</para>
    ///
    /// <para>Rounded to six significant figures. The curve path evaluates in
    /// float32 inside Unity's own <c>AnimationCurve</c>, so more digits would
    /// be inventing precision, and six is far below the 1% spacing
    /// tolerance.</para>
    /// </remarks>
    [SitrepUnit(Units.Kilopascals)]
    public double[]? Pressures { get; set; }
}

/// <summary>
/// A body's Keplerian orbital elements, as emitted by
/// <c>SystemViewProvider.BuildOrbit</c> (present on every
/// <see cref="BodyEntry"/> except the root star). Each element is
/// independently nullable: KSP's own <c>lan</c>/<c>argPe</c> are NaN for a
/// near-equatorial/near-circular orbit (a routine case) and the provider
/// maps that (and any genuinely-absent value) to null via the shared
/// non-finite-is-absent rule, never a NaN token on the wire.
///
/// <para>Units mirror the KSP-native inconsistency deliberately KEPT
/// upstream: <see cref="Sma"/> in metres; <see cref="Inc"/>/<see cref="Lan"/>/
/// <see cref="ArgPe"/> in DEGREES; <see cref="MeanAnomalyAtEpoch"/> in
/// RADIANS; <see cref="Epoch"/> in UT seconds. No <c>eccentricAnomaly</c>
/// field (see <see cref="BodyEntry"/>).</para>
/// </summary>
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

    /// <summary>Longitude of ascending node, degrees; null for an undefined node (near-equatorial orbit).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Lan { get; set; }

    /// <summary>Argument of periapsis, degrees; null for an undefined periapsis (near-circular orbit).</summary>
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
/// The <c>system.vessels</c> channel payload: the full known-vessel roster
/// (every vessel, not just the active one, for TargetPicker-style "what could
/// I target" listings), produced by
/// <c>SystemViewProvider.BuildSystemVessels</c>. Mirrors that provider's
/// existing serialized shape EXACTLY (a wrapper object
/// <c>{ "vessels": [ ... ] }</c>). The whole payload is <c>null</c> when
/// nothing is loaded (main menu), distinct from an empty roster
/// (<c>{ "vessels": [] }</c>) when the game genuinely reports zero vessels.
/// Same <c>system</c>-domain convention as <see cref="SystemBodies"/>: no
/// per-payload <c>Meta</c> (it rides the envelope).
/// </summary>
[SitrepContract]
[SitrepTopic("system.vessels")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SystemVessels
{
    public IReadOnlyList<VesselRosterEntry> Vessels { get; set; } = new List<VesselRosterEntry>();
}

/// <summary>
/// Roster-level control-link tier for <see cref="VesselRosterEntry.CommsControlSource"/>.
/// Deliberately its OWN enum, not a reuse of <see cref="Sitrep.Contract.CommsControlSource"/>,
/// that type belongs to the active-vessel-only <c>comms.*</c> elected-backend
/// family (<see cref="ICommsBackend"/>/<c>CommsElection</c>), which this roster
/// read does not touch (see <see cref="VesselRosterEntry"/>'s own doc comment).
/// The three tiers happen to mirror stock <c>Vessel.ControlLevel</c>'s
/// none/partial/full shape, which is coincidence, not a shared contract.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum RosterCommsControlSource
{
    None,
    Partial,
    Full,
}

/// <summary>
/// One vessel in the <see cref="SystemVessels"/> roster. Mirrors the exact
/// per-vessel dict the provider emits. A roster entry with no resolvable
/// stable id is dropped by the provider, never emitted with a fabricated one,
/// so <see cref="VesselId"/> is always present.
/// </summary>
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

    /// <summary>Vessel type. On the wire this is the enum ORDINAL (the provider emits <c>(int)</c> of the parsed type); typed here to the shared <see cref="Sitrep.Contract.VesselType"/> enum, whose numeric members match those ordinals.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType VesselType { get; set; }

    /// <summary>Flight situation. On the wire this is the enum ORDINAL; typed here to the shared <see cref="Sitrep.Contract.Situation"/> enum.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation Situation { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of this vessel's main body; null when absent or unresolved.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>
    /// Kerbals aboard right now. Read off the LOADED vessel's crew when
    /// loaded, off <c>ProtoVessel</c> otherwise (<c>KspHost.BuildVesselRosterEntry</c>'s
    /// doc comment): so an unloaded background vessel still reports a real
    /// count. Null only if the read itself failed (the producer omits the raw
    /// key rather than fabricate a zero); never used to distinguish "probe"
    /// from "unknown", that is <see cref="CrewCount"/> == 0 vs. null.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? CrewCount { get; set; }

    /// <summary>Seat capacity, same loaded/proto read as <see cref="CrewCount"/>. Null only if the read failed.</summary>
    [SitrepUnit(Units.Count)]
    public int? CrewCapacity { get; set; }

    /// <summary>
    /// Whether stock CommNet reports a live control link home for this
    /// vessel right now: a raw <c>Vessel.connection.IsConnected</c> read
    /// against EVERY roster vessel (loaded or not), NOT the active-vessel-only
    /// elected-backend <c>comms.*</c> family. Null when CommNet has no
    /// connection object to read for this vessel this tick, an honest
    /// "unknown", not a fabricated "no link". Two distinct causes collapse to
    /// the same null: a transient scene-transition race (rare), and a
    /// PERMANENT, by-design absence for <c>Debris</c>/<c>SpaceObject</c>
    /// (asteroids/comets)/<c>Unknown</c> vessel types: verified against
    /// <c>CommNet.CommNetVessel.OnStart</c>, which never assigns
    /// <c>vessel.connection</c> for those three types. A debris or asteroid
    /// roster entry is expected to carry null here on every sample, not
    /// occasionally.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CommsConnected { get; set; }

    /// <summary>
    /// The same read's control-level tier, for the roster's connected/partial/
    /// none link-quality tag. Null under the same "nothing to read" condition
    /// as <see cref="CommsConnected"/>: including the permanent
    /// Debris/SpaceObject/Unknown-vessel-type case documented there.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public RosterCommsControlSource? CommsControlSource { get; set; }

    /// <summary>
    /// This vessel's own orbital elements, the same shape (and the same
    /// <c>SystemViewProvider.BuildOrbit</c> routine) that fills
    /// <see cref="BodyEntry.Orbit"/>. This is what positions a roster vessel
    /// (and a SystemView graph node keyed to it via <see cref="VesselId"/>):
    /// no separate node-position field exists, a client derives position by
    /// joining a node's id to this orbit. Null when the vessel has no
    /// orbitDriver yet (a scene-transition race), never a sentinel.
    /// </summary>
    public OrbitEntry? Orbit { get; set; }
}
