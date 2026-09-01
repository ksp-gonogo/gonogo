#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoPrincipiaUplink;

/// <summary>
/// The <c>principia.plan</c> channel: the selected flight plan as the PLUGIN
/// answers it, this tick, complete enough to tune a burn against.
///
/// <para><b>This channel used to have a twin, and the twin is gone.</b>
/// <c>principia.flightPlan</c> mirrored the producer's own planner WINDOW, and
/// the fields it read refresh only while that window renders. So it answered
/// only when the player happened to have that panel open, which is not a
/// property a telemetry channel may have, whatever its doc comment says. It was
/// deleted rather than reduced: a channel whose availability is the player's
/// panel state is still that channel with fewer fields on it.</para>
///
/// <para>Everything it carried is here. The burn shape was already a strict
/// superset, and its five remaining facts now come from the plugin: the
/// integration status below, and <see cref="FirstFutureBurnIndex"/>. Its sixth,
/// a first-error burn index, is NOT here and is not a loss: the window's field
/// held the index of the control the player last edited when an error came back,
/// cleared on the next render. It described an interaction, not a plan, and the
/// plan-level fact a client wants is <see cref="AnomalousBurnCount"/>.</para>
///
/// <para><b>Absence is not silence here either.</b> No sample at all means no
/// plugin, no vessel or no session. <see cref="PlanExists"/> false is a positive
/// observation that the vessel holds no plan.</para>
///
/// <para><c>DelayRole.Delayed</c>: a per-vessel telemetry fact, subject to the
/// reveal-gate like the plan mirror beside it.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("principia.plan")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaPlan
{
    /// <summary>The vessel this plan belongs to, as the guid string.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>When the plugin was asked. Equal to the sample's own instant,
    /// unlike the window mirror's observation stamp.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SampledAtUt { get; set; }

    /// <summary>True when the vessel holds a plan. False is a positive
    /// observation of none.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PlanExists { get; set; }

    /// <summary>
    /// Whether an edit can be dispatched at all, and if not, why.
    ///
    /// <para>This is the field a control surface renders itself from. A console
    /// that offers an editor and then refuses every edit has told the operator
    /// nothing until they tried; the state belongs beside the numbers being
    /// edited.</para>
    /// </summary>
    public PrincipiaWriteSurface? WriteSurface { get; set; }

    /// <summary>How many plans the vessel holds, up to the producer's ten.</summary>
    [SitrepUnit(Units.Count)]
    public int? PlanCount { get; set; }

    /// <summary>Which plan is selected, from zero; <b>minus one means none</b>.
    /// Every number below belongs to whichever this names.</summary>
    [SitrepUnit(Units.Count)]
    public int? SelectedPlan { get; set; }

    /// <summary>Where the plan begins.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? InitialTimeUt { get; set; }

    /// <summary>Where the plan has been asked to end.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DesiredFinalTimeUt { get; set; }

    /// <summary>How far it actually integrated. Short of the desired final time
    /// exactly when the plan is in trouble.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ActualFinalTimeUt { get; set; }

    /// <summary>How many burns the integrator flagged. They are the LAST n of
    /// <see cref="Burns"/>, and each carries its own flag so no client repeats
    /// that rule.</summary>
    [SitrepUnit(Units.Count)]
    public int? AnomalousBurnCount { get; set; }

    /// <summary>
    /// Whether the plan integrated: true observed OK, false observed failed,
    /// <b>null when the status could not be read at all</b>.
    ///
    /// <para>The third state is the point. Collapsing an unreadable status into
    /// "integrated" would report health from a failed read, and a plan whose
    /// status we cannot see is a plan we cannot vouch for.</para>
    ///
    /// <para>The plugin's own answer for the PLAN, asked each tick. Its planner
    /// window keeps a different thing under a similar name: the status of the
    /// last edit the player made in that panel, which it clears once it has
    /// shown it.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? PlanIntegrated { get; set; }

    /// <summary>The integrator's own error code, when
    /// <see cref="PlanIntegrated"/> is false. Passed through rather than mapped:
    /// the codes are the producer's vocabulary.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? StatusError { get; set; }

    /// <summary>The integrator's own message for a failed plan, passed through
    /// as it stands. The producer's window composes localised prose on top of
    /// this; the raw message is what travels.</summary>
    [SitrepUnit(Units.Text)]
    public string? StatusMessage { get; set; }

    /// <summary>
    /// True when the integrator hit its time limit before reaching the desired
    /// final time. The remedy is a larger step budget or a nearer end, and
    /// <see cref="Integrator"/> carries the budget.
    ///
    /// <para>One of the producer's error codes rather than a separate flag on its
    /// side, so this is <see cref="StatusError"/> read through the producer's own
    /// predicate rather than compared against a number here.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? ReachedDeadline { get; set; }

    /// <summary>
    /// Index into <see cref="Burns"/> of the next burn still ahead of the sample
    /// instant, or absent when every burn is behind it.
    ///
    /// <para>Derivable from the burns' own cutoffs and published anyway, because
    /// it is the rule the producer's own panel applies and no two clients should
    /// have to agree on it independently.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? FirstFutureBurnIndex { get; set; }

    /// <summary>
    /// True when the producer's own optimiser is mid-run on this plan.
    ///
    /// <para>Not informational. A running optimiser publishes a fresh candidate
    /// plan periodically and the producer's planner window swaps it over the
    /// live one every frame, which discards an in-place edit wholesale and
    /// reports nothing. An edit dispatched while this is true is refused rather
    /// than raced.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? OptimisationRunning { get; set; }

    /// <summary>The integrator bounds this plan is being solved to, and the
    /// remedy for the commonest reason a plan will not draw.</summary>
    public PrincipiaPlanIntegrator? Integrator { get; set; }

    /// <summary>The committed burns, in plan order.</summary>
    public PrincipiaPlannedBurn[]? Burns { get; set; }
}

