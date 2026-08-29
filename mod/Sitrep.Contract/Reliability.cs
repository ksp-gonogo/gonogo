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
// mod/Sitrep.Host/Comms/CommsElection.cs, mod/Gonogo.KSP/ReliabilityCoreUplink.cs).
//
//   • ONE exclusive capability "reliability" whose active instance is an
//     IReliabilityBackend (this file).
//   • A core registrar (mod/Gonogo.KSP/ReliabilityCoreUplink.cs) OWNS the
//     capability, ships the vanilla "no model" fallback, declares the two
//     reliability.* channels ONCE, and sources them from whichever backend the
//     election picked (Kernel.Query<IReliabilityBackend>("reliability")).
//   • Providers register in their OWN uplink's Register (host.Kernel.RegisterProvider):
//       - GonogoKerbalismUplink  → Priority 1  (LOW specificity)
//       - GonogoTestFlightUplink → Priority 10 (engine-authoritative; wins under RO)
//     Under RO only TestFlight is live; in stock Kerbalism only Kerbalism is
//     live; both-registered resolves by Priority in the Kernel, never in the client.
//
// MODEL-FIRST SHAPE. The payloads below describe what a reliability model KNOWS
// rather than which mod is speaking. The previous shape was a hand-curated
// superset with one mod's fields beside another's, all nullable, each doc-commented
// with who fills it: that needed a core PR per provider and it encoded two
// providers' vocabularies into a shared record. What replaced it is smaller (the
// summary went 6 members to 3, the part entry 12 to 9) and open where it needs to
// be: a consumed dimension is a ReliabilityBudget entry a provider names itself,
// and anything genuinely provider-shaped goes in the extension bag.
//
// ReliabilitySummary / ReliabilityPartEntry / ReliabilityBudget are wire POCOs
// (typing + codegen). IReliabilityBackend is the capability's active-instance
// interface, NOT a wire type: parameterless and KSP-free (backends read the
// active vessel internally, exactly like ICommsBackend), so Sitrep.Contract stays
// KSP-free / MIT.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Whether anything is watching this craft's reliability, and if not, why not.
/// Five states because five different things are wrong (or not wrong), and the
/// operator's response differs in each. Replaces the boolean Unmodeled, which
/// could not tell "off" from "could not tell" and reported the reassuring answer.
/// </summary>
public static class ReliabilityCoverage
{
    /// <summary>No provider registered for the capability. Nothing is installed that could model reliability, and nothing could therefore be silently broken.</summary>
    public const string None = "none";

    /// <summary>A provider WAS selected and could not be read: its factory threw during Kernel activation, or its Summary()/Parts() threw this capture. We are blind and must say so.</summary>
    public const string Unavailable = "unavailable";

    /// <summary>The elected backend is present and is not modelling reliability for this save. Says nothing about whether some OTHER mod is.</summary>
    public const string Disabled = "disabled";

    /// <summary>The elected backend cannot determine its own modelling state (a probe that did not bind). Distinct from Disabled, and must never collapse into it.</summary>
    public const string Indeterminate = "indeterminate";

    /// <summary>The elected backend is modelling reliability for this craft.</summary>
    public const string Modeled = "modeled";
}

/// <summary>
/// Vessel-level reliability summary. Two facts and a bag, and deliberately no
/// judgements: who is modelling, and whether they are modelling at all.
///
/// <para>There are no roll-ups here. A malfunction/critical count over the same
/// part list published from the same capture at the same UT is a second authority
/// for a derivable quantity, and a second authority is how two adjacent numbers
/// come to disagree. The client derives what it needs from
/// <c>reliability.parts</c>.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("reliability.summary")]
public class ReliabilitySummary
{
    /// <summary>Which backend produced this: "kerbalism" | "testflight" | "none", or a third-party provider id.</summary>
    [SitrepUnit(Units.Id)]
    public string? Source { get; set; }

