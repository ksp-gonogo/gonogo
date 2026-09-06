#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink;

// ====================================================================
// The antenna-TARGETING half of this Uplink's contract: one observation
// channel and the args of the two commands that write to it.
//
// Targeting is per-ANTENNA in RealAntennas. There is no vessel-level target,
// no primary antenna and no arbitration: the state is one field on one
// antenna, and the link solver considers every compatible pair of antennas
// across every pair of nodes, so two dishes on one craft aimed two ways give
// two candidate links. That is why the channel is an array keyed by antenna
// and both commands address a single antenna, rather than a craft.
//
// R7 discipline as elsewhere in this slice: absence is a nullable (T?), never
// a NaN/0/-1 sentinel.
// ====================================================================

/// <summary>
/// One antenna of the reported craft, on the <c>realantennas.antennas</c>
/// channel: what it is, what it can do, and where it is currently pointed.
/// The channel value is a bare ARRAY of these, one entry per antenna, in the
/// order RealAntennas holds them.
///
/// <para>DELAYED, unlike the rest of this Uplink's channels. The others
/// describe the LINK as KSC computes it ground-side and are true now; where a
/// dish is pointed is a property of the craft, and the commands that change it
/// ride the Courier's light-time delay. A true-now readout beside a delayed
/// command would show the new aim point while the command was still in flight.
/// </para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("realantennas.antennas", isArray: true)]
public class RealAntennasAntennaState
{
    /// <summary>
    /// The address both targeting commands take, stable across a reordering of
    /// the craft's antenna list: the flight id of the part the antenna belongs
    /// to, plus an ordinal when one part carries several antennas
    /// (<c>"1234567890/0"</c>). Falls back to <c>"index/&lt;n&gt;"</c> for an
    /// antenna whose part cannot be read, which is the unloaded case.
    ///
    /// <para>An index alone would not do. Both commands are
    /// <c>Delayed</c>, so a command dispatched against "the second antenna"
    /// arrives minutes later against whatever is second BY THEN, and a
    /// decoupled part between the two moments aims a different dish.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string AntennaId { get; set; } = "";

    /// <summary>Position in RealAntennas' own antenna list for this craft: display order, not an address.</summary>
    [SitrepUnit(Units.Count)]
    public int Index { get; set; }

    /// <summary>The antenna's name, which is the part title.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>
    /// Whether this antenna can hold a target at all. RealAntennas derives it
    /// from gain alone (a dish is an antenna with more than 5 dBi; there is no
    /// stored "steerable" flag), and an antenna that is not steerable refuses
    /// both commands.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Steerable { get; set; }

    /// <summary>
    /// Whether this antenna currently holds a target. The fields below describe
    /// it when true and are all null when false.
    ///
    /// <para>False on a steerable antenna means it has not been aimed yet, which
    /// is the state a dish leaves the editor in. There is no command that returns
    /// one to it: both targeting commands move an antenna between targets, and
    /// RealAntennas itself never puts a vessel dish back.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Targeted { get; set; }

    /// <summary>Antenna gain (dBi), the quantity beamwidth and steerability both come off.</summary>
    [SitrepUnit(Units.Decibels)]
    public double? Gain { get; set; }

    /// <summary>Antenna tech level (0..9): the level the mode gate compares against.</summary>
    [SitrepUnit(Units.Count)]
    public int? TechLevel { get; set; }

    /// <summary>
    /// Beamwidth (degrees), from gain. RealAntennas draws the 3 dB cone at half
    /// this and the 10 dB cone at all of it, so this is the wider of the two.
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    public double? Beamwidth { get; set; }

    /// <summary>The 3 dB cone half-angle (degrees): half the beamwidth.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Cone3Db { get; set; }

    /// <summary>The 10 dB cone half-angle (degrees): the beamwidth itself.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Cone10Db { get; set; }

    /// <summary>
    /// The near-field limit a tight beam imposes (metres): RealAntennas reports
    /// zero for an antenna holding no target, and for a beam 90° or wider.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? MinimumDistance { get; set; }

    /// <summary>
    /// The STORED kind of the current target: <c>Vessel</c>,
    /// <c>BodyLatLonAlt</c>, <c>AzEl</c> or <c>OrbitRelative</c>. Null when the
    /// antenna holds no target.
    ///
    /// <para><c>BodyCenter</c> never appears here, and the omission is
    /// deliberate. RealAntennas has five mode NAMES and four target classes:
    /// "body centre" is a way of filling in a <c>BodyLatLonAlt</c>
    /// (lat 0, lon 0, altitude minus the body's radius) and nothing records
    /// that it was chosen that way. Reporting the stored kind is a read;
    /// reporting <c>BodyCenter</c> would be a guess about how the numbers were
    /// arrived at.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? TargetKind { get; set; }

