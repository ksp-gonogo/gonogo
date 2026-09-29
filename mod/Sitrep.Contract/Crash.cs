using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The payload for the <c>crash.lastCrash</c> channel: a single "last
/// notable crash" record for the current save, delivered on the
/// <see cref="Delivery.ReliableOrdered"/> event lane, so a late subscriber
/// receives the most recent record. Every field is captured from the
/// crashed vessel at the moment of the crash.
/// <internal>
/// Typing-only: Gonogo.KSP.CrashUplink flattens the live crash into a
/// dictionary via Sitrep.Host.Crash.CrashPayload.Build, so JsonWriter never
/// sees this POCO (it is on WirePayloadCoverageTests's producer-flatten
/// allowlist). The frozen captures in
/// packages/app/src/__tests__/fixtures/crash-payloads.ts are the wire ground
/// truth; FlightOutcomeBanner.parseCrash and LaunchDirector parse it.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("crash.lastCrash")]
public class CrashReport
{
    /// <summary>The crashed vessel's stable id (<c>Vessel.id</c> as a string GUID).</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>Which detector fired: <c>CrashSplashdown</c> / <c>Destroyed</c> / <c>Crash</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string EventKind { get; set; } = "";

    /// <summary>The colliding object's name (<c>EventReport.other</c>): empty for a non-collision death.</summary>
    [SitrepUnit(Units.Text)]
    public string What { get; set; } = "";

    /// <summary>The crashed vessel's <c>VesselType</c> name (e.g. <c>"Ship"</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string VesselType { get; set; } = "";

    /// <summary>The detector's message (<c>EventReport.msg</c>): often empty.</summary>
    [SitrepUnit(Units.Text)]
    public string Msg { get; set; } = "";

    /// <summary>The vessel's latitude at the crash (<c>Vessel.latitude</c>), in degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Latitude { get; set; }

    /// <summary>The vessel's longitude at the crash (<c>Vessel.longitude</c>), in degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Longitude { get; set; }

    /// <summary>Parts lost in the destroying event.</summary>
    public List<CrashPartLost> PartsLost { get; set; } = new();

    /// <summary>Name of the body the crash happened on (<c>mainBody.bodyName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Body { get; set; } = "";

    /// <summary>Per-flight statistics accumulated up to the crash.</summary>
    public CrashFlightStats FlightStats { get; set; } = new();

    /// <summary>The crashed vessel's name (<c>Vessel.vesselName</c>); empty when KSP had none.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>
    /// The vessel's flight-event log (liftoff, staging, the crash line), oldest
    /// first, each line <c>[HH:MM:SS]: message</c> stamped with mission time.
    /// Holds at most the 200 most recent lines.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public List<string> Events { get; set; } = new();

    /// <summary>Names of the kerbals lost in this crash: everyone aboard at the crash.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> KerbalsKilled { get; set; } = new();

    /// <summary>The vessel's flight situation at the crash (<c>Vessel.Situations</c> name, e.g. <c>"FLYING"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Situation { get; set; } = "";

    /// <summary>Names of the crew aboard at the crash.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> CrewAboard { get; set; } = new();

    /// <summary>The vessel's altitude above sea level at the crash (<c>Vessel.altitude</c>), in metres.</summary>
    [SitrepUnit(Units.Metres)]
    public double Altitude { get; set; }

    /// <summary>Universal time of the crash capture.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// One part lost in a crash: an entry of <see cref="CrashReport.PartsLost"/>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrashPartLost
{
    /// <summary>The part's <c>flightID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public long PartId { get; set; }

    /// <summary>The part's <c>partInfo.name</c> (e.g. <c>"mk1pod.v2"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string PartName { get; set; } = "";

    /// <summary>The part's <c>partInfo.title</c> (e.g. <c>"Mk1 Command Pod"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string PartTitle { get; set; } = "";

    /// <summary>Destruction message for this part: often empty.</summary>
    [SitrepUnit(Units.Text)]
    public string Msg { get; set; } = "";
}

/// <summary>
/// Per-flight statistics accumulated across the whole flight up to the crash,
/// <see cref="CrashReport.FlightStats"/>. Maxima and distances are sampled
/// from the active vessel at the telemetry cadence, so they are approximate.
/// A vessel that was never sampled reports zero for every accumulated
/// value.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrashFlightStats
{
    /// <summary>Kerbals killed earlier in the flight (before the final crash).</summary>
    [SitrepUnit(Units.Count)]
    public int KerbalsKilled { get; set; }

    /// <summary>Cumulative parts destroyed across the flight.</summary>
    [SitrepUnit(Units.Count)]
    public int PartsLost { get; set; }

    /// <summary>How the flight ended. Always <c>"CATASTROPHIC_FAILURE"</c> on a crash record.</summary>
    [SitrepUnit(Units.Text)]
    public string FlightEndMode { get; set; } = "";

    /// <summary>
    /// The highest surface speed (<c>Vessel.srfSpeed</c>) reached while not
    /// splashed down, in m/s. Flight over water counts; only samples taken
    /// while splashed are excluded.
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double HighestSpeedOverLand { get; set; }

    /// <summary>Whether the mission has ended. Always <c>true</c> on a crash record.</summary>
    [SitrepUnit(Units.Flag)]
    public bool MissionEnd { get; set; }

    /// <summary>The highest g-force (<c>Vessel.geeForce</c>) sampled during the flight.</summary>
    [SitrepUnit(Units.GForce)]
    public double HighestGee { get; set; }

    /// <summary>The highest altitude above sea level (<c>Vessel.altitude</c>) sampled during the flight, in metres.</summary>
    [SitrepUnit(Units.Metres)]
    public double HighestAltitude { get; set; }

    /// <summary>
    /// Distance travelled relative to the surface, in metres: surface speed
    /// integrated over UT between samples. A gap of more than 10 s between
    /// samples (a warp jump, a quickload) is skipped rather than integrated.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double TotalDistance { get; set; }

    /// <summary>Mission time (seconds since launch) at the crash: the highest <c>Vessel.missionTime</c> sampled.</summary>
    [SitrepUnit(Units.Seconds)]
    public double MissionTime { get; set; }

    /// <summary>The highest surface speed (<c>Vessel.srfSpeed</c>) sampled during the flight, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double HighestSpeed { get; set; }

    /// <summary>
    /// Horizontal distance travelled over the surface, in metres: horizontal
    /// surface speed integrated over UT between samples, with the same 10 s gap
    /// rule as <see cref="TotalDistance"/>.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double GroundDistance { get; set; }

    /// <summary><c>true</c> once the vessel's mission clock has started, i.e. it has left the launch site.</summary>
    [SitrepUnit(Units.Flag)]
    public bool LiftOff { get; set; }
}
