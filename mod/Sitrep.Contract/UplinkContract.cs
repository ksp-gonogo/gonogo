using System;
using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// How a channel's samples are delivered to a client.
    /// <see cref="LossyLatest"/> is the default: a client that falls behind
    /// receives only the freshest sample per topic. <see cref="ReliableOrdered"/>
    /// delivers every sample, in order, and never coalesces one away: kOS
    /// terminal output needs it, because a dropped keystroke is wrong in a way
    /// a dropped telemetry tick is not.
    /// </summary>
    /// <category>Channels and emission</category>
    public enum Delivery
    {
        /// <summary>Coalesced to the freshest sample per topic; an older sample not yet sent is dropped.</summary>
        LossyLatest,

        /// <summary>Every sample delivered, in the order it was published, none coalesced away.</summary>
        ReliableOrdered,
    }

    /// <summary>
    /// Whether a channel or command rides the light-time signal delay,
    /// declared per channel and per command rather than inferred from a topic
    /// name. Everything is <see cref="Delayed"/> unless it is a ground-side
    /// fact with no analogue in flight, such as <c>scansat.available</c>
    /// (whether SCANsat is installed at all), which is <see cref="TrueNow"/>.
    ///
    /// <para>One enum serves both directions, because it is one question: is
    /// this datum's subject aboard a craft across the gap, or here on the
    /// ground. A channel declares it on <see cref="ChannelDeclaration.Delay"/>
    /// and a command on <see cref="SitrepCommandAttribute.Delay"/>, and the
    /// same subject gets the same value both ways round: <c>time.warp</c> is a
    /// <see cref="TrueNow"/> channel and <c>time.setWarpIndex</c> a
    /// <see cref="TrueNow"/> command, and the <c>alarm.scet.*</c> channels and
    /// the commands that set those alarms likewise.</para>
    /// </summary>
    /// <category>Channels and emission</category>
    public enum DelayRole
    {
        /// <summary>Delivered after the one-way light-time between the subject and the command centre, and withheld while the subject is out of contact.</summary>
        Delayed,

        /// <summary>Delivered immediately, bypassing the signal delay and any loss of contact.</summary>
        TrueNow,
    }

    /// <summary>
    /// One channel an Uplink declares in its <see cref="UplinkManifest"/>. The
    /// declaration, not the call that registers the channel's source, is what
    /// sets its <see cref="Delivery"/>, <see cref="Emission"/> and
    /// <see cref="Delay"/>, and a source registered for a topic with no
    /// declaration is refused.
    /// <internal>
    /// ChannelEngine.AddChannelSource looks the declaration up by Topic when
    /// the Uplink calls it during Register.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
    public sealed class ChannelDeclaration
    {
        /// <summary>
        /// The channel's topic id, such as <c>vessel.flight</c>. For a template
        /// passed to <see cref="IUplinkHost.RegisterDynamicNamespace"/> this is
        /// ignored: every concrete topic under the namespace gets its own.
        /// </summary>
        public string Topic { get; set; } = "";

        /// <summary>
        /// How the channel's samples reach a client. Defaults to
        /// <see cref="Delivery.LossyLatest"/>.
        /// </summary>
        public Delivery Delivery { get; set; } = Delivery.LossyLatest;

        /// <summary>
        /// When the engine puts a sample for this channel on the wire: its
        /// cadence, deadband and keyframe rules. Required: there is no default,
        /// so every declaration must set one.
        /// </summary>
        public EmissionPolicy Emission { get; set; } = null!;

        /// <summary>
        /// Whether this channel rides the light-time signal delay. Defaults to
        /// <see cref="DelayRole.Delayed"/>, the same default a command takes on
        /// <see cref="SitrepCommandAttribute.Delay"/>. Set it explicitly on every
        /// declaration, so the disposition can be read off the declaration
        /// rather than inferred from the default.
        /// </summary>
        public DelayRole Delay { get; set; } = DelayRole.Delayed;
        /// <summary>
        /// What this save must have unlocked before the channel can carry
        /// anything: the same requirement descriptors a command declares,
        /// resolved by the same evaluators, and published per channel on
        /// <c>system.uplink.gates</c>, so a client can name the missing tech or
        /// building instead of drawing an empty value.
        ///
        /// <para>State it on every declaration, <see cref="Requirement.None"/>
        /// for a channel nothing in the game gates. Most channels are honestly
        /// ungated, and an explicit None is what shows that was decided rather
        /// than forgotten.</para>
        ///
        /// <para>A channel's requirement is evaluated with no arguments, so it
        /// may not declare <see cref="CommandRequirement.Needs"/>.</para>
        /// <internal>
        /// Null is read as None, so an Uplink built against an older Minor
        /// loads unchanged; core's own declarations are held to stating it by
        /// ChannelRequiresDeclaredTests.
        /// </internal>
        /// </summary>
        public CommandRequirement[]? Requires { get; set; }

        /// <summary>
        /// Opt-in for a channel that is legitimately empty from its very first
        /// tick (<c>vessel.target</c> with no target selected, <c>vessel.dock</c>
        /// with no docking port aligned, <c>vessel.crew</c> with no crew
        /// aboard): a real, present subject whose value can simply be null, as
        /// opposed to "no subject yet" (the main menu, or before the flight
        /// scene is ready).
        ///
        /// <para>With the default <c>false</c>, a null from a channel that has
        /// never emitted a real value is not sent, so the client never learns
        /// the channel is empty and keeps waiting for its first value. Set
        /// <c>true</c>, the first null is sent as a confirmed-empty sample (a
        /// null payload), so the client can show that there is no data rather
        /// than that it is still waiting.</para>
        /// </summary>
        public bool AbsenceIsData { get; set; } = false;

        /// <summary>
        /// The opposite reading of the same null, for a channel whose subject
        /// keeps existing while the game stops being able to REPORT it: a null
        /// mapper result means "no reading available", never "confirmed
        /// nothing", so the engine emits neither a value nor a tombstone and the
        /// channel simply goes quiet.
        ///
        /// <para>The client reads that silence as a held value: missed
        /// keyframes move the topic's <c>Reading</c> to the state that carries
        /// the last real observation and the UT it was made at, and a
        /// subscriber that connects during the silence is served that same last
        /// sample stamped <see cref="Staleness.Held"/>. A confirmed-empty
        /// sample would instead assert that the subject has no value, which for
        /// <c>career.facilities</c> means telling an operator in orbit that the
        /// space centre they built has no buildings.</para>
        ///
        /// <para>Contradicts <see cref="AbsenceIsData"/>, which says a null is a
        /// real absence worth announcing. If both are set this one wins,
        /// because a channel that cannot be read has nothing to announce.
        /// Defaults to <c>false</c>.</para>
        /// </summary>
        public bool NullIsUnreadable { get; set; } = false;

        /// <summary>
        /// Opt in to the BINARY LANE (<see cref="BinaryLane"/>): this channel's
        /// payload is opaque bytes, and the engine puts it on the wire as a
        /// <see cref="StreamBinary"/> frame instead of JSON-encoding it into a
        /// <c>stream-data</c> envelope.
        ///
        /// <para>The mapper must then return either a single <c>byte[]</c> or an
        /// ordered collection of them (the batch form, and the one to prefer:
        /// the per-frame envelope is what costs, not the bytes). Anything else
        /// disables the owning Uplink the same way an unserializable JSON
        /// payload does.</para>
        ///
        /// <para><b>Declared, never inferred.</b> Nothing inspects the
        /// payload's CLR type to decide this, and nothing reads the topic name:
        /// a <c>byte[]</c> is an ordinary thing for a JSON channel to publish as
        /// a number array. The binary lane is used only when this is set.</para>
        ///
        /// <para>Defaults to <c>false</c>, the JSON envelope.</para>
        /// </summary>
        public bool OpaquePayload { get; set; } = false;

        /// <summary>
        /// Opt-in predicate for a <see cref="Delivery.ReliableOrdered"/>
        /// channel whose samples are a diff stream relative to earlier samples
        /// (the kOS terminal's full-repaint-or-incremental-diff frames) rather
        /// than a sequence of independently meaningful events
        /// (<c>crash.lastCrash</c>). Return <c>true</c> for a sample that is
        /// self-contained.
        ///
        /// <para>When set, a late or returning subscriber's catch-up is the last
        /// delivered sample this predicate accepted, rather than whatever is
        /// latest, which for a diff stream could be a bare diff with no baseline
        /// to apply it to. Null (the default) catches up on the latest
        /// sample.</para>
        /// <internal>
        /// ChannelEngine tracks the last sample already past the reveal gate
        /// (ChannelEngine.FlushReveal) as Courier's per-topic sticky-keyframe
        /// cache entry. Without it a reconnecting kOS terminal renders a
        /// corrupted or black screen.
        /// </internal>
        /// </summary>
        public Func<object?, bool>? IsKeyframe { get; set; }

        /// <summary>
        /// Declares that topics under this dynamic namespace are keyed by
        /// vessel, <c>&lt;prefix&gt;&lt;guid&gt;.&lt;field&gt;</c>, so each
        /// topic is delayed by its own craft's light-time. Any namespace that is
        /// per-vessel must set it.
        ///
        /// <para>The default delays every topic by the active vessel's
        /// light-time, which for anything keyed by vessel is wrong in the
        /// direction that leaks: a Munar base's payload arrives at the delay of
        /// whatever craft the player happens to be flying, usually shorter.
        /// Nothing goes missing and nothing reports an error; the value simply
        /// turns up early.</para>
        ///
        /// <para>This is the same routing <c>fleet.</c>-prefixed telemetry gets,
        /// available to any Uplink that declares it. Ignored on a static channel
        /// declaration, whose one topic is not keyed by anything.</para>
        /// <internal>
        /// Recorded under that craft's own Courier node rather than the single
        /// main node. No test that asserts a payload arrived can see the
        /// default's failure.
        /// </internal>
        /// </summary>
        public bool PerVesselNode { get; set; } = false;

        /// <summary>
        /// Turns this namespace's key segment into the id of the vessel that
        /// owns it, for a namespace whose key is NOT itself a vessel id.
        ///
        /// <para>Without this, <see cref="PerVesselNode"/> reads the segment
        /// after the prefix as a vessel id. That is right for a namespace keyed
        /// by craft and wrong for one keyed by anything else: a namespace keyed
        /// by, say, a processor id would resolve to a vessel no delay is ever
        /// measured for, a quieter failure than the wrong delay. Null keeps the
        /// segment-is-the-id reading.</para>
        ///
        /// <para>Return null for a key that cannot be placed yet, and the topic
        /// is delayed as the active craft's. Never invent an id: a vessel with no
        /// measured delay is worse than one with the wrong delay.</para>
        ///
        /// <para><b>Must not read live game state.</b> It is called off the main
        /// thread while resolving a topic, and a Unity read from there throws.
        /// Maintain a snapshot during the Uplink's own main-thread pass and have
        /// this read that.</para>
        /// </summary>
        public Func<string, string?>? VesselIdForKey { get; set; }

        /// <summary>
        /// Whether this channel's samples are held aboard the subject through a
        /// loss of signal and replayed on reacquisition, rather than discarded.
        ///
        /// <para>Defaults to <c>true</c>, following from <see cref="Delay"/>:
        /// <see cref="DelayRole.Delayed"/> already asserts the channel carries a
        /// flight-side fact that ground learns at light-time, and a flight-side
        /// fact is one the craft's own instruments produced and could have
        /// written down. A <see cref="DelayRole.TrueNow"/> channel is never
        /// withheld, so there is nothing to hold and this has no effect on
        /// it.</para>
        ///
        /// <para>Set it <c>false</c> for a <see cref="DelayRole.Delayed"/>
        /// channel whose value was never aboard: the session's warp rate, the
        /// game's calendar, a roster of every other craft in the universe.
        /// Replaying those would have the craft dump a recording of facts it
        /// could not observe. A non-recording channel is not silent about the
        /// outage: its first post-blackout sample carries <see
        /// cref="Meta.GapSinceUt"/>, so the hole is stated rather than drawn
        /// through.</para>
        /// </summary>
        public bool Recordable { get; set; } = true;

        /// <summary> Declares that this channel's value is a fact held at the
        /// home command (the career ledger, the space centre's facilities and
        /// rosters) rather than aboard a craft. Each command centre learns a
        /// change after its own delay to home: a ground centre at effectively
        /// zero over the ground network, a crewed vessel after its path home,
        /// the same seconds a currency award from that vessel waits to reach
        /// the ledger in the first place.
        ///
        /// <para>Requires <see cref="Delay"/> to be <see
        /// cref="DelayRole.Delayed"/>. A <see cref="DelayRole.TrueNow"/>
        /// channel reaches every vantage at once, which is the claim this flag
        /// exists to retract, so declaring both is a contradiction and the
        /// engine refuses the owning Uplink rather than guessing which was
        /// meant. Ignored on a dynamic namespace template: a per-vessel
        /// namespace is by definition not held at home.</para>
        ///
        /// <para>Never frozen by a blackout. The home command cannot lose
        /// contact with its own ledger, so an out-of-contact active vessel does
        /// not withhold it; a craft that cannot reach home learns nothing new
        /// until it can.</para>
        ///
        /// <para>Defaults to <c>false</c>.</para>
        /// </summary>
        public bool HeldAtHome { get; set; } = false;
    }

    /// <summary>
    /// One command an uplink declares: which id it serves, and what the engine
    /// must satisfy before the handler runs.
    ///
    /// <para>Whether the command rides the light-time delay is not declared
    /// here. It is declared once, on <see cref="SitrepCommandAttribute.Delay"/>,
    /// which is also what a client's delay display reads, so the two cannot
    /// disagree.</para>
    /// </summary>
    /// <category>Commands</category>
    public sealed class CommandDeclaration
    {
        /// <summary>
        /// The command id this declaration covers, such as
        /// <c>career.tech.unlock</c>. Required.
        /// </summary>
        public string Command { get; set; } = "";

        /// <summary>
        /// The delay disposition for a command id that carries no
        /// <c>[SitrepCommand]</c> attribute. For every attributed command the
        /// attribute decides, whatever this says, so in practice only a test
        /// double declaring an ad-hoc id has any reason to set it. Leave it
        /// unset for a real command.
        /// <internal>
        /// packages/core/src/styleguide-command-delay-single-source.test.ts
        /// fails on a manifest that restates an attributed command's
        /// disposition, because a value that looks authoritative and is not is
        /// worse to read than no value.
        /// </internal>
        /// </summary>
        public DelayRole Delay { get; set; } = DelayRole.Delayed;

        /// <summary>
        /// Preconditions the engine evaluates before the handler runs, from
        /// this declaration alone. No handler implements them and no widget
        /// checks them: the command says what it needs once. Empty (the
        /// default) means ungated.
        /// </summary>
        public CommandRequirement[] Requires { get; set; } = new CommandRequirement[0];

        /// <summary>
        /// The Topic this command's target lives on: a channel topic, or a
        /// dynamic namespace's topic with an <c>"{args.X}"</c> segment filled
        /// from the dispatch args (<c>X</c> names an args property/key, e.g.
        /// <c>"vessel.partActions.{args.PartId}"</c>). The command is delayed,
        /// blocked by loss of contact and delivered exactly as that topic's
        /// telemetry is, so it always agrees with whatever topic the operator
        /// is reading.
        ///
        /// <para>Empty (the default) only for a <see cref="DelayRole.TrueNow"/>
        /// command, which has no craft to address. Every other command must set
        /// one that resolves to a channel or namespace some Uplink declares.
        /// This is checked once every Uplink has registered, and a command
        /// whose subject does not resolve is marked unavailable rather than
        /// aimed at the active craft.</para>
        /// <internal>
        /// Resolved through ChannelEngine.NodeFor, the same node lookup a
        /// channel's telemetry uses.
        /// </internal>
        /// </summary>
        public string Subject { get; set; } = "";
    }

    /// <summary>
    /// Requirement sets for a <see cref="ChannelDeclaration.Requires"/> or a
    /// <see cref="CommandDeclaration.Requires"/>.
    /// </summary>
    /// <category>Commands</category>
    public static class Requirement
    {
        /// <summary>Nothing in the game has to be unlocked first.</summary>
        public static CommandRequirement[] None => new CommandRequirement[0];
    }

    /// <summary>
    /// One precondition on a command: WHAT is required, never how to find out.
    ///
    /// <para>A requirement is a descriptor, not a predicate: an
    /// <see cref="ICommandGateEvaluator"/> registered for its
    /// <see cref="Kind"/> resolves it against live game state.</para>
    ///
    /// <para>A client never sees a requirement; it sees the verdict derived
    /// from it, a <see cref="GateVerdict"/>.</para>
    /// <internal>
    /// Not shape-gated, same rule as CommandDeclaration and
    /// IUplinkCapabilityDeclarer: this is the Uplink-facing registration
    /// surface, not a wire type. This assembly has no KSP or Unity reference,
    /// which is why a requirement cannot be a predicate.
    /// </internal>
    /// </summary>
    /// <category>Commands</category>
    public class CommandRequirement
    {
        /// <summary>
        /// Which evaluator resolves this requirement: the
        /// <see cref="ICommandGateEvaluator.Kind"/> it is registered under. A
        /// string rather than an enum so an Uplink can declare its own kind and
        /// register its own evaluator beside its own commands.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Kind { get; set; } = "";

        /// <summary>
        /// The <c>SpaceCenterFacility</c> member name whose level sets the
        /// limit, for the facility kinds, such as <c>LaunchPad</c>. A name
        /// rather than the enum because the enum is KSP's. Empty for a kind
        /// that names no facility.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Facility { get; set; } = "";

        /// <summary>
        /// Which limit of that facility, e.g. <c>mass</c>, <c>partCount</c>,
        /// <c>activeCrew</c>. Evaluator-defined, so a new kind can name its own.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Quantity { get; set; } = "";

        /// <summary>
        /// Argument paths this requirement reads, e.g. <c>craftMass</c>. Empty
        /// means the requirement is static and can be decided with no arguments
        /// at all.
        ///
        /// <para>This is what lets one declaration serve both uses. When a
        /// declared path is absent from the arguments, the requirement abstains
        /// without its evaluator being called. Evaluated with no arguments, the
        /// static requirements decide and the argument-dependent ones abstain,
        /// which tells a client in advance whether the command can be sent at
        /// all; evaluated with the full arguments of a real call, every
        /// requirement decides, which is whether that call is refused.</para>
        /// <internal>
        /// The abstention arithmetic lives here, once, deliberately. An
        /// evaluator that implemented its own abstention could get it wrong
        /// privately, and a requirement that reports Fail rather than abstaining
        /// when it simply has no arguments yet publishes its command as
        /// permanently unaddressable, which disables the control for good and
        /// looks like it is working.
        /// </internal>
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string[] Needs { get; set; } = new string[0];
    }

    /// <summary>What a command gate concluded about one precondition: passed,
    /// failed, could not be decided from the arguments supplied, or could not
    /// be decided from the game's state.</summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsEnum]