    /// <summary>
    /// The target as RealAntennas itself renders it, which is the same string
    /// its in-game "Antenna Target" field shows. Null when the antenna holds no
    /// target.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? TargetLabel { get; set; }

    /// <summary>
    /// The target vessel's id, for a <c>Vessel</c> target. For <c>AzEl</c> and
    /// <c>OrbitRelative</c> this is the craft the angles are measured FROM,
    /// which is the antenna's own, not something being aimed at.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? TargetVesselId { get; set; }

    /// <summary>The body a <c>BodyLatLonAlt</c> target is on.</summary>
    [SitrepUnit(Units.Text)]
    public string? TargetBodyName { get; set; }

    /// <summary>Latitude of a <c>BodyLatLonAlt</c> target (degrees).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetLatitude { get; set; }

    /// <summary>Longitude of a <c>BodyLatLonAlt</c> target (degrees).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetLongitude { get; set; }

    /// <summary>
    /// Altitude of a <c>BodyLatLonAlt</c> target (metres above the surface). A
    /// value of minus the body's radius is the body's centre, which is what
    /// RealAntennas writes for its own "Body Center" affordance and for the
    /// default target it gives an untargeted dish.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? TargetAltitude { get; set; }

    /// <summary>Azimuth of an <c>AzEl</c> target (degrees, 0..360).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetAzimuth { get; set; }

    /// <summary>Elevation of an <c>AzEl</c> or <c>OrbitRelative</c> target (degrees, -90..90).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetElevation { get; set; }

    /// <summary>Deflection from prograde of an <c>OrbitRelative</c> target (degrees, -180..180).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetForward { get; set; }

    /// <summary>
    /// The mode names <c>realantennas.antenna.target</c> will accept for THIS
    /// antenna: every mode the install declares whose tech level this antenna
    /// has reached.
    ///
    /// <para>It is per-antenna because the gate is per-antenna, and it is on the
    /// wire because the gate is DATA. The five levels are config, not code, and
    /// Realism Overhaul moves three of them, so a client that hard-coded the
    /// stock numbers would offer modes this install refuses and hide modes it
    /// allows.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string[] AvailableTargetModes { get; set; } = new string[0];

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// Args for <c>realantennas.antenna.target</c>: point one antenna at one thing.
///
/// <para>Which of the optional fields are read depends on <see cref="Mode"/>,
/// and a field the mode does not read is ignored rather than refused.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("realantennas.antenna.target")]
public class RealAntennasTargetArgs
{
    /// <summary>Which antenna, as <see cref="RealAntennasAntennaState.AntennaId"/> gives it.</summary>
    [SitrepUnit(Units.Id)]
    public string AntennaId { get; set; } = "";

    /// <summary>
    /// One of <c>Vessel</c>, <c>BodyCenter</c>, <c>BodyLatLonAlt</c>,
    /// <c>AzEl</c>, <c>OrbitRelative</c>. Anything else is refused.
    ///
    /// <para><c>BodyCenter</c> is accepted here even though nothing stores it
    /// (see <see cref="RealAntennasAntennaState.TargetKind"/>): it is the mode
    /// the tech-level gate is declared against, and it saves every caller
    /// having to know that the body's centre is written as latitude 0,
    /// longitude 0, altitude minus the radius. It is stored as, and reads back
    /// as, <c>BodyLatLonAlt</c>.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Mode { get; set; } = "";

    /// <summary>
    /// The vessel to point at, for <c>Vessel</c>. Ignored by every other mode:
    /// <c>AzEl</c> and <c>OrbitRelative</c> are measured from the antenna's OWN
    /// craft, which the handler fills in, so a caller cannot aim one craft's
    /// dish by another craft's attitude.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>
    /// The body, for <c>BodyCenter</c> and <c>BodyLatLonAlt</c>. Empty means the
    /// home body.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? BodyName { get; set; }

    /// <summary>Latitude (degrees, -90..90), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Longitude (degrees, -180..360), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Altitude above the surface (metres), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Altitude { get; set; }

    /// <summary>Azimuth (degrees, 0..360), for <c>AzEl</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Azimuth { get; set; }

    /// <summary>Elevation (degrees, -90..90), for <c>AzEl</c> and <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Elevation { get; set; }

    /// <summary>Deflection from prograde (degrees, -180..180), for <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Forward { get; set; }
}

/// <summary>
/// Args for <c>realantennas.antenna.targetHome</c>: one antenna, no options.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("realantennas.antenna.targetHome")]
public class RealAntennasAntennaArgs
{
    /// <summary>Which antenna, as <see cref="RealAntennasAntennaState.AntennaId"/> gives it.</summary>
    [SitrepUnit(Units.Id)]
    public string AntennaId { get; set; } = "";
}
