using System;
using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// Which outbox lane a channel's samples ride, per
    /// <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c> §1.1.
    /// <see cref="LossyLatest"/> is the <see cref="Sitrep.Host.ChannelEngine"/>'s default:
    /// the outbox coalesces to the freshest sample per topic (the shape
    /// <c>GonogoBodiesServer</c>'s <c>GonogoOutbox._latestByTopic</c> already
    /// implemented). <see cref="ReliableOrdered"/> rides the outbox's FIFO
    /// reliable lane instead: every sample is delivered, in order, never
    /// coalesced away (kOS terminal output is the load-bearing example the
    /// design doc names: a dropped keystroke is wrong in a way a dropped
    /// telemetry tick isn't).
    /// </summary>
    public enum Delivery
    {
        LossyLatest,
        ReliableOrdered,
    }

    /// <summary>
    /// A channel's delay disposition, declared PER CHANNEL here rather than
    /// inferred client-side from topic names. The rule this enum encodes
    /// instead of leaving to convention: everything is
    /// <see cref="Delayed"/> (rides the Courier's
    /// light-time delay clock) unless it's a ground-side fact with no
    /// analogue in flight (e.g. <c>scansat.available</c>: is the SCANsat
    /// assembly even present, which is <see cref="TrueNow"/>, delivered
    /// immediately, bypassing the delay clock entirely).
    /// </summary>
    public enum DelayRole
    {
        Delayed,
        TrueNow,
    }

    /// <summary>
    /// One channel an uplink declares in its <see cref="UplinkManifest"/>,
    /// the wire-visible metadata <see cref="Sitrep.Host.ChannelEngine.AddChannelSource"/>
    /// looks up by <see cref="Topic"/> when an uplink calls it during
    /// <see cref="ISitrepUplink.Register"/>. Declaring a channel here
    /// BEFORE registering its mapper is the manifest-first rule the design
    /// doc's §1.1 table describes: the manifest is the source of truth for
    /// <see cref="Delivery"/> and <see cref="Emission"/>, not the call site.
    /// </summary>
    public sealed class ChannelDeclaration
    {
        public string Topic { get; set; } = "";
        public Delivery Delivery { get; set; } = Delivery.LossyLatest;
        public EmissionPolicy Emission { get; set; } = null!;

        /// <summary>
        /// Defaults to <see cref="DelayRole.Delayed"/>: mirrors
        /// <see cref="CommandDeclaration.Delayed"/>'s own default-true
        /// precedent, and is the contract-conservative choice: nothing in
        /// <see cref="Sitrep.Host.ChannelEngine"/> branches on this value
        /// today (it is purely declarative, feeding the SDK/client's future
        /// delay routing), so EVERY existing bundled channel's host-observable
        /// behavior is unchanged regardless of what this defaults to; see
        /// the ContractDelayDispositionTests round-trip test and the
        /// contract-dynamic-delay-report.md for the "no behavior change"
        /// proof. Every bundled channel (vessel/system/career/science/parts)
        /// nonetheless sets this EXPLICITLY at its declaration site rather
        /// than relying on the default, so the disposition is provable by
        /// reading the declaration, not inferred from silence.
        /// </summary>
        public DelayRole Delay { get; set; } = DelayRole.Delayed;

        /// <summary>
        /// Opt-in for a channel that is LEGITIMATELY empty from its very
        /// first tick (e.g. <c>vessel.target</c> with no target selected,
        /// <c>vessel.dock</c> with no docking port aligned, <c>vessel.crew</c>
        /// with no crew aboard): a real, present subject whose value can
        /// simply be null, as opposed to "no subject yet" (main menu, before
        /// <c>FlightGlobals</c> is ready). Defaults to <c>false</c>, which
        /// preserves the pre-existing behavior: <see cref="Sitrep.Host.ChannelEngine.ProcessTick"/>'s
        /// birth-gate skips a null mapper result for a channel that has
        /// never emitted a real value, so the client never learns the
        /// channel is absent and shows "SYNCING" forever. Setting this
        /// <c>true</c> makes the engine fall through to
        /// <c>ChannelEmitter.Decide</c> even from birth, emitting a
        /// confirmed-empty tombstone (null payload) on the first tick so
        /// the client shows "NO DATA" instead.
        /// </summary>
        public bool AbsenceIsData { get; set; } = false;

        /// <summary>
        /// The opposite reading of the same null, for a channel whose subject
        /// keeps existing while the game stops being able to REPORT it: a null
        /// mapper result means "no reading available", never "confirmed
        /// nothing", so the engine emits neither a value nor a tombstone and the
        /// channel simply goes quiet.
        ///
        /// <para>Silence is what the client's staleness machinery is built to
        /// read. Missed keyframes take the topic to the <c>stale</c> arm of
        /// <c>Reading</c>, carrying the last real observation and the UT it was
        /// made at, and a subscriber that connects during the silence is served
        /// the same last sample out of the archive stamped
        /// <see cref="Staleness.HeldStale"/>. A tombstone would instead assert
        /// that the subject has no value, which for <c>career.facilities</c>
        /// means telling an operator in orbit that the space centre they built
        /// has no buildings.</para>
        ///
        /// <para>Contradicts <see cref="AbsenceIsData"/>, which says a null IS a
        /// real absence worth announcing. Setting both is a contradiction about
        /// what the mapper's null means; this one wins, because a channel that
        /// cannot be read has nothing to announce. Defaults to <c>false</c>,
        /// leaving every existing channel's tombstone behaviour untouched.</para>
        /// </summary>
        public bool NullIsUnreadable { get; set; } = false;

        /// <summary>
        /// Opt-in predicate for a <see cref="Delivery.ReliableOrdered"/>
        /// channel whose samples are a CURSOR-RELATIVE DIFF STREAM (e.g. the
        /// kOS terminal's full-repaint-or-incremental-diff frames) rather
        /// than a sequence of independently-meaningful discrete events (e.g.
        /// <c>crash.lastCrash</c>). When set, <see cref="Sitrep.Host.ChannelEngine"/>
        /// tracks the last REVEALED (i.e. already past the reveal gate; see
        /// <c>ChannelEngine.FlushReveal</c>) sample for which this predicate
        /// returns <c>true</c> as a per-topic sticky catch-up baseline (see
        /// <see cref="Sitrep.Core.Courier"/>'s sticky-keyframe cache). A
        /// late or returning subscriber's synchronous catch-up then always
        /// resolves to that self-contained keyframe instead of Courier's
        /// plain "whatever's latest in the archive" read, which, for a diff
        /// stream, can otherwise resolve to a bare positional diff with no
        /// baseline to apply it to (screen corruption / the terminal
        /// "black screen" bug: see
        /// local_docs/kos-terminal-feedback-2026-07-15.md's "Loading /
        /// connection" section). Null (default) leaves every existing
        /// channel's catch-up behavior byte-for-byte unchanged.
        /// </summary>
        public Func<object?, bool>? IsKeyframe { get; set; }

        /// <summary>
        /// Declares that topics under this DYNAMIC NAMESPACE are keyed by
        /// vessel: <c>&lt;prefix&gt;&lt;guid&gt;.&lt;field&gt;</c>, recorded
        /// under that craft's own Courier node, so each one reveals at its OWN
        /// light-time. Any namespace that is per-vessel MUST set it.
        ///
        /// <para>The default routes to the single main node, which carries the
        /// ACTIVE vessel's light-time, and for anything keyed by vessel that is
        /// wrong in the direction that leaks: a Munar base's payload arrives at
        /// the delay of whatever craft the player happens to be flying, which is
        /// usually shorter. Nothing goes missing and nothing goes red, the value
        /// simply turns up early wearing someone else's delay, so no test that
        /// asserts a payload arrived can see it.</para>
        ///
        /// <para>It is the declared form of the routing that
        /// <c>fleet.</c>-prefixed telemetry gets built in: an Uplink earns the
        /// per-vessel node by SAYING its namespace is per-vessel, rather than by
        /// having its name added to core's routing, so a third-party Uplink can
        /// have it too. Ignored on a static channel declaration, whose one topic
        /// is not keyed by anything.</para>
        /// </summary>
        public bool PerVesselNode { get; set; } = false;

        /// <summary>
        /// Whether this channel's samples are held aboard the subject through a
        /// loss of signal and replayed on reacquisition, rather than discarded.
        ///
        /// <para>Defaults to <c>true</c>, and the default is the reading of
        /// <see cref="Delay"/> rather than a separate guess:
        /// <see cref="DelayRole.Delayed"/> already asserts the channel carries a
        /// flight-side fact that ground learns at light-time, and a flight-side
        /// fact is by construction one the craft's own instruments produced and
        /// could have written down. A <see cref="DelayRole.TrueNow"/> channel
        /// never reaches the recorder at all (it is never withheld, so there is
        /// nothing to hold), which is why this needs no coupling to that role.</para>
        ///
        /// <para>Set it <c>false</c> for a <see cref="DelayRole.Delayed"/> channel
        /// whose value was never aboard: the session's warp rate, the game's
        /// calendar, a roster of every other craft in the universe. Replaying
        /// those would have the craft dump a recording of facts it could not
        /// observe. A non-recording channel is not silent about the outage: its
        /// first post-blackout sample carries <see cref="Meta.GapSinceUt"/>, so
        /// the hole is stated rather than drawn through.</para>
        /// </summary>
        public bool Recordable { get; set; } = true;
    }

    /// <summary>
    /// One command an uplink declares. <see cref="Delayed"/> defaults to
    /// <c>true</c> (a normal vessel command rides the Courier's light-time
    /// delay); ground-infrastructure commands (negotiation, archive file
    /// ops) set it <c>false</c> so <see cref="Sitrep.Host.ChannelEngine.DispatchCommand"/>
    /// bypasses the Courier entirely: see the design doc §4.3's kerbcast
    /// negotiate discussion for why this flag exists.
    /// </summary>
    public sealed class CommandDeclaration
    {
        public string Command { get; set; } = "";
        public bool Delayed { get; set; } = true;

        /// <summary>
        /// Preconditions the ENGINE evaluates, before the handler runs, from
        /// this declaration alone.
        ///
        /// <para>Same shape of promise as <see cref="Delayed"/>: no handler
        /// implements it, no widget checks it, the command says what it needs
        /// once and the engine does the rest. Empty (the default) means
        /// ungated, which is every command that exists today.</para>
        /// </summary>
        public CommandRequirement[] Requires { get; set; } = new CommandRequirement[0];
    }

    /// <summary>
    /// One precondition on a command: WHAT is required, never how to find out.
    ///
    /// <para>This assembly has no KSP and no Unity reference and keeps none, so
    /// a requirement cannot be a predicate. It is a descriptor an
    /// <see cref="ICommandGateEvaluator"/> registered by the KSP-facing layer
    /// resolves against live game state.</para>
    ///
    /// <para>Not shape-gated, same rule as <see cref="CommandDeclaration"/> that
    /// carries it and <see cref="IUplinkCapabilityDeclarer"/> beside it: this is
    /// the Uplink-facing REGISTRATION surface, not a wire type. A client never
    /// sees a requirement; it sees the derived verdict, which is
    /// <see cref="GateVerdict"/> and is shape-gated.</para>
    /// </summary>
    public class CommandRequirement
    {
        /// <summary>
        /// Which evaluator answers this. A string rather than an enum so an
        /// Uplink can declare its own kind and register its own evaluator
        /// beside its own commands: gating expressible only by first-party code
        /// would make the built-in Uplinks structurally unlike the ones we ask
        /// people to write.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Kind { get; set; } = "";

        /// <summary>
        /// The <c>SpaceCenterFacility</c> member name whose level sets the
        /// limit, for the facility kinds. A name rather than the enum because
        /// the enum is KSP's.
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
        /// Argument paths this requirement reads, e.g. <c>craftMass</c>. EMPTY
        /// means the requirement is static and answerable with no arguments at
        /// all.
        ///
        /// <para>This is what makes one declaration serve both halves. The HOST
        /// abstains, without calling the evaluator, when a declared path is
        /// absent from the bag: evaluated with an empty bag the static
        /// requirements decide and the argument-dependent ones abstain, which is
        /// the addressability set; evaluated with the full bag every
        /// requirement decides, which is the refusal.</para>
        ///
        /// <para>The arithmetic lives here and once, deliberately. An evaluator
        /// that implemented its own abstention could get it wrong privately, and
        /// the failure mode is severe: a requirement that reports BLOCKED rather
        /// than abstaining when it simply has no arguments yet publishes its
        /// command as permanently unaddressable, which disables the control for
        /// good and looks like it is working.</para>
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string[] Needs { get; set; } = new string[0];
    }

    /// <summary>What an evaluator concluded. Three-valued, and the third value is load-bearing.</summary>
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
        /// Not answerable from what was supplied. NOT a refusal: a caller that
        /// treats this as blocked disables every argument-dependent control
        /// permanently. Published as its own state, never folded into either
        /// neighbour.
        /// </summary>
        Abstain = 2,

        /// <summary>
        /// Answerable in principle but the live state needed is missing, e.g. a
        /// facility KSP no longer tracks under the name declared. Distinct from
        /// <see cref="Abstain"/> because nothing further the caller supplies
        /// will resolve it, and distinct from <see cref="Pass"/> because
        /// treating an unreadable limit as no limit is how a gate fails open.
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
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class LimitBreach
    {
        [SitrepUnit(Units.Id)]
        public string Facility { get; set; } = "";

        /// <summary>
        /// The facility's name as the GAME writes it ("Astronaut Complex"), for
        /// the sentence an operator reads. Empty when the producer had no
        /// display name to hand.
        ///
        /// <para><see cref="Facility"/> beside it is the raw
        /// <c>SpaceCenterFacility</c> member name, which is an id and reads like
        /// one. Nothing else on the wire publishes the display name, so without
        /// this the client would have to keep its own English mapping of KSP's
        /// enum: a second source of truth, wrong in every other language, and
        /// stale the moment KSP adds a facility.</para>
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string FacilityName { get; set; } = "";

        /// <summary>Normalised facility level, as KSP reports it. Not a tier index.</summary>
        [SitrepUnit(Units.Ratio)]
        public double FacilityLevel { get; set; }

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

        /// <summary>What the call actually asked for, same unit as <see cref="Limit"/>.</summary>
        [SitrepUnit(Units.NotApplicable)]
        public double? Actual { get; set; }

        /// <summary>
        /// The unit token <see cref="Limit"/> and <see cref="Actual"/> are in,
        /// e.g. <c>t</c> for a mass limit, <c>count</c> for a part count.
        ///
        /// <para>Carried as DATA because one breach type serves limits with
        /// different dimensions: a static <c>[SitrepUnit]</c> on those two
        /// properties cannot be right for all of them, and the unit gate says
        /// plainly that a wrong unit is worse than a bare readout because the
        /// client will confidently mislabel it. So they declare
        /// <c>NotApplicable</c> and their real unit travels here, which is also
        /// what lets the client render the comparison in the operator's own
        /// units instead of the mod composing a sentence.</para>
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Unit { get; set; } = "";
    }

    /// <summary>
    /// A verdict plus its evidence.
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    // AutoExportMethods=false for the same reason CommandResult sets it: the
    // static Pass/Fail/Unknown factories are C#-side ergonomics, not wire shape,
    // and without this rtcli emits them as bogus interface members on the
    // generated TS type. Confirmed by generating once without it.
    [TsInterface(AutoExportMethods = false)]
