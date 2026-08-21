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
/// A reference frame, named well enough that a number stamped with it can be
/// read, and the shape every frame-dependent quantity on this Uplink carries.
///
/// <para><b>Why a frame travels with a number at all.</b> A trajectory is a
/// different curve and a Δv a different triple depending on which frame the
/// player picked, and the player can change that with no cue on any readout. So
/// a quantity quoted without its frame is not a rougher number, it is a wrong
/// one, and the qualifier ranks with a currency symbol rather than with a
/// tooltip.</para>
///
/// <para><b>The same type serves two different selectors and that is the point.</b>
/// One instance names the global plotting frame; another names one burn's
/// manœuvring frame, and the two are routinely different. <see cref="Selector"/>
/// says which, because reusing the component is right and reusing the LABEL is
/// the bug.</para>
///
/// <para>The kind travels as the producer's own enum value rather than as a
/// name, because every member that would format a name reaches a fatal log
/// through a default branch and aborts the KSP process. The naming table is on
/// the client side, in <c>plottingFrame.ts</c>.</para>
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class PrincipiaReferenceFrame
{
    /// <summary>Which selector this frame came from: <c>plotting</c> for the
    /// global one, or <c>burn</c> for a burn's own manœuvring frame.</summary>
    [SitrepUnit(Units.Text)]
    public string? Selector { get; set; }

    /// <summary>The frame's kind, as the producer's own enum value. Null when the
    /// target frame is selected, which is not a member of that enum.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? Type { get; set; }

    /// <summary>The body the frame is centred on, when it has one. The two
    /// rotating frames and the target frame do not.</summary>
    [SitrepUnit(Units.Text)]
    public string? CentreBody { get; set; }

    /// <summary>The body a rotating frame turns about: the parent of
    /// <see cref="SecondaryBody"/>. Null for the centred frames.</summary>
    [SitrepUnit(Units.Text)]
    public string? PrimaryBody { get; set; }

    /// <summary>The body a rotating frame is anchored to. Null for the centred
    /// frames.</summary>
    [SitrepUnit(Units.Text)]
    public string? SecondaryBody { get; set; }

    /// <summary>True when the frame is the target frame, which sits orthogonally
    /// to the kind enum rather than inside it. It is the only frame in which the
    /// producer computes closest approach, and one in which apsides do not exist
    /// at all.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? TargetFrameSelected { get; set; }

    /// <summary>The target vessel the frame is defined against, when it is a
    /// target frame.</summary>
    [SitrepUnit(Units.Id)]
    public string? TargetVesselId { get; set; }

    /// <summary>That vessel's name, so a readout need not resolve the guid.</summary>
    [SitrepUnit(Units.Text)]
    public string? TargetVesselName { get; set; }
}

