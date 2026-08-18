using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The payload for the <c>crash.lastCrash</c> channel: a single "last
/// notable crash" record for the current save, delivered on the
/// <see cref="Delivery.ReliableOrdered"/> event lane. Mirrors the wire shape
/// the consumers already parse (<c>FlightOutcomeBanner.parseCrash</c>,
/// <c>LaunchDirector</c>) field-for-field; the frozen captures in
/// <c>packages/app/src/__tests__/fixtures/crash-payloads.ts</c> are the wire
/// ground truth this type names.
///
/// <para>TYPING/codegen marker only. The producer (<c>Gonogo.KSP.CrashUplink</c>)
/// hand-flattens the live-KSP crash into a <c>Dictionary&lt;string, object?&gt;</c>
/// via <c>Sitrep.Host.Crash.CrashPayload.Build</c> before publishing, so
/// <see cref="Sitrep.Core.Serialization.JsonWriter"/> only ever sees the
/// dictionary: this POCO exists solely so the TS SDK has a concrete payload
/// type to name (it is on <c>WirePayloadCoverageTests</c>'s producer-flatten
/// allowlist for exactly that reason).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
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

    [SitrepUnit(Units.Degrees)]
    public double Latitude { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double Longitude { get; set; }

    /// <summary>Parts lost in the destroying event.</summary>
    public List<CrashPartLost> PartsLost { get; set; } = new();

    /// <summary>Name of the body the crash happened on (<c>mainBody.bodyName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Body { get; set; } = "";

    /// <summary>Per-flight statistics accumulated up to the crash.</summary>
    public CrashFlightStats FlightStats { get; set; } = new();

    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>Timestamped flight-event log (liftoff, staging, the crash line).</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Events { get; set; } = new();

    /// <summary>Names of the kerbals lost in this crash.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> KerbalsKilled { get; set; } = new();

    /// <summary>The vessel's flight situation at the crash (<c>Vessel.Situations</c> name, e.g. <c>"FLYING"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Situation { get; set; } = "";

    /// <summary>Names of the crew aboard at the crash.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> CrewAboard { get; set; } = new();

    [SitrepUnit(Units.Metres)]
    public double Altitude { get; set; }

    /// <summary>Universal time of the crash capture.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// One part lost in a crash: an entry of <see cref="CrashReport.PartsLost"/>.
/// See <c>crash-payloads.ts</c> for the wire shape.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
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
/// <see cref="CrashReport.FlightStats"/>. See <c>crash-payloads.ts</c> for
/// the wire shape.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
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

    /// <summary>How the flight ended (e.g. <c>"CATASTROPHIC_FAILURE"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string FlightEndMode { get; set; } = "";

    [SitrepUnit(Units.MetresPerSecond)]
    public double HighestSpeedOverLand { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool MissionEnd { get; set; }

    [SitrepUnit(Units.GForce)]
    public double HighestGee { get; set; }

    [SitrepUnit(Units.Metres)]
    public double HighestAltitude { get; set; }

    [SitrepUnit(Units.Metres)]
    public double TotalDistance { get; set; }

    /// <summary>Mission time (seconds since launch) at the crash.</summary>
    [SitrepUnit(Units.Seconds)]
    public double MissionTime { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double HighestSpeed { get; set; }

    [SitrepUnit(Units.Metres)]
    public double GroundDistance { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool LiftOff { get; set; }
}
