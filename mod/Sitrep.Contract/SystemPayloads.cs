using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>system.bodies</c> channel payload — the celestial-body tree,
/// produced by <c>Sitrep.Host.SystemViewProvider.BuildSystemBodies</c>.
/// This type MIRRORS that provider's existing hand-built serialized shape
/// EXACTLY (a wrapper object <c>{ "bodies": [ ... ] }</c>); it is a
/// typing/codegen marker so a widget resolves a real payload type instead of
/// <c>unknown</c>, and does NOT participate in serialization (the provider
/// still emits the live value tree that <c>JsonWriter</c> walks — see
/// <see cref="SitrepTopicAttribute"/>). The whole payload is <c>null</c> (not
/// an empty-bodies object) when no sample has landed yet — the provider's
/// "no data yet" vs. "zero bodies" distinction.
///
/// <para>Deliberately carries NO <c>Meta</c> field: unlike the
/// <c>vessel.*</c> family, this <c>system</c>-domain snapshot has no
/// per-payload provenance — its <see cref="Meta"/> rides the envelope
/// (<c>StreamData.Meta</c>), never the payload body.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("system.bodies")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SystemBodies
{
    public IReadOnlyList<BodyEntry> Bodies { get; set; } = new List<BodyEntry>();
}

/// <summary>
/// One celestial body in the <see cref="SystemBodies"/> tree. Mirrors the
/// exact per-body dict <c>SystemViewProvider.BuildBody</c> emits — same field
/// names, casing and nullability. Kills the Telemachus orbit warts at the
/// source: an explicit parent-index tree (no flat <c>b.*[idx]</c> keys), no
/// numeric sentinels for missing data, and no <c>eccentricAnomaly</c> field
/// (Telemachus's <c>OrbitPatchJSONFormatter</c> mis-assigns that key the
/// body's eccentricity — a confirmed copy-paste bug).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class BodyEntry
{
    /// <summary>Body name (e.g. "Kerbin"); null when the live game hasn't populated it.</summary>
    public string? Name { get; set; }

    /// <summary>This body's position in the list — stable per session. Always present (the provider falls back to the list index when the raw field is missing), never null.</summary>
    public int Index { get; set; }

    /// <summary>Index of the body this one orbits; null ONLY for the root star (no parent), never a sentinel like -1.</summary>
    public int? ParentIndex { get; set; }

    /// <summary>Mean radius, metres; null when the live game doesn't have it yet (never 0/-1 as a stand-in).</summary>
    public double? Radius { get; set; }

    /// <summary>Orbital elements; null ONLY for the root star (orbit is meaningless without a parent) — the "sun has a bogus orbit" wart suppressed at the source.</summary>
    public OrbitEntry? Orbit { get; set; }

    // Deliberately NO "eccentricAnomaly" field — see the class doc.
}

/// <summary>
/// A body's Keplerian orbital elements, as emitted by
/// <c>SystemViewProvider.BuildOrbit</c> (present on every
/// <see cref="BodyEntry"/> except the root star). Each element is
/// independently nullable: KSP's own <c>lan</c>/<c>argPe</c> are NaN for a
/// near-equatorial/near-circular orbit — a routine case — and the provider
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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class OrbitEntry
{
    /// <summary>Semi-major axis, metres.</summary>
    public double? Sma { get; set; }

    /// <summary>Eccentricity.</summary>
    public double? Ecc { get; set; }

    /// <summary>Inclination, degrees.</summary>
    public double? Inc { get; set; }

    /// <summary>Longitude of ascending node, degrees; null for an undefined node (near-equatorial orbit).</summary>
    public double? Lan { get; set; }

    /// <summary>Argument of periapsis, degrees; null for an undefined periapsis (near-circular orbit).</summary>
    public double? ArgPe { get; set; }

    /// <summary>Mean anomaly at epoch, radians.</summary>
    public double? MeanAnomalyAtEpoch { get; set; }

    /// <summary>Epoch UT, seconds.</summary>
    public double? Epoch { get; set; }
}

/// <summary>
/// The <c>system.vessels</c> channel payload — the full known-vessel roster
/// (every vessel, not just the active one, for TargetPicker-style "what could
/// I target" listings), produced by
/// <c>SystemViewProvider.BuildSystemVessels</c>. Mirrors that provider's
/// existing serialized shape EXACTLY (a wrapper object
/// <c>{ "vessels": [ ... ] }</c>). The whole payload is <c>null</c> when
/// nothing is loaded (main menu) — distinct from an empty roster
/// (<c>{ "vessels": [] }</c>) when the game genuinely reports zero vessels.
/// Same <c>system</c>-domain convention as <see cref="SystemBodies"/>: no
/// per-payload <c>Meta</c> (it rides the envelope).
/// </summary>
[SitrepContract]
[SitrepTopic("system.vessels")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SystemVessels
{
    public IReadOnlyList<VesselRosterEntry> Vessels { get; set; } = new List<VesselRosterEntry>();
}

/// <summary>
/// One vessel in the <see cref="SystemVessels"/> roster. Mirrors the exact
/// per-vessel dict the provider emits. A roster entry with no resolvable
/// stable id is dropped by the provider, never emitted with a fabricated one,
/// so <see cref="VesselId"/> is always present.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselRosterEntry
{
    /// <summary>Stable subject id (KSP vessel GUID). Always present — entries without one are dropped.</summary>
    public string VesselId { get; set; } = "";

    /// <summary>Display name; defaults to the empty string, never null.</summary>
    public string Name { get; set; } = "";

    /// <summary>Vessel type. On the wire this is the enum ORDINAL (the provider emits <c>(int)</c> of the parsed type); typed here to the shared <see cref="Sitrep.Contract.VesselType"/> enum, whose numeric members match those ordinals.</summary>
    public VesselType VesselType { get; set; }

    /// <summary>Flight situation. On the wire this is the enum ORDINAL; typed here to the shared <see cref="Sitrep.Contract.Situation"/> enum.</summary>
    public Situation Situation { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of this vessel's main body; null when absent or unresolved.</summary>
    public int? BodyIndex { get; set; }
}