/// <summary>
/// The <c>principia.settings</c> channel: every setting that changes what
/// another number MEANS, on one surface.
///
/// <para><b>Why these are grouped and why they come before the readouts they
/// qualify.</b> A setting here is not a preference. The plotting frame decides
/// what curve a trajectory even is; the prediction tolerance and step count
/// decide where its line stops; the history length decides how much past exists;
/// the analysis window decides how wide every orbital band is. Omitting one does
/// not leave a gap on a board, it leaves a number that is quietly wrong with
/// nothing anywhere saying so. In-game they are spread across four windows on
/// the player's machine, which is the thing a console can fix and an in-game
/// overlay cannot.</para>
///
/// <para><b>Where each value comes from decides whether it can be believed.</b>
/// The per-vessel and per-plan integrator bounds are read from the producer's own
/// plugin, through the precondition protocol, so they are what that vessel's
/// prediction and that plan ACTUALLY used rather than what a slider was last set
/// to globally. The rest are plain managed fields on the producer's windows and
/// are correct whenever they are read. Nothing here is inferred from a default:
/// a value that could not be read is null, because an invented tolerance is a
/// fabricated basis for judging every other number on the screen and a missing
/// one is a gap an operator can act on.</para>
///
/// <para><b>Reading stops entirely while the producer is recording a journal</b>
/// (<see cref="Journaling"/>). Its journal writes every call made through its
/// plugin interface, ours included, and that journal is the artefact one of its
/// bug reports is made of. Contaminating someone's debugging record is not an
/// acceptable side effect of a readout. While a recorder is active this payload
/// carries <see cref="ReadingSuspended"/> and its reason and nothing else, which
/// is a stated outage rather than a frozen last value.</para>
///
/// <para><c>DelayRole.TrueNow</c>: these are the operator's own settings and the
/// local mod's configuration, held on the machine the command centre runs
/// beside. There is no light-time for them to travel, and delaying them would
/// mean someone who tightened a tolerance kept reading their old basis for every
/// propagated number until light-time had passed.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("principia.settings")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class PrincipiaSettings
{
    /// <summary>The instant these settings were read. They are true as of now, so
    /// this is the sample's own UT rather than a past observation, and it is
    /// carried so a client never has to assume that.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ObservedAtUt { get; set; }

    /// <summary>The producer's build string, as the session's version gate read
    /// it. Null when no session is bound, in which case nothing below the frame
    /// is present either.</summary>
    [SitrepUnit(Units.Text)]
    public string? PluginVersion { get; set; }

    /// <summary>True when we have deliberately stopped reading. The rest of the
    /// payload is absent, and <see cref="ReadingSuspendedReason"/> says why.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ReadingSuspended { get; set; }

    /// <summary>Why reading stopped, in a sentence an operator can act on.</summary>
    [SitrepUnit(Units.Text)]
    public string? ReadingSuspendedReason { get; set; }

    // ---- What a trajectory or a marker IS ----

    /// <summary>The global plotting frame. Every frame-dependent quantity this
    /// Uplink publishes is in this frame unless it carries its own.</summary>
    public PrincipiaReferenceFrame? PlottingFrame { get; set; }

    /// <summary>Each burn's own manœuvring frame, in plan order, so the Δv triple
    /// beside it can be read. Only one in-game cue exists that a burn's frame
    /// differs from the plotting frame, and it is suppressed when the editor is
    /// minimised, so this is the operator's only reliable warning.</summary>
    public PrincipiaReferenceFrame[]? BurnFrames { get; set; }

    /// <summary>True while the producer's map-click vessel picker is armed. Read
    /// only; we never arm it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? SelectingTargetVessel { get; set; }

    /// <summary>The target vessel, by guid. It gates the target frame and every
    /// closest-approach number, so it is not informational: clearing it
    /// force-unsets the target frame and silently changes the plotted
    /// curve.</summary>
    [SitrepUnit(Units.Id)]
    public string? TargetVesselId { get; set; }

    /// <summary>That vessel's name.</summary>
    [SitrepUnit(Units.Text)]
    public string? TargetVesselName { get; set; }

    /// <summary>True while the producer's map-click celestial picker is armed.
    /// Mutually exclusive with <see cref="SelectingTargetVessel"/>: arming either
    /// disarms the other, so both true is a state the game cannot be in.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? SelectingTargetCelestial { get; set; }

    /// <summary>The targeted celestial, by name, when the target is a body rather
    /// than a vessel.</summary>
    [SitrepUnit(Units.Text)]
    public string? TargetCelestialBody { get; set; }

    /// <summary>True when the game is ALSO drawing stock patched conics. The one
    /// setting that tells an operator they are being shown two contradictory
    /// futures; the producer's own label for it ends "do not use for flight
    /// planning!".</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DisplayPatchedConics { get; set; }

    // ---- What changes the numeric answer ----

    /// <summary>The window the orbit analyser has been ASKED to analyse over. The
    /// analysis payload reports the duration it actually covered, and the two
    /// differ while an analysis is still catching up; this is the request.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? AnalysisMissionDurationRequestedSeconds { get; set; }

    /// <summary>True when the producer is detecting the ground-track recurrence
    /// itself rather than being told one.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? RecurrenceAutodetect { get; set; }

    /// <summary>The manual recurrence cycle's revolutions, used in game when
    /// autodetect is off. Inert for our own figures, which is exactly why it is
    /// here: it explains why the player's screen and ours disagree.</summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceRevolutionsPerCycle { get; set; }

    /// <summary>The manual recurrence cycle's days.</summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceDaysPerCycle { get; set; }

    /// <summary>Which revolution the ground-track figures are quoted for. Both
    /// equatorial-crossing longitudes change meaning with it, from a stepper the
    /// operator cannot see.</summary>
    [SitrepUnit(Units.Count)]
    public int? GroundTrackRevolution { get; set; }

    /// <summary>Which vessel the prediction bounds below were read for. They are
    /// per-vessel, so a tolerance with no vessel attached would read as a global
    /// setting and mislead about every other craft.</summary>
    [SitrepUnit(Units.Id)]
    public string? PredictionVesselId { get; set; }

    /// <summary>The position tolerance that vessel's prediction is integrated to,
    /// read from the plugin's own per-vessel parameters rather than from the
    /// global slider.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PredictionToleranceMetres { get; set; }

    /// <summary>That prediction's step limit. A prediction that stops short looks
    /// identical to a trajectory that ends, and this is the only number that
    /// separates them.</summary>
    [SitrepUnit(Units.Count)]
    public double? PredictionMaxSteps { get; set; }

    /// <summary>The FLIGHT PLAN's integration tolerance, which is a different
    /// setting from the prediction's despite sharing a label in game. Conflated,
    /// a plan failure gets explained by a prediction setting and the operator
    /// changes the wrong control.</summary>
    [SitrepUnit(Units.Metres)]
    public double? PlanToleranceMetres { get; set; }

    /// <summary>The flight plan's step limit per segment, and the remedy for the
    /// commonest reason a plan could not be drawn.</summary>
    [SitrepUnit(Units.Count)]
    public double? PlanMaxSteps { get; set; }

    /// <summary>Where the plan begins.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PlanInitialTimeUt { get; set; }

    /// <summary>Where the plan has been asked to end. Shortening it makes later
    /// burns vanish, and a burn that disappeared reads as a burn that was
    /// deleted.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PlanDesiredFinalTimeUt { get; set; }

    /// <summary>How far the plan actually integrated. Short of the desired final
    /// time exactly when the plan is in trouble.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PlanActualFinalTimeUt { get; set; }

    /// <summary>How many flight plans the vessel holds, up to the producer's ten.</summary>
    [SitrepUnit(Units.Count)]
    public int? FlightPlanCount { get; set; }

    /// <summary>Which plan is selected, from zero. <b>Minus one means none is
    /// selected</b>, which is a state rather than a zero, and every number on a
    /// plan board belongs to whichever this names.</summary>
    [SitrepUnit(Units.Count)]
    public int? SelectedFlightPlan { get; set; }

    /// <summary>The altitude the plan optimiser is solving for.</summary>
    [SitrepUnit(Units.Metres)]
    public double? OptimiserTargetAltitudeMetres { get; set; }

    /// <summary>The inclination the optimiser is solving for, or null when
    /// inclination is NOT an objective. Null and zero are different instructions
    /// and rendering the first as the second would show an equatorial target that
    /// nobody asked for. The optimised BODY is not here: it comes from the
    /// plotting frame, which is the coupling most easily got wrong.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? OptimiserTargetInclinationDegrees { get; set; }

    // ---- What changes what is drawn ----

    /// <summary>How much flown history the producer draws, for the vessel and for
    /// every celestial. Our own map draws its own history, so this exists to
    /// explain a disagreement between screens rather than to drive one.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? HistoryLengthSeconds { get; set; }

    /// <summary>True when apsis, node and approach markers are hidden IN THE
    /// FRAME NOW SELECTED. This is the per-frame answer rather than the global
    /// one: a marker's absence in game reads as "does not exist" when it means
    /// "hidden here", which sends an operator looking for a physics problem that
    /// is a view setting.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? UnpinnedMarkersHiddenHere { get; set; }

    /// <summary>How many frames in total hide their unpinned markers, so the
    /// per-frame answer above can be read as one case of a habit.</summary>
    [SitrepUnit(Units.Count)]
    public int? FramesHidingUnpinnedMarkers { get; set; }

    /// <summary>As above, for celestial trajectories, in the frame now selected.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? UnpinnedCelestialsHiddenHere { get; set; }

    /// <summary>As above, the total.</summary>
    [SitrepUnit(Units.Count)]
    public int? FramesHidingUnpinnedCelestials { get; set; }

    /// <summary>The bodies pinned exempt from the two hide settings, by name.
    /// Without it those settings are unfalsifiable: a hidden marker and an exempt
    /// one look the same from outside.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? PinnedCelestials { get; set; }

    /// <summary>True when the target is pinned exempt as well.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? TargetPinned { get; set; }

    /// <summary>True when the producer is synthesising a stock-shaped manœuvre
    /// node on the player's navball from its own guidance. Our navball takes the
    /// guidance directly; reading the synthesised node would be reading our own
    /// reflection back.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ShowManoeuvreOnNavball { get; set; }

    /// <summary>True when the stability graph is drawn against the
    /// maximum-eccentricity, minimum-inclination contour family. The same curve
    /// against the wrong family reads as the opposite stability conclusion.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? StabilityGridMaxEccentricityMinInclination { get; set; }

    /// <summary>True when it is drawn against the minimum-eccentricity,
    /// maximum-inclination family.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? StabilityGridMinEccentricityMaxInclination { get; set; }

    /// <summary>True when the producer's own element graphs are shown. Ours are a
    /// widget rather than a toggle, so this is what explains an operator having
    /// history their game does not.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ShowElementGraphs { get; set; }

    // ---- Diagnostic ----

    /// <summary>The producer's verbose logging level, 0 to 4.</summary>
    [SitrepUnit(Units.Count)]
    public int? VerboseLevel { get; set; }

    /// <summary>The severity at or above which a message is written to the log
    /// file. Three sinks, three independent thresholds, three settings.</summary>
    [SitrepUnit(Units.Count)]
    public int? LogThreshold { get; set; }

    /// <summary>The severity at or above which a message also reaches stderr.</summary>
    [SitrepUnit(Units.Count)]
    public int? StderrThreshold { get; set; }

    /// <summary>The severity above which the log is flushed rather than buffered.</summary>
    [SitrepUnit(Units.Count)]
    public int? FlushThreshold { get; set; }

    /// <summary>True when the operator has ASKED for a journal. It takes effect
    /// on the next load, so it is deliberately not the same fact as
    /// <see cref="Journaling"/>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? RecordJournalRequested { get; set; }

    /// <summary>True when a recorder is ACTUALLY running. This is the state that
    /// stops us reading, precisely because it is the actual one: gating on the
    /// requested flag instead would stop us a session early and then fail to stop
    /// us at all in the case that matters.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Journaling { get; set; }
}