/// <summary>
/// Whether the plan can be edited from here, and what is standing in the way.
///
/// <para>Three states rather than a boolean, because "not yet armed" and "this
/// producer build was never analysed for writes" want completely different
/// things from an operator: one is a click, the other is a version.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaWriteSurface
{
    /// <summary>True when the surface could be armed: the producer's build is
    /// one whose write entry points were analysed, and a plan is there to
    /// edit.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Available { get; set; }

    /// <summary>True when the operator has armed it, so an edit will actually be
    /// attempted.
    ///
    /// <para><b>NOT the same as "everything was verified", which is what it used to
    /// be read as.</b> Arming is allowed on a PARTIAL verification, because the two
    /// structs fail independently and the step-limit remedy should survive a burn
    /// probe that could not run. The two flags below say which was established, and
    /// they are on the wire because a gate may legitimately pass on partial
    /// verification and may not report that as full verification.</para></summary>
    [SitrepUnit(Units.Flag)]
    public bool? Armed { get; set; }

    /// <summary>
    /// Whether a BURN was actually round-tripped through the plugin and came back
    /// unchanged.
    ///
    /// <para>False beside <see cref="Armed"/> true is a real and reachable state,
    /// and the one this field exists for: a plan holding no burns has none to
    /// round-trip, so the burn struct's shape stands undemonstrated while the
    /// integrator's is proven and the surface arms on that. Before this was
    /// published, such an arm answered a plain "armed" and an operator had no way to
    /// know that the check covering the edit they were about to make had never
    /// run.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? BurnLayoutVerified { get; set; }

    /// <summary>
    /// Whether the integrator's step parameters were round-tripped and came back
    /// unchanged. Its own verdict, because a plan with no burns can still have its
    /// step limit raised, which is the commonest remedy for the plan most likely to
    /// have no burns drawn.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IntegratorLayoutVerified { get; set; }

    /// <summary>Why the surface is unavailable or unarmed, in a sentence an
    /// operator can act on. Null only when <see cref="Armed"/> is true.</summary>
    [SitrepUnit(Units.Text)]
    public string? Reason { get; set; }

    /// <summary>
    /// The producer build the write entry points were read against, and the one
    /// this surface will arm for. Carried so a mismatch can be reported as a
    /// mismatch rather than as a vague refusal.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? AnalysedVersion { get; set; }

    /// <summary>The build actually found. Equal to
    /// <see cref="AnalysedVersion"/> when the gate opened.</summary>
    [SitrepUnit(Units.Text)]
    public string? DetectedVersion { get; set; }
}

