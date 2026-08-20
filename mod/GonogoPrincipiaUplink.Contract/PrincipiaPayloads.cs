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

/// <summary>
/// The <c>principia.provenance</c> channel: what is authoritative right now, and
/// which parts of that we have actually seen.
///
/// <para>Three settings decide whether a propagated number can be trusted at a
/// given instant, and in-game they live in three different windows. Putting them
/// on one surface is the thing an in-game overlay cannot do, and the elected
/// provider belongs here too as a diagnostic rather than a readout.</para>
///
/// <para><b>The fields split into two classes and the split is load-bearing.</b>
/// Most of this is operator state that is correct whenever it is read: a toggle
/// holds what the operator set, a length is restored from the save. But the
/// prediction tolerance and step limit are recomputed by the producer's own UI on
/// every repaint from a per-vessel source we may not query, so they are
/// <b>observations</b> and carry <see cref="PredictionObservedAtUt"/> plus the
/// vessel they were observed for. Null means not observed.</para>
///
/// <para>That distinction is not pedantry. Unobserved, those two indices sit at
/// their constructor defaults, which resolve to a plausible tolerance and a
/// plausible step count. A payload that reported them anyway would hand an
/// operator a fabricated basis for judging every other number on the screen, with
/// nothing anywhere to indicate it. A missing tolerance is a gap someone can act
/// on; an invented one is not.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("principia.provenance")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class PrincipiaProvenance
{
    /// <summary>True when the game is ALSO drawing stock patched conics. The trust
    /// question in reverse: an operator seeing two curves needs to know one of them
    /// is not the integrated one.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DisplayPatchedConics { get; set; }

    /// <summary>How much flown history the producer keeps. An interval, so
    /// seconds.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? HistoryLengthSeconds { get; set; }

    /// <summary>How many plotting frames are set to hide unpinned markers. A count
    /// rather than the set: the operator-facing fact is whether markers are being
    /// hidden from them at all.</summary>
    [SitrepUnit(Units.Count)]
    public int? FramesHidingUnpinnedMarkers { get; set; }

    /// <summary>As above, for celestials.</summary>
    [SitrepUnit(Units.Count)]
    public int? FramesHidingUnpinnedCelestials { get; set; }

    /// <summary>The plotting frame's kind, as the producer's own enum ordinal.
    /// Passed through rather than mapped to a name on the producer side: the label
    /// is built client-side because every method that would name it can abort the
    /// process.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? PlottingFrameType { get; set; }

    /// <summary>The body the plotting frame is centred on, by name.</summary>
    [SitrepUnit(Units.Text)]
    public string? PlottingFrameCentreBody { get; set; }

    /// <summary>True when the frame is defined relative to the target rather than
    /// to a body, in which case the centre body above does not describe it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? TargetFrameSelected { get; set; }

    /// <summary>The prediction's position tolerance. An OBSERVATION: null until the
    /// producer's own settings UI has rendered at least once.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictionToleranceMetres { get; set; }

    /// <summary>The prediction's integration step limit. An observation, as
    /// above.</summary>
    [SitrepUnit(Units.Count)]
    public double? PredictionMaxSteps { get; set; }

    /// <summary>When the two prediction fields above were observed. Their age is
    /// the operator's cue, exactly as on the flight plan.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictionObservedAtUt { get; set; }

    /// <summary>Which vessel the prediction settings were observed FOR. They are
    /// per-vessel, so a tolerance with no vessel attached would read as a global
    /// setting and mislead on every other craft.</summary>
    [SitrepUnit(Units.Id)]
    public string? PredictionVesselId { get; set; }
}
