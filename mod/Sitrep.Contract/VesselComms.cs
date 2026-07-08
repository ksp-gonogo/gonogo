#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>VesselControlState</c> enum by name (its underlying
/// int values collide by design in stock KSP — e.g. <c>Probe == ProbeNone == 2</c>
/// — which is KSP's own ambiguity, not one this contract introduces; we
/// simply consume whichever name <c>.ToString()</c> already commits to).
/// <see cref="Unknown"/> is the graceful fallback for an unrecognized raw
/// value.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum ControlState
{
    None,
    Probe,
    Kerbal,
    Partial,
    Full,
    ProbeNone,
    ProbePartial,
    ProbeFull,
    KerbalNone,
    KerbalPartial,
    KerbalFull,
    Unknown,
}

/// <summary>
/// The <c>vessel.comms</c> channel payload — the raw CommNet VESSEL snapshot.
/// Kills M-3 (one typed <see cref="ControlState"/> enum replaces the
/// magic-int <c>comm.controlState</c> + parallel <c>comm.controlStateName</c>
/// string key) and M-4 (no <c>0</c>/<c>0d</c> no-data sentinel — absence is
/// the WHOLE channel being null when <c>vessel.connection</c> is null,
/// R1(b), never a fake zero reading indistinguishable from "no telemetry at
/// all").
///
/// <para><b>Scope fence</b> (per the design doc): this is what the vessel
/// itself reports. The delay authority and link modelling live in a future
/// <c>comms.*</c> CAPABILITY channel (RemoteTech-default) — Telemachus's
/// <c>comm.signalDelay</c> does NOT get a field here; that successor is
/// <c>comms.delay</c>, a different provider entirely.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselComms
{
    public bool Connected { get; set; }

    public double SignalStrength { get; set; }

    public ControlState ControlState { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
