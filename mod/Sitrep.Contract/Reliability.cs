using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Reliability: a Domain-NEUTRAL capability namespace (reliability.*), exactly
// like comms.* (Comms.cs). It is NOT owned by one uplink Domain: multiple mods
// can model reliability (Kerbalism-Reliability, TestFlight), so it rides the
// Kernel capability election, modelled on the "comms" capability (Kernel.cs,
// mod/Sitrep.Host/Comms/CommsElection.cs, mod/Gonogo.KSP/CommsCoreUplink.cs).
//
//   • ONE exclusive capability "reliability" whose active instance is an
//     IReliabilityBackend (this file).
//   • A core registrar (mod/Gonogo.KSP/ReliabilityCoreUplink.cs) OWNS the
//     capability, ships the vanilla "unmodeled" fallback, declares the two
//     reliability.* channels ONCE, and sources them from whichever backend the
//     election picked (Kernel.Query<IReliabilityBackend>("reliability")).
//   • Providers register in their OWN uplink's Register (host.Kernel.RegisterProvider):
//       - GonogoKerbalismUplink  → Priority 1  (reports Unmodeled=true when Features.Reliability off)
//       - GonogoTestFlightUplink → Priority 10 (engine-authoritative; wins under RO)
//     Under RO only TestFlight is live; in stock Kerbalism only Kerbalism is
//     live; both-registered resolves by Priority in the Kernel, never in the client.
//
// ReliabilitySummary / ReliabilityPartEntry are wire POCOs (typing + codegen).
// IReliabilityBackend is the capability's active-instance interface, NOT a wire
// type: parameterless and KSP-free (backends read the active vessel internally,
// exactly like ICommsBackend), so Sitrep.Contract stays KSP-free / MIT.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Vessel-level reliability summary. Source-agnostic: the elected backend fills it.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("reliability.summary")]
public class ReliabilitySummary
{
    /// <summary>True when the elected backend does not model reliability (Kerbalism with Features.Reliability off).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Unmodeled { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Malfunction { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Critical { get; set; }
    /// <summary>Which backend produced this: "kerbalism" | "testflight" | "none".</summary>
    [SitrepUnit(Units.Id)]
    public string? Source { get; set; }
    /// <summary>Worst engine reliability probability on the vessel (0..1), the at-a-glance number. TestFlight fills it; null for Kerbalism.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? WorstReliabilityFraction { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how a reliability backend carries a
    /// field this shared shape does not declare, WITHOUT a PR against this file.
    /// See <see cref="ProviderExtensionBagAttribute"/> for the whole mechanism.
    /// The fields above are the hand-curated superset that predates it; a NEW
    /// provider-specific field belongs here instead
    /// (<c>Sitrep.Host.Tests.ReliabilityContractShapeTests</c> holds that line).
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// Per-part reliability. A source-agnostic superset: Kerbalism fills the
/// consumed-fraction fields (<see cref="IgnitionsConsumed"/>/<see cref="DurationConsumed"/>,
/// 1.0 = spent, remaining = 1 - value), TestFlight leaves those null and carries
/// a live reliability estimate via <see cref="MtbfHours"/>. The renderer shows
/// whichever fields are non-null.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("reliability.parts", isArray: true)]
public class ReliabilityPartEntry
{
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }
    [SitrepUnit(Units.Text)]
    public string? Group { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Broken { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Critical { get; set; }
    [SitrepUnit(Units.Hours)]
    public double? MtbfHours { get; set; }
    /// <summary>Live/interpolated reliability probability (0..1): TestFlight's headline pre-burn go/no-go number. TestFlight fills it; null for Kerbalism.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ReliabilityFraction { get; set; }
    /// <summary>Seconds of rated burn left (TestFlight). Distinct from the Kerbalism-only DurationConsumed fraction. Null for Kerbalism.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? RemainingRatedBurn { get; set; }
    /// <summary>Fraction of rated ignitions CONSUMED (1.0 = spent). Kerbalism-only; null for TestFlight.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? IgnitionsConsumed { get; set; }
    /// <summary>Fraction of rated duration CONSUMED (1.0 = spent). Kerbalism-only; null for TestFlight.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? DurationConsumed { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? NeedsRepair { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, per-part half. Same mechanism and
    /// same rule as <see cref="ReliabilitySummary.Extensions"/>: a provider that
    /// models something this shared shape does not declare writes it under its own
    /// provider id rather than adding a member here.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The "reliability" capability's active-instance interface (parallel to
/// <see cref="ICommsBackend"/>). Parameterless + KSP-free: implementations
/// (in the KSP-referencing uplink projects) read the active vessel internally.
/// Registered as a Kernel provider by each modelling uplink; the core registrar
/// resolves the elected one and publishes its readouts on reliability.*.
/// </summary>
public interface IReliabilityBackend : ISitrepProvider
{
    /// <summary>False when this backend does not model reliability (Kerbalism with Features.Reliability off).</summary>
    bool IsModeled { get; }

    /// <summary>Vessel-level summary for the active vessel.</summary>
    ReliabilitySummary Summary();

    /// <summary>Per-part reliability entries for the active vessel.</summary>
    IReadOnlyList<ReliabilityPartEntry> Parts();
}
