#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The exclusive <c>"simulation"</c> capability's active instance: whether the
/// flight currently on screen is a REHEARSAL rather than a mission.
///
/// <para><b>Why this is a capability and not a field somebody reads.</b>
/// Nothing in stock KSP has the concept. A flight is a flight; there is no
/// rehearsal mode to be in, and no bool anywhere that could answer. RP-1 adds
/// one (its simulation launches, reverted at the end and costing the career
/// nothing), and it will not be the last mod to. So the QUESTION belongs to
/// core, which owns every <c>flight.*</c> and <c>vessel.*</c> channel a
/// simulation would otherwise misreport, and the ANSWER belongs to whichever
/// mod invented the distinction.</para>
///
/// <para><b>Why it matters enough to be on the wire at all.</b> A mission
/// control board that reports a rehearsal exactly as it reports a mission is
/// not missing a feature, it is making a false statement about every number on
/// it. Altitude, stage, crew, fuel and the countdown are all real readings of
/// a flight that is not happening.</para>
/// </summary>
public interface ISimulationBackend : ISitrepProvider
{
    /// <summary>
    /// Whether the flight on screen is a simulation, or <c>null</c> when this
    /// install has no such concept.
    ///
    /// <para><b>Null is not false, and the difference is the whole point.</b>
    /// False says "this game distinguishes rehearsals from missions, and this
    /// is a mission". Null says "this game has no such distinction", which is
    /// what stock is, and a client that collapsed the two would put a
    /// MISSION badge on a stock flight that was never in the running for one.
    /// </para>
    /// </summary>
    bool? IsSimulatedFlight();
}

/// <summary>
/// The <c>flight.simulation</c> channel payload: is this a rehearsal, and is
/// signal delay being applied to it.
///
/// <para><b>TrueNow, and it has to be.</b> This is meta about the stream
/// rather than a reading from a craft, the same disposition
/// <c>comms.delay</c> takes: a channel that told an operator "this is a
/// simulation" only after the light-time had elapsed would be describing the
/// board they were looking at four minutes ago.</para>
///
/// <para><b>Absence is data.</b> A stock install publishes nothing here,
/// because it has nothing to say; see <see cref="Simulated"/>.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("flight.simulation")]
public class FlightSimulation
{
    /// <summary>
    /// Whether the flight on screen is a simulation. Null when the install has
    /// no such concept; see <see cref="ISimulationBackend.IsSimulatedFlight"/>
    /// for why that is different from false.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Simulated { get; set; }

    /// <summary>
    /// Whether signal delay is currently being applied to this flight.
    ///
    /// <para>A rehearsal has no spacecraft, so it has no light-time, and by
    /// default a simulation cuts the delay outright rather than modelling a
    /// distance to a craft that is not there. A controller may still want the
    /// delay on, to rehearse under the conditions the real flight will have,
    /// which is why it is <see cref="DelayInSimulation"/> below rather than a
    /// rule. This field is the OUTCOME of those two, so a client can say why
    /// the board is live without re-deriving it.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool DelayApplied { get; set; }

    /// <summary>
    /// The operator's standing choice: apply signal delay during a simulation
    /// anyway. Off by default, for the reason above.
    ///
    /// <para>Carried here so the settings row that changes it can READ what
    /// the mod is actually doing rather than what a console once asked for.
    /// The mod owns this value: it is what enforces the delay, and a console
    /// preference the enforcer never heard would be a switch wired to
    /// nothing.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool DelayInSimulation { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// Arguments to <c>comms.setSimulationDelayPolicy</c>: apply signal delay
/// during a simulation, or cut it.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("comms.setSimulationDelayPolicy")]
public class SetSimulationDelayPolicyArgs
{
    [SitrepUnit(Units.Flag)]
    public bool ApplyDuringSimulation { get; set; }
}