#endif
    public class GateVerdict
    {
        [SitrepUnit(Units.Enumeration)]
        public GateOutcome Outcome { get; set; } = GateOutcome.Pass;

        /// <summary>
        /// WHICH refusal, for a <see cref="GateOutcome.Fail"/>: the same typed
        /// arm an actuator refusal carries, so one client sentence serves a
        /// declared gate and a handler that got far enough to look.
        ///
        /// <para>Named by the EVALUATOR, because only the evaluator knows which
        /// authority it asked: a full pad and an un-upgraded Tracking Station
        /// are both a gate saying no, and they are not the same refusal.
        /// <see cref="CommandErrorCode.ModeUnavailable"/> is the default for an
        /// evaluator that says nothing.</para>
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public CommandErrorCode ErrorCode { get; set; } = CommandErrorCode.ModeUnavailable;

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

        public static GateVerdict Pass() => new GateVerdict { Outcome = GateOutcome.Pass };

        public static GateVerdict Fail(LimitBreach breach) =>
            Fail(CommandErrorCode.LimitReached, breach);

        public static GateVerdict Fail(CommandErrorCode errorCode, LimitBreach breach) =>
            new GateVerdict { Outcome = GateOutcome.Fail, ErrorCode = errorCode, Breach = breach };

        public static GateVerdict Fail(string detail) =>
            Fail(CommandErrorCode.ModeUnavailable, detail);

        public static GateVerdict Fail(CommandErrorCode errorCode, string detail) =>
            new GateVerdict { Outcome = GateOutcome.Fail, ErrorCode = errorCode, Detail = detail ?? "" };

        public static GateVerdict Unknown(string detail) =>
            new GateVerdict { Outcome = GateOutcome.Unknown, Detail = detail };
    }

    /// <summary>
    /// The arguments a gate may read, as the decoded wire bag.
    /// </summary>
    ///
    /// <remarks>
    /// An interface rather than the dictionary so the EMPTY case is a real
    /// object with the same shape: evaluating for addressability passes an empty
    /// bag rather than a null, and no evaluator needs a null check that would be
    /// the abstention arithmetic leaking back in.
    /// </remarks>
    public interface IGateArguments
    {
        /// <summary>
        /// The value at <paramref name="path"/>, if the call supplied one.
        /// </summary>
        bool TryGet(string path, out object value);
    }

    /// <summary>
    /// Resolves one <see cref="CommandRequirement.Kind"/> against live game
    /// state. Implemented by the KSP-facing layer, or by an Uplink for its own
    /// kinds, and registered through <see cref="IUplinkHost.AddGateEvaluator"/>.
    /// </summary>
    ///
    /// <remarks>
    /// <para>Declared in this assembly, which has no KSP reference, precisely so
    /// a THIRD-PARTY Uplink can implement it: an Uplink sees
    /// <see cref="IUplinkHost"/> and this assembly and nothing else, so an
    /// evaluator interface living host-side would have made gating
    /// first-party-only.</para>
    ///
    /// <para><b>Never return <see cref="GateOutcome.Abstain"/>.</b> The host
    /// decides abstention from <see cref="CommandRequirement.Needs"/> before an
    /// evaluator is called, so an evaluator is only ever asked a question it has
    /// the arguments to answer. See <c>Needs</c> for why that arithmetic is
    /// deliberately not distributed.</para>
    /// </remarks>
    public interface ICommandGateEvaluator
    {
        /// <summary>The <see cref="CommandRequirement.Kind"/> this answers.</summary>
        string Kind { get; }

        GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments);
    }

    /// <summary>
    /// Where an Uplink's CLIENT bundle lives, so a third-party Uplink is
    /// self-describing: the app learns the client URL from the running mod, no
    /// central index (design §3.2, D5). A manifest declares this only when it
    /// HAS a client half; a mod-only Uplink leaves
    /// <see cref="UplinkManifest.ClientSource"/> null.
    ///
    /// <para>The integrity hash for this bundle is NOT repeated here, it stays
    /// on <see cref="UplinkManifest.ExpectedClientHash"/> (H_mod), carried
    /// alongside on the same manifest/roster, because the loader's three-way
    /// agreement reads it there.</para>
    /// </summary>
    public sealed class UplinkClientSource
    {
        /// <summary>
        /// The distributable client bundle URL: REQUIRED for a production
        /// Uplink (this is what the app fetches the client half from when the
        /// Uplink ships). Never null on a declared client source.
        /// </summary>
        public string Url { get; set; } = "";

        /// <summary>
        /// Optional local/dev override: a localhost dev-server URL or a local
        /// build directory a third-party dev points at while iterating, so they
        /// get a dev loop without publishing to <see cref="Url"/> each change.
        /// <c>null</c> for a released Uplink (which serves from <see cref="Url"/>).
        /// </summary>
        public string? DevPath { get; set; }
    }

    /// <summary>
    /// The manifest an <see cref="ISitrepUplink"/> exposes: one
    /// registry-unique <see cref="Id"/>, one shared semver <see cref="Version"/>,
    /// and every channel/command it owns. See the design doc §1.1: this is
    /// generated from the C# side in the full contract; here it's simply the
    /// authored source of truth the engine reads at <see cref="ISitrepUplink.Register"/>
    /// time.
    /// </summary>
    public sealed class UplinkManifest
    {
        public string Id { get; set; } = "";
        public string Version { get; set; } = "";
        /// <summary>
        /// Human-facing provenance, emitted on <c>system.uplinks</c> so the
        /// consent dialog can say WHO wrote the thing it is asking to run.
        ///
        /// <para>The consent moment is the only place this matters and the only
        /// reason it is on the wire. An operator being asked to execute a bundle
        /// fetched from a URL they did not choose should be told the author, and
        /// until these existed the dialog said <c>by unknown</c> for every
        /// Uplink, because it had nothing else to say.</para>
        ///
        /// <para>Deliberately three fields and not a metadata block: an id is
        /// not a name, a name is not an author, and a repo is where a suspicious
        /// operator goes to look. Anything else belongs in the Uplink's own
        /// documentation rather than on every roster tick.</para>
        ///
        /// <para>Empty rather than null for a mod that predates them, so a
        /// consumer never has to distinguish "old mod" from "author declined to
        /// say": both render as absent.</para>
        /// </summary>
        public string Name { get; set; } = "";
        /// <inheritdoc cref="Name"/>
        public string Author { get; set; } = "";
        /// <inheritdoc cref="Name"/>
        public string Repo { get; set; } = "";
        /// <summary>
        /// H_mod: the sha256 of the client bundle this DLL was released with, as
        /// <c>sha256-&lt;hex&gt;</c> (design §3.1). Baked at release build by the two-pass
        /// client-hash generator (see the Uplink build script); <c>null</c> for a mod-only
        /// Uplink with no client half, or an unbuilt/dev DLL. Emitted on
        /// <c>system.uplinks.expectedClientHash</c> so the app can enforce the three-way
        /// agreement (index == mod == bytes) before importing the client.
        /// </summary>
        public string? ExpectedClientHash { get; set; }
        /// <summary>
        /// Where this Uplink's client bundle lives (D5), its distributable URL
        /// plus an optional local/dev path. <c>null</c> for a mod-only Uplink
        /// with no client half. Emitted on <c>system.uplinks.clientSource</c>.
        /// </summary>
        public UplinkClientSource? ClientSource { get; set; }
        public IReadOnlyList<ChannelDeclaration> Channels { get; set; } = Array.Empty<ChannelDeclaration>();
        public IReadOnlyList<CommandDeclaration> Commands { get; set; } = Array.Empty<CommandDeclaration>();
    }

    /// <summary>
    /// Fail-soft status for one registered uplink; see the design doc
    /// §1.4 handshake shape. An uplink that throws (or explicitly calls
    /// <see cref="IUplinkHost.SetAvailability"/>) during
    /// <see cref="ISitrepUplink.Register"/> is marked unavailable rather
    /// than crashing the whole engine; every OTHER already/later-registered
    /// uplink is unaffected.
    /// </summary>
    public readonly struct Availability
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }

        private Availability(bool isAvailable, string? reason)
        {
            IsAvailable = isAvailable;
            Reason = reason;
        }

        public static readonly Availability Available = new Availability(true, null);

        public static Availability Unavailable(string reason) => new Availability(false, reason);
    }

    /// <summary>
    /// Contributes raw fragments into a <see cref="KspSnapshot"/> each sample
    /// tick: the C# port of the design doc's <c>ISnapshotSampler</c> (§1.2).
    /// Registered via <see cref="IUplinkHost.AddSampler"/>. Not needed by
    /// <c>system.bodies</c> today (<c>KspHost.Sample</c> already populates
    /// the "bodies" key unconditionally): this exists so a FUTURE uplink
    /// whose data isn't already on the snapshot has somewhere to hook in
    /// without the engine knowing anything KSP-specific.
    /// </summary>
    public interface ISnapshotSampler
    {
        void Sample(KspSnapshot snapshot);
    }

    /// <summary>
    /// Push-style publisher for event-driven / in-process channel sources
    /// (kOS callbacks, GameEvents): the counterpart to the pull-style
    /// <see cref="IUplinkHost.AddChannelSource"/> mapper. Obtained via
    /// <see cref="IUplinkHost.Publisher"/>; <see cref="Publish"/> is safe
    /// to call from the main thread only (it hands off to the engine's own
    /// job queue, same as <see cref="Sitrep.Host.ChannelEngine.Tick"/>).
    /// </summary>
    public interface IChannelPublisher
    {
        void Publish(object? payload, double ut);
    }

    /// <summary>
    /// A registered dynamic namespace's emitter factory: returned by
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>. Generalizes the
    /// fixed single-topic <see cref="IUplinkHost.Publisher"/> to a
    /// runtime-computed sub-topic under a declared prefix (e.g.
    /// <c>scansat.coverage.</c> + <c>"Kerbin.AltimetryLoRes"</c> =
    /// <c>scansat.coverage.Kerbin.AltimetryLoRes</c>): the mechanism U1's
    /// GonogoScansatUplink report flagged as missing (see
    /// <c>.superpowers/sdd/u1-scansat-uplink-report.md</c>'s "Known,
    /// disclosed gap"). Each concrete <c>prefix + subTopic</c> gets its own
    /// independent <see cref="Sitrep.Host.ChannelEmitter"/>
    /// keyframe-on-change/lossy-latest-value state, exactly as though it had
    /// been declared as an ordinary fixed <see cref="ChannelDeclaration"/>,
    /// the ENGINE materializes that declaration (cloned from the
    /// <see cref="ChannelDeclaration"/> template passed to
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>) the first time a
    /// concrete sub-topic is published or subscribed, so subscribers can
    /// target a concrete dynamic topic string exactly as they would a fixed
    /// one: no protocol change on the wire.
    /// </summary>
    public interface IDynamicChannelSource
    {
        /// <summary>Publisher for one concrete sub-topic (<c>prefix + subTopic</c>) under this dynamic namespace.</summary>
        IChannelPublisher Publisher(string subTopic);

        /// <summary>
        /// Registers <paramref name="callback"/> to run on the COURIER
        /// thread every time ANY concrete sub-topic under this namespace's
        /// prefix sees an individual, PER-SESSION subscribe transition,
        /// one call per <c>ProcessSubscribe</c>, regardless of whether the
        /// topic's aggregate subscriber count actually changed (a second
        /// viewer joining an already-subscribed topic, or a resubscribe
        /// faster than a polling consumer's own cadence, both still fire
        /// it). This is the thread-safe seam a consumer that needs to react
        /// to "a specific viewer just subscribed": e.g. seeding a full
        /// repaint baseline for a fresh terminal viewer, should use
        /// INSTEAD of polling a subscriber count from another thread; it
        /// deliberately does not expose (and its caller must never read)
        /// the engine's Courier-thread-only <c>_subscriptions</c> registry.
        ///
        /// <para>Call only during the owning uplink's
        /// <see cref="ISitrepUplink.Register"/>, before the engine starts:
        /// same registration-time-only discipline as
        /// <see cref="IUplinkHost.AddSampler"/> /
        /// <see cref="IUplinkHost.AddChannelSource"/>. The callback itself
        /// runs on the Courier thread (never the registering thread) and
        /// must be safe to call from there; an exception it throws is
        /// caught and logged by the engine so it can never wedge the
        /// Courier thread, but the callback will, in effect, silently
        /// no-op for that invocation.</para>
        /// </summary>
        void OnSubscribed(Action<string> callback);
    }

    /// <summary>
    /// What <see cref="Sitrep.Host.ChannelEngine"/> hands an <see cref="ISitrepUplink"/>
    /// during <see cref="ISitrepUplink.Register"/>: see the design doc
    /// §1.2. Uplinks register PURE pieces here; they never touch the
    /// transport, the Courier, or threading directly: the engine runs
    /// everything registered through this interface.
    /// </summary>
    public interface IUplinkHost
    {
        double NowUt();

        /// <summary>Contribute a sampler that augments the snapshot handed to <see cref="Sitrep.Host.ChannelEngine.Tick"/>. See <see cref="ISnapshotSampler"/>.</summary>
        void AddSampler(ISnapshotSampler sampler);

        /// <summary>
        /// Pull-style channel source: a KSP-free mapper, snapshot -&gt; typed
        /// payload, for a topic the calling uplink already declared in
        /// its <see cref="UplinkManifest.Channels"/>. Exactly
        /// <c>SystemViewProvider.BuildSystemBodies</c>'s shape: the engine
        /// change-gates the result and records it into the Courier.
        /// </summary>
        void AddChannelSource(string topic, Func<KspSnapshot?, object?> map);

        /// <summary>Push-style channel source: see <see cref="IChannelPublisher"/>.</summary>
        IChannelPublisher Publisher(string topic);

        /// <summary>
        /// A <b>capture-on-main / handle-on-Courier</b> source: the
        /// threading-safe seam for an Uplink that must read live KSP/Unity
        /// (or another mod's) APIs that are NOT already on the shared
        /// <see cref="KspSnapshot"/>. Unity APIs are main-thread-only; every
        /// other registration point on this interface either runs off the
        /// main thread (<see cref="AddChannelSource"/>'s mapper and
        /// <see cref="ISnapshotSampler.Sample"/> both run on the engine's
        /// Courier thread) or is fed pre-built snapshot data, so before this
        /// existed a third-party Uplink had no way to read a live API safely,
        /// and doing it from a Courier-thread mapper/sampler is a crash /
        /// garbage-data risk.
        ///
        /// <para><paramref name="captureOnMainThread"/> runs on the SAME
        /// thread and at the SAME cadence the <see cref="KspSnapshot"/> is
        /// built: the Unity main thread, inside <c>GonogoAddon.FixedUpdate</c>
        /// in production (a test driver calls it on whatever thread invokes
        /// <c>ChannelEngine.Tick</c>). It is handed that tick's snapshot (for
        /// <see cref="KspSnapshot.Ut"/> and any already-sampled data) and
        /// returns an OPAQUE payload: plain, self-contained data, NO live
        /// KSP/Unity object references, which the engine carries across to
        /// the Courier thread.</para>
        ///
        /// <para><paramref name="handleOnCourier"/> then runs on the Courier
        /// thread with exactly that captured payload, and does all the
        /// off-thread work: change-gating, packing, and publishing to
        /// channels obtained via <see cref="Publisher"/> /
        /// <see cref="RegisterDynamicNamespace"/>. It MUST NOT touch any
        /// KSP/Unity API, that is the whole reason this seam exists; read
        /// everything KSP-facing in <paramref name="captureOnMainThread"/>
        /// and pass it forward as data.</para>
        ///
        /// <para>Fail-soft, mirroring <see cref="AddSampler"/> /
        /// <see cref="AddChannelSource"/>: a capture OR handle that throws
        /// takes only its own registration's owning Uplink inert (from the
        /// next tick onward): every other source, and the rest of THIS tick,
        /// continues.</para>
        /// </summary>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier);

        /// <summary>
        /// Subscription-gated overload of <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>,
        /// identical capture-on-main / handle-on-Courier semantics, plus
        /// <paramref name="subscriptionTopicPrefixes"/>: the set of channel-topic
        /// prefixes this source PRODUCES (e.g. <c>"scansat.coverage."</c>). When
        /// given, the engine SKIPS <paramref name="captureOnMainThread"/> entirely
        /// on any tick where NO currently-subscribed topic starts with any of these
        /// prefixes: so a source that does expensive main-thread work (grid copies,
        /// stock-API reads) burns nothing while no client is looking. Pass the
        /// prefix(es) an <see cref="RegisterDynamicNamespace"/> owns, and/or the exact
        /// topics a <see cref="Publisher"/> targets (an exact topic is its own prefix).
        ///
        /// <para><b>The gate is a pure early-out ONLY for a capture whose entire
        /// effect is its return value.</b> For one of those it is never a correctness
        /// change: a late subscriber still gets the current value the ordinary way
        /// (the emitter's keyframe-on-subscribe + the Courier archive's catch-up),
        /// because the very next capture after a 0-&gt;1 subscription runs again.
        /// Omitting this overload (or passing no prefixes) preserves the original
        /// always-capture behaviour.</para>
        ///
        /// <para><b>A capture that ALSO writes state something else reads is starved
        /// by this, silently.</b> The skip is total: no capture, so no write, so
        /// every reader of that state sees whatever was last left there, for as long
        /// as nobody subscribes a declared prefix. There is no exception, no log
        /// line, and no degraded mode to notice. If the reader is an EXCLUSIVE
        /// capability there is no vanilla fallback either, because winning the
        /// election is what stops stock answering: the client is told nothing, or is
        /// told positively that there is nothing to tell. Both shapes of that have
        /// shipped from this Uplink surface, and the first was found on a rig rather
        /// than by any test.</para>
        ///
        /// <para><b>So: never gate a capture that feeds anything but its own
        /// topics.</b> Register it with the ungated overload above, and put the
        /// subscription check on the PUBLISH instead if the expensive part is the
        /// packing rather than the reading (<see cref="IsAnyTopicSubscribed"/>).
        /// Skipping a publish starves nothing, because keyframe-on-subscribe hands a
        /// late subscriber the current value; skipping the reading starves everything
        /// downstream of it. An early-out is safe exactly where nothing else reads
        /// what it skips.</para>
        /// </summary>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes);

        /// <summary>
        /// Point-in-time query: is at least one currently-subscribed channel
        /// topic prefixed by <paramref name="topicPrefix"/> (ordinal
        /// <c>StartsWith</c>)? This is the same subscription-awareness the
        /// gated <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?}, string[])"/>
        /// overload applies internally, exposed for an Uplink whose expensive
        /// capture is NOT driven by the engine's sampled-source loop but by an
        /// external callback it cannot gate declaratively: e.g. the kOS
        /// Uplink's <c>ScreenBuffer.Print</c> Harmony postfix, which fires on
        /// EVERY kerboscript <c>PRINT</c> and must short-circuit to nothing
        /// while no <c>kos.compute.*</c> subscriber exists.
        ///
        /// <para>Reads the engine's thread-safe subscribed-topics mirror, so it
        /// is safe to call from the KSP main thread (where the postfix runs) as
        /// well as the Courier thread.</para>
        ///
        /// <para>It carries the SAME condition as the sampled-source gate, and for
        /// the same reason: a pure early-out hint, never a correctness gate, ONLY
        /// where the work it skips produces nothing but the gated topics. A late
        /// subscriber gets the current value the ordinary way
        /// (keyframe-on-subscribe + archive catch-up), so skipping a PUBLISH is
        /// always safe. Skipping a READING that something else derives from is not:
        /// see the gated
        /// <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?}, string[])"/>
        /// overload for what that failure looks like from a client, which is
        /// silence or a confident wrong answer, and nothing at all in a log.</para>
        /// </summary>
        bool IsAnyTopicSubscribed(string topicPrefix);

        /// <summary>
        /// Declares a dynamic namespace: a <paramref name="prefix"/> the
        /// calling uplink owns, plus a <paramref name="template"/>
        /// <see cref="ChannelDeclaration"/> (its <see cref="ChannelDeclaration.Topic"/>
        /// is ignored, every materialized sub-topic gets its own) whose
        /// <see cref="ChannelDeclaration.Delivery"/>/<see cref="ChannelDeclaration.Emission"/>/
        /// <see cref="ChannelDeclaration.Delay"/> apply to every concrete
        /// <c>prefix + subTopic</c> the returned <see cref="IDynamicChannelSource"/>
        /// is asked to publish. Unlike a fixed <see cref="ChannelDeclaration"/>,
        /// nothing under this prefix needs to be individually pre-declared
        /// in <see cref="UplinkManifest.Channels"/>: see
        /// <see cref="IDynamicChannelSource"/>'s doc comment for the
        /// per-concrete-topic keyframe/lossy semantics this preserves.
        /// </summary>
        IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template);

        /// <summary>
        /// Registers the handler for a command the calling uplink already
        /// declared in its <see cref="UplinkManifest.Commands"/>. Whether
        /// this rides the Courier's delay is decided by that declaration's
        /// <see cref="CommandDeclaration.Delayed"/> flag, not by this call.
        /// </summary>
        void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler);

        /// <summary>
        /// Register a handler that is told which command centre the command came
        /// FROM, as well as what it said.
        ///
        /// <para>Additive rather than a widening of the signature above, because
        /// almost no command needs this: setting a throttle means the same thing
        /// wherever it was sent from. The ones that do are the questions whose
        /// correct answer differs per vantage, because each has been told different
        /// things: where a craft goes, what a plan would do. Those cannot be answered
        /// from the game's own state, which is every vantage's future.</para>
        ///
        /// <para>The vantage is the sender's, resolved where the command entered
        /// rather than passed in its arguments. A client that named its own vantage
        /// in a payload could name another one.</para>
        /// </summary>
        void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler);

        /// <summary>
        /// Register an evaluator for one <see cref="CommandRequirement.Kind"/>.
        ///
        /// <para>Available to any Uplink, first-party or not, so an Uplink can
        /// gate its own commands on its own conditions rather than only on the
        /// kinds core happens to ship.</para>
        ///
        /// <para>Registration ORDER is not controllable across Uplinks, so a
        /// command may declare a requirement whose evaluator registers later, or
        /// never. The engine therefore validates the pairing ONCE after every
        /// Uplink has registered rather than at the moment a handler is added: a
        /// declared kind with no evaluator is a startup failure, because a gate
        /// nobody can evaluate is a gate that silently does not exist.</para>
        /// </summary>
        void AddGateEvaluator(ICommandGateEvaluator evaluator);

        /// <summary>
        /// Contribute one <see cref="CommandRequirement"/> to a command this
        /// Uplink does not own, so an installed mod can impose its own
        /// precondition on a command core declared.
        ///
        /// <para><b>Why a command needs preconditions from elsewhere.</b> The
        /// Uplink that declares a command knows what the GAME requires of it.
        /// It cannot know what an installed mod requires, and under a career
        /// overhaul that is most of what stands between an operator and a launch:
        /// stock will fly any craft file, RP-1 will fly only a vehicle a launch
        /// complex integrated and then rolled out to a pad. A launch that walks
        /// past both steps passes every stock test on the way.</para>
        ///
        /// <para><b>Contribution, not election.</b> Preconditions COMPOSE: two
        /// mods may each legitimately impose one, and every requirement on a
        /// command has to hold. So this appends, and an exclusive capability with
        /// one winning provider would have silently dropped the loser's
        /// condition. Registering IS the gate, the same way every presence-probed
        /// registration in this contract works: an Uplink whose mod is absent
        /// contributes nothing, and contributing nothing is a complete answer
        /// rather than an absent one.</para>
        ///
        /// <para><b>Order.</b> Contributions are evaluated AFTER the owning
        /// Uplink's own declared requirements, in the order they were
        /// contributed. That matters because the engine returns on the first
        /// non-Pass verdict: core's launch requirements are answerable with no
        /// arguments and can darken a control in advance, and a contributed
        /// requirement that abstains ahead of them would hide every one of
        /// those.</para>
        ///
        /// <para><b>The kind still needs an evaluator</b>
        /// (<see cref="AddGateEvaluator"/>), validated once after every Uplink has
        /// registered. A contributed requirement nobody can evaluate is a startup
        /// failure for the same reason a declared one is.</para>
        ///
        /// <para>Contributing to a command that does not exist is an error at
        /// validation time rather than a silent no-op: a typo would otherwise
        /// read as a condition that is being enforced.</para>
        /// </summary>
        void AddCommandRequirement(string command, CommandRequirement requirement);

        /// <summary>
        /// Advertise the AUTHORITATIVE <c>comms.delay</c> one-way signal delay to
        /// the engine's server-side reveal gate: the choke point that makes
        /// <see cref="DelayRole.Delayed"/> channels actually withheld on the host
        /// (spec-streaming-delay-model §4 / §7.3 Step 2). <paramref name="computeOnMainThread"/>
        /// is evaluated on the SAME thread and cadence as
        /// <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>'s
        /// capture (the Unity main thread in production), so it may safely read
        /// the live elected comms backend, and it runs EVERY tick regardless of
        /// what any client has subscribed, that subscription-independence is the
        /// whole point.
        ///
        /// <para><b>Why this exists as a first-class seam:</b> the bundled
        /// comms uplink publishes <c>comms.delay</c> through a
        /// <see cref="Publisher"/> fed by a capture-on-main /
        /// handle-on-Courier <see cref="AddSampledSource"/> (live KSP reads must
        /// stay on the main thread). That is NOT the pull-style
        /// <see cref="AddChannelSource"/> shape the engine's per-tick delay
        /// refresh could read, and the publish path is subscription-gated, so
        /// with the production registration the reveal gate never learned the
        /// delay and delivered Delayed channels live. This seam hands the gate
        /// the delay directly, computed server-side, subscription-independent.</para>
        ///
        /// <para>Fail-soft, mirroring the other registration points: a
        /// <paramref name="computeOnMainThread"/> that throws takes only its
        /// owning uplink inert (from the next tick onward); a <c>null</c> result
        /// (or a <see cref="CommsDelaySource.None"/> / non-positive value) leaves
        /// the last-known delay untouched and never reveals a Delayed channel
        /// earlier than the known horizon. Registering no source at all keeps
        /// today's behaviour: with no delay authority every channel is revealed
        /// live.</para>
        /// </summary>
        void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread);

        /// <summary>
        /// Set the one-way routed light-time for a FLEET vessel's telemetry
        /// (Plan 2): the vessel's <c>fleet.&lt;vesselId&gt;.*</c> topics are
        /// delayed by this from the single KSC observer. Call it per vessel each
        /// fleet-capture tick (from the handle-on-Courier half of a gated
        /// <see cref="AddSampledSource"/>). Unlike <see cref="SetSignalDelaySource"/>
        /// (the active vessel's global authority), this is a per-subject node
        /// delay: freeze stays global in Plan 2 (the reveal gate is unchanged).
        /// </summary>
        void SetVesselDelay(string vesselId, double oneWaySeconds);

        /// <summary>
        /// Set the per-(authority, subject) command delay (Plan 3): the one-way
        /// light-time from a command centre (<paramref name="centreId"/>, an
        /// authority/vantage) to a fleet subject. Writes the EXPLICIT (vantage,
        /// node) pair tier, which overrides the <see cref="SetVesselDelay"/>
        /// node-default for that observer; the node-default stays underneath for
        /// any unselected vantage. Populated per capture pass, one row per active
        /// centre x subject (minus the crewed-centre self-exclusion).
        /// </summary>
        void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds);

        /// <summary>
        /// Set the one-way light-time BETWEEN two command centres: the delay a
        /// command takes travelling from <paramref name="fromCentreId"/> (a
        /// vantage) to <paramref name="toCentreId"/> addressed as a destination
        /// node. Same explicit (vantage, node) tier as
        /// <see cref="SetAuthorityDelay"/>; the difference is that the subject is
        /// a centre rather than a craft, which is what an act aimed at the
        /// program's home centre (a currency spend) needs in order to be delayed
        /// at all. Populated per capture pass, one row per ordered pair of active
        /// centres that are routable to each other.
        /// </summary>
        void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds);

        /// <summary>
        /// Set a FLEET vessel's connectivity (Plan 2b): its
        /// <c>fleet.&lt;vesselId&gt;.*</c> topics freeze on ITS OWN link
        /// independently of the active vessel. Call it per vessel each
        /// fleet-capture tick (from the gated capture's handle-on-Courier).
        /// The active vessel's connectivity stays on the ungated
        /// <see cref="SetConnectivitySource"/>; this is the per-subject freeze
        /// lever for background fleet vessels.
        /// </summary>
        void SetVesselConnectivity(string vesselId, bool connected);

        /// <summary>
        /// Advertise the AUTHORITATIVE CONNECTED/DISCONNECTED control-link state
        /// to the engine's server-side reveal gate: the freeze-on-disconnect
        /// half of the enforcement <see cref="SetSignalDelaySource"/> started
        /// (spec-streaming-delay-model). <paramref name="computeOnMainThread"/>
        /// is evaluated on the SAME thread and cadence as
        /// <see cref="SetSignalDelaySource"/> (the Unity main thread in
        /// production, every tick, subscription-independently), so it may safely
        /// read the elected comms backend's connectivity.
        ///
        /// <para><b>Why distinct from delay magnitude:</b> a down link produces a
        /// <see cref="CommsDelaySource.None"/> / zero delay that is
        /// INDISTINGUISHABLE from a genuine connected, in-LOS, zero-distance
        /// link. Delay 0 alone must still reveal live; only a real DISCONNECTED
        /// state freezes. When disconnected the gate withholds every
        /// <see cref="DelayRole.Delayed"/> channel (nothing new delivered =
        /// frozen at last-known) while <see cref="DelayRole.TrueNow"/> channels
        /// (comms.delay / comms.connectivity / time.* / system.bodies) keep
        /// flowing, so the operator sees the outage live; on reconnect the
        /// withheld backlog is dropped and delivery resumes from the reconnect
        /// moment.</para>
        ///
        /// <para>Fail-soft, mirroring <see cref="SetSignalDelaySource"/>: a
        /// throwing source takes only its owning uplink inert and reverts the
        /// gate to CONNECTED; a <c>null</c> result leaves the last-known state
        /// untouched; registering no source at all keeps today's behaviour (the
        /// gate treats the link as always CONNECTED; never worse than the
        /// pre-freeze LAN path).</para>
        /// </summary>
        void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread);

        /// <summary>
        /// Advertise a BREAK in the subject's route home: the drop event, the
        /// third and last thing the reveal gate's delay authority can say.
        /// Evaluated on the SAME thread and cadence as
        /// <see cref="SetSignalDelaySource"/> and
        /// <see cref="SetConnectivitySource"/>, with the tick's UT, so it may
        /// read the elected comms backend's hop geometry and routing.
        ///
        /// <para><b>Why none of the other two can carry it.</b> The delay says
        /// how far away the craft is and can say further and nearer; it has no
        /// honest value for GONE, and forcing one through produces a zero, a
        /// null or an infinity that some other reader will take at face value.
        /// Connectivity says whether anything NEW can be sent, which is a
        /// different question from what becomes of the light already on the
        /// wire: a relay dying mid-flight leaves the craft connected by another
        /// route while the tail crossing the dead one is lost. That tail is what
        /// this reports, and it is the only statement that can retire a sample
        /// which could not physically have arrived.</para>
        ///
        /// <para>The break carries a POSITION as well as an instant, because
        /// position is what decides whether rather than when: light already past
        /// the break point is on the far leg and lands normally.
        /// <c>Sitrep.Host.Comms.PathBreakWatch</c> is the shipped producer, and
        /// its doc comment carries the reroute-versus-destruction discrimination
        /// and the warp domain the answer is only valid inside.</para>
        ///
        /// <para>INTERNAL to the delay machinery: nothing about a break reaches
        /// the wire, and a client sees only the silence it produces.</para>
        ///
        /// <para>Fail-soft, mirroring the two sources above: a throwing source
        /// takes only its owning uplink inert, a <c>null</c> result is the
        /// ordinary "no break this tick", and registering no source at all keeps
        /// today's behaviour, which is that every recorded sample is delivered
        /// at its own light-time whatever became of the route.</para>
        /// </summary>
        void SetPathBreakSource(Func<KspSnapshot?, double, PathBreak?> computeOnMainThread);

        /// <summary>The C# port of <c>mod/sitrep-kernel</c>'s capability/provider registry (see <see cref="Kernel"/>).</summary>
        Kernel Kernel { get; }

        /// <summary>
        /// Fail-soft: flag the CURRENTLY-registering uplink as unavailable (see
        /// <see cref="Availability"/>), so an uplink whose mod is not installed
        /// says so and returns instead of throwing. The rest of Gonogo loads
        /// either way.
        ///
        /// <para>Registration-time only: it names the uplink whose
        /// <see cref="ISitrepUplink.Register"/> is on the stack, so a call from a
        /// callback, a command handler, or anywhere after
        /// <see cref="ISitrepUplink.Register"/> has returned writes nothing. That
        /// call is logged rather than dropped in silence, and the state it wanted
        /// to report belongs on <see cref="ISitrepUplink.Health"/>, which is
        /// polled for exactly this.</para>
        /// </summary>
        void SetAvailability(Availability availability);

        /// <summary>
        /// Force an unconditional keyframe on <paramref name="topic"/>'s
        /// NEXT <c>ChannelEmitter.Decide</c> call: the same mechanism a
        /// genuine 0→1 subscribe transition already uses (see
        /// <c>ChannelEmitter.NotifySubscribed</c>). The load-bearing use
        /// case is a subject-provenance epoch (see
        /// <see cref="Sitrep.Host.VesselEpochSampler"/>): when the thing a channel
        /// describes changes identity mid-stream, the NEXT sample must be
        /// an unconditional keyframe, not something a deadband/cadence gate
        /// can suppress or delay. MUST be called only from within a
        /// registered <see cref="ISnapshotSampler.Sample"/> or a command
        /// handler: both of which the engine already runs exclusively on
        /// its Courier thread; calling this from arbitrary main-thread code
        /// would race the emitter's per-channel state with no
        /// synchronization.
        /// </summary>
        void ForceKeyframe(string topic);

        /// <summary>
        /// Clears the "has this channel ever emitted a non-null value"
        /// birth-guard (see <c>ChannelEngine</c>'s <c>_born</c> field doc
        /// comment) for EXACTLY the given <paramref name="topics"/>, WITHOUT
        /// touching the emitter's force-keyframe state (compare
        /// <see cref="ForceKeyframe"/>, which this is meant to be called
        /// ALONGSIDE, not instead of). The M2 subject-scoped-birth seam: a
        /// subject switch (see <see cref="Sitrep.Host.VesselEpochSampler"/>) calls this
        /// for every topic it owns so a channel the NEW subject has never
        /// populated goes back to "not yet a subject", rather than
        /// inheriting the PREVIOUS subject's birth state and emitting a
        /// spurious tombstone for data the new subject simply never had.
        /// MUST be called only from within a registered
        /// <see cref="ISnapshotSampler.Sample"/> or a command handler: same
        /// Courier-thread-only rule as <see cref="ForceKeyframe"/>.
        /// </summary>
        void ResetChannelBirth(IEnumerable<string> topics);
    }

    /// <summary>
    /// One self-contained uplink: the C# half of the design doc's
    /// two-half contract (§1.1). Ships in GameData; registers PURE pieces
    /// (channel sources, command handlers, capability providers) against an
    /// <see cref="IUplinkHost"/> and never touches transport/threading
    /// itself. <c>system.bodies</c>'s retrofit
    /// (<c>Gonogo.KSP.SystemUplink</c>) is the reference implementation,
    /// see the design doc §6.1.
    ///
    /// <para><b>Lives in <c>Sitrep.Contract</c>, not <c>Sitrep.Host</c>
    /// (moved here in the Uplink-foundation review's fix round):</b> this
    /// interface, <see cref="UplinkManifest"/>, <see cref="IUplinkHost"/>,
    /// and everything else <see cref="Register"/>'s signature transitively
    /// needs (<see cref="ChannelDeclaration"/>, <see cref="CommandDeclaration"/>,
    /// <see cref="Delivery"/>, <see cref="Availability"/>,
    /// <see cref="ISnapshotSampler"/>, <see cref="IChannelPublisher"/>,
    /// <see cref="Sitrep.Contract.KspSnapshot"/>, <see cref="Kernel"/>, and
    /// <see cref="EmissionPolicy"/>) are the COMPLETE set a third-party
    /// Uplink needs to implement this interface and compile against
    /// <c>Sitrep.Contract</c> ALONE: no reference to <c>Sitrep.Host</c>
    /// (the engine: <c>ChannelEngine</c>, discovery, transport) is ever
    /// required. That's the whole point of the split: <c>Sitrep.Contract</c>
    /// is the planned MIT/BSD carve-out, and an Uplink author's compile-time
    /// surface must not leak engine internals. <c>Sitrep.Host</c> keeps
    /// everything ELSE: the engine that CONSUMES this interface
    /// (<c>ChannelEngine.RegisterUplink</c>/<c>RegisterDiscoveredUplink</c>)
    /// and the assembly-scan discovery that finds implementations of it
    /// (<c>UplinkDiscovery</c>) both still live there; only the SHAPE an
    /// Uplink author programs against moved.</para>
    /// </summary>
    public interface ISitrepUplink
    {
        UplinkManifest Manifest { get; }

        /// <summary>
        /// Called once, on the main thread, by <see cref="Sitrep.Host.ChannelEngine.RegisterUplink"/>.
        /// Throwing here (or calling <see cref="IUplinkHost.SetAvailability"/>
        /// with an unavailable status) fail-softs THIS uplink only, every
        /// other registered uplink is unaffected.
        /// </summary>
        void Register(IUplinkHost host);

        /// <summary>
        /// This uplink's current health: a MANDATORY self-report (2026-07-21,
        /// <c>local_docs/holiday_week/HIGH-PRIORITY-mandatory-healthchecks.md</c>).
        /// Every uplink MUST report health: it is a required member of the base
        /// contract (NOT a default), so an uplink that does not consciously report
        /// does not compile, only the uplink itself knows what "ready" means for
        /// it (kOS needs a CPU on the vessel, comms needs a backend elected, a
        /// plain channel uplink just means "registered without error"). The FLOOR
        /// is one line, <c>public UplinkHealth Health() =&gt; UplinkHealth.Healthy;</c>
        /// via <see cref="UplinkHealth.Healthy"/>: so the mandate is cheap;
        /// RICHNESS (a denser <see cref="UplinkHealth.Detail"/> string) stays the
        /// author's choice.
        ///
        /// <para>Called on the tick/Courier thread while building
        /// <c>system.uplinks</c> (polled on EVERY sample) so it must be cheap
        /// (a simple state check, no blocking I/O) and fail-soft. The engine wraps
        /// the call in a try/catch regardless: a throw here is reported as
        /// <see cref="UplinkHealthState.Degraded"/> with the exception message as
        /// <see cref="UplinkHealth.Detail"/>, and does NOT disable the uplink's
        /// other channels/commands: this is a read, not a registration step.</para>
        /// </summary>
        UplinkHealth Health();
    }

    /// <summary>
    /// OPTIONAL companion to <see cref="ISitrepUplink"/> that lets an uplink
    /// declare its capability descriptors in a discovery pass that runs BEFORE
    /// any uplink's <see cref="ISitrepUplink.Register"/>: the two-pass fix for
    /// the capability-vs-provider registration-order hazard.
    ///
    /// <para><b>The problem this closes:</b> <see cref="Kernel.RegisterProvider"/>
    /// throws if the capability it targets has not been registered yet, and
    /// assembly-scan discovery (<c>AppDomain.GetAssemblies()</c> /
    /// <c>GetTypes()</c>) fixes NO order between uplinks. So an uplink that
    /// registers a <c>"comms"</c> PROVIDER (e.g. RealAntennas) could run before
    /// the uplink that owns the <c>"comms"</c> CAPABILITY, the provider
    /// registration would throw, be swallowed, and the provider would silently
    /// never take part in the election even though it loaded.</para>
    ///
    /// <para><b>The contract:</b> an uplink that owns a capability declares it
    /// here (via <see cref="Kernel.RegisterCapability"/>) instead of in
    /// <see cref="ISitrepUplink.Register"/>. The host runs
    /// <see cref="DeclareCapabilities"/> for EVERY discovered uplink first, so
    /// by the time any <see cref="ISitrepUplink.Register"/> runs its
    /// <see cref="Kernel.RegisterProvider"/> call, the target capability is
    /// guaranteed present regardless of discovery order. PROVIDERS still
    /// register in <see cref="ISitrepUplink.Register"/> as before: only
    /// capability DECLARATIONS move to this earlier pass. Implementing this
    /// interface is optional: an uplink that registers no capability of its own
    /// (every provider-only or channel-only uplink) does not need it.</para>
    ///
    /// <para>Not shape-gated: this is an SPI interface on the Uplink-facing
    /// surface, not a <c>[SitrepContract]</c> wire type, so adding it is an
    /// additive Minor change that does not bump <see cref="ContractVersion"/>.</para>
    /// </summary>
    public interface IUplinkCapabilityDeclarer
    {
        /// <summary>
        /// Register this uplink's capability descriptor(s) on
        /// <paramref name="kernel"/>. Runs once, on the main thread, in the
        /// pre-<see cref="ISitrepUplink.Register"/> discovery pass. Throwing here
        /// fail-softs THIS uplink only (its <see cref="ISitrepUplink.Register"/>
        /// is then skipped); every other uplink is unaffected.
        /// </summary>
        void DeclareCapabilities(Kernel kernel);
    }

    /// <summary>
    /// Coarse self-reported health for one <see cref="ISitrepUplink"/>; see
    /// <see cref="IUplinkHealthReporter"/>.
    /// </summary>
    public enum UplinkHealthState
    {
        Healthy,
        Degraded,
        Unavailable,
    }

    /// <summary>
    /// One labelled diagnostic on an <see cref="UplinkHealth"/>: which file, which
    /// build, which hash, whatever an operator would have to quote when reporting
    /// this uplink's state to somebody else.
    ///
    /// <para>Both halves are plain display text and the engine parses neither. A
    /// client renders the list as rows without knowing what any uplink is, which is
    /// the whole point: an uplink that wants to publish its dependency's identity
    /// does not need a topic of its own, and a client does not need to learn a
    /// vendor-specific payload shape to show it.</para>
    ///
    /// <para>Facts are for what would go in a bug report, not for anything a
    /// reading is taken from. A number that changes as the mission runs is
    /// telemetry and belongs on a channel, where it gets a unit, a delay role and a
    /// history; putting it here would make it a string nobody can plot.</para>
    /// </summary>
    public readonly struct UplinkHealthFact
    {
        /// <summary>What the value is, in the operator's terms, e.g. "binary".</summary>
        public string Label { get; }

        /// <summary>The value as it should read on a screen. Null when the uplink
        /// knows the fact applies but has not established it.</summary>
        public string? Value { get; }

        public UplinkHealthFact(string label, string? value)
        {
            Label = label;
            Value = value;
        }
    }

    /// <summary>
    /// One <see cref="IUplinkHealthReporter.Health"/> result: a coarse
    /// <see cref="State"/> plus an OPTIONAL uplink-authored <see cref="Detail"/>
    /// string explaining what "ready" means for THIS uplink (e.g. "no active
    /// CPU selected" for kOS, "no comms backend elected" for comms). The
    /// engine never fabricates or parses <see cref="Detail"/>, it is opaque,
    /// display-only text the uplink itself writes.
    ///
    /// <para><see cref="Facts"/> carries the same author's-own text in a form a
    /// client can lay out: the identity of whatever this uplink depends on, one
    /// labelled row at a time. <see cref="State"/> is the glanceable answer and
    /// <see cref="Detail"/> the sentence beneath it; the facts are what somebody
    /// diagnosing the state would need to quote, and they are deliberately not the
    /// same length as either.</para>
    /// </summary>
    public readonly struct UplinkHealth
    {
        public UplinkHealthState State { get; }
        public string? Detail { get; }

        /// <summary>
        /// Labelled diagnostics, in the order the author wants them read. Never
        /// null: an uplink with nothing to add reports an empty list, so a client
        /// enumerates unconditionally.
        /// </summary>
        public IReadOnlyList<UplinkHealthFact> Facts { get; }

        public UplinkHealth(UplinkHealthState state, string? detail = null)
            : this(state, detail, null)
        {
        }

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
        /// The trivial "all good, nothing to say" result, a shared instance so
        /// the mandatory floor for a plain uplink is one line:
        /// <c>public UplinkHealth Health() =&gt; UplinkHealth.Healthy;</c>. State
        /// <see cref="UplinkHealthState.Healthy"/>, no <see cref="Detail"/>.
        /// </summary>
        public static readonly UplinkHealth Healthy = new UplinkHealth(UplinkHealthState.Healthy);

        /// <summary>
        /// Working, but not as it should be: the uplink is registered and its
        /// dependency is present, and something it needs is missing or wrong
        /// (no CPU selected, a capture that threw, a version it does not
        /// recognise). <paramref name="detail"/> is the sentence an operator
        /// reads under the state, and a degraded report is the one shape where
        /// omitting it leaves them nothing to act on.
        ///
        /// <para>A factory rather than a field, exactly as
        /// <see cref="Availability.Unavailable"/> is one beside
        /// <see cref="Availability.Available"/>: the healthy case has nothing
        /// to say and can be a shared value, and these two cannot honestly
        /// exist without a reason.</para>
        /// </summary>
        public static UplinkHealth Degraded(
            string detail,
            IReadOnlyList<UplinkHealthFact>? facts = null) =>
            new UplinkHealth(UplinkHealthState.Degraded, detail, facts);

        /// <summary>
        /// Not usable at all: the mod this uplink integrates is absent, or a
        /// capability it depends on never resolved, so none of its channels
        /// will carry anything. <paramref name="detail"/> says which, in the
        /// operator's terms. A factory for the same reason
        /// <see cref="Degraded"/> is one.
        /// </summary>
        public static UplinkHealth Unavailable(
            string detail,
            IReadOnlyList<UplinkHealthFact>? facts = null) =>
            new UplinkHealth(UplinkHealthState.Unavailable, detail, facts);
    }

    // Health is MANDATORY, not opt-in: `Health()` is a member of the base
    // `ISitrepUplink` (see that interface's doc), so every uplink reports it or
    // does not compile. There is deliberately no optional reporter interface to
    // implement instead.
}