#endif
    public enum GateOutcome
    {
        /// <summary>Nothing blocks this.</summary>
        Pass = 0,

        /// <summary>Blocked, with the comparison that says why.</summary>
        Fail = 1,

        /// <summary>
        /// Cannot be decided from the arguments supplied, because one it needs
        /// is missing. Not a refusal: a client that treats this as blocked
        /// disables every argument-dependent control permanently.
        /// </summary>
        Abstain = 2,

        /// <summary>
        /// Decidable in principle, but the live state needed is missing, e.g. a
        /// facility KSP does not track under the name declared. Distinct from
        /// <see cref="Abstain"/> because nothing further the caller supplies
        /// will resolve it, and distinct from <see cref="Pass"/> because an
        /// unreadable limit is not the same as no limit.
        /// </summary>
        Unknown = 3,
    }

    /// <summary>
    /// The comparison behind a <see cref="GateOutcome.Fail"/>: the limit and the
    /// actual value, never a verdict on its own.
    ///
    /// <para>"Too heavy" does not tell an operator whether to shed 200&#160;kg or
    /// redesign. Carrying both numbers lets the CLIENT compose "1.4 t over the
    /// 18 t Launch Pad limit" through its own unit rendering, rather than the mod
    /// baking an English sentence in one unit system.</para>
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class LimitBreach
    {
        /// <summary>
        /// The facility whose limit was exceeded, as its KSP
        /// <c>SpaceCenterFacility</c> member name (e.g. <c>LaunchPad</c>). An id
        /// for matching; show <see cref="FacilityName"/> to an operator. Empty
        /// for a limit that belongs to no facility, such as a time-warp rate.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Facility { get; set; } = "";

        /// <summary>
        /// The facility's name as the game writes it ("Astronaut Complex"), for
        /// the sentence an operator reads. Empty when no display name was
        /// available.
        ///
        /// <para>This is the only place the display name is published, so use
        /// it rather than mapping <see cref="Facility"/> to English on the
        /// client, which would be wrong in every other language and miss any
        /// facility KSP adds.</para>
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string FacilityName { get; set; } = "";

        /// <summary>Normalised facility level, as KSP reports it. Not a tier
        /// index.</summary>
        [SitrepUnit(Units.Ratio)]
        public double FacilityLevel { get; set; }

        /// <summary>
        /// Which limit was exceeded, e.g. <c>mass</c>, <c>partCount</c>,
        /// <c>activeCrew</c> or <c>warpRate</c>. For a declared gate this is the
        /// <see cref="CommandRequirement.Quantity"/> of the requirement that
        /// failed; the vocabulary is set by whoever produced the breach, so it
        /// is open-ended.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Quantity { get; set; } = "";

        /// <summary>
        /// The limit, in whatever unit <see cref="Quantity"/> implies. NULL when
        /// the facility is unlimited.
        ///
        /// <para>Never the sentinel. KSP returns <c>float.MaxValue</c> (and
        /// <c>int.MaxValue</c>, and a <c>Vector3</c> of them) at maximum level,
        /// and 3.4e38 rendered beside a craft mass is not "unlimited", it is a
        /// bug that reads as a units error. No limit is the ABSENCE of a limit.
        /// A breach with no limit should be unreachable, since nothing can
        /// exceed an unlimited limit.</para>
        /// </summary>
        [SitrepUnit(Units.NotApplicable)]
        public double? Limit { get; set; }

        /// <summary>What the call actually asked for, same unit as <see
        /// cref="Limit"/>.</summary>
        [SitrepUnit(Units.NotApplicable)]
        public double? Actual { get; set; }

        /// <summary>
        /// The unit token <see cref="Limit"/> and <see cref="Actual"/> are in,
        /// e.g. <c>t</c> for a mass limit, <c>count</c> for a part count.
        ///
        /// <para>Carried as data because one breach type serves limits with
        /// different dimensions, so <see cref="Limit"/> and <see cref="Actual"/>
        /// have no fixed unit of their own. Read it from here, and render the
        /// comparison in the operator's own units.</para>
        /// <internal>
        /// A static [SitrepUnit] on Limit and Actual could not be right for every
        /// limit, and a wrong unit is worse than a bare readout because the
        /// client will confidently mislabel it, so they declare NotApplicable.
        /// </internal>
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Unit { get; set; } = "";
    }

    /// <summary>
    /// The verdict of a command gate on one call or one command, plus its
    /// evidence: the <see cref="GateOutcome"/>, and for a refusal which refusal
    /// it is and why.
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    // AutoExportMethods=false for the same reason CommandResult sets it: the
    // static Pass/Fail/Unknown factories are C#-side ergonomics, not wire shape,
    // and without this rtcli emits them as bogus interface members on the
    // generated TS type.
    [TsInterface(AutoExportMethods = false)]