    /// <summary>One of <see cref="ReliabilityCoverage"/>. Null only if a producer failed to set it; the client treats null and an unrecognised value identically.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Coverage { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how a reliability backend carries a
    /// field this shared shape does not declare, WITHOUT a PR against this file.
    /// See <see cref="ProviderExtensionBagAttribute"/> for the whole mechanism.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One consumed dimension of a part's rated life: the open-ended member of the
/// per-part shape, and the reason this contract could shrink rather than grow.
/// A provider declares a dimension the shared shape has never heard of without a
/// core PR, which is what the extension bag cannot deliver for a SHARED renderer
/// (a bag entry is readable only by a widget that already knows the provider id).
///
/// <para>A budget is BACKWARD-looking: how much of a rated allowance has been
/// used. It is not a forecast; that is <see cref="ReliabilityPartEntry.Survival"/>.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ReliabilityBudget
{
    /// <summary>
    /// Provider-chosen dimension id, stable across frames. Reserved ids with fixed
    /// meanings: "service" (scheduled maintenance clock), "burn.continuous",
    /// "burn.cumulative" (rated firing time, per RatingScope), "ignitions",
    /// "cycles". A provider with a dimension not listed here invents an id; the
    /// client renders it from Label and the numbers, never from the id.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>Display-ready lower-case noun phrase, rendered verbatim in the operator's sentence: "continuous rated burn", "service". Max 40 chars; the producer clamps.</summary>
    [SitrepUnit(Units.Text)]
    public string? Label { get; set; }

    /// <summary>
    /// What crossing the limit means, and therefore which verb the client uses:
    /// "schedule" (a maintenance date falls due; nothing fails at the line),
    /// "risk-ramp" (failure probability begins climbing past the line, nothing is
    /// guaranteed), "hard-limit" (the part stops at the line), "advisory" (the
    /// provider models the count but not what the limit means). A provider that
    /// does not know writes "advisory"; NEVER null-by-ignorance, because the
    /// client's threshold table is keyed on this.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Kind { get; set; }

    /// <summary>Used/Limit as a fraction, 0..1+ (may exceed 1). Null when the provider has no denominator. This is the field the client thresholds on.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Consumed { get; set; }

    /// <summary>
    /// Seconds of the allowance used. RATED seconds, not wall-clock: TestFlight
    /// consumes engine life thrust-weighted
    /// (<c>currentRunTime += dt * thrustModifier.Evaluate(engine.thrustRatio)</c>
    /// in TestFlightReliability_EngineCycle.UpdateCycle), so remaining rated
    /// seconds are not seconds of burn at partial throttle. Every rendered
    /// sentence says "rated" for that reason, and no wall-clock conversion is
    /// attempted because the future throttle profile is unknown.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? UsedSeconds { get; set; }

    /// <summary>The rated allowance in the same seconds <see cref="UsedSeconds"/> counts. Null when the provider has no denominator.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? LimitSeconds { get; set; }

    /// <summary>Countable events used (ignitions, cycles). Exclusive with the seconds pair.</summary>
    [SitrepUnit(Units.Count)]
    public double? UsedCount { get; set; }

    /// <summary>The countable allowance. Null when the provider has no denominator.</summary>
    [SitrepUnit(Units.Count)]
    public double? LimitCount { get; set; }
}

/// <summary>
/// Per-part reliability, in the terms a reliability model actually has: a
/// condition, the provider's own word for it, an optional forward survival
/// probability with its horizon, and any number of consumed budgets.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("reliability.parts", isArray: true)]
public class ReliabilityPartEntry
{
    /// <summary>UNIQUE within one reliability.parts payload. Producers MUST enforce this; it is not a KSP flightID and must not be treated as one.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// One of: "nominal", "service-due", "failed", "failed-critical", "unknown".
    /// The provider's WORST condition for this part.
    ///
    /// <para>"failed-critical" means the provider grades this failure as its more
    /// severe / more costly class. It does NOT mean unrecoverable: Kerbalism's
    /// critical IS repairable (2 evaRepairKits, and ElevatedForCritical() raises
    /// the crew requirement by one level before Repair() clears it). Nothing in
    /// this contract asserts that a part cannot be recovered, because
    /// repairability is a function of the part AND the crew, kits and difficulty
    /// flags aboard, which no per-part field can answer.</para>
    ///
    /// <para>"unknown" means the provider could not read this part's condition. It
    /// is a first-class value and the client renders it; it must never be
    /// substituted with "nominal".</para>
    ///
    /// <para>There is deliberately NO "wear" value: wear is a threshold on a
    /// number, the numbers are in <see cref="Budgets"/>/<see cref="Survival"/>,
    /// and the thresholds live client-side in one table. Two authorities for one
    /// word is how "2 wearing" comes to disagree with the number of wearing rows
    /// beneath it.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Condition { get; set; }

    /// <summary>The provider's OWN word(s) for this condition, rendered verbatim as the row's detail clause: "busted", "needs service", "turbopump failure". Max 120 chars; producer clamps. This is how a third mod's native vocabulary reaches the screen without a contract change.</summary>
    [SitrepUnit(Units.Text)]
    public string? ConditionDetail { get; set; }

    /// <summary>P(this part survives the next <see cref="SurvivalHorizonSeconds"/> seconds of OPERATION), 0..1. Null when the provider models no forward probability. MUST be null whenever the horizon is null.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Survival { get; set; }

    /// <summary>The horizon the fraction is over, in seconds of operation. MANDATORY whenever <see cref="Survival"/> is set: exp(-rate*t) is uninterpretable without t, and two parts' fractions are not comparable unless both horizons are on screen.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? SurvivalHorizonSeconds { get; set; }

    /// <summary>Consumed dimensions. Null or empty when the provider models none. Order is producer-chosen and not significant.</summary>
    public IReadOnlyList<ReliabilityBudget>? Budgets { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, per-part half. Same mechanism and
    /// same rule as <see cref="ReliabilitySummary.Extensions"/>.
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
    /// <summary>One of <see cref="ReliabilityCoverage"/>. Replaces the bool IsModeled: a boolean structurally cannot say "I could not tell", so it reported the reassuring answer.</summary>
    string Coverage { get; }

    /// <summary>Vessel-level summary for the active vessel.</summary>
    ReliabilitySummary Summary();

    /// <summary>Per-part reliability entries for the active vessel.</summary>
    IReadOnlyList<ReliabilityPartEntry> Parts();
}
