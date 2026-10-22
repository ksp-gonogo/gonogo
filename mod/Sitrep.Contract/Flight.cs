#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Why a flight ended, carried on <see cref="FlightEnded"/>. The detail of a
/// crash or a recovery is on the <c>crash.lastCrash</c> and
/// <c>recovery.lastSummary</c> channels; this is only the coarse reason.
/// <internal>
/// Gonogo.KSP.FlightUplink hooks the same onCrash / onCrashSplashdown /
/// onVesselWillDestroy / onVesselRecoveryProcessingComplete GameEvents that
/// CrashUplink and RecoveryUplink hook, independently, so the detail streams
/// are unaffected. Revert is detected by Sitrep.Host.Flight.FlightLifecycleSampler
/// from UT jumping backward, not from a GameEvent.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsEnum]
#endif
public enum FlightEndReason
{
    /// <summary>The vessel was recovered.</summary>
    Recovered,

    /// <summary>The vessel was lost to a collision or a hard splashdown.</summary>
    Crashed,

    /// <summary>
    /// The game rewound (a revert or a quickload) to before the flight's end,
    /// or the flight was still open when the rewind happened. Also sent for a
    /// flight that had already ended by crash or recovery on the timeline the
    /// rewind discarded, in case its first end never reached the client.
    /// </summary>
    Reverted,

    /// <summary>The vessel was destroyed without a collision, for example burning up on re-entry.</summary>
    Destroyed,

    /// <summary>The player ended the vessel from the Tracking Station. It was neither lost nor recovered.</summary>
    Terminated,

    /// <summary>
    /// The vessel docked with, or was grabbed by, another craft, and the game kept the
    /// other craft as the one vessel. The craft it joined is named on
    /// <see cref="FlightEnded.JoinedVesselId"/> and <see cref="FlightEnded.JoinedVesselName"/>.
    /// </summary>
    Docked,
}

/// <summary>
/// Which flight is active and what phase it is in, for the vessel gonogo is
/// reporting as active. Only the newest value matters, and it is delayed by the
/// link's signal delay like every <c>vessel.*</c> Topic. That is the vessel the game is flying, with one
/// exception: a kerbal on EVA does not become the subject of this reading,
/// the craft they stepped out of stays it for as long as that craft is in the
/// world.
/// <para>Nothing is published while there is no active vessel; the last
/// value is held.</para>
/// </summary>
/// <category>Flights</category>
/// <categoryDescription>
/// A flight from launch to its end: which flight is active, the notices that one
/// started, ended or changed vessel, the recovery and crash reports that close one,
/// and whether a revert is still possible.
/// </categoryDescription>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.current")]
public class FlightCurrent
{
    /// <summary>
    /// The id of the flight the active vessel is flying, an opaque string the mod
    /// makes up when the flight starts. A revert to launch starts a new flight for
    /// the same vessel, so this changes while <see cref="VesselId"/> does not.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the active vessel, as a string. Joins against <c>VesselIdentity.VesselId</c> and <c>CrashReport.VesselId</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The active vessel's display name.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>The vessel's current flight phase, as its <see cref="Situation"/> (PreLaunch, Flying, Landed and so on).</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation Phase { get; set; }

    /// <summary>True while a kerbal is on EVA from this vessel. The rest of this reading, and every other <c>vessel.*</c> Topic, goes on describing the vessel the kerbal left.</summary>
    [SitrepUnit(Units.Flag)]
    public bool OnEva { get; set; }

    /// <summary>The name of the kerbal on EVA from this vessel, or null when nobody is.</summary>
    [SitrepUnit(Units.Text)]
    public string? EvaKerbalName { get; set; }
}