/// <summary>
/// The bounds the flight plan's own integration runs to, as the plugin holds
/// them.
///
/// <para>The two integrator KINDS travel even though nothing sane changes them,
/// because they are the field where a change is unlogged: they are drawn from
/// disjoint sets over different equations, and handing the plugin the wrong one
/// aborts the game with no message. Publishing them is what lets a client see
/// that the pair it is about to write back is the pair it read.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaPlanIntegrator
{
    /// <summary>Step limit per segment. The remedy when a plan stops short.</summary>
    [SitrepUnit(Units.Count)]
    public double? MaxSteps { get; set; }

    /// <summary>Position tolerance.</summary>
    [SitrepUnit(Units.Metres)]
    public double? LengthToleranceMetres { get; set; }

    /// <summary>Speed tolerance.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? SpeedToleranceMetresPerSecond { get; set; }

    /// <summary>The integrator kind, as the producer's own enum value.</summary>
    [SitrepUnit(Units.Enumeration)]
    public double? IntegratorKind { get; set; }

    /// <summary>The generalized integrator kind, from a DIFFERENT set of
    /// values than <see cref="IntegratorKind"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public double? GeneralizedIntegratorKind { get; set; }
}

/// <summary>
/// One planned burn, as the plugin describes it rather than as the producer's
/// window displays it.
///
/// <para>The Δv triple is the point of this type. The window mirror carries a
/// magnitude, which is enough to read and not enough to tune: nudging Δv means
/// nudging one of three components, and which three depends on
/// <see cref="CoordinateSystem"/>.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaPlannedBurn
{
    /// <summary>Position in the plan, from zero.</summary>
    [SitrepUnit(Units.Count)]
    public int? Index { get; set; }

    /// <summary>Ignition instant. The countdown an operator needs is to THIS,
    /// never to a node: a finite burn starts here and the producer anchors its
    /// own countdown the same way.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? IgnitionUt { get; set; }

    /// <summary>Cutoff instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CutoffUt { get; set; }

    /// <summary>Burn length, an interval.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? DurationSeconds { get; set; }

    /// <summary>How long from ignition until half the Δv has been spent, which
    /// is the instant a stock-shaped node would have been placed at.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeToHalfDeltaVSeconds { get; set; }

    /// <summary>Δv magnitude, derived from the triple.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaV { get; set; }

    /// <summary>The along-track component. The producer's own word for this
    /// axis is "tangent", and it is kept: relabelling it prograde is safe, but
    /// relabelling the other two is a physics error, and a triple whose axes
    /// come from two vocabularies is worse than one that keeps the
    /// producer's.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVTangent { get; set; }

    /// <summary>The in-plane component orthogonal to the track.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVNormal { get; set; }

    /// <summary>The out-of-plane component.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVBinormal { get; set; }

    /// <summary>Which coordinate system the triple is expressed in, as the
    /// producer's own enum ordinal. One of its four values is Cartesian and the
    /// other three are spherical, and the components above are only the whole
    /// story for the Cartesian one.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? CoordinateSystem { get; set; }

    /// <summary>True when the burn holds a fixed inertial attitude instead of
    /// tracking its frame. A direction locked to the stars behaves differently
    /// from one that rotates with the orbit, and that difference is the whole
    /// point of the setting.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? InertiallyFixed { get; set; }

    /// <summary>Thrust the plan assumes.</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? ThrustKilonewtons { get; set; }

    /// <summary>Specific impulse the plan assumes, at standard gravity.</summary>
    [SitrepUnit(Units.SpecificImpulse)]
    public double? SpecificImpulseSeconds { get; set; }

    /// <summary>Vessel mass at ignition.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? InitialMassTons { get; set; }

    /// <summary>Vessel mass at cutoff.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? FinalMassTons { get; set; }

    /// <summary>Propellant consumption while the burn runs. Part of the planned
    /// profile rather than a curiosity: the plan integrates the burn, so a stage
    /// or engine change moves the trajectory.</summary>
    [SitrepUnit(Units.KilogramsPerSecond)]
    public double? MassFlowKilogramsPerSecond { get; set; }

    /// <summary>The burn's own manœuvring frame, as the producer's frame-type
    /// enum value. Independent of the plotting frame, and routinely
    /// different.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? FrameType { get; set; }

    /// <summary>
    /// The body the burn's frame is centred on, when its kind has one. The two
    /// rotating kinds are declined with a PAIR instead and leave this null.
    ///
    /// <para>Here rather than joined from
    /// <see cref="PrincipiaSettings.BurnFrames"/>, which carries the same frames
    /// as a bare list: a client holding a burn would have to find its frame in
    /// that list by POSITION, and the position is not the burn's. A manoeuvre
    /// whose frame cannot be read is dropped from that list rather than held open
    /// in it, which shifts every entry after it, so an index join is silently
    /// wrong exactly when a frame fails to read. Read off the same descriptor
    /// <see cref="FrameType"/> is, in the same native frame on the same
    /// tick.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? CentreBody { get; set; }

    /// <summary>The body a rotating frame turns about: the parent of
    /// <see cref="SecondaryBody"/>. Null for the centred kinds.</summary>
    [SitrepUnit(Units.Text)]
    public string? PrimaryBody { get; set; }

    /// <summary>The body a rotating frame is anchored to. Null for the centred
    /// kinds.</summary>
    [SitrepUnit(Units.Text)]
    public string? SecondaryBody { get; set; }

    /// <summary>Every body on the primary side, of which <see cref="PrimaryBody"/>
    /// is the first. Carried for the same reason
    /// <see cref="PrincipiaReferenceFrame.PrimaryBodies"/> is: a pulsating frame
    /// turns about a pair of SETS, and the head alone is a name a reader
    /// recognises with the rest of the defining mass missing.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? PrimaryBodies { get; set; }

    /// <summary>Every body on the secondary side, of which
    /// <see cref="SecondaryBody"/> is the first.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? SecondaryBodies { get; set; }

    /// <summary>
    /// True when this burn's frame is one an edit may be sent for.
    ///
    /// <para>Two of the producer's frame kinds are not. One is constructible but
    /// no interface of its own ever produces it and it carries five constructor
    /// invariants; the other has no case at all in the producer's frame factory
    /// and reaching it aborts the game. Sending a burn back with either is a
    /// process kill, so the answer travels with the burn rather than being
    /// rediscovered per client.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? FrameEditable { get; set; }

    /// <summary>True when the burn is running right now: ignition is past and
    /// cutoff is not. The plugin permits editing it and will not warn; that
    /// guard is ours, so the fact is published.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Executing { get; set; }

    /// <summary>True when this burn is one the integrator flagged.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Anomalous { get; set; }
}

