#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The flight-lifecycle domain — retires the last Telemachus-era artifact in
/// this codebase: the client-side <c>FlightDetector</c> heuristic that
/// reconstructed flight boundaries from <c>vesselName</c> + <c>missionTime</c>
/// + a revert-threshold guess (see
/// <c>docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md</c>). The
/// producer (<c>Gonogo.KSP.FlightUplink</c> + <c>Sitrep.Host.Flight.FlightLifecycleSampler</c>)
/// hooks KSP's flight GameEvents internally and translates them into this
/// clean contract — no KSP names ever cross the wire.
///
/// <para><b>Crash/recovery stayed separate</b> (the smaller-blast-radius
/// pick, per the spec's build-time TBD): <c>crash.lastCrash</c>/
/// <c>recovery.lastSummary</c> keep their own rich detail payloads
/// unmodified; <see cref="FlightEnded"/> only carries the coarse
/// <see cref="FlightEndReason"/>. <c>FlightUplink</c> hooks the SAME
/// <c>onCrash</c>/<c>onCrashSplashdown</c>/<c>onVesselWillDestroy</c>/
/// <c>onVesselRecoveryProcessingComplete</c> GameEvents <c>CrashUplink</c>/
/// <c>RecoveryUplink</c> already hook, independently — zero coupling, zero
/// risk to the existing detail streams.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsEnum]
#endif
public enum FlightEndReason
{
    Recovered,
    Crashed,
    Reverted,
    Destroyed,
}

/// <summary>
/// The <c>flight.current</c> channel payload — a UT-indexed <b>Value</b>
/// (LossyLatest + <see cref="DelayRole.Delayed"/>, mirroring every
/// <c>vessel.*</c> channel): the authoritative "what flight is this, and what
/// phase is it in" reading for whichever vessel is presently
/// <c>FlightGlobals.ActiveVessel</c>. <see cref="Phase"/> reuses
/// <see cref="Situation"/> rather than inventing a parallel enum — see
/// <see cref="FlightLifecycleSampler"/> doc reference in
/// <c>Sitrep.Host.Flight</c> for the exact phase source.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("flight.current")]
public class FlightCurrent
{
    /// <summary>The mod-minted stable flight id — KSP's <c>Vessel.id</c> GUID as a string, the same currency <c>VesselIdentity.VesselId</c>/<c>CrashReport.VesselId</c> already use.</summary>
    public string FlightId { get; set; } = "";

    public string VesselId { get; set; } = "";

    public string VesselName { get; set; } = "";

    /// <summary>The vessel's current flight phase — reuses <see cref="Situation"/> (PreLaunch/Flying/Landed/…), not a parallel enum.</summary>
    public Situation Phase { get; set; }
}

/// <summary>
/// The <c>flight.started</c> channel payload — a <see cref="Delivery.ReliableOrdered"/>
/// + <see cref="DelayRole.Delayed"/> event, fired the moment a genuinely NEW
/// flight begins (first-ever observation of a vessel id, or a switch onto a
/// vessel this session has never tracked before — see
/// <c>FlightLifecycleSampler</c>'s doc comment for the exact started-vs-
/// vesselChanged distinction).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("flight.started")]
public class FlightStarted
{
    public string FlightId { get; set; } = "";

    public string VesselId { get; set; } = "";

    public string VesselName { get; set; } = "";

    /// <summary>Universal time this flight began — the UUT the sampler first observed the vessel active (or the revert-target UT, for a flight started as a revert's counterpart).</summary>
    public double Ut { get; set; }
}

/// <summary>
/// The <c>flight.ended</c> channel payload — a <see cref="Delivery.ReliableOrdered"/>
/// + <see cref="DelayRole.Delayed"/> event, fired once per flight when it
/// stops being trackable (recovered, crashed/destroyed, or reverted). Rides
/// the SAME delay class as <c>crash.lastCrash</c>/<c>recovery.lastSummary</c>,
/// so it inherits the already-proven revert-before-reveal erasure invariant
/// (<c>RevertBeforeRevealErasesAReliableOrderedDelayedEventForever</c>,
/// commit <c>82132a08</c>) for free — no new reveal-gate work needed.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("flight.ended")]
public class FlightEnded
{
    public string FlightId { get; set; } = "";

    public string VesselId { get; set; } = "";

    public string VesselName { get; set; } = "";

    public FlightEndReason Reason { get; set; }

    /// <summary>Universal time the flight ended. For <see cref="FlightEndReason.Reverted"/> this is the revert-TARGET UT (see <c>FlightLifecycleSampler</c>'s revert-epoch-consistency doc), not the wall-clock moment the player hit revert.</summary>
    public double Ut { get; set; }
}

/// <summary>
/// The <c>flight.vesselChanged</c> channel payload — a
/// <see cref="Delivery.ReliableOrdered"/> + <see cref="DelayRole.Delayed"/>
/// event, fired whenever the operator's active-vessel focus moves to a
/// DIFFERENT, already-known vessel (docking/undocking/EVA/tracking-station
/// reselect) — decoupled from <see cref="FlightStarted"/>/<see cref="FlightEnded"/>:
/// switching focus away from a still-flying vessel does not end its flight.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("flight.vesselChanged")]
public class FlightVesselChanged
{
    public string FlightId { get; set; } = "";

    public string VesselId { get; set; } = "";

    public string VesselName { get; set; } = "";

    /// <summary>The vessel id the operator's focus moved FROM — null on the very first observation (nothing to switch away from).</summary>
    public string? PreviousVesselId { get; set; }

    public double Ut { get; set; }
}
