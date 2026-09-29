#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The exclusive <c>"simulation"</c> capability's active instance: whether the
/// flight currently on screen is a REHEARSAL rather than a mission.
///
/// <para>Stock KSP has no such concept, so the Uplink for the mod that adds one
/// implements this. RP-1 is one: its simulation launches are reverted at the
/// end and cost the career nothing.</para>
///
/// <para>Without it, every <c>flight.*</c> and <c>vessel.*</c> channel reports
/// a rehearsal exactly as it reports a mission: altitude, stage, crew, fuel and
/// the countdown are all real readings of a flight that is not happening.</para>
/// </summary>
/// <category>Uplink API</category>
public interface ISimulationBackend : ISitrepProvider
{
    /// <summary>
    /// Whether the flight on screen is a simulation, or <c>null</c> when this
    /// install has no such concept.
    ///
    /// <para>Null is not false. False says "this game distinguishes rehearsals
    /// from missions, and this is a mission". Null says "this game has no such
    /// distinction", which is what stock is.</para>
    /// </summary>
    bool? IsSimulatedFlight();
}

/// <summary>
/// The <c>flight.simulation</c> channel payload: is this a rehearsal, and is
/// signal delay being applied to it.
///
/// <para>Delivered without signal delay: this describes the stream rather than
/// a reading from a craft, as <c>comms.delay</c> does.</para>
///
/// <para>Absence is data: an install with no concept of a simulation (stock)
/// publishes nothing here, and a client reads the silence as "this game does
/// not distinguish". It never publishes <c>simulated: false</c> in its
/// place.</para>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.simulation")]
public class FlightSimulation
{
    /// <summary>
    /// Whether the flight on screen is a simulation. When the install has no
    /// such concept the whole payload is absent, so on a published payload this
    /// is true or false.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Simulated { get; set; }

    /// <summary>
    /// Whether signal delay is currently being applied to this flight.
    ///
    /// <para>By default a simulation cuts the delay, since a rehearsal has no
    /// real spacecraft to be distant from. <see cref="DelayInSimulation"/> turns
    /// it back on. This field is the outcome, the same one the mod enforces, so
    /// a client can say why the board is live without re-deriving it.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool DelayApplied { get; set; }

    /// <summary>
    /// The operator's standing choice: apply signal delay during a simulation
    /// anyway. Off by default. Set with <c>comms.setSimulationDelayPolicy</c>.
    ///
    /// <para>This is the value the mod is enforcing, so a settings control
    /// should read it here rather than remember what it last sent.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool DelayInSimulation { get; set; }

    /// <summary>The payload's provenance (<c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// Arguments to <c>comms.setSimulationDelayPolicy</c>: apply signal delay
/// during a simulation, or cut it.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("comms.setSimulationDelayPolicy", Delay = DelayRole.TrueNow)]
public class SetSimulationDelayPolicyArgs
{
    /// <summary>True to apply signal delay during a simulation, false to cut it. Reported back as <see cref="FlightSimulation.DelayInSimulation"/>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool ApplyDuringSimulation { get; set; }
}