/// <summary>
/// What actually happened to a dispatched plan write. Three states, and none of
/// them is a default that reads as success.
///
/// <para><b>Zero is <see cref="Refused"/> on purpose.</b> A producer that
/// forgets to fill this field, or a consumer reading a payload from a producer
/// that never had it, lands on "we did not touch the plan", which is the safe
/// reading. A "nothing was refused" sentinel in the zero slot is what a silent
/// no-op looks like from outside, and it has already been shipped once in this
/// mod.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PrincipiaWriteOutcome
{
    /// <summary>We never called the plugin. <see cref="PrincipiaPlanWriteReceipt.Refusal"/>
    /// says which guard stopped it.</summary>
    Refused = 0,

    /// <summary>We called, and the plugin declined: the burn was singular, it
    /// did not fit between its neighbours, the final time was before the last
    /// coast, or the integration ran out of budget.
    /// <see cref="PrincipiaPlanWriteReceipt.StatusError"/> carries the
    /// producer's own code.</summary>
    Rejected = 1,

    /// <summary>The plugin accepted the write. The plan state on the receipt is
    /// what it looks like AFTER, re-read rather than assumed.</summary>
    Written = 2,
}

/// <summary>
/// Which guard refused a plan write.
///
/// <para><b>Zero is the closed answer</b>, for the reason
/// <see cref="PrincipiaWriteOutcome.Refused"/> is: an unset field means "the
/// surface is not available", never "nothing was wrong".</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PrincipiaWriteRefusal
{
    /// <summary>No plugin, no session, or a producer build whose write entry
    /// points were never analysed. Writes fail closed to read-only.</summary>
    SurfaceUnavailable = 0,

    /// <summary>Nothing refused it: this write was attempted. Only ever paired
    /// with <see cref="PrincipiaWriteOutcome.Rejected"/> or
    /// <see cref="PrincipiaWriteOutcome.Written"/>.</summary>
    NotRefused = 1,

    /// <summary>The surface was not armed. Every plan write changes the
    /// player's saved game and re-integrates on the game's own thread, so it
    /// takes a deliberate arm first.</summary>
    NotArmed = 2,

    /// <summary>The struct this write passes to the plugin failed its
    /// round-trip probe, or the probe has not run. The producer's own structs
    /// are generated from a schema that changed in the shipped release, and a
    /// stale shape does not fail to resolve: it writes a plausible wrong burn
    /// into the save.</summary>
    LayoutUnverified = 3,

    /// <summary>The plugin no longer knows this vessel.</summary>
    VesselUnknown = 4,

    /// <summary>The vessel holds no flight plan to edit.</summary>
    NoFlightPlan = 5,

    /// <summary>A plan already exists and this write would have created a
    /// second without being asked to.</summary>
    PlanAlreadyExists = 6,

    /// <summary>The vessel already holds the producer's maximum of ten plans.
    /// An eleventh makes the producer's own planner window throw on every
    /// layout pass, permanently, with the button that would delete it inside the
    /// part that stopped rendering.</summary>
    PlanSlotsFull = 7,

    /// <summary>The burn index was outside the count read in the same
    /// frame.</summary>
    BurnIndexOutOfRange = 8,

    /// <summary>The burn is running right now. The plugin permits this and only
    /// the rebase entry point checks, so the guard is ours.</summary>
    BurnExecuting = 9,

    /// <summary>The burn's manœuvring frame is one the producer's frame factory
    /// does not handle, so sending the burn back would abort the game.</summary>
    BurnFrameUnsupported = 10,

    /// <summary>An optimisation is running on this plan and would revert the
    /// edit without reporting it.</summary>
    OptimisationRunning = 11,

    /// <summary>A requested value was not finite, or a Δv triple would have
    /// been.</summary>
    ValueNotFinite = 12,

    /// <summary>Thrust is not positive. A zero-thrust burn has infinite
    /// duration, which the producer's own singularity test does not catch: it
    /// pushes the plan's end instant to infinity, spawns a thread that never
    /// terminates, and serialises the infinity into the save.</summary>
    ThrustNotPositive = 13,

    /// <summary>The integrator kinds read back from the plugin were not the
    /// pair this build expects, so writing them back could abort with no
    /// message.</summary>
    IntegratorKindUnexpected = 14,

    /// <summary>A requested integrator bound was outside the range the
    /// producer's own controls offer.</summary>
    IntegratorBoundsExceeded = 15,

    /// <summary>A plan cannot be created ending before it starts.</summary>
    FinalTimeInPast = 16,

    /// <summary>A field this write must set was not found on the producer's own
    /// struct, so its shape is not the shape that was analysed.</summary>
    PluginShapeChanged = 18,

    /// <summary>The ignition instant this write asked for had already passed by
    /// the time the write arrived. Distinct from
    /// <see cref="FinalTimeInPast"/>, which is about a plan's END and only
    /// reachable while creating one.
    ///
    /// <para>Reached under signal delay with nothing done wrong at either end: an
    /// instant comfortably ahead when the operator pressed can be behind by the
    /// time the command lands. Writing it anyway asks the plugin to integrate a
    /// burn that never happened, and the receipt would read
    /// <see cref="PrincipiaWriteOutcome.Written"/>.</para></summary>
    IgnitionInPast = 19,

    /// <summary>
    /// A composed plan that cannot be read as one: no burn list where a list was
    /// required, a burn missing from the middle, more burns than a single command may
    /// install, ignitions out of time order, or an end that falls before the last
    /// burn.
    ///
    /// <para>Separate from <see cref="ValueNotFinite"/>, which is one number being
    /// unusable. This is the SHAPE being wrong, and it refuses the whole plan rather
    /// than one burn of it, because a plan half-installed is a trajectory nobody
    /// composed.</para>
    /// </summary>
    PlanMalformed = 20,

    /// <summary>
    /// A burn with no manœuvre ahead of it was asked for without the instant it
    /// lights.
    ///
    /// <para>Everywhere else an absent instant means "leave it where it is", which
    /// refers to the burn being changed. A burn with nothing ahead of it has no
    /// instant to be left at, so the one value it cannot derive has to be
    /// stated.</para>
    /// </summary>
    ComposedBurnIncomplete = 21,
}