/// <summary>
/// An event that is always delivered,
/// in the order it happened, and held back by the signal delay like any value
/// about a craft, sent when a new flight begins. A flight is new when its vessel id
/// has not been started before in this game session (a launch, or a first
/// switch onto a vessel), and every vessel active just after a revert or a
/// quickload starts a new flight with an id of its own, even one with the same
/// vessel id.
/// <para>A client that subscribes while a flight is already open receives
/// that flight's <c>flight.started</c>, carrying its original start
/// <see cref="Ut"/>. A repeat with an unchanged <see cref="FlightId"/> is the
/// same flight announced again; a new <see cref="FlightId"/> for the same vessel
/// id is a new flight after a rewind.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.started")]
public class FlightStarted
{
    /// <summary>The id of the flight that began, an opaque string the mod makes up. A flight begun by a revert has an id of its own, never the reverted flight's.</summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the vessel flying this flight, as a string.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The vessel's display name when the flight was announced.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>Universal time this flight began: when the vessel was first observed active, or the revert-target UT for a flight started by a rewind.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>
    /// True when this is a flight that ended <see cref="FlightEndReason.Docked"/> and is now
    /// flying again, because the craft that came off an undock or a Claw release is the one
    /// that docked: <see cref="FlightId"/> and <see cref="Ut"/> are the original flight's, and
    /// <see cref="VesselId"/> is the new vessel's. Its earlier Docked end no longer stands.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool ResumesAfterDock { get; set; }
}

/// <summary>
/// An event that is always delivered,
/// in the order it happened, and held back by the signal delay like any value
/// about a craft, sent once per flight when it stops being trackable: recovered,
/// crashed, destroyed or reverted. It shares the delay class of
/// <c>crash.lastCrash</c> and <c>recovery.lastSummary</c>, so an end that a
/// rewind discards before its signal delay has elapsed is never revealed.
/// <para>A crash or a destruction is the lost craft's own report: it reaches
/// each command centre at the signal delay of that craft's link as of its last
/// contact, whichever craft is being flown, and a centre that had no route to
/// it is sent nothing. A centre that saw the craft go has the end in its
/// <c>trackingStation.catalog</c>.</para>
/// <para>Debris, flags and vessels of unknown type never end a flight. Leaving
/// the flight scene or switching to another vessel does not end one either: the
/// flight stays open, and <c>flight.current</c> names it again when its vessel
/// is flown again.</para>
/// <para>A revert sends one end for every flight still open, and an end for the
/// last flight that ended by a crash or a recovery after the revert target. A
/// client that already holds an end for a flight keeps it.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.ended")]
public class FlightEnded
{
    /// <summary>The id of the flight that ended, as <see cref="FlightStarted.FlightId"/> carried it.</summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the vessel whose flight ended, as a string.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The vessel's display name at the end of the flight.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>Why the flight ended. When a crash and a destruction are both detected for one loss, the first detected wins.</summary>
    [SitrepUnit(Units.Enumeration)]
    public FlightEndReason Reason { get; set; }

    /// <summary>Universal time the flight ended. For <see cref="FlightEndReason.Reverted"/> this is the revert-target UT, not the moment the player chose to revert.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>KSP's <c>Vessel.id</c> GUID of the craft the vessel joined, as a string. Null unless <see cref="Reason"/> is <see cref="FlightEndReason.Docked"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? JoinedVesselId { get; set; }

    /// <summary>The display name of the craft the vessel joined. Null unless <see cref="Reason"/> is <see cref="FlightEndReason.Docked"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? JoinedVesselName { get; set; }
}

/// <summary>
/// An event that is always delivered,
/// in the order it happened, and held back by the signal delay like any value
/// about a craft, sent whenever the active vessel changes after the first
/// observation of the session (docking, undocking, a tracking-station
/// reselect). Switching away from a vessel that is still flying does not end
/// its flight, and switching back to a known one does not start a new one.
/// Switching onto a vessel for the first time also sends
/// <see cref="FlightStarted"/>. Going on EVA does not change the active vessel
/// (see <see cref="FlightCurrent"/>).
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.vesselChanged")]
public class FlightVesselChanged
{
    /// <summary>The id of the flight now active, as <see cref="FlightStarted.FlightId"/> carried it.</summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the vessel focus moved to, as a string.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The display name of the vessel focus moved to.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>The vessel id focus moved from, or null when there was no previous vessel.</summary>
    [SitrepUnit(Units.Id)]
    public string? PreviousVesselId { get; set; }

    /// <summary>Universal time of the switch.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}
