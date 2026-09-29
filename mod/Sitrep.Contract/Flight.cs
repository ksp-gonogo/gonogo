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
    /// rewind discarded.
    /// </summary>
    Reverted,

    /// <summary>The vessel was destroyed without a collision, for example burning up on re-entry.</summary>
    Destroyed,
}

/// <summary>
/// The <c>flight.current</c> channel payload: a UT-indexed value, delivered
/// latest-wins and delayed like every <c>vessel.*</c> channel. It says which
/// flight is active and what phase it is in, for the vessel gonogo is
/// reporting as active. That is the vessel the game is flying, with one
/// exception: a kerbal on EVA does not become the subject of this reading,
/// the craft they stepped out of stays it for as long as that craft is in the
/// world.
/// <para>Nothing is published while there is no active vessel; the last
/// value is held.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.current")]
public class FlightCurrent
{
    /// <summary>
    /// The stable flight id: KSP's <c>Vessel.id</c> GUID as a string, the same
    /// value as <see cref="VesselId"/> and as <c>VesselIdentity.VesselId</c>
    /// and <c>CrashReport.VesselId</c>, so it joins against those directly.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the active vessel, as a string. Always equal to <see cref="FlightId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The active vessel's display name.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>The vessel's current flight phase, as its <see cref="Situation"/> (PreLaunch, Flying, Landed and so on).</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation Phase { get; set; }
}

/// <summary>
/// The <c>flight.started</c> channel payload: a reliable, ordered, delayed
/// event sent when a new flight begins. A flight is new when its vessel id
/// has not been started before in this game session (a launch, or a first
/// switch onto a vessel), and every vessel active just after a revert or a
/// quickload starts a new flight, even one with the same id.
/// <para>A client that subscribes while a flight is already open receives
/// that flight's <c>flight.started</c>, carrying its original start
/// <see cref="Ut"/>. A repeat with an unchanged <see cref="Ut"/> is the same
/// flight announced again; a new <see cref="Ut"/> for the same vessel id is a
/// new flight after a rewind.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.started")]
public class FlightStarted
{
    /// <summary>The stable flight id: KSP's <c>Vessel.id</c> GUID as a string. Always equal to <see cref="VesselId"/>.</summary>
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
}

/// <summary>
/// The <c>flight.ended</c> channel payload: a reliable, ordered, delayed
/// event sent once per flight when it stops being trackable: recovered,
/// crashed, destroyed or reverted. It shares the delay class of
/// <c>crash.lastCrash</c> and <c>recovery.lastSummary</c>, so an end that a
/// rewind discards before its light-time has elapsed is never revealed.
/// <para>Debris, flags and vessels of unknown type never end a flight.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.ended")]
public class FlightEnded
{
    /// <summary>The id of the flight that ended: KSP's <c>Vessel.id</c> GUID as a string. Always equal to <see cref="VesselId"/>.</summary>
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
}

/// <summary>
/// The <c>flight.vesselChanged</c> channel payload: a reliable, ordered,
/// delayed event sent whenever the active vessel changes after the first
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
    /// <summary>The flight now active: KSP's <c>Vessel.id</c> GUID as a string. Always equal to <see cref="VesselId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string FlightId { get; set; } = "";

    /// <summary>KSP's <c>Vessel.id</c> GUID of the vessel focus moved TO, as a string.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>The display name of the vessel focus moved to.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>The vessel id focus moved FROM, or null when there was no previous vessel.</summary>
    [SitrepUnit(Units.Id)]
    public string? PreviousVesselId { get; set; }

    /// <summary>Universal time of the switch.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}