/// <summary>
/// What a plan write did, as a separate artefact from the request.
///
/// <para><b>Why the plan is re-read rather than assumed.</b> Replacing the last
/// burn can move the plan's end instant; so can the integration that follows any
/// write; a rebase silently drops manœuvres that no longer fit and still reports
/// success. So the honest answer to "what did my edit do" is a fresh reading,
/// taken in the same frame as the write, and that is what this carries.</para>
///
/// <para><b>A refusal and a no-op are different facts.</b>
/// <see cref="Outcome"/> separates "we never called" from "we called and it
/// declined" from "it landed", and <see cref="Refusal"/> names the guard in the
/// first case. Nothing here can render as a quiet success.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaPlanWriteReceipt
{
    /// <summary>The request this answers, echoed back so a client can pair a
    /// receipt with the edit it sent instead of with the edit it sent next.</summary>
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>True when this receipt is a replay of an earlier identical
    /// request rather than a fresh write. A plan write re-integrates
    /// synchronously, so repeating one on a retry is expensive as well as
    /// wrong.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Replayed { get; set; }

    /// <summary>Refused, rejected or written. Never a success by default.</summary>
    public PrincipiaWriteOutcome Outcome { get; set; } = PrincipiaWriteOutcome.Refused;

    /// <summary>Which guard refused it.</summary>
    public PrincipiaWriteRefusal Refusal { get; set; } = PrincipiaWriteRefusal.SurfaceUnavailable;

    /// <summary>The refusal in a sentence, with the numbers that caused it.</summary>
    [SitrepUnit(Units.Text)]
    public string? RefusalDetail { get; set; }

    /// <summary>The producer's own status code when it declined. Zero when it
    /// accepted; null when we never called.</summary>
    [SitrepUnit(Units.Enumeration)]
    public int? StatusError { get; set; }

    /// <summary>The producer's own message for a declined write, passed through
    /// rather than reworded: it names conditions we do not model.</summary>
    [SitrepUnit(Units.Text)]
    public string? StatusMessage { get; set; }

    /// <summary>The plan as it stands after the write, re-read in the same
    /// frame. Null when nothing was attempted.</summary>
    public PrincipiaPlan? Plan { get; set; }
}

