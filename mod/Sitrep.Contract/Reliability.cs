using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/*
 * reliability.* is a Domain-neutral capability namespace, like comms.*: several mods can
 * model reliability, so one exclusive "reliability" capability is elected in the Kernel and
 * its active instance is an IReliabilityBackend. A core registrar owns the capability, ships
 * the "no model" fallback and declares both reliability.* channels once; each provider
 * registers from its own Uplink, and an install with several resolves by Priority in the
 * Kernel (TestFlight outranks Kerbalism), never in the client.
 *
 * The payloads describe what a reliability model KNOWS rather than which mod is speaking: a
 * consumed dimension is a ReliabilityBudget entry the provider names itself, and anything
 * genuinely provider-shaped goes in the extension bag. IReliabilityBackend is not a wire
 * type; it is parameterless and KSP-free so this assembly stays KSP-free.
 */

/// <summary>
/// The vocabulary of <see cref="ReliabilitySummary.Coverage"/>: whether anything
/// is watching this craft's reliability, and if not, why not. Five states
/// because five different things are wrong (or not wrong), and the operator's
/// response differs in each. "Off" and "could not tell" are separate states and
/// must never be merged.
/// </summary>
/// <category>Parts</category>
public static class ReliabilityCoverage
{
    /// <summary>No provider registered for the capability. Nothing is installed that could model reliability, and nothing could therefore be silently broken.</summary>
    public const string None = "none";

    /// <summary>A provider WAS selected and could not be read: its factory threw during Kernel activation, or its Summary()/Parts() threw this capture. Nothing can be seen, and the payload says so.</summary>
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
/// <category>Parts</category>
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
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One consumed dimension of a part's rated life: the open-ended member of the
/// per-part shape. A provider declares a dimension the shared shape has never
/// heard of without a change to this contract, and any renderer can draw it
/// from <see cref="Label"/> and the numbers (an extension bag entry, by
/// contrast, is readable only by a widget that already knows the provider id).
///
/// <para>A budget is BACKWARD-looking: how much of a rated allowance has been
/// used. It is not a forecast; that is <see cref="ReliabilityPartEntry.Survival"/>.</para>
/// </summary>
/// <category>Parts</category>
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
    /// consumes engine life thrust-weighted, so remaining rated seconds are not
    /// seconds of burn at partial throttle. Say "rated" when rendering it, and do
    /// not convert it to wall-clock time: the future throttle profile is unknown.
    /// <internal>
    /// TestFlight's rule is
    /// <c>currentRunTime += dt * thrustModifier.Evaluate(engine.thrustRatio)</c>
    /// in <c>TestFlightReliability_EngineCycle.UpdateCycle</c>.
    /// </internal>
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
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("reliability.parts", isArray: true)]
public class ReliabilityPartEntry
{
    /// <summary>
    /// UNIQUE within one reliability.parts payload. Producers MUST enforce this;
    /// it is not a KSP flightID and must not be treated as one. It is the id
    /// <see cref="RepairPartArgs.PartId"/> takes.
    /// <internal>
    /// Both bundled providers write <c>&lt;flightID&gt;:&lt;occurrence&gt;</c>,
    /// because one part can carry more than one modelled core and a bare
    /// flightID would merge the rows.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>
    /// Which crew trait may act on this part, as the provider states it: a
    /// single name, or several comma-separated, or empty meaning anyone.
    ///
    /// <para>Carried so a console can offer only the crew who could actually do
    /// it, rather than listing everyone aboard and letting the operator spend a
    /// round trip discovering that the pilot cannot. This is the PROVIDER's own
    /// requirement read back, never a guess at one.</para>
    ///
    /// <para>Already ELEVATED where the provider elevates it. Kerbalism asks
    /// more of a critical failure than an ordinary one, so this is the
    /// requirement for THIS part in THIS condition, not the part's baseline.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? RepairTrait { get; set; }

    /// <summary>Minimum experience level the trait must hold, elevated with <see cref="RepairTrait"/>. Null when the provider states none.</summary>
    [SitrepUnit(Units.Count)]
    public int? RepairLevel { get; set; }

