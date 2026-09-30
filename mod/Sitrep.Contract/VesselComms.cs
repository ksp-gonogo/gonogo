#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// KSP's <c>VesselControlState</c>, carried by name: what is controlling the
/// vessel (a probe core, a kerbal) and how much control it has (none, partial,
/// full). Mirrors the stock member names; <see cref="Unknown"/> covers any name
/// the mod does not recognise.
/// <internal>Several stock members share an underlying int (for example
/// <c>Probe == ProbeNone</c>), so the mod parses <c>.ToString()</c> rather than
/// the int, and this enum's ordinals are its own, not KSP's.</internal>
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ControlState
{
    /// <summary>No control.</summary>
    None,
    /// <summary>Controlled by a probe core.</summary>
    Probe,
    /// <summary>Controlled by a kerbal.</summary>
    Kerbal,
    /// <summary>Partial control.</summary>
    Partial,
    /// <summary>Full control.</summary>
    Full,
    /// <summary>A probe-controlled vessel with no control.</summary>
    ProbeNone,
    /// <summary>A probe-controlled vessel with partial control, typically without a connection home.</summary>
    ProbePartial,
    /// <summary>A probe-controlled vessel with full control.</summary>
    ProbeFull,
    /// <summary>A kerbal-controlled vessel with no control.</summary>
    KerbalNone,
    /// <summary>A kerbal-controlled vessel with partial control.</summary>
    KerbalPartial,
    /// <summary>A kerbal-controlled vessel with full control.</summary>
    KerbalFull,
    /// <summary>A state name the mod does not recognise.</summary>
    Unknown,
}

/// <summary>
/// The <c>vessel.comms</c> channel payload: the active vessel's own CommNet
/// connection, from KSP's <c>vessel.connection</c>. The whole payload is null
/// when the vessel has no CommNet connection object; there is no zero or
/// disconnected placeholder reading.
///
/// <para>This is what the vessel itself reports. Signal delay and link
/// modelling are on the <c>comms.*</c> channels (<c>comms.delay</c> for the
/// delay), not here.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.comms")]
public class VesselComms
{
    /// <summary>Whether the vessel has a CommNet connection home, from <c>vessel.connection.IsConnected</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }

    /// <summary>The connection's signal strength, from <c>vessel.connection.SignalStrength</c>: a ratio from <c>0</c> (none) to <c>1</c> (full).</summary>
    [SitrepUnit(Units.Ratio)]
    public double SignalStrength { get; set; }

    /// <summary>What is controlling the vessel and how much control it has, from <c>vessel.connection.ControlState</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public ControlState ControlState { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