/// <summary>
/// Args for <c>principia.plan.arm</c>: run the struct round-trip probes and,
/// if they pass, permit edits for a while.
///
/// <para>Arming is not a preference toggle. Every plan write is persisted into
/// the player's save, can move and delete stock manœuvre nodes on the flying
/// vessel, can quadruple a THIRD vessel's prediction budget, and re-integrates
/// on the game's own thread with one wait that has no timeout. That is the class
/// of consequence that put frame-setting behind an arm rather than in a settings
/// panel.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.arm", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaPlanArmArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Stable per-intent id. Reuse it on a retry of the same intent
    /// and bump it only for a new one: a repeated id replays the previous
    /// receipt instead of writing again.</summary>
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }
}

/// <summary>
/// Which propulsion profile a burn edit should carry.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PrincipiaBurnProfile
{
    /// <summary>Leave the thrust and specific impulse the plan already
    /// holds.</summary>
    Unchanged = 0,

    /// <summary>The producer's own instant-impulse preset: thrust set so the
    /// acceleration is a thousand metres per second squared at the burn's
    /// initial mass, and a specific impulse of a thousand seconds. It exists to
    /// see the shape of the resulting arc before tuning a real engine's burn,
    /// and the numbers are the producer's rather than ours.</summary>
    InstantImpulse = 1,
}

