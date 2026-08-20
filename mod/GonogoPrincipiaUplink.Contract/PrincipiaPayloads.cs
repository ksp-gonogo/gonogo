#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoPrincipiaUplink;

/// <summary>
/// The <c>principia.flightPlan</c> channel: an n-body flight plan as it was last
/// OBSERVED, with the instant of that observation on the payload.
///
/// <para><b>Why the observation instant is a field and not an implementation
/// detail.</b> Every value here is read from a window class whose fields are
/// refreshed only while that window is rendering. So a payload with no
/// observation instant would be a claim about now built from a reading of
/// whenever-the-operator-last-looked, and the client would have no way to tell
/// the difference. <see cref="ObservedAtUt"/> is what makes the rest of this
/// type honest.</para>
///
/// <para><b>Absence is never rendered from silence.</b> A vessel whose planner
/// has never been opened produces NO sample on this channel, not a sample with
/// an empty <see cref="Burns"/> list. Those are different claims and conflating
/// them is the dangerous direction: "no flight plan" for a vessel that has one
/// makes the operator stop looking, on the one channel whose purpose is to have
/// them looking. A sample with <see cref="PlanExists"/> false is a POSITIVE
/// observation that there is no plan, which is only ever published when the
/// planner rendered and declined to draw one.</para>
///
/// <para>A TS-shape-only typing/codegen marker: the uplink hand-builds the dict
/// and <c>JsonWriter</c> walks that live tree, so this POCO never serializes.
/// <c>DelayRole.Delayed</c>, being a per-vessel telemetry fact subject to the
/// reveal-gate.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("principia.flightPlan")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class PrincipiaFlightPlan
{
    /// <summary>The vessel this plan belongs to, as the guid string, the same key
    /// the <c>fleet.</c> namespace uses. Carried rather than implied: the planner
    /// renders for its own predicted vessel, which is not necessarily the active
    /// one, and attributing one vessel's burns to another would be worse than
    /// publishing nothing.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>UT at which this plan state was observed. Not the current UT, and
    /// the two are equal only while the planner window is actually being drawn.
    /// The client ages the plan against its own view instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ObservedAtUt { get; set; }

    /// <summary>True when a plan was observed to exist. False is a POSITIVE
    /// observation of no plan (the planner rendered and drew none), never the
    /// default for "we have not looked".</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PlanExists { get; set; }

    /// <summary>The plan's desired end instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FinalTimeUt { get; set; }

    /// <summary>True when the integrator hit its time limit before finishing the
    /// plan: the plan is incomplete and nothing in-game says so once the window
    /// is closed.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ReachedDeadline { get; set; }

    /// <summary>Whether the plan integrated: true observed OK, false observed
    /// failed, <b>null when the producer could not read the status at all</b>.
    /// Three states rather than two, deliberately. A boolean here would force an
    /// unreadable status to render as one of the two answers, and "integrated" is
    /// the one it would have to be: health reported from a failed read, on the
    /// field that decides whether the plan is worth trusting.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PlanIntegrated { get; set; }

    /// <summary>The integrator's own error code, when
    /// <see cref="PlanIntegrated"/> is false.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? StatusError { get; set; }

    /// <summary>The integrator's own message for a failed plan, passed through
    /// rather than reworded: it names conditions we do not model.</summary>
    [SitrepUnit(Units.Text)]
    public string? StatusMessage { get; set; }

    /// <summary>Index into <see cref="Burns"/> of the burn that broke the
    /// integration, when the integrator identified one. The difference between
    /// "the plan failed" and "burn 3 failed" is the difference between a warning
    /// and an action.</summary>
    [SitrepUnit(Units.Count)]
    public int? FirstErrorBurnIndex { get; set; }

    /// <summary>Index into <see cref="Burns"/> of the next burn still in the
    /// future at observation time. This is the ignition worth waking someone
    /// for, and it is named by the integrator rather than derived here.</summary>
    [SitrepUnit(Units.Count)]
    public int? FirstFutureBurnIndex { get; set; }

    /// <summary>How many burns are anomalous. The anomalous ones are the LAST n
    /// of <see cref="Burns"/>, which is the integrator's own rule; each affected
    /// burn also carries <see cref="PrincipiaFlightPlanBurn.Anomalous"/> so a
    /// client never has to know it.</summary>
    [SitrepUnit(Units.Count)]
    public int? AnomalousBurnCount { get; set; }

    /// <summary>The committed burns, in plan order.</summary>
    public PrincipiaFlightPlanBurn[]? Burns { get; set; }
}

/// <summary>
/// One committed burn in a <see cref="PrincipiaFlightPlan"/>.
///
/// <para>Every field is read from a plain managed field or a property over one.
/// Nothing here is computed by asking the integrator at read time, which is what
/// keeps the observation a pure read of state the game had already decided.</para>
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class PrincipiaFlightPlanBurn
{
    /// <summary>Position in the plan, from zero.</summary>
    [SitrepUnit(Units.Count)]
    public int? Index { get; set; }

    /// <summary>Ignition instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? IgnitionUt { get; set; }

    /// <summary>Cutoff instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CutoffUt { get; set; }

    /// <summary>Burn length. An interval, so seconds rather than a UT: a finite
    /// burn's whole point is that it has duration, and the coast before it is
    /// what the operator is away for.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? DurationSeconds { get; set; }

    /// <summary>Δv magnitude.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaV { get; set; }

    /// <summary>Thrust the plan assumes for this burn.</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? ThrustKilonewtons { get; set; }

    /// <summary>Specific impulse the plan assumes, at standard gravity.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? SpecificImpulseSeconds { get; set; }

    /// <summary>Vessel mass the plan assumes at ignition.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? InitialMassTons { get; set; }

    /// <summary>True when the burn holds a fixed inertial attitude rather than
    /// tracking its frame.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? InertiallyFixed { get; set; }

    /// <summary>Which coordinate system the Δv components are expressed in, as
    /// the integrator's own enum ordinal. Passed through rather than mapped: the
    /// set is the integrator's and a stale mapping here would silently mislabel
    /// a burn's frame.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? CoordinateSystem { get; set; }

    /// <summary>True when this burn is one the integrator flagged as anomalous.
    /// Resolved here from the count so no client has to reimplement the
    /// last-n rule.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Anomalous { get; set; }
}