#endif
    public class GateVerdict
    {
        /// <summary>
        /// What the gate concluded. Defaults to <see cref="GateOutcome.Pass"/>.
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public GateOutcome Outcome { get; set; } = GateOutcome.Pass;

        /// <summary>
        /// Which refusal, for a <see cref="GateOutcome.Fail"/>: the same error
        /// code a command handler's own refusal carries, so one client sentence
        /// serves a declared gate and a handler that got far enough to look.
        ///
        /// <para>Set by the evaluator, because only the evaluator knows what it
        /// checked: a full pad and an un-upgraded Tracking Station are both a
        /// gate saying no, and they are not the same refusal.
        /// <see cref="CommandErrorCode.ModeUnavailable"/> is what
        /// <see cref="Fail(string)"/> names for an evaluator that says nothing
        /// more. Null on every outcome but a Fail.</para>
        ///
        /// <para>On the wire the root's id, with a refinement's own id beside it
        /// as <see cref="Reason"/>, as on <see cref="CommandResult"/>.</para>
        /// </summary>
#if SITREP_CODEGEN
        [TsProperty(Type = "CommandErrorCode", ForceNullable = true)]
#endif
        [SitrepUnit(Units.Enumeration)]
        [SitrepOmittedWhenNull]
        public RefusalCode? ErrorCode { get; set; }

        /// <summary>The refinement's id when <see cref="ErrorCode"/> is more specific than its root; absent otherwise.</summary>
        [SitrepUnit(Units.Id)]
        [SitrepOmittedWhenNull]
        public string? Reason => ErrorCode is { IsRoot: false } ? ErrorCode.Id : null;

        /// <summary>
        /// Set only for a numeric <see cref="GateOutcome.Fail"/>. Null is the
        /// shape a client keys on: an Abstain or an Unknown has nothing to
        /// compare, so it must not arrive carrying zeroes that render as a real
        /// limit of 0.
        /// </summary>
        public LimitBreach? Breach { get; set; }

        /// <summary>
        /// Why, when the outcome carries no numeric comparison: a
        /// <see cref="GateOutcome.Unknown"/>'s cause, or a discrete
        /// prerequisite's name. Prose for a human, never parsed.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string Detail { get; set; } = "";

        /// <summary>
        /// For a <see cref="CommandErrorCode.NotUnlocked"/> Fail, each unlock
        /// this save is missing: a tech node not researched, or a building
        /// below the level it needs. Absent on every other outcome, and on a
        /// refusal whose evaluator could not say which unlock it was.
        /// </summary>
        [SitrepOmittedWhenNull]
        public List<MissingUnlock>? Missing { get; set; }

        /// <summary>A verdict that nothing blocks the command.</summary>
        /// <returns>A <see cref="GateOutcome.Pass"/> verdict.</returns>
        public static GateVerdict Pass() => new GateVerdict { Outcome = GateOutcome.Pass };

        /// <summary>A numeric refusal with the
        /// <see cref="CommandErrorCode.LimitReached"/> error code.</summary>
        /// <param name="breach">The limit and the value that exceeded it.</param>
        /// <returns>A <see cref="GateOutcome.Fail"/> verdict carrying <paramref name="breach"/>.</returns>
        public static GateVerdict Fail(LimitBreach breach) =>
            Fail(CommandErrorCode.LimitReached, breach);

        /// <summary>A numeric refusal with the error code of your choice.</summary>
        /// <param name="errorCode">Which refusal this is.</param>
        /// <param name="breach">The limit and the value that exceeded it.</param>
        /// <returns>A <see cref="GateOutcome.Fail"/> verdict carrying <paramref name="breach"/>.</returns>
        public static GateVerdict Fail(RefusalCode errorCode, LimitBreach breach) =>
            new GateVerdict { Outcome = GateOutcome.Fail, ErrorCode = errorCode, Breach = breach };

        /// <summary>A refusal with no numeric comparison, such as an unmet
        /// discrete prerequisite, with the
        /// <see cref="CommandErrorCode.ModeUnavailable"/> error code.</summary>
        /// <param name="detail">Why, as prose for a human.</param>
        /// <returns>A <see cref="GateOutcome.Fail"/> verdict with no <see cref="Breach"/>.</returns>
        public static GateVerdict Fail(string detail) =>
            Fail(CommandErrorCode.ModeUnavailable, detail);

        /// <summary>A refusal with no numeric comparison and the error code of
        /// your choice.</summary>
        /// <param name="errorCode">Which refusal this is.</param>
        /// <param name="detail">Why, as prose for a human. Null reads as empty.</param>
        /// <returns>A <see cref="GateOutcome.Fail"/> verdict with no <see cref="Breach"/>.</returns>
        public static GateVerdict Fail(RefusalCode errorCode, string detail) =>
            new GateVerdict { Outcome = GateOutcome.Fail, ErrorCode = errorCode, Detail = detail ?? "" };

        /// <summary>A refusal because this save has not unlocked something yet, naming what.</summary>
        /// <param name="detail">Why, as prose for a human.</param>
        /// <param name="missing">The unlocks the save is missing.</param>
        /// <returns>A <see cref="GateOutcome.Fail"/> verdict with the <see cref="CommandErrorCode.NotUnlocked"/> error code.</returns>
        public static GateVerdict NotUnlocked(string detail, params MissingUnlock[] missing) =>
            new GateVerdict
            {
                Outcome = GateOutcome.Fail,
                ErrorCode = CommandErrorCode.NotUnlocked,
                Detail = detail ?? "",
                Missing = new List<MissingUnlock>(missing),
            };

        /// <summary>A verdict that the live state needed to decide is
        /// missing.</summary>
        /// <param name="detail">What could not be read, as prose for a human.</param>
        /// <returns>A <see cref="GateOutcome.Unknown"/> verdict.</returns>
        public static GateVerdict Unknown(string detail) =>
            new GateVerdict { Outcome = GateOutcome.Unknown, Detail = detail };
    }

    /// <summary>
    /// The arguments a gate may read, as the decoded wire bag.
    /// </summary>
    ///
    /// <remarks>
    /// Never null: when a client asks whether a command can be sent at all,
    /// the evaluator is handed an empty set of arguments, not a null.
    /// </remarks>
    /// <category>Commands</category>
    public interface IGateArguments
    {
        /// <summary>
        /// The value at <paramref name="path"/>, if the call supplied one.
        /// </summary>
        /// <param name="path">An argument path, as named in <see cref="CommandRequirement.Needs"/>.</param>
        /// <param name="value">The decoded value when present.</param>
        /// <returns><c>true</c> when the call supplied a value at <paramref name="path"/>.</returns>
        bool TryGet(string path, out object value);
    }

    /// <summary>
    /// Resolves one <see cref="CommandRequirement.Kind"/> against live game
    /// state. Implemented by Gonogo for its built-in kinds, or by an Uplink for
    /// its own, and registered through <see cref="IUplinkHost.AddGateEvaluator"/>.
    /// </summary>
    ///
    /// <remarks>
    /// <para><b>Never return <see cref="GateOutcome.Abstain"/>.</b> Abstention
    /// is decided from <see cref="CommandRequirement.Needs"/> before an
    /// evaluator is called, so an evaluator is only ever asked about a
    /// requirement whose arguments are all present.</para>
    /// </remarks>
    /// <category>Commands</category>
    public interface ICommandGateEvaluator
    {
        /// <summary>The <see cref="CommandRequirement.Kind"/> this evaluator
        /// resolves.</summary>
        string Kind { get; }

        /// <summary> Decide whether <paramref name="requirement"/> is met,
        /// reading whatever it needs out of <paramref name="arguments"/>.
        ///
        /// <para>Called only for a requirement whose <see
        /// cref="CommandRequirement.Kind"/> equals this evaluator's <see
        /// cref="Kind"/>, and only once the host has established that the
        /// arguments it names are present, so there is no "cannot decide" case
        /// and <see cref="GateOutcome.Abstain"/> is never a legal return.
        /// Throwing refuses the command and is reported as a fault in the
        /// evaluator, not in the caller's request; return a refusing
        /// <see cref="GateVerdict"/> instead.</para>
        /// </summary>
        /// <param name="requirement">The requirement to decide.</param>
        /// <param name="arguments">The call's decoded arguments; empty when a client is asking whether the command can be sent at all.</param>
        /// <returns>A <see cref="GateOutcome.Pass"/>, <see cref="GateOutcome.Fail"/> or <see cref="GateOutcome.Unknown"/> verdict.</returns>
        GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments);
    }

    /// <summary>
    /// The items an <see cref="ICommandGateEvaluator"/> can be asked about,
    /// for a requirement whose verdict depends on which one is chosen.
    /// Implemented beside <see cref="ICommandGateEvaluator"/> by an evaluator
    /// whose answer differs per item, such as a price that depends on which
    /// facility is upgraded.
    /// </summary>
    ///
    /// <remarks>
    /// <para>The gate report asks each item in turn, with the requirement's one
    /// <see cref="CommandRequirement.Needs"/> path set to the item's value, and
    /// publishes every verdict that is not a Pass on
    /// <see cref="CommandGate.Items"/>. A control then goes dark before it is
    /// pressed, with the same verdict the dispatch would return.</para>
    ///
    /// <para>Only a requirement that names exactly one need is asked. Name the
    /// items a control could plausibly offer right now (the nodes still to be
    /// researched, not the whole tree): each is evaluated on the main thread at
    /// the gate sampling interval.</para>
    /// </remarks>
    /// <category>Commands</category>
    public interface ICommandGateItems
    {
        /// <summary>The values of <paramref name="requirement"/>'s one need worth a verdict right now.</summary>
        /// <param name="requirement">The requirement whose items are wanted.</param>
        /// <returns>The item values, exactly as a call would send them. Empty when none can be named.</returns>
        IEnumerable<string> Items(CommandRequirement requirement);
    }

    /// <summary>
    /// Where an Uplink's client bundle lives, so the app learns it from the
    /// running mod rather than from a central index. Declared only by an Uplink
    /// with a client half.
    ///
    /// <para>The bundle's integrity hash is on
    /// <see cref="UplinkManifest.ExpectedClientHash"/>, not here.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public sealed class UplinkClientSource
    {
        /// <summary>
        /// The released bundle's URL, which the app fetches the client half from.
        /// Required on a declared client source.
        /// </summary>
        public string Url { get; set; } = "";

        /// <summary> A dev-server URL or local build directory to load from
        /// while iterating, so a change needs no publish to <see cref="Url"/>.
        /// <c>null</c> for a released Uplink.
        /// </summary>
        public string? DevPath { get; set; }
    }

    /// <summary>
    /// What an <see cref="ISitrepUplink"/> declares: its id, its version, who
    /// wrote it, and every channel and command it owns.
    ///
    /// <para><see cref="Channels"/> and <see cref="Commands"/> are validated at
    /// startup: a channel published or a command handled with no matching
    /// declaration is refused.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public sealed class UplinkManifest
    {
        /// <summary>The registry-unique id. Must equal the <see
        /// cref="SitrepUplinkAttribute.Id"/> on the class.</summary>
        public string Id { get; set; } = "";

        /// <summary>The Uplink's semver version, shared by its mod and client
        /// halves.</summary>
        public string Version { get; set; } = "";
        /// <summary> The Uplink's human-facing name. With <see cref="Author"/>
        /// and <see cref="Repo"/> it is emitted on <c>system.uplinks</c>, so
        /// the consent dialog can say who wrote the bundle it is asking to run.
        ///
        /// <para>Empty when not declared, which renders as absent.</para>
        /// </summary>
        public string Name { get; set; } = "";
        /// <summary>Who wrote the Uplink, shown beside <see cref="Name"/>.
        /// Empty when not declared.</summary>
        public string Author { get; set; } = "";

        /// <summary>Where the Uplink's source lives, shown beside <see
        /// cref="Name"/>. Empty when not declared.</summary>
        public string Repo { get; set; } = "";
        /// <summary>
        /// The sha256 of the client bundle this DLL was released with, as
        /// <c>sha256-&lt;hex&gt;</c>, baked at release build. <c>null</c> for a
        /// mod-only Uplink or a development build. The app refuses to import a
        /// client whose bytes do not match it.
        /// </summary>
        public string? ExpectedClientHash { get; set; }
        /// <summary> Where this Uplink's client bundle lives. <c>null</c> for a
        /// mod-only Uplink with no client half. Emitted on
        /// <c>system.uplinks.clientSource</c>.
        /// </summary>
        public UplinkClientSource? ClientSource { get; set; }

        /// <summary>Every channel this Uplink publishes.</summary>
        public IReadOnlyList<ChannelDeclaration> Channels { get; set; } = Array.Empty<ChannelDeclaration>();

        /// <summary>Every command this Uplink handles.</summary>
        public IReadOnlyList<CommandDeclaration> Commands { get; set; } = Array.Empty<CommandDeclaration>();

        /// <summary>
        /// Every refusal refinement this Uplink's commands may answer with, read
        /// off its holder class by <see cref="ErrorCodeCatalog.Of"/> so nothing
        /// is listed twice.
        ///
        /// <para>Each id must begin with this Uplink's <see cref="Id"/>. The host
        /// drops the whole set when one does not, and a result naming a
        /// refinement missing from it is sent as that refinement's root. Emitted
        /// on <c>system.uplinks</c> with each code's sentence, so a client that
        /// never loaded this Uplink's bundle can still say it.</para>
        /// </summary>
        public IReadOnlyList<RefusalCode> ErrorCodes { get; set; } = Array.Empty<RefusalCode>();
    }

    /// <summary> Whether one registered Uplink is usable. An Uplink that throws
    /// during <see cref="ISitrepUplink.Register"/>, or reports itself
    /// unavailable through <see cref="IUplinkHost.SetAvailability"/>, is marked
    /// unavailable and every other Uplink is unaffected.
    /// </summary>
    /// <category>Uplink API</category>
    public readonly struct Availability
    {
        /// <summary>Whether the Uplink is usable.</summary>
        public bool IsAvailable { get; }

        /// <summary>Why it is not, in the operator's terms; null when
        /// available.</summary>
        public string? Reason { get; }

        private Availability(bool isAvailable, string? reason)
        {
            IsAvailable = isAvailable;
            Reason = reason;
        }

        /// <summary>The usable state.</summary>
        public static readonly Availability Available = new Availability(true, null);

        /// <summary>The unusable state, with its reason.</summary>
        /// <param name="reason">Why, in the operator's terms, e.g. the mod it integrates is not installed.</param>
        public static Availability Unavailable(string reason) => new Availability(false, reason);
    }

    /// <summary>
    /// Adds an Uplink's own data to the <see cref="KspSnapshot"/> each sample
    /// tick, for data that is not already on the snapshot. Registered via
    /// <see cref="IUplinkHost.AddSampler"/>.
    /// </summary>
    /// <category>Channels and emission</category>
    public interface ISnapshotSampler
    {
        /// <summary> Add this Uplink's data to <paramref name="snapshot"/>, in
        /// place, once per tick, before any channel source reads it.
        ///
        /// <para>Called on the main thread, so it may touch the game. It must
        /// not REMOVE or overwrite a key another sampler put there: samplers
        /// run in an order nobody controls, so a sampler that takes something
        /// away produces a snapshot whose contents depend on registration
        /// order.</para>
        /// </summary>
        void Sample(KspSnapshot snapshot);
    }

    /// <summary>
    /// Push-style publisher for an event-driven channel source (kOS callbacks,
    /// KSP <c>GameEvents</c>): the counterpart to the pull-style
    /// <see cref="IUplinkHost.AddChannelSource"/> mapper. Obtained from
    /// <see cref="IUplinkHost.Publisher"/> or
    /// <see cref="IDynamicChannelSource.Publisher"/>.
    /// </summary>
    /// <category>Channels and emission</category>
    public interface IChannelPublisher
    {
        /// <summary>
        /// Offer <paramref name="payload"/> as this topic's value at
        /// <paramref name="ut"/> (UT seconds).
        ///
        /// <para>Offer, not send: a value equal to the last one published puts
        /// nothing new on the wire. Call it from the main thread only. A
        /// <c>null</c> payload is a legitimate value, meaning the source has
        /// nothing right now, and is not a way to withdraw an earlier
        /// one.</para>
        /// </summary>
        /// <param name="payload">The topic's new value, or <c>null</c> for nothing.</param>
        /// <param name="ut">The universal time the value was observed at, in seconds.</param>
        void Publish(object? payload, double ut);
    }

    /// <summary>
    /// A registered dynamic namespace, returned by
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>: publishes to topics
    /// computed at runtime under a declared prefix (<c>scansat.coverage.</c>
    /// plus <c>Kerbin.AltimetryLoRes</c> is
    /// <c>scansat.coverage.Kerbin.AltimetryLoRes</c>).
    ///
    /// <para>Each concrete topic behaves exactly as though it had been
    /// declared as an ordinary <see cref="ChannelDeclaration"/> cloned from the
    /// namespace's template, with its own change-gating and keyframe state,
    /// from the first time it is published or subscribed. A client subscribes
    /// to a concrete dynamic topic exactly as it would to a fixed one.</para>
    /// </summary>
    /// <category>Channels and emission</category>
    public interface IDynamicChannelSource
    {
        /// <summary>Publisher for one concrete topic, <c>prefix +
        /// subTopic</c>, under this dynamic namespace.</summary>
        /// <param name="subTopic">The part of the topic after the namespace's prefix.</param>
        /// <returns>The publisher for that topic.</returns>
        IChannelPublisher Publisher(string subTopic);

        /// <summary>
        /// Registers <paramref name="callback"/> to run every time a client
        /// subscribes to any concrete topic under this namespace's prefix,
        /// once per subscribing client, whether or not the topic already had
        /// subscribers. Use it to react to a specific viewer arriving, such as
        /// sending a fresh terminal viewer a full repaint, rather than polling
        /// a subscriber count.
        ///
        /// <para>Call only during the owning Uplink's
        /// <see cref="ISitrepUplink.Register"/>, as with
        /// <see cref="IUplinkHost.AddSampler"/> and
        /// <see cref="IUplinkHost.AddChannelSource"/>. The callback runs off the
        /// main thread and must not touch the game. An exception it throws is
        /// caught and logged, and that invocation does nothing.</para>
        /// <internal>
        /// Runs on the Courier thread, one call per ProcessSubscribe. It
        /// deliberately does not expose the engine's Courier-thread-only
        /// _subscriptions registry, which its caller must never read.
        /// </internal>
        /// </summary>
        /// <param name="callback">Called with the full concrete topic that was subscribed.</param>
        void OnSubscribed(Action<string> callback);
    }

    /// <summary>
    /// What Gonogo hands an <see cref="ISitrepUplink"/> during
    /// <see cref="ISitrepUplink.Register"/>. An Uplink registers its pieces
    /// here and never touches the transport, the signal delay or threading
    /// directly: the engine runs everything registered through this
    /// interface.
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface IUplinkHost
    {
        /// <summary>
        /// The game's current universal time, in seconds.
        ///
        /// <para>Ask the host rather than the game directly: this is the same
        /// clock every sample and every command on this tick is stamped with,
        /// so a payload built from it agrees with the one beside it. It moves
        /// under warp, and it jumps backwards on a load.</para>
        /// </summary>
        double NowUt();

        /// <summary>Contribute a sampler that adds to the snapshot every
        /// channel source reads each tick. See <see
        /// cref="ISnapshotSampler"/>.</summary>
        /// <param name="sampler">The sampler to run each tick.</param>
        void AddSampler(ISnapshotSampler sampler);

        /// <summary>
        /// Pull-style channel source: a mapper from the tick's snapshot to the
        /// topic's typed payload, for a topic the calling Uplink declared in its
        /// <see cref="UplinkManifest.Channels"/>. The engine runs it each tick,
        /// change-gates the result and delivers it. The mapper runs off the main
        /// thread and must not touch the game; read everything from the
        /// snapshot.
        /// <internal>
        /// Same shape as SystemViewProvider.BuildSystemBodies; the result is
        /// recorded into the Courier.
        /// </internal>
        /// </summary>
        /// <param name="topic">The declared topic.</param>
        /// <param name="map">Snapshot to payload. A <c>null</c> result means no value; see <see cref="ChannelDeclaration.AbsenceIsData"/> and <see cref="ChannelDeclaration.NullIsUnreadable"/>.</param>
        void AddChannelSource(string topic, Func<KspSnapshot?, object?> map);

        /// <summary>Push-style channel source for a declared topic: see <see
        /// cref="IChannelPublisher"/>.</summary>
        /// <param name="topic">The declared topic.</param>
        /// <returns>The publisher for that topic.</returns>
        IChannelPublisher Publisher(string topic);

        /// <summary>
        /// A capture-on-main, handle-off-main source: the way for an Uplink to
        /// read live KSP, Unity or another mod's APIs that are not already on
        /// the shared <see cref="KspSnapshot"/>. Unity APIs are main-thread
        /// only, and <see cref="AddChannelSource"/>'s mapper runs off the main
        /// thread, so a live read from there crashes or returns garbage.
        ///
        /// <para><paramref name="captureOnMainThread"/> runs on the Unity main
        /// thread, once per tick, as the <see cref="KspSnapshot"/> is built. It
        /// is handed that tick's snapshot (for <see cref="KspSnapshot.Ut"/> and
        /// any already-sampled data) and returns plain, self-contained data with
        /// no live KSP or Unity object references.</para>
        ///
        /// <para><paramref name="handleOnCourier"/> then runs off the main
        /// thread with exactly that captured value, and does the rest:
        /// change-gating, packing, and publishing to channels obtained from
        /// <see cref="Publisher"/> or <see cref="RegisterDynamicNamespace"/>. It
        /// must not touch any KSP or Unity API; read everything game-facing in
        /// <paramref name="captureOnMainThread"/> and pass it forward as
        /// data.</para>
        ///
        /// <para>A capture or handle that throws disables its owning Uplink from
        /// the next tick onward; every other source, and the rest of this tick,
        /// continues.</para>
        /// <internal>
        /// The capture runs inside GonogoAddon.FixedUpdate in production (a test
        /// driver calls it on whatever thread invokes ChannelEngine.Tick); the
        /// handle runs on the Courier thread.
        /// </internal>
        /// </summary>
        /// <param name="captureOnMainThread">Reads the game on the main thread and returns plain data.</param>
        /// <param name="handleOnCourier">Receives that data off the main thread and publishes.</param>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier);

        /// <summary>
        /// Subscription-gated overload of <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>,
        /// with the same capture and handle semantics, plus
        /// <paramref name="subscriptionTopicPrefixes"/>: the topic prefixes this
        /// source produces (e.g. <c>"scansat.coverage."</c>). The engine skips
        /// <paramref name="captureOnMainThread"/> entirely on any tick where no
        /// subscribed topic starts with any of them, so a source that does
        /// expensive main-thread work costs nothing while no client is looking.
        /// Pass the prefixes a <see cref="RegisterDynamicNamespace"/> namespace
        /// owns and the exact topics a <see cref="Publisher"/> targets (an exact
        /// topic is its own prefix). Passing no prefixes captures every tick.
        ///
        /// <para><b>The gate is safe only for a capture whose entire effect is
        /// its return value.</b> For one of those a late subscriber still gets
        /// the current value, because the first capture after a subscription
        /// runs again and a new subscriber is sent a keyframe.</para>
        ///
        /// <para><b>A capture that also writes state something else reads is
        /// silently starved by this.</b> The skip is total: no capture, so no
        /// write, so every reader of that state sees whatever was last left
        /// there for as long as nobody subscribes a declared prefix. There is
        /// no exception, no log line and no degraded mode to notice. If the
        /// reader provides an exclusive capability there is no stock fallback
        /// either, because providing it is what stops stock from being used:
        /// the client is told nothing, or told positively that there is nothing
        /// to tell.</para>
        ///
        /// <para><b>So never gate a capture that feeds anything but its own
        /// topics.</b> Register it with the ungated overload, and if the
        /// expensive part is the packing rather than the reading, check
        /// <see cref="IsAnyTopicSubscribed"/> before publishing instead.
        /// Skipping a publish starves nothing; skipping the reading starves
        /// everything downstream of it.</para>
        /// </summary>
        /// <param name="captureOnMainThread">Reads the game on the main thread and returns plain data.</param>
        /// <param name="handleOnCourier">Receives that data off the main thread and publishes.</param>
        /// <param name="subscriptionTopicPrefixes">The topic prefixes this source produces.</param>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes);

        /// <summary> Whether at least one subscribed topic starts with
        /// <paramref name="topicPrefix"/> (ordinal comparison), right now. The
        /// same check the gated <see cref="AddSampledSource(Func{KspSnapshot?,
        /// object?}, Action{object?}, string[])"/> overload applies, for an
        /// Uplink whose expensive work is driven by an external callback rather
        /// than the engine's tick, such as a Harmony postfix that fires on every
        /// kerboscript <c>PRINT</c>.
        ///
        /// <para>Safe to call from the main thread and from off-main-thread
        /// handlers.</para>
        ///
        /// <para>Use it only to skip work whose sole product is the gated
        /// topics. Skipping a publish is always safe, because a late subscriber
        /// is sent a keyframe. Skipping a reading that something else derives
        /// from is not: see the gated <see cref="AddSampledSource(Func{KspSnapshot?,
        /// object?}, Action{object?}, string[])"/> overload for what that looks
        /// like to a client, which is silence or a confident wrong value, and
        /// nothing in a log.</para>
        /// </summary>
        /// <param name="topicPrefix">A topic prefix, or an exact topic.</param>
        /// <returns><c>true</c> when any subscribed topic starts with <paramref name="topicPrefix"/>.</returns>
        bool IsAnyTopicSubscribed(string topicPrefix);

        /// <summary> Declares a dynamic namespace: a <paramref name="prefix"/>
        /// the calling Uplink owns, plus a <paramref name="template"/> whose
        /// <see cref="ChannelDeclaration.Delivery"/>,
        /// <see cref="ChannelDeclaration.Emission"/> and
        /// <see cref="ChannelDeclaration.Delay"/> apply to every concrete
        /// <c>prefix + subTopic</c> the returned
        /// <see cref="IDynamicChannelSource"/> publishes. The template's
        /// <see cref="ChannelDeclaration.Topic"/> is ignored. Unlike a fixed
        /// channel, nothing under the prefix needs to be declared individually
        /// in <see cref="UplinkManifest.Channels"/>.
        /// </summary>
        /// <param name="prefix">The topic prefix, including its trailing dot, e.g. <c>scansat.coverage.</c>.</param>
        /// <param name="template">The declaration every concrete topic is cloned from.</param>
        /// <returns>The namespace's publisher factory.</returns>
        IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template);

        /// <summary>
        /// Registers the handler for a command the calling Uplink declared in
        /// its <see cref="UplinkManifest.Commands"/>. Whether the command rides
        /// the signal delay is decided by its own
        /// <see cref="SitrepCommandAttribute.Delay"/>, not by this call.
        /// </summary>
        /// <typeparam name="TArgs">The command's argument type, decoded from the wire.</typeparam>
        /// <typeparam name="TResult">The handler's result type.</typeparam>
        /// <param name="command">The declared command id.</param>
        /// <param name="handler">Runs the command.</param>
        void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler);

        /// <summary>
        /// Register a handler that is told which command centre the command came
        /// FROM, as well as what it said.
        ///
        /// <para>Almost no command needs this: setting a throttle means the
        /// same thing wherever it was sent from. The ones that do are questions
        /// whose correct result differs per command centre, because each has
        /// been told different things: where a craft goes, what a plan would
        /// do. Those cannot be computed from the game's own state, which is
        /// every centre's future.</para>
        ///
        /// <para>The vantage is the sender's, resolved where the command
        /// entered rather than taken from its arguments, so a client cannot
        /// claim another centre's vantage.</para>
        /// </summary>
        /// <typeparam name="TArgs">The command's argument type, decoded from the wire.</typeparam>
        /// <typeparam name="TResult">The handler's result type.</typeparam>
        /// <param name="command">The declared command id.</param>
        /// <param name="handler">Runs the command, given its arguments and the sending command centre's id.</param>
        void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler);

        /// <summary>
        /// Register an evaluator for one <see cref="CommandRequirement.Kind"/>.
        ///
        /// <para>Available to any Uplink, so an Uplink can gate its own
        /// commands on its own conditions rather than only on the kinds Gonogo
        /// ships.</para>
        ///
        /// <para>Registration order across Uplinks is not controllable, so a
        /// command may declare a requirement whose evaluator registers later, or
        /// never. The pairing is therefore validated once every Uplink has
        /// registered: a declared kind with no evaluator is a startup failure,
        /// because a gate nobody can evaluate would silently not exist.</para>
        /// </summary>
        /// <param name="evaluator">The evaluator, registered under its <see cref="ICommandGateEvaluator.Kind"/>.</param>
        void AddGateEvaluator(ICommandGateEvaluator evaluator);

        /// <summary>
        /// Contribute one <see cref="CommandRequirement"/> to a command this
        /// Uplink does not own, so an installed mod can impose its own
        /// precondition on a command core declared.
        ///
        /// <para><b>Why a command needs preconditions from elsewhere.</b> The
        /// Uplink that declares a command knows what the game requires of it.
        /// It cannot know what an installed mod requires, and under a career
        /// overhaul that is most of what stands between an operator and a launch:
        /// stock will fly any craft file, a realism career only a vehicle a launch
        /// complex integrated and then rolled out to a pad. A launch that walks
        /// past both steps passes every stock test on the way.</para>
        ///
        /// <para><b>Contributions compose.</b> Two mods may each legitimately
        /// impose a precondition, and every requirement on a command has to
        /// hold, so this appends. Register only when your mod is present: an
        /// Uplink whose mod is absent contributes nothing, and nothing is a
        /// complete contribution.</para>
        ///
        /// <para><b>Order.</b> Contributions are evaluated after the owning
        /// Uplink's own declared requirements, in the order they were
        /// contributed, and evaluation stops at the first verdict that is not a
        /// pass. The built-in launch requirements can be decided with no
        /// arguments and so can disable a control in advance; a contributed
        /// requirement that abstained ahead of them would hide every one of
        /// them.</para>
        ///
        /// <para><b>The kind still needs an evaluator</b> (<see
        /// cref="AddGateEvaluator"/>), validated once after every Uplink has
        /// registered. A contributed requirement nobody can evaluate is a
        /// startup failure for the same reason a declared one is.</para>
        ///
        /// <para>Contributing to a command that does not exist is an error at
        /// validation time rather than a silent no-op: a typo would otherwise
        /// read as a condition that is being enforced.</para>
        /// </summary>
        /// <param name="command">The id of a command another Uplink declares.</param>
        /// <param name="requirement">The precondition to add.</param>
        void AddCommandRequirement(string command, CommandRequirement requirement);

        /// <summary> Register the authoritative one-way signal delay (the
        /// value <c>comms.delay</c> publishes) that Gonogo uses to withhold
        /// <see cref="DelayRole.Delayed"/> channels. <paramref
        /// name="computeOnMainThread"/> runs on the Unity main thread every tick,
        /// whatever any client has subscribed, so it may read the live comms
        /// backend and the delay is enforced even while nobody watches
        /// <c>comms.delay</c>.
        ///
        /// <para>A <paramref name="computeOnMainThread"/> that throws disables
        /// its owning Uplink from the next tick onward. A <c>null</c> result, a
        /// <see cref="CommsDelaySource.None"/> source or a non-positive value
        /// leaves the last known delay in place, so nothing is delivered
        /// earlier than the known delay. With no source registered at all,
        /// every channel is delivered live.</para>
        /// <internal>
        /// A first-class seam because the bundled comms Uplink publishes
        /// comms.delay through a subscription-gated capture-on-main /
        /// handle-on-Courier sampled source, which the engine's per-tick delay
        /// refresh cannot read; without this the reveal gate never learned the
        /// delay and delivered Delayed channels live.
        /// </internal>
        /// </summary>
        /// <param name="computeOnMainThread">Returns this tick's delay to the active vessel, or <c>null</c> to keep the last one.</param>
        void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread);

        /// <summary> Set the one-way routed light-time for one vessel's
        /// telemetry: its <c>fleet.&lt;vesselId&gt;.*</c> topics, and any
        /// <see cref="ChannelDeclaration.PerVesselNode"/> namespace keyed by
        /// it, are delayed by this to any command centre with no more specific
        /// delay of its own to the vessel. Call it per vessel on
        /// each capture pass, from the off-main-thread handler of a
        /// <see cref="AddSampledSource(Func{KspSnapshot?, object?},
        /// Action{object?}, string[])"/> source. <see cref="SetSignalDelaySource"/>
        /// is the active vessel's delay; this is any vessel's.
        /// </summary>
        /// <param name="vesselId">The vessel's id (its GUID, as the topic carries it).</param>
        /// <param name="oneWaySeconds">One-way light-time, in seconds.</param>
        void SetVesselDelay(string vesselId, double oneWaySeconds);

        /// <summary>
        /// Set the one-way light-time between two command centres: the delay a
        /// command takes travelling from <paramref name="fromCentreId"/> to
        /// <paramref name="toCentreId"/>. The same as a centre's delay to a
        /// fleet craft, except that the destination is a centre rather than a
        /// craft, which is what an act aimed at the
        /// program's home centre (a currency spend) needs in order to be delayed
        /// at all. Populate it on each capture pass, one row per ordered pair of
        /// active centres that can reach each other.
        /// </summary>
        /// <param name="fromCentreId">The sending command centre's id.</param>
        /// <param name="toCentreId">The destination command centre's id.</param>
        /// <param name="oneWaySeconds">One-way light-time, in seconds.</param>
        void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds);

        /// <summary>
        /// Set how long a change to a fact held at the home command takes to reach
        /// <paramref name="centreId"/> as a vantage: the delay every
        /// <see cref="ChannelDeclaration.HeldAtHome"/> channel rides to that centre.
        ///
        /// <para>This is the centre's PATH HOME, not a route to the one station
        /// the home-command claimant named. Every ground station reaches home
        /// over the ground network, so a ground centre's row is zero; a crewed
        /// vessel's row is its own control path to whichever station it
        /// reaches, which is the same number a currency award from that vessel
        /// waits before it is booked. A centre with no row reads zero, so a
        /// vessel that has never been measured must be written rather than left
        /// out.</para>
        ///
        /// <para>Populate it on each capture pass, one row per active
        /// centre.</para>
        /// </summary>
        /// <param name="centreId">The command centre's id.</param>
        /// <param name="oneWaySeconds">One-way light-time home, in seconds.</param>
        void SetHomeCommandDelay(string centreId, double oneWaySeconds);

        /// <summary> Replace every centre's delay to the ACTIVE craft: the
        /// delay each ordinary channel (one with no per-vessel node and not
        /// held at home) rides to that centre as a vantage, since those
        /// channels all describe whichever craft is active.
        ///
        /// <para>The map is the whole set, not an update. A centre left out
        /// uses the active craft's own light-time home, and a centre that had a
        /// row on the previous call and has none now loses it. That is what
        /// keeps a pilot who switches away from their craft from reading the
        /// next one instantly on a held zero.</para>
        ///
        /// <para>Populate it on each capture pass: zero for the crewed centre
        /// that is the active craft, and its route to the active craft for any
        /// other centre that has one.</para>
        /// </summary>
        /// <param name="oneWaySecondsByCentre">One-way light-time to the active craft, in seconds, keyed by command centre id.</param>
        void SetActiveVesselDelays(IReadOnlyDictionary<string, double> oneWaySecondsByCentre);

        /// <summary>
        /// Set one vessel's connectivity: its <c>fleet.&lt;vesselId&gt;.*</c>
        /// topics stop updating while its own link is down, independently of
        /// the active vessel. Call it for every vessel on every tick from the
        /// off-main-thread handler of an ungated
        /// <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>
        /// source, not one gated on a subscription: a vessel is known to be out
        /// of contact only if that was reported while nobody was watching, and a
        /// first subscriber's catch-up is graded by exactly that.
        /// <see cref="SetConnectivitySource"/> covers the active vessel.
        /// </summary>
        /// <param name="vesselId">The vessel's id.</param>
        /// <param name="connected">Whether the vessel has a control link now.</param>
        void SetVesselConnectivity(string vesselId, bool connected);

        /// <summary>
        /// Register the authoritative connected or disconnected state of the
        /// active vessel's control link, which Gonogo uses to stop delivering
        /// <see cref="DelayRole.Delayed"/> channels during an outage.
        /// <paramref name="computeOnMainThread"/> runs on the Unity main thread
        /// every tick, whatever any client has subscribed, like
        /// <see cref="SetSignalDelaySource"/>, so it may read the live comms
        /// backend.
        ///
        /// <para>Separate from the delay because a down link and a connected
        /// zero-distance link both have a zero delay: only a real disconnected
        /// state stops delivery. While disconnected, nothing new is delivered on
        /// any <see cref="DelayRole.Delayed"/> channel, which holds its last
        /// value, while <see cref="DelayRole.TrueNow"/> channels
        /// (<c>comms.delay</c>, <c>comms.connectivity</c>, <c>time.*</c>,
        /// <c>system.bodies</c>) keep flowing, so the operator sees the outage
        /// live. On reconnect the withheld backlog is dropped and delivery
        /// resumes from the moment of reconnection.</para>
        ///
        /// <para>A source that throws disables its owning Uplink and the link
        /// is treated as connected. A <c>null</c> result leaves the last known
        /// state in place. With no source registered, the link is always
        /// treated as connected.</para>
        /// </summary>
        /// <param name="computeOnMainThread">Returns whether the active vessel is connected now, or <c>null</c> to keep the last state.</param>
        void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread);

        /// <summary>
        /// Register the source of every break this tick in any watched
        /// subject's route home, such as a relay destroyed while signal was
        /// crossing it. Each break names its own subject, so a relay dying
        /// under a craft that is not on screen stops that craft's telemetry and
        /// no one else's. Runs on the Unity main thread every tick, like
        /// <see cref="SetSignalDelaySource"/> and
        /// <see cref="SetConnectivitySource"/>, and is handed the tick's UT, so
        /// it may read the comms backend's hop geometry and routing.
        ///
        /// <para><b>Why neither of the other two can carry it.</b> The delay
        /// says how far away the craft is; it has no honest value for gone.
        /// Connectivity says whether anything new can be sent, which is a
        /// different question from what becomes of the signal already in
        /// flight: a relay dying mid-flight leaves the craft connected by
        /// another route while the samples crossing the dead one are lost. Those
        /// samples are what a break retires, since they could not physically
        /// have arrived.</para>
        ///
        /// <para>A break carries a position as well as an instant, because
        /// position decides whether a sample is lost: signal already past the
        /// break point is on the far leg and arrives normally.</para>
        ///
        /// <para>Nothing about a break reaches the wire; a client sees only the
        /// silence it produces.</para>
        ///
        /// <para>A source that throws disables its owning Uplink. A <c>null</c>
        /// or empty result means no break this tick. With no source registered,
        /// every recorded sample is delivered at its own light-time whatever
        /// became of the route.</para>
        /// <internal>
        /// Sitrep.Host.Comms.PathBreakWatch is the shipped producer; its doc
        /// comment carries the reroute-versus-destruction discrimination and the
        /// warp domain the result is only valid inside.
        /// </internal>
        /// </summary>
        /// <param name="computeOnMainThread">Given the tick's snapshot and UT in seconds, returns the breaks this tick, or <c>null</c> for none.</param>
        void SetPathBreakSource(Func<KspSnapshot?, double, IReadOnlyList<PathBreak>?> computeOnMainThread);

        /// <summary>
        /// Scale every signal delay by <paramref name="factor"/> until the
        /// returned handle is disposed. <c>2</c> doubles each light-time,
        /// <c>0.5</c> halves it, and <c>0</c> switches delay off entirely, so
        /// telemetry arrives live and commands land at once.
        ///
        /// <para>Every modifier in force multiplies: two Uplinks each holding
        /// <c>2</c> make every delay four times its light-time, and any one
        /// holding <c>0</c> switches delay off whatever the others hold. The
        /// operator's own delay settings are applied the same way, so a
        /// modifier composes with them rather than overriding them.</para>
        ///
        /// <para>The factor reaches every place a delay is read at once: the
        /// release of delayed telemetry, <c>comms.delay</c>, each fleet craft's
        /// own light-time, each command centre's, and when a change in the
        /// career is announced. Hold a modifier for as long as its condition
        /// lasts and dispose it when the condition ends; disposing twice is
        /// harmless.</para>
        ///
        /// <para>Nothing about a modifier reaches the wire. A client sees the
        /// delay it produces, and an Uplink that wants the operator to know why
        /// says so itself.</para>
        /// </summary>
        /// <param name="factor">The multiplier: zero or a positive, finite number.</param>
        /// <param name="reason">Why the delay is scaled, in a few words, for the mod's log.</param>
        /// <returns>The handle whose disposal withdraws the modifier.</returns>
        /// <exception cref="ArgumentOutOfRangeException"><paramref name="factor"/> is negative, NaN or infinite.</exception>
        /// <exception cref="ArgumentException"><paramref name="reason"/> is null or blank.</exception>
        IDisposable RegisterDelayModifier(double factor, string reason);

        /// <summary>The capability and provider registry, through which an
        /// Uplink provides a capability or resolves one another Uplink provides.
        /// See <see cref="Sitrep.Contract.Kernel"/>.</summary>
        Kernel Kernel { get; }

        /// <summary>
        /// Mark the Uplink that is registering now as available or unavailable
        /// (see <see cref="Availability"/>), so an Uplink whose mod is not
        /// installed says so and returns instead of throwing. The rest of
        /// Gonogo loads either way.
        ///
        /// <para>Registration time only: it applies to the Uplink whose
        /// <see cref="ISitrepUplink.Register"/> is on the stack, so a call from a
        /// callback, a command handler, or anywhere after
        /// <see cref="ISitrepUplink.Register"/> has returned writes nothing. That
        /// call is logged rather than dropped in silence, and the state it wanted
        /// to report belongs on <see cref="ISitrepUplink.Health"/>, which is
        /// polled for exactly this.</para>
        /// </summary>
        /// <param name="availability">The Uplink's availability.</param>
        void SetAvailability(Availability availability);

        /// <summary>
        /// Make <paramref name="topic"/>'s next sample an unconditional
        /// keyframe, the same as a first subscriber receives. Use it when the
        /// subject a channel describes changes identity mid-stream (the active
        /// vessel switches, say): the next sample must then be a full keyframe,
        /// not something a deadband or cadence rule can suppress or delay.
        ///
        /// <para>Call it only from within a registered
        /// <see cref="ISnapshotSampler.Sample"/> or a command handler, which run
        /// on the engine's own thread; calling it from other code races the
        /// channel's emission state.</para>
        /// <internal>
        /// Forces the next ChannelEmitter.Decide, the same mechanism as
        /// ChannelEmitter.NotifySubscribed on a 0-to-1 subscribe. The
        /// load-bearing caller is VesselEpochSampler. Samplers and command
        /// handlers both run on the Courier thread.
        /// </internal>
        /// </summary>
        /// <param name="topic">The topic whose next sample is forced.</param>
        void ForceKeyframe(string topic);

        /// <summary>
        /// Return exactly the given <paramref name="topics"/> to the state of a
        /// channel that has never emitted a real value, so a null is again
        /// withheld rather than sent as confirmed-empty (see
        /// <see cref="ChannelDeclaration.AbsenceIsData"/>). Call it alongside
        /// <see cref="ForceKeyframe"/>, not instead of it, when a channel's
        /// subject switches: a channel the new subject has never populated then
        /// reads as waiting for its first value, rather than inheriting the
        /// previous subject's state and announcing an absence the new subject
        /// never had.
        ///
        /// <para>Call it only from within a registered
        /// <see cref="ISnapshotSampler.Sample"/> or a command handler, the same
        /// rule as <see cref="ForceKeyframe"/>.</para>
        /// <internal>
        /// Clears ChannelEngine's _born guard without touching the emitter's
        /// force-keyframe state. VesselEpochSampler calls it for every topic it
        /// owns on a subject switch.
        /// </internal>
        /// </summary>
        /// <param name="topics">The topics to reset.</param>
        void ResetChannelBirth(IEnumerable<string> topics);
    }

    /// <summary>
    /// The interface every Uplink implements: the C# half of an Uplink, which
    /// declares its channels and commands and registers the pieces that serve
    /// them against an <see cref="IUplinkHost"/>. It never touches transport or
    /// threading itself.
    ///
    /// <para>Mark the class with <see cref="SitrepUplinkAttribute"/> so Gonogo
    /// finds it. <see cref="Manifest"/> is read first, then
    /// <see cref="Register"/> runs once, and <see cref="Health"/> is polled from
    /// then on. An exception from <see cref="Register"/> disables that Uplink
    /// alone.</para>
    ///
    /// <para><c>Sitrep.Contract</c> alone is enough to implement it: nothing in
    /// <see cref="Register"/>'s signature, directly or transitively, lives in
    /// another assembly.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public interface ISitrepUplink
    {
        /// <summary>
        /// Everything this Uplink declares: its id, its channels, its commands.
        ///
        /// <para>Read before <see cref="Register"/> and constant for the
        /// Uplink's lifetime, so it must not depend on game state. A channel
        /// published or a command handled that it does not declare is refused
        /// at registration.</para>
        /// </summary>
        UplinkManifest Manifest { get; }

        /// <summary> Register this Uplink's channel sources, command handlers
        /// and providers. Called once, on the main thread, at load.
        ///
        /// <para>Throwing here, or calling <see
        /// cref="IUplinkHost.SetAvailability"/> with an unavailable status,
        /// disables this Uplink only; every other Uplink is unaffected.</para>
        /// </summary>
        /// <param name="host">What the Uplink registers against.</param>
        void Register(IUplinkHost host);

        /// <summary> Returns this Uplink's current health. Only the Uplink
        /// knows what ready means for it, such as a CPU on the vessel or a
        /// comms backend elected. An Uplink with nothing to report returns <see
        /// cref="UplinkHealth.Healthy"/>.
        ///
        /// <para>Polled on every sample, off the main thread, so it must be
        /// cheap, must not block, and must not touch the game. A throw is
        /// reported as <see cref="UplinkHealthState.Degraded"/> with the
        /// exception message as <see cref="UplinkHealth.Detail"/>, and does not
        /// disable the Uplink's channels or commands.</para>
        /// </summary>
        UplinkHealth Health();
    }

    /// <summary>
    /// Optional second interface for an Uplink that owns a capability. Every
    /// implementation's <see cref="DeclareCapabilities"/> runs before any
    /// Uplink's <see cref="ISitrepUplink.Register"/>, so a capability exists
    /// before another Uplink tries to provide for it.
    ///
    /// <para>Discovery fixes no order between Uplinks, and
    /// <see cref="Kernel.RegisterProvider"/> throws for a capability not yet
    /// registered, so a provider (a RealAntennas comms backend, say) could
    /// otherwise load before the capability it serves. So capability
    /// declarations go here, through
    /// <see cref="Kernel.RegisterCapability"/>, and providers still register in
    /// <see cref="ISitrepUplink.Register"/>. An Uplink that owns no capability
    /// does not implement this.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public interface IUplinkCapabilityDeclarer
    {
        /// <summary>
        /// Register this Uplink's capability descriptors on
        /// <paramref name="kernel"/>. Runs once, on the main thread, before any
        /// <see cref="ISitrepUplink.Register"/>. Throwing here disables this Uplink
        /// only, and its <see cref="ISitrepUplink.Register"/> is then skipped.
        /// </summary>
        /// <param name="kernel">The capability and provider registry.</param>
        void DeclareCapabilities(Kernel kernel);
    }

    /// <summary>
    /// Coarse self-reported health for one <see cref="ISitrepUplink"/>, as
    /// returned by <see cref="ISitrepUplink.Health"/>.
    /// </summary>
    /// <category>Uplink API</category>
    public enum UplinkHealthState
    {
        /// <summary>Working as it should.</summary>
        Healthy,

        /// <summary>Registered and working, but something it needs is missing
        /// or wrong.</summary>
        Degraded,

        /// <summary>Not usable at all: none of its channels will carry
        /// anything.</summary>
        Unavailable,
    }

    /// <summary> One labelled diagnostic on an <see cref="UplinkHealth"/>:
    /// which file, which build, which hash, whatever an operator would have to
    /// quote when reporting this uplink's state to somebody else.
    ///
    /// <para>Both halves are display text; nothing parses them.</para>
    ///
    /// <para>Facts are for what would go in a bug report: a count or a version,
    /// not a sentence. A number that changes as the mission runs is telemetry and
    /// belongs on a channel, where it gets a unit, a delay role and a
    /// history.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public readonly struct UplinkHealthFact
    {
        /// <summary>What the value is, in the operator's terms, e.g.
        /// "binary".</summary>
        public string Label { get; }

        /// <summary>The value as it should read on a screen. Null when the uplink
        /// knows the fact applies but has not established it.</summary>
        public string? Value { get; }

        /// <summary>One labelled fact.</summary>
        /// <param name="label">What the value is, in the operator's terms.</param>
        /// <param name="value">The value as it should read, or null when not yet established.</param>
        public UplinkHealthFact(string label, string? value)
        {
            Label = label;
            Value = value;
        }
    }

    /// <summary>
    /// One <see cref="ISitrepUplink.Health"/> result: a coarse
    /// <see cref="State"/> plus an optional <see cref="Detail"/> sentence saying
    /// what "ready" means for this Uplink (e.g. "no active CPU selected"). The
    /// engine never writes or parses <see cref="Detail"/>; it is display-only
    /// text the Uplink itself writes.
    ///
    /// <para><see cref="Facts"/> are labelled rows beneath it: what somebody
    /// diagnosing the state would need to quote, such as the version of the mod
    /// the Uplink depends on.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public readonly struct UplinkHealth
    {
        /// <summary>The overall state.</summary>
        public UplinkHealthState State { get; }

        /// <summary>The sentence an operator reads under <see cref="State"/>,
        /// or null for nothing to add.</summary>
        public string? Detail { get; }

        /// <summary>
        /// Labelled diagnostics, in the order the author wants them read. Never
        /// null: an uplink with nothing to add reports an empty list, so a client
        /// enumerates unconditionally.
        /// </summary>
        public IReadOnlyList<UplinkHealthFact> Facts { get; }

        /// <summary>A result with no facts.</summary>
        /// <param name="state">The coarse state.</param>
        /// <param name="detail">The sentence under the state, or null.</param>
        public UplinkHealth(UplinkHealthState state, string? detail = null)
            : this(state, detail, null)
        {
        }

        /// <summary>A result with labelled facts.</summary>
        /// <param name="state">The coarse state.</param>
        /// <param name="detail">The sentence under the state, or null.</param>
        /// <param name="facts">The facts in reading order; null reads as none.</param>
        public UplinkHealth(
            UplinkHealthState state,
            string? detail,
            IReadOnlyList<UplinkHealthFact>? facts)
        {
            State = state;
            Detail = detail;
            Facts = facts ?? NoFacts;
        }

        private static readonly UplinkHealthFact[] NoFacts = new UplinkHealthFact[0];

        /// <summary>
        /// Healthy, with nothing to add: what an Uplink with nothing to report
        /// returns from <see cref="ISitrepUplink.Health"/>.
        /// </summary>
        public static readonly UplinkHealth Healthy = new UplinkHealth(UplinkHealthState.Healthy);

        /// <summary>
        /// Working, but not as it should be: the uplink is registered and its
        /// dependency is present, and something it needs is missing or wrong
        /// (no CPU selected, a capture that threw, a version it does not
        /// recognise). <paramref name="detail"/> is the sentence an operator
        /// reads under the state, and a degraded report is the one shape where
        /// omitting it leaves them nothing to act on.
        /// </summary>
        /// <param name="detail">Why, in the operator's terms. Required.</param>
        /// <param name="facts">Labelled facts, or null for none.</param>
        public static UplinkHealth Degraded(
            string detail,
            IReadOnlyList<UplinkHealthFact>? facts = null) =>
            new UplinkHealth(UplinkHealthState.Degraded, detail, facts);

        /// <summary>
        /// Not usable at all: the mod this uplink integrates is absent, or a
        /// capability it depends on never resolved, so none of its channels
        /// will carry anything. <paramref name="detail"/> says which, in the
        /// operator's terms.
        /// </summary>
        /// <param name="detail">Which, in the operator's terms. Required.</param>
        /// <param name="facts">Labelled facts, or null for none.</param>
        public static UplinkHealth Unavailable(
            string detail,
            IReadOnlyList<UplinkHealthFact>? facts = null) =>
            new UplinkHealth(UplinkHealthState.Unavailable, detail, facts);
    }

}