/// <summary>
/// Args for <c>principia.plan.burn.replace</c> and
/// <c>principia.plan.burn.insert</c>: tune one burn.
///
/// <para><b>Every field is optional and an omitted field means "leave it".</b>
/// The burn that reaches the plugin is the burn READ BACK from it with the
/// stated fields changed, never one assembled here. The producer's burn struct
/// is generated from a schema that changed in the release this Uplink is keyed
/// to; a round trip is layout-agnostic in a way a literal is not.</para>
///
/// <para>Insert uses the same shape: the burn at <see cref="BurnIndex"/> (or the
/// last one, when inserting past the end) is the template, and the new burn goes
/// in at <see cref="BurnIndex"/>. A plan with no burns has nothing to copy and
/// the insert is refused rather than composed.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.burn.insert", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
[SitrepCommand("principia.plan.burn.replace", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaBurnEditArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Stable per-intent id; see <see cref="PrincipiaPlanArmArgs.RequestId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>Which burn. Bounded against the count read in the same frame as
    /// the write, never against one carried from an earlier tick.</summary>
    [SitrepUnit(Units.Count)]
    public int BurnIndex { get; set; }

    /// <summary>New ignition instant. An instant, so a UT: the producer anchors
    /// a burn to its start.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? IgnitionUt { get; set; }

    /// <summary>New along-track component.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVTangent { get; set; }

    /// <summary>New in-plane component.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVNormal { get; set; }

    /// <summary>New out-of-plane component.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DeltaVBinormal { get; set; }

    /// <summary>Whether the burn holds a fixed inertial attitude.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? InertiallyFixed { get; set; }

    /// <summary>Which propulsion profile to plan against.</summary>
    public PrincipiaBurnProfile Profile { get; set; } = PrincipiaBurnProfile.Unchanged;
}

/// <summary>
/// One burn as a command centre composed it, carried inside
/// <see cref="PrincipiaPlanSendArgs"/>.
///
/// <para>Every component is stated. There is no "unchanged" here, unlike
/// <see cref="PrincipiaBurnEditArgs"/>, because a composed plan is not a delta
/// against something the sender cannot see: at a light-delayed vantage, "leave the
/// normal component as it is" refers to a value that may already have moved.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PrincipiaComposedBurn
{
    /// <summary>Ignition instant, as a UT: a burn is anchored to its start.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double IgnitionUt { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double DeltaVTangent { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double DeltaVNormal { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double DeltaVBinormal { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool InertiallyFixed { get; set; }

    public PrincipiaBurnProfile Profile { get; set; } = PrincipiaBurnProfile.Unchanged;
}

/// <summary>
/// Args for <c>principia.plan.send</c>: a whole flight plan, composed at a command
/// centre and transmitted to be instantiated aboard.
///
/// <para><b>Why this exists when per-burn edits already do.</b> Five separate burn
/// commands are five separate messages, each with its own light-time, each able to
/// arrive late, out of order or not at all. A craft that received three of them
/// would fly a plan no one composed and no one approved. One plan is one message,
/// applied whole or not at all.</para>
///
/// <para><b>The burns are transmitted, never re-derived.</b> The receiving side does
/// not re-solve toward a goal: it installs these numbers. A plan re-solved on arrival
/// would be computed against the craft's true state, which is ahead of everything the
/// operator saw, so the craft would fly something nobody at the command centre ever
/// looked at.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.send", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaPlanSendArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Stable per-intent id; see <see cref="PrincipiaPlanArmArgs.RequestId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>
    /// The view instant the plan was composed against: what the command centre could
    /// see when it decided. Recorded on the receipt so the divergence between the
    /// state that was planned against and the state that received the plan is a
    /// measurement rather than a guess.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ComposedAtViewUt { get; set; }

    /// <summary>
    /// The instant the vessel state used for planning was actually TRUE, which is at
    /// or before <see cref="ComposedAtViewUt"/>. Both are carried because they answer
    /// different questions: one is when the operator decided, the other is how old
    /// their information already was.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ObservedAtUt { get; set; }

    /// <summary>
    /// The burns, in order. An EMPTY list is a plan with no burns, which is a
    /// meaningful thing to send (it clears the plan); a NULL list is a malformed
    /// command and is refused, because the two must not be confused.
    /// </summary>
    public PrincipiaComposedBurn[]? Burns { get; set; }

    /// <summary>How far the plan is asked to run.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DesiredFinalTimeUt { get; set; }
}