    /// <summary>The part's display title, as the provider reports it.</summary>
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
    /// flags aboard, which no per-part field can settle.</para>
    ///
    /// <para>"unknown" means the provider could not read this part's condition. It
    /// is a first-class value and the client renders it; it must never be
    /// substituted with "nominal".</para>
    ///
    /// <para>There is no "wear" value: wear is a threshold on a number, the
    /// numbers are in <see cref="Budgets"/> and <see cref="Survival"/>, and the
    /// thresholds live client-side.</para>
    /// <internal>
    /// One authority for the word: a server-side "wear" beside client-side
    /// thresholds is how "2 wearing" comes to disagree with the number of
    /// wearing rows beneath it.
    /// </internal>
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
    /// What repairing THIS part in THIS condition consumes, as the provider
    /// states it. Null or empty means the provider models no consumable cost:
    /// that is not the same claim as a cost of zero, and a console must render
    /// it as "nothing is consumed" rather than as "needs 0".
    ///
    /// <para>A consumable cost is the PROVIDER's arithmetic and nothing else can
    /// derive it. Kerbalism charges two EVA repair kits for its critical class
    /// and one for an ordinary failure, and nothing for a service; TestFlight has
    /// no consumable in its model at all. Do not derive a cost from
    /// <see cref="Condition"/>: that applies one backend's rule to every
    /// install.</para>
    ///
    /// <para>Already ELEVATED where the provider elevates it, on the same rule as
    /// <see cref="RepairTrait"/>: this is the cost for this part in this
    /// condition, not the part's baseline.</para>
    /// </summary>
    public IReadOnlyList<RepairCostItem>? RepairCost { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, per-part half. Same mechanism and
    /// same rule as <see cref="ReliabilitySummary.Extensions"/>.
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One kind of thing a repair consumes, and how many of it. Deliberately shaped
/// as <see cref="InventoryItem"/>'s name/quantity pair so a console can join the
/// two directly rather than guessing which inventory line a cost refers to.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RepairCostItem
{
    /// <summary><c>AvailablePart.name</c>, the config id (e.g. <c>"evaRepairKit"</c>), matching <see cref="InventoryItem.Name"/>. The provider names the item so no consumer has to know which one a backend uses.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary>How many of this kind one repair consumes. An entry exists only where something IS consumed, so this is never a meaningful zero.</summary>
    [SitrepUnit(Units.Count)]
    public int Quantity { get; set; }
}

/// <summary>
/// The "reliability" capability's active-instance interface (parallel to
/// <see cref="ICommsBackend"/>). An Uplink that models reliability implements it
/// and registers it as a Kernel provider; the elected one's readouts are
/// published on <c>reliability.summary</c> and <c>reliability.parts</c>.
/// Parameterless and KSP-free: an implementation reads the active vessel
/// itself.
/// </summary>
/// <category>Uplink API</category>
public interface IReliabilityBackend : ISitrepProvider
{
    /// <summary>One of <see cref="ReliabilityCoverage"/>. Report <see cref="ReliabilityCoverage.Indeterminate"/> rather than guessing when the backend cannot tell.</summary>
    string Coverage { get; }

    /// <summary>Vessel-level summary for the active vessel.</summary>
    ReliabilitySummary Summary();

    /// <summary>Per-part reliability entries for the active vessel.</summary>
    IReadOnlyList<ReliabilityPartEntry> Parts();

    /// <summary>
    /// Attempt a repair of one part, by one named crew member, in a single call.
    ///
    /// <para><b>One call, because every command costs a round trip.</b> Asking
    /// who holds a kit, ordering a fetch and then ordering the repair is three
    /// trips, which at Duna is hours and nobody would use it. So the backend
    /// resolves the whole intent locally: crew check, EVA-possibility check,
    /// kit sourcing including taking one from a part-hosted store, and the
    /// repair itself.</para>
    ///
    /// <para>Returns the result, refusals included, and <c>Ok</c> only when the
    /// part was actually repaired. A refusal is not an exception: it is the
    /// result, it costs the same round trip as a success, and it has to say WHY
    /// (a <see cref="RepairRefusal"/> code where one fits) so the operator's
    /// next choice is informed.</para>
    ///
    /// <para>A backend that models no repair returns
    /// <see cref="RepairRefusal.NotModelled"/> rather than throwing, so the
    /// command always gets a result.</para>
    /// </summary>
    /// <param name="partId">The part, as <see cref="ReliabilityPartEntry.PartId"/> names it.</param>
    /// <param name="crewName">The kerbal who performs the repair, by name.</param>
    /// <returns>The outcome on success, or the refusal that stopped the repair.</returns>
    CommandResult<RepairOutcome> Repair(string partId, string crewName);
}

/// <summary><c>vessel.repair</c>'s args: which part, and which crew member does it.</summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.repair", Payload = typeof(RepairOutcome))]
public class RepairPartArgs
{
    /// <summary>The failed part, by the id <c>reliability.parts</c> gives it (<see cref="ReliabilityPartEntry.PartId"/>).</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>Who performs it. A NAME, because that is KSP's own stable identifier for a kerbal and what <c>vessel.crew</c> is keyed by.</summary>
    [SitrepUnit(Units.Text)]
    public string CrewName { get; set; } = "";
}

/// <summary>
/// What a repair attempt did, or why it did nothing.
///
/// <para>Carries where the kit came from because that changes what the operator
/// has left, and under delay they will not get to ask again cheaply.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RepairOutcome
{
    /// <summary>Whether the part was actually repaired.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Repaired { get; set; }

    /// <summary>Kits consumed. Kerbalism charges two for a critical failure and one otherwise.</summary>
    [SitrepUnit(Units.Count)]
    public int KitsUsed { get; set; }

    /// <summary>
    /// Where the kit came from: <c>carried</c> when the kerbal already held it,
    /// otherwise the part id of the store it was taken from, so the operator
    /// can see which locker just got lighter.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? KitsFrom { get; set; }
}

/// <summary>
/// Why a repair was refused, finer than its root: a part that does not resolve
/// and a crew member who does not are both <c>notFound</c>, and only the
/// refinement says which.
///
/// <para>A backend states WHY in this vocabulary, or with a bare root when
/// none of these fits. It does not write a sentence of its own: each code here
/// carries the one an operator reads.</para>
/// </summary>
/// <category>Parts</category>
public static class RepairRefusal
{
    /// <summary>No crew member aboard has the requested name.</summary>
    public static readonly RefusalCode NoSuchCrew =
        CommandErrorCode.NotFound.Refine("repair.noSuchCrew", "no crew member aboard has that name");

    /// <summary>
    /// The named kerbal is aboard but does not satisfy the provider's own
    /// (elevated, for a critical failure) crew requirement.
    /// </summary>
    public static readonly RefusalCode CrewNotQualified =
        CommandErrorCode.CapabilityMismatch.Refine("repair.crewNotQualified", "that crew member is not qualified to repair it");

    /// <summary>
    /// The kerbal could not have got out: the hatch is inside a fairing. Resolves
    /// by waiting, since the fairing is jettisoned later in the same flight.
    /// </summary>
    public static readonly RefusalCode EvaImpossible =
        CommandErrorCode.NotClearToProceed.Refine("repair.evaImpossible", "the crew cannot get out to it yet");

    /// <summary>Fewer consumables aboard than the provider charges for this repair.</summary>
    public static readonly RefusalCode NoKits =
        CommandErrorCode.InsufficientResource.Refine("repair.noKits", "there are not enough repair kits aboard");

    /// <summary>Nothing on this install models reliability, so there is nothing to repair.</summary>
    public static readonly RefusalCode NotModelled =
        CommandErrorCode.ModeUnavailable.Refine("repair.notModelled", "nothing on this install models part failures");

    /// <summary>No part on the vessel carries that id, or it carries nothing repairable.</summary>
    public static readonly RefusalCode NoSuchPart =
        CommandErrorCode.NotFound.Refine("repair.noSuchPart", "no part aboard needs that repair");

    /// <summary>
    /// The provider models this failure and states that it cannot be repaired
    /// at all: TestFlight's <c>ITestFlightFailure.CanAttemptRepair()</c> is
    /// false for an exploded part, a fired docking clamp and a snapped solar
    /// mechanism, whatever crew are aboard and whatever they carry.
    ///
    /// <para>Not <see cref="NotModelled"/>: the model is present and working,
    /// and this is its verdict.</para>
    /// </summary>
    public static readonly RefusalCode Unrepairable =
        CommandErrorCode.CapabilityMismatch.Refine("repair.unrepairable", "that failure cannot be repaired");
}