/// <summary>
/// Args for <c>principia.plan.burn.remove</c>: drop one burn from the plan.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.burn.remove", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaBurnRemoveArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    [SitrepUnit(Units.Count)]
    public int BurnIndex { get; set; }
}

/// <summary>
/// Args for <c>principia.plan.horizon</c>: move where the plan is asked to end.
///
/// <para>The cheapest mutator in the family: it recomputes only the final coast.
/// It is also the one that makes later burns vanish when shortened, and a burn
/// that disappeared reads as a burn that was deleted, which is why the receipt
/// carries the burn count afterwards.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.horizon", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaPlanHorizonArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>The plan's new end instant.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DesiredFinalTimeUt { get; set; }
}

/// <summary>
/// Args for <c>principia.plan.integrator</c>: raise the step budget or loosen
/// the tolerances so a plan that stopped short can finish.
///
/// <para><b>Only three fields, and that is a safety property rather than a
/// scope choice.</b> The struct the plugin takes also carries two integrator
/// kinds, drawn from disjoint sets over different equations; swapping them is an
/// abort with no message at all. The struct is read back, these three fields are
/// changed, and it is written whole, which is exactly what the producer's own
/// controls do and the reason they do it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.integrator", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaPlanIntegratorArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>New step limit per segment, within the range the producer's own
    /// stepper offers.</summary>
    [SitrepUnit(Units.Count)]
    public double? MaxSteps { get; set; }

    /// <summary>New position tolerance.</summary>
    [SitrepUnit(Units.Metres)]
    public double? LengthToleranceMetres { get; set; }

    /// <summary>New speed tolerance.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? SpeedToleranceMetresPerSecond { get; set; }
}

/// <summary>
/// Args for <c>principia.plan.create</c>, <c>principia.plan.delete</c> and
/// <c>principia.plan.duplicate</c>: the plan slots themselves.
///
/// <para>Create is the only one that reads the two doubles. Delete and duplicate
/// act on whichever plan is selected.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("principia.plan.create", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
[SitrepCommand("principia.plan.delete", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
[SitrepCommand("principia.plan.duplicate", Payload = typeof(System.Collections.Generic.Dictionary<string, object>))]
public class PrincipiaPlanSlotArgs
{
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }

    /// <summary>Where a newly created plan should end. Must not be before now:
    /// the plugin checks that with an assertion and aborts the game rather than
    /// returning an error.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FinalTimeUt { get; set; }
}
