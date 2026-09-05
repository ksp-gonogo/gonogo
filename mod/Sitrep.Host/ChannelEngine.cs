using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using Sitrep.Propagation;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Transport;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host
{
    /// <summary>
    /// The multi-topic generalization of <c>Gonogo.KSP.GonogoBodiesServer</c> /
    /// <c>Sitrep.Host.IntegrationTests.ReplayBodiesServer</c> (both retired:
    /// see <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c>
    /// §1.2/§6.1). Owns EVERYTHING those two paired, hand-copied classes
    /// owned: the <see cref="SubscriptionRegistry"/> outer gate, the
    /// per-topic <see cref="ChannelEmitter"/> inner gate, the <see cref="Courier"/>
    /// + delay, the timeline-reset broadcast, and the three-domain threading
    /// model (main-loop / Courier / socket): but drives a SET of channels
    /// and commands registered by <see cref="ISitrepUplink"/>s, not one
    /// hardwired <c>system.bodies</c> topic. This is the design doc's central
    /// rule made concrete: "providers are registered mappers; the engine owns
    /// the pipeline."
    ///
    /// KSP is never touched here, same discipline <c>GonogoBodiesServer</c>
    /// followed: the caller (<c>GonogoAddon.FixedUpdate</c> in production, a
    /// test driver headlessly) samples <see cref="IKspHost"/> and hands the
    /// already-built <see cref="KspSnapshot"/> to <see cref="Tick"/>, which
    /// only ever touches primitives, registered mapper delegates, and the
    /// explicit job queue.
    /// </summary>
    public sealed class ChannelEngine : IUplinkHost, IDisposable
    {
        public const string NodeId = "system";

        /// <summary>
        /// The everywhere-at-once observer vantage: <c>DelayTo(MetaVantage, *)</c>
        /// is pinned to 0 so instant/exempt topics (comms.delay, comms.link,
        /// TrueNow) are never delayed by the ledger even after the whole-network
        /// default carries the signal delay (Plan 1). Keeps "instant" a vantage,
        /// not a separate code path.
        /// </summary>
        public const string MetaVantage = "meta";

        /// <summary>
        /// The default command centre a connection commands from and observes at
        /// until it selects another (Plan 3). "ksc" is the stock home-node centre;
        /// with only KSC enumerated and no explicit (vantage, node) authority rows
        /// set, <c>DelayTo("ksc", node)</c> falls through to Plan 2's node-default,
        /// so KSC-only behaviour is identical to Plan 2.
        /// </summary>
        public const string DefaultVantage = "ksc";

        /// <summary>
        /// Per-vessel node namespace (Plan 2): a topic "fleet.&lt;guid&gt;.&lt;field&gt;"
        /// records under the per-vessel Courier node "fleet.&lt;guid&gt;", so
        /// <c>DelayTo(vantage, node)</c> can give each vessel its own light-time.
        /// Every other topic uses the single <see cref="NodeId"/>. The delay per
        /// vessel node is populated by the fleet capture; freeze stays global in
        /// Plan 2 (the reveal gate is unchanged).
        /// </summary>
        public const string FleetNodePrefix = "fleet.";

        /// <summary>
        /// Per-centre node namespace: the id under which a command centre can be
        /// addressed as the DESTINATION of a command, mirroring
        /// <see cref="FleetNodePrefix"/>'s per-vessel one. A centre is otherwise
        /// only ever a vantage (the left-hand side of
        /// <c>DelayTo(vantage, node)</c>), which leaves no id to name when the
        /// thing being commanded is another centre rather than a craft, and a
        /// currency spend routed to the program's home centre is exactly that.
        ///
        /// <para>Delay-only for now: no channel publishes under this prefix, so
        /// <see cref="NodeForTopic"/> deliberately does not map it. The node
        /// exists to be the right-hand side of a delay lookup, not to carry
        /// telemetry.</para>
        /// </summary>
        public const string CentreNodePrefix = "centre.";

        /// <summary>
        /// Source-attributed currency-event namespace: a
        /// "currency.&lt;guid&gt;.&lt;currency&gt;" topic records under the SAME
        /// per-vessel node "fleet.&lt;guid&gt;" that vessel's telemetry uses, so the
        /// event is revealed at <c>DelayTo(vantage, thatVessel)</c> -- the light-time
        /// of the vessel the delta came FROM, not the observer's ambient
        /// vantage-to-KSC delay (which is 0 for an operator at the default KSC
        /// vantage, i.e. no delay at all) and not the active vessel's.
        ///
        /// <para>A currency total reveals instantly (<c>career.status</c> is
        /// <see cref="DelayRole.TrueNow"/>, deliberately: it gates spend decisions)
        /// while the vessel telemetry that would confirm the underlying event is
        /// Delayed, so an operator could infer a distant event early by watching the
        /// number. Attributing a delta to its source vessel and revealing it on that
        /// vessel's own clock closes that gap without touching the gating total.</para>
        ///
        /// <para>A DISJOINT prefix rather than publishing under
        /// <see cref="FleetNodePrefix"/> directly, because
        /// <see cref="RegisterDynamicNamespace"/> is last-registration-wins per
        /// prefix: a second uplink registering "fleet." would overwrite the fleet
        /// capture's LossyLatest template (and its channel ownership) with the
        /// event lane's ReliableOrdered one. Same node, own namespace, earned by
        /// declaring <see cref="ChannelDeclaration.PerVesselNode"/> at the
        /// registration rather than by being named here.</para>
        /// </summary>
        public const string CurrencyEventPrefix = "currency.";

        /// <summary>
        /// Source-attributed comms-silence namespace: a "silence.&lt;guid&gt;.&lt;field&gt;"
        /// topic records under the SAME per-vessel node "fleet.&lt;guid&gt;" that
        /// vessel's telemetry uses, same mapping <see cref="CurrencyEventPrefix"/>
        /// gets and for the same reason: the mod-side <c>SilenceTracker</c>'s
        /// reckoning of a vessel (is it in contact, how long has it been dark, when
        /// is it declared lost) is a COMMS-owned opinion about that vessel, not core
        /// fleet telemetry, so it is registered from the comms uplink's own
        /// <c>Register</c> rather than the always-on fleet dynamic namespace.
        ///
        /// <para>A DISJOINT prefix rather than publishing under
        /// <see cref="FleetNodePrefix"/> directly, for the same reason
        /// <see cref="CurrencyEventPrefix"/> is disjoint:
        /// <see cref="RegisterDynamicNamespace"/> is last-registration-wins per
        /// prefix, and re-registering "fleet." here would clobber the fleet
        /// capture's own template/ownership. Same node, own namespace, earned by
        /// declaring <see cref="ChannelDeclaration.PerVesselNode"/> at the
        /// registration rather than by being named here.</para>
        /// </summary>
        public const string SilenceEventPrefix = "silence.";

        /// <summary>
        /// Resolves the Courier node a topic records/subscribes under, for the
        /// namespaces core owns itself: a per-vessel
        /// "fleet.&lt;guid&gt;.&lt;field&gt;" topic maps to its own node
        /// "fleet.&lt;guid&gt;", everything else to the single
        /// <see cref="NodeId"/>. An Uplink's OWN per-vessel namespace routes
        /// through <see cref="NodeFor"/> instead, which consults what each
        /// namespace declared; this is the fallback beneath it. Together they
        /// are the ONLY seam that makes the node axis per-vessel (Plan 2), the
        /// Courier/Archive already key by opaque node.
        /// </summary>
        internal static string NodeForTopic(string topic)
        {
            if (!topic.StartsWith(FleetNodePrefix, StringComparison.Ordinal))
            {
                return NodeId;
            }
            var dot = topic.IndexOf('.', FleetNodePrefix.Length);
            return dot < 0 ? NodeId : topic.Substring(0, dot);
        }

        /// <summary>
        /// The node a topic records/subscribes under, honouring every dynamic
        /// namespace registered with <see cref="ChannelDeclaration.PerVesselNode"/>:
        /// a "&lt;prefix&gt;&lt;guid&gt;.&lt;field&gt;" topic under one of those
        /// records on that craft's own "fleet.&lt;guid&gt;" node, so it reveals
        /// at that craft's light-time rather than the active vessel's. Falls
        /// back to <see cref="NodeForTopic"/> for core's own namespaces.
        ///
        /// <para>Every per-vessel namespace is a DECLARATION rather than a name
        /// written in here, including the two that were once hardcoded
        /// (<see cref="CurrencyEventPrefix"/>, <see cref="SilenceEventPrefix"/>):
        /// the routing an Uplink needs cannot be conditional on core having
        /// heard of that Uplink.</para>
        /// </summary>
        internal string NodeFor(string topic)
        {
            foreach (var prefix in _perVesselNamespacePrefixes)
            {
                if (!topic.StartsWith(prefix, StringComparison.Ordinal))
                {
                    continue;
                }
                var guid = GuidSegment(topic, prefix.Length);
                return guid == null ? NodeId : FleetNodePrefix + guid;
            }
            return NodeForTopic(topic);
        }

        /// <summary>
        /// The vessel-guid segment of a per-vessel topic: the text between
        /// <paramref name="start"/> and the next '.', or null when the topic carries
        /// no field after the guid (a bare "currency.&lt;guid&gt;" is not a channel, so
        /// it falls back to <see cref="NodeId"/> rather than inventing a node).
        /// </summary>
        private static string? GuidSegment(string topic, int start)
        {
            var dot = topic.IndexOf('.', start);
            return dot <= start ? null : topic.Substring(start, dot - start);
        }

        private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(50);

        /// <summary>
        /// C1-pub tolerance: <see cref="ProcessPublish"/> clamps a
        /// caller-stamped <c>ut</c> that lands meaningfully ahead of the
        /// clock's current position at processing time (a ghost publish from
        /// before a quickload rewind: see ProcessPublish's own comment). A
        /// tiny epsilon (rather than an exact `&gt;`) absorbs floating-point
        /// noise only: it is NOT meant to tolerate genuine slack between when
        /// an uplink reads "now" and when its Publish call is processed.
        /// </summary>
        private const double PublishUtToleranceSeconds = 1e-6;

        private readonly ManualClock _clock;
        private readonly INetwork _network;
        private readonly Courier _courier;
        private readonly FleckTransportListener _listener;
        private readonly Kernel _kernel = new Kernel();

        // Plan 3: the registered command-centre sources; enumerated to validate a
        // set-vantage request (a centre must be active to be selectable, though
        // DefaultVantage is always allowed).
        private readonly CommandCentres.CommandCentreRegistry _commandCentres = new CommandCentres.CommandCentreRegistry();

        /// <summary>
        /// Gate evaluators by <see cref="CommandRequirement.Kind"/>. Populated
        /// during Uplink registration, in no controllable order, which is why the
        /// declared-kind-has-an-evaluator check is a pass after registration
        /// rather than a guard inside <see cref="AddCommandHandler{TArgs,TResult}"/>.
        /// </summary>
        private readonly Dictionary<string, ICommandGateEvaluator> _gateEvaluators =
            new Dictionary<string, ICommandGateEvaluator>(StringComparer.Ordinal);

        // Requirements an Uplink contributed to a command it does not own (see
        // IUplinkHost.AddCommandRequirement). Kept apart from the owning
        // declaration rather than merged into it so the two orders stay fixed:
        // the owner's static requirements are evaluated first and can darken a
        // control in advance, contributions follow in the order they arrived.
        private readonly Dictionary<string, List<CommandRequirement>> _contributedRequirements =
            new Dictionary<string, List<CommandRequirement>>(StringComparer.Ordinal);

        // The last main-thread gate sample, published to system.uplink.gates by
        // the Courier-thread mapper. See SampleCommandGates.
        private CommandGateReport _commandGateReport = new CommandGateReport();

        // Wall clock for the gate cadence, not UT: GonogoAddon drives the sample
        // from Update(), which keeps running while the game is paused, and a
        // paused game is exactly when an operator has time to read the console.
        // A UT-keyed throttle would stall the whole channel there.
        private readonly System.Diagnostics.Stopwatch _gateSampleClock = System.Diagnostics.Stopwatch.StartNew();
        private double _lastGateSampleAtSec = double.NegativeInfinity;
        private PerfBudget? _commandGateBudget;

        /// <summary>
        /// How often <see cref="SampleCommandGates"/> actually re-reads the
        /// game, however often it is called.
        ///
        /// <para>2 Hz, and the number is set by the FASTEST-moving gate rather
        /// than the average one. Almost every requirement in the tree changes on
        /// a discrete career event: a facility upgrade, a hire, a contract
        /// accepted, a scene load. Those would be happy at 0.2 Hz.
        /// <c>ClearToSaveStatus</c> is the exception: its arms include
        /// "throttled up" and "under acceleration", which an operator changes
        /// with a keypress, so a recovery control has to go dark within about a
        /// beat of the throttle moving or the console is lying about the
        /// present.</para>
        ///
        /// <para>Not faster, because this runs on the Unity main thread inside
        /// the frame budget and there is nothing to buy above a beat: the
        /// verdict is advisory, and the DISPATCH re-evaluates the same gates
        /// against live state anyway, so a stale Pass can never actually let a
        /// command through.</para>
        /// </summary>
        internal const double GateSampleIntervalSec = 0.5;

        /// <summary>
        /// Soft cap on evaluator calls per second from the gate sampler.
        ///
        /// <para>Steady state is roughly a dozen: eleven gated commands sharing
        /// six or so DISTINCT requirements (nine of them declare the same
        /// career-mode gate), memoised per pass, sampled at
        /// <see cref="GateSampleIntervalSec"/>. A hundred is about 8x that, so it
        /// tolerates the gated set tripling without noise and trips when
        /// something has either lost the memo or started sampling per frame,
        /// which are the two ways this becomes a main-thread cost.</para>
        /// </summary>
        internal const double GateEvaluationBudget = 100;

        /*
         * The last built system.channels roster, and the wall clock that paces
         * rebuilding it. Courier-thread-only: unlike _commandGateReport above,
         * nothing here crosses a thread, because every input (the emitter, the
         * subscription registry, _born, _availability) is Courier-owned and the
         * mapper runs on the Courier thread too. So no Volatile, and no lock.
         */
        private readonly System.Diagnostics.Stopwatch _channelCounterClock = System.Diagnostics.Stopwatch.StartNew();
        private double _lastChannelCounterAtSec = double.NegativeInfinity;
        private double _channelCounterIntervalSec = ChannelCounterIntervalSec;
        private ChannelEmissionReport _channelCounterReport = new ChannelEmissionReport();
        private PerfBudget? _channelCounterBudget;

        /// <summary>
        /// How often the <see cref="ChannelsTopic"/> roster is actually rebuilt,
        /// however often its mapper is called.
        ///
        /// <para>Wall clock rather than UT, for the same reason the gate sampler
        /// next door uses one: the cost this paces is building and serialising a
        /// list once per declared channel, which is spent in wall-clock time
        /// whatever the game's clock is doing. A UT throttle would rebuild it a
        /// hundred times a second under time warp and never under a pause.</para>
        ///
        /// <para>Five seconds because this is a counter, not a sample. Nobody
        /// reads a monotonic total to watch it move; they read it to see whether
        /// it moved at all, and the answer to that does not improve with
        /// cadence. Emission follows the throttle for free: an unchanged report
        /// is the same object, so the change-gate declines it, which is why the
        /// declaration below needs no deadband of its own.</para>
        /// </summary>
        internal const double ChannelCounterIntervalSec = 5.0;

        /// <summary>
        /// Soft cap on channel rows published per second from
        /// <see cref="ChannelsTopic"/>.
        ///
        /// <para>Rows rather than payloads, because rows are what the wire and
        /// the serialiser actually cost and a payload count cannot see the
        /// roster growing. Steady state is the declared-channel count divided by
        /// <see cref="ChannelCounterIntervalSec"/>: around 120 bundled channels
        /// plus the dynamic per-vessel and per-processor ones, so roughly 30 to
        /// 60 rows a second. Three hundred is about 5x that, which tolerates the
        /// roster doubling and trips on the two ways this becomes a firehose:
        /// the throttle collapsing to per-tick (thousands a second), or a
        /// dynamic namespace minting topics without bound.</para>
        /// </summary>
        internal const double ChannelCounterRowBudget = 300;

        private readonly ConcurrentQueue<IEngineJob> _jobs = new ConcurrentQueue<IEngineJob>();
        private readonly SemaphoreSlim _jobSignal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _courierThread;

        // F2 Part 1 (main-thread command execution): when true, a command
        // handler is NOT run inline on the Courier thread but marshaled onto
        // this queue, drained by RunPendingCommands on the Unity main thread
        // (GonogoAddon.FixedUpdate). The Courier thread blocks on the queued
        // job's completion signal and returns its typed result, the symmetric
        // WRITE-side twin of F1's capture-on-main / handle-on-Courier read
        // seam (AddSampledSource). KSP/Unity actuation (KspVesselActuator)
        // MUST run on the main thread; calling it from the Courier thread is
        // the crash class this closes. When false (the default, and every
        // headless test that doesn't stand up a main-thread pump), handlers
        // run inline on the Courier thread exactly as before, same behavior
        // the pre-F2 engine had.
        private readonly bool _executeCommandsOnMainThread;
        private readonly ConcurrentQueue<MainThreadCommand> _mainThreadCommands = new ConcurrentQueue<MainThreadCommand>();

        // F2-fix backstop: the longest a Courier-thread command will block on
        // the main-thread pump before giving up with a Timeout failure result.
        // Bounded so a paused game / scene-load stall (FixedUpdate frozen, but
        // in production the drain now rides Update so this is a last resort) can
        // never park the single-drain Courier thread indefinitely.
        private readonly TimeSpan _mainThreadCommandTimeout;

        // F2-fix shutdown gate: set true in Stop() BEFORE the pending-command
        // flush so any command the Courier dequeues AFTER the flush fails fast
        // in RunOnMainThread instead of enqueuing+blocking on a pump that has
        // already stopped: closing the single-pass-flush race. Engine-level;
        // distinct from ChannelOutbox._stopping (a per-connection field).
        private volatile bool _engineStopping;

        // The OUTER (SubscriptionRegistry) / INNER (ChannelEmitter) gate pair,
        // Courier-thread-only, shared across every registered topic: both
        // classes are already keyed by channelId/topic internally, so no
        // per-topic instance is needed (see their own doc comments).
        private readonly SubscriptionRegistry _subscriptions = new SubscriptionRegistry();
        private readonly ChannelEmitter _emitter;

        /*
         * How delay and signal loss actually work, end to end.
         *
         * Two gates sit between a channel value and the wire, and they answer
         * two different questions.
         *
         *   1. The REVEAL GATE, below (Emit / RevealDelayFor / FlushReveal).
         *      It asks MAY THIS CROSS AT ALL. While the subject is in contact
         *      an ordinary Delayed channel passes straight through it
         *      (RevealDelayFor returns 0); while the subject is dark it returns
         *      +Inf and the sample is held in the blackout recorder instead,
         *      to be replayed on reacquisition. The gate carries a real horizon
         *      for exactly two shapes: comms.delay (0, it defines the delay)
         *      and the freeze-exempt link/contact MetaTopics, which must be
         *      able to report the outage from inside it.
         *
         *   2. The LEDGER, in the Courier/Archive (INetwork.DelayTo). It asks
         *      WHEN DOES IT ARRIVE. Every recorded sample is scheduled at
         *      validAt + DelayTo(vantage, node), and the delivery reads the
         *      vantage's archive cursor at fireUt − DelayTo. For ordinary
         *      telemetry this is the gate that decides, not the reveal buffer.
         *
         * So a cut at UT T behaves the way a broadcast does. Everything the
         * craft recorded in the window (T − delay, T] had already left before
         * the link died; those samples are scheduled and keep arriving, one at
         * a time, in order, until T + delay. Only then does the stream go
         * quiet. Nothing recorded after T ever crosses: it is held by the
         * reveal gate and surfaces only if the link comes back
         * (ReplayInBlackoutBacklog), stamped as a recording rather than as
         * live telemetry. LATE and GONE stay distinguishable.
         *
         * Holding the tail is not automatic, and this is the subtle part: a
         * lost path has no geometry to measure, so the live comms.delay
         * collapses to 0 on the cut tick. Left alone, that collapse drags every
         * in-flight delivery's archive read a full light-time forward and the
         * operator is handed the last pre-cut sample immediately, skipping the
         * seconds of telemetry that were genuinely still on their way.
         * RefreshLedgerDelays holds a dark subject's ledger row at its
         * last-connected light-time to stop that. The SDK's DelayAuthority
         * holds the same number client-side, for the same reason.
         *
         * ---- Server-side reveal gate (spec-streaming-delay-model §4 / §7.3
         * Steps 1–3): the choke point that makes DelayRole LIVE on the host.
         * A Delayed channel's change-gated (UT,value) decisions are routed
         * through Emit and reach the Courier: i.e. the wire, for EVERY client
         * (SDK, curl, third-party, station relay): only once their reveal
         * horizon allows. TrueNow channels (and comms.delay itself, which
         * DEFINES the delay) bypass entirely and are recorded live.
         * Courier-thread-only, same discipline as _emitter/_born.
         */

        // The literal MUST match Gonogo.KSP.CommsCoreUplink.DelayTopic, that
        // uplink is KSP-facing (this project builds without the KSP DLLs), so
        // the topic is duplicated here rather than referenced.
        internal const string CommsDelayTopic = "comms.delay";

        // The connectivity MetaTopic (comms.link): a Delayed channel that is
        // EXEMPT from the freeze-on-disconnect gate, exactly as CommsDelayTopic
        // is exempt from its own delay. It REPORTS the freeze (link up/down), so
        // it must escape it: it reveals the disconnect edge at now-delay and
        // keeps reporting connected:false through the blackout, so the client's
        // "NO SIGNAL" flips at the correct delayed instant. Every OTHER Delayed
        // channel still freezes. The literal MUST match
        // Gonogo.KSP.CommsCoreUplink.LinkTopic (duplicated for the same
        // KSP-DLL-free reason as CommsDelayTopic above) and
        // Sitrep.Contract.CommsLink's [SitrepTopic].
        internal const string ConnectivityMetaTopic = "comms.link";

        // The per-vessel contact MetaTopic suffix: "fleet.<guid>.contact" carries
        // the core connected/lastContactUt facts for ONE vessel. Public, like
        // FleetNodePrefix and for the same reason: the publishing uplink
        // composes the topic from it, so there is one literal rather than two
        // that must agree.
        public const string ContactMetaSuffix = ".contact";

        // The comms-owned per-vessel silence-reckoning MetaTopic suffix:
        // "silence.<guid>.state" carries the SilenceTracker's view of ONE
        // vessel (link state, when it went quiet, its officially-lost
        // deadline, whether it has been declared Lost). Same freeze-exempt
        // treatment as ContactMetaSuffix and for the same reason.
        public const string SilenceStateSuffix = ".state";

        /// <summary>
        /// Whether <paramref name="topic"/> escapes the freeze-on-disconnect
        /// gate. All three exempt shapes REPORT the blackout, so none can be
        /// subject to it: <see cref="ConnectivityMetaTopic"/> for the active
        /// vessel's link, and the per-vessel contact/silence channels
        /// (<see cref="ContactMetaSuffix"/>/<see cref="SilenceStateSuffix"/>) for
        /// a fleet subject's. Publishing a "gone quiet at UT, presumed lost by
        /// UT" report down a lane frozen by the very silence it describes
        /// buries it: every in-blackout sample takes an infinite reveal horizon
        /// and is then dropped by <see cref="DropInBlackoutBacklog"/> on
        /// reconnect, so the operator is told nothing at all about the craft
        /// that went dark, the exact opposite of the feature's point.
        ///
        /// <para>Deliberately ONE field of a fleet subject, not the namespace:
        /// that vessel's ordinary telemetry (.orbit, .delay) must keep freezing
        /// on its own link, or the blackout would stop meaning anything. The
        /// node test (rather than a bare prefix match) keeps the exemption to
        /// genuine per-vessel topics.</para>
        /// </summary>
        private bool IsFreezeExempt(string topic) =>
            topic == ConnectivityMetaTopic
            || ((topic.EndsWith(ContactMetaSuffix, StringComparison.Ordinal)
                    || topic.EndsWith(SilenceStateSuffix, StringComparison.Ordinal))
                && NodeFor(topic).StartsWith(FleetNodePrefix, StringComparison.Ordinal));

        // The built-in uplink-health-self-report channel (see
        // BuildSystemUplinksPayload's doc comment). Unlike every other
        // channel on this class, it is NOT owned by any ISitrepUplink's
        // Manifest: the engine declares and sources it directly in the
        // constructor, because it is the only component that ever sees
        // EVERY registered uplink at once. No _channelOwner entry is ever
        // recorded for it, so IsChannelAvailable treats it as always
        // available (untracked topic == available, per that method's doc
        // comment): appropriate here since the channel reports on OTHER
        // uplinks' availability rather than having any of its own.
        internal const string UplinksTopic = "system.uplinks";

        /// <summary>
        /// Ask where a craft goes, FROM THIS COMMAND CENTRE'S POINT OF VIEW.
        ///
        /// <para>Registered here rather than by an Uplink because it is not any one
        /// mod's question. The physics comes from whichever seeded provider is
        /// elected, and what makes the answer honest is the archive and the vantage,
        /// both of which are core's.</para>
        ///
        /// <para>Undelayed, and that is the subtle part. This is not a command to a
        /// craft, it is an operator asking their own command centre to work something
        /// out from what it already knows. Delaying it would make a room full of
        /// people wait a light-time for the result of their own arithmetic. The delay
        /// lives where it belongs, in the STATE the answer is computed from.</para>
        /// </summary>
        internal const string PlanForVantageCommand = "vessel.trajectory.forVantage";

        // The ground-side pending-uplink queue self-report channel (see
        // Sitrep.Contract.PendingUplink's doc comment for the prediction-only
        // invariant this carries). Same "engine declares/sources it directly"
        // treatment as UplinksTopic above, for the same reason: no single
        // ISitrepUplink owns the whole in-flight-dispatch roster across every
        // uplink. THIS TASK declares the channel with an EMPTY-queue source
        // only: a declared channel must have a source or sampling
        // KeyNotFounds: the real pending list is wired up in a follow-on
        // task once dispatch bookkeeping exists to populate it.
        internal const string UplinkPendingTopic = "system.uplink.pending";

        // Every gated command's CURRENT verdict, evaluated with no arguments:
        // the addressability answer, published so a control can be drawn dark
        // before the operator presses it. Same "engine declares and sources it
        // directly" treatment as the two topics above, and for the same reason:
        // only the engine sees every CommandDeclaration and every registered
        // ICommandGateEvaluator at once, so no single ISitrepUplink could own
        // this.
        //
        // SAMPLED ON THE MAIN THREAD, unlike every other channel source here.
        // See SampleCommandGates: an evaluator reads live game state, channel
        // mappers run on the Courier thread, and a Unity read from there raises
        // a cross-thread exception that EvaluateGates catches as Unknown. Unknown
        // refuses, so a gate sampled off the main thread would publish every
        // gated command as permanently unavailable and look entirely deliberate
        // doing it. So the mapper below only hands back what the main-thread
        // sampler last wrote.
        internal const string UplinkGatesTopic = "system.uplink.gates";

        // The contract's unit knowledge, served so the stream describes
        // itself. Everything else the unit system knows is a TypeScript
        // artifact and none of it survives the wire: a consumer that is not
        // TypeScript receives {"heatShieldFlux": 3400.0} and has no way to
        // learn it is kilowatts. Same "engine declares and sources it
        // directly" treatment as the two topics above, for the same reason:
        // it describes the CONTRACT rather than anything an uplink owns.
        internal const string UnitsTopic = "system.units";

        /*
         * Every declared channel's emission counters, so a silent Topic can be
         * told apart from a Topic nobody looked at. Same "engine declares and
         * sources it directly" treatment as the four topics above, and for the
         * strongest version of the same reason: only the engine holds the
         * emitter, the subscription registry, the birth set and the
         * availability map, and the answer is the four of them read together.
         *
         * This exists because an outside observer cannot get it. One vessel
         * channel delivered zero frames in a 20-second capture while another
         * delivered throughout the same one, and every explanation was
         * eliminated by test or measurement without narrowing anything, because
         * "the engine never considered this channel" and "the engine considered
         * it and the emitter declined every value" are indistinguishable from
         * the wire: both are silence. Considered separates them, and the flags
         * on ChannelEmissionEntry name which upstream gate held a
         * never-considered channel back.
         *
         * See ChannelEmissionReport for the shape and for the two ways this
         * report is behind the frame that carries it.
         */
        internal const string ChannelsTopic = "system.channels";

        // Current one-way signal delay (seconds), snooped off the comms.delay
        // channel's latest revealed value (§7.3 Step 2). 0 = no delay authority
        // (CommsDelaySource.None / signal-delay-disabled / pre-first-emit),
        // which reveals everything live, byte-identical to the pre-gate LAN
        // behaviour. Fail-soft: a non-finite/negative value is treated as 0.
        // Cached descriptor for UnitsTopic; see its source registration.
        private string _unitsDescriptorJson;

        private double _signalDelaySeconds;

        // The last _signalDelaySeconds observed while CONNECTED (see
        // CaptureSignalDelay's snapshot). A genuine disconnect collapses the
        // LIVE _signalDelaySeconds to 0 (no path ⇒ SignalDelay.Compute returns
        // None ⇒ 0: see RevealDelayFor's doc comment), so a freeze-EXEMPT
        // topic (ChannelDeclaration.FreezeExempt: the connectivity MetaTopic)
        // reads THIS field instead while disconnected: it must still reveal
        // its disconnect edge at the REAL last-known light-time horizon, not
        // instantly at delay=0, which would defeat the whole point of the
        // channel being Delayed rather than TrueNow. Frozen for the outage's
        // duration (stops updating the instant _commsConnected goes false),
        // resumes tracking live once reconnected.
        /// <summary>
        /// The unit descriptor, built once and never allowed to fail loudly.
        /// </summary>
        /// <remarks>
        /// Reflection over a contract assembly can fail when one of its types
        /// references something that is not deployed. That is a reason to
        /// serve no descriptor; it is not a reason to break the telemetry
        /// engine, which is what an exception escaping a channel source would
        /// do. An empty string is a consumer seeing "this stream does not
        /// describe itself", which is exactly the state every consumer was in
        /// before this channel existed.
        /// </remarks>
        private string UnitsDescriptorJson()
        {
            if (_unitsDescriptorJson != null)
            {
                return _unitsDescriptorJson;
            }

            try
            {
                _unitsDescriptorJson = UnitDescriptor.ToJson();
            }
            catch (Exception)
            {
                _unitsDescriptorJson = string.Empty;
            }

            return _unitsDescriptorJson;
        }

        // Per-subject last-connected delay (Plan 2b), keyed by NodeForTopic.
        // Feeds the freeze-exempt reveal horizon for both exempt shapes: the
        // active vessel's comms.link under "system", and each fleet subject's
        // fleet.<guid>.contact under its own node.
        private readonly Dictionary<string, double> _subjectLastConnectedDelay =
            new Dictionary<string, double>();

        // The routed light-time last written for each fleet.<guid> node. Shadows
        // the ledger's node-default purely so SetVesselDelay can snapshot the
        // OUTGOING value into _subjectLastConnectedDelay, the role
        // _signalDelaySeconds plays for the "system" subject in
        // CaptureSignalDelay. Courier-thread-only, cleaned with the subject.
        private readonly Dictionary<string, double> _vesselNodeDelay =
            new Dictionary<string, double>();

        // AUTHORITATIVE, subscription-independent server-side delay source (see
        // IUplinkHost.SetSignalDelaySource): the closure the bundled comms
        // uplink registers to compute comms.delay on the MAIN thread every tick,
        // reading the live elected backend the way its AddSampledSource capture
        // does. Invoked in RunCaptures (main-loop thread), its CommsDelay result
        // carried on the TickJob and applied to _signalDelaySeconds in
        // ProcessTick BEFORE the channel loop: so the gate learns the delay
        // regardless of how comms.delay is otherwise registered (Publisher /
        // AddSampledSource, never AddChannelSource in production) and regardless
        // of whether any client subscribed comms.delay. Set once at registration
        // (before Start), only read afterward; _signalDelaySourceDisabled is the
        // single mutable-after-start field (a volatile bool, same discipline as
        // SampledSource.Disabled) flipped by the fail-soft path / owner going
        // Unavailable so a throwing source stops running on the main-loop thread.
        private Func<KspSnapshot?, CommsDelay?>? _signalDelaySource;
        private string _signalDelaySourceOwnerId = "";
        private volatile bool _signalDelaySourceDisabled;

        // The DROP EVENT's source (see IUplinkHost.SetPathBreakSource), sourced
        // and disciplined exactly as _signalDelaySource above: a main-thread
        // closure reading the elected backend, captured every tick in
        // CapturePathBreakOnMain, carried on the TickJob and spent Courier-side
        // in ApplyPathBreak on INetwork.DropPath, BEFORE the clock advances so a
        // break is on the books before any delivery it dooms can fire.
        private Func<KspSnapshot?, double, PathBreak?>? _pathBreakSource;
        private string _pathBreakSourceOwnerId = "";
        private volatile bool _pathBreakSourceDisabled;

        // Freeze-on-disconnect (server-side reveal-gate enforcement): the
        // subscription-independent CONNECTED/DISCONNECTED signal, sourced the
        // SAME way _signalDelaySource sources the delay (a main-thread closure
        // reading the elected comms backend's Connectivity(), registered via
        // IUplinkHost.SetConnectivitySource, captured every tick in
        // CaptureConnectivityOnMain and applied Courier-side in
        // RefreshConnectivityFromCapability BEFORE the channel loop/FlushReveal).
        //
        // When the link is DOWN, a Delayed channel is withheld as if the reveal
        // horizon were infinitely far off (RevealDelayFor returns +Inf → Emit
        // buffers rather than records live) AND FlushReveal releases nothing,
        // even a pre-outage in-flight entry whose finite horizon the clock would
        // otherwise overtake: so telemetry FREEZES at last-known. TrueNow
        // channels (comms.delay / comms.connectivity / time.* / system.bodies)
        // still flow, so the operator sees the outage live. This is DISTINCT
        // from delay==0: a genuine connected, in-LOS zero-distance link still
        // reveals live; only a real down-link freezes.
        //
        // Default true and fail-soft to true: unknown / no authority / a source
        // that threw ⇒ treated as CONNECTED (reveal per normal delay), so this
        // can never worsen today's LAN (no-comms-uplink) behaviour. Only a
        // non-null capture result flips it; a null leaves the last value.
        // Courier-thread-only, same discipline as _signalDelaySeconds.
        // Per-subject current connectivity (Plan 2b), keyed by NodeForTopic
        // (fleet.<guid> or "system"). A subject absent from the map reads as
        // CONNECTED (never spuriously frozen). This is the freeze lever: a
        // disconnected subject's Delayed topics get +Inf in RevealDelayFor.
        private readonly Dictionary<string, bool> _subjectConnected =
            new Dictionary<string, bool>();
        private Func<KspSnapshot?, bool?>? _connectivitySource;
        private string _connectivitySourceOwnerId = "";
        private volatile bool _connectivitySourceDisabled;

        // Connectivity history (UT-ascending): every CONNECTED/DISCONNECTED
        // TRANSITION the live source reported, stamped with the tick UT it took
        // effect. FlushReveal's per-entry gate consults ConnectivityAt(entry.Ut)
        // to decide whether a buffered Delayed sample was captured while the
        // link was up (reveal, the pre-outage tail) or during the blackout
        // (withhold: frozen). Bounded to a small window behind the current
        // horizon (PruneConnectivityHistory): once every buffered sample older
        // than a transition has revealed or been dropped, that transition can
        // never be queried again. Courier-thread-only, same discipline as
        // _commsConnected. Seeded with the default-connected state at UT 0 so a
        // lookup before the first real transition fails soft to CONNECTED.
        // Per-subject connectivity-interval history (Plan 2b): node ->
        // UT-ascending transition list. FlushReveal's per-entry gate consults
        // ConnectivityAt(NodeFor(topic), entry.Ut) to decide whether a
        // buffered Delayed sample was captured while THAT subject's link was up
        // (reveal, the pre-outage tail) or during its blackout (withhold,
        // frozen). A stateless per-subject bool cannot do this: the decision is
        // per-sample-UT. Each list is bounded by PruneConnectivityHistory(node)
        // and seeded (-Inf, true) on first transition. Courier-thread-only.
        private readonly Dictionary<string, List<(double Ut, bool Connected)>> _subjectConnectivityHistory =
            new Dictionary<string, List<(double, bool)>>();

        // Per-topic buffer of change-gated (UT,value) decisions for Delayed
        // channels not yet past their reveal horizon. Flushed to the Courier in
        // insertion (UT-ascending) order once the horizon reaches each entry
        // (see FlushReveal). Bounded by the delay window, entries leave as the
        // horizon advances: never by session length (§5.1). Courier-thread-only.
        private readonly Dictionary<string, List<BufferedReveal>> _revealBuffer =
            new Dictionary<string, List<BufferedReveal>>();

        // Per-topic UT of the last sample that reached the Courier, i.e. the last
        // one the ground will ever have on that topic before whatever comes next.
        // It is the left-hand edge a Meta.GapSinceUt names, so it has to be known
        // at the moment a sample is DROPPED rather than reconstructed afterwards
        // (by then the record has no entry to read it off).
        // Courier-thread-only, same discipline as _revealBuffer.
        private readonly Dictionary<string, double> _lastRecordedUt = new Dictionary<string, double>();

        // Per-topic pending Meta.GapSinceUt: set the first time a sample is
        // dropped rather than held, cleared when the next delivered sample
        // carries it out. Set ONCE per break, not per dropped sample: every drop
        // in one run of them widens the same hole, and its left-hand edge is
        // fixed at the last sample the ground actually has.
        // Courier-thread-only.
        private readonly Dictionary<string, double> _pendingGapSinceUt = new Dictionary<string, double>();

        // Per-subject UT of the current outage's start, held for as long as it
        // runs so the Courier's link-down mark can be re-applied at the ORIGINAL
        // instant on every disconnected tick rather than drifting forward.
        // See SetSubjectConnected. Courier-thread-only.
        private readonly Dictionary<string, double> _subjectDarkSinceUt = new Dictionary<string, double>();

        /// <summary>
        /// How many in-blackout samples the recorder holds PER TOPIC before the
        /// oldest are dropped to make room (see <see cref="Emit"/>).
        ///
        /// <para>A cap is not optional: an outage has no upper bound in UT (a
        /// Jool transfer's occultation, a probe abandoned for a career year) and
        /// a channel emitting through it every tick would grow this without
        /// limit. The old policy could not leak because it dropped the window
        /// whole; holding it is what makes a bound necessary.</para>
        ///
        /// <para>Drop-OLDEST rather than refuse-newest, and neither decimation
        /// nor a UT window. Drop-oldest keeps the span ADJACENT to reacquisition,
        /// which is the half that still describes a live craft and the half a
        /// chart's window is looking at; refuse-newest would fill the recorder in
        /// the first minutes of a long outage and then record none of the
        /// approach. Decimation was the other candidate and is rejected because
        /// these channels are already change-gated: dropping every other sample
        /// of a deadbanded series discards real transitions and leaves a series
        /// that looks complete and is not, whereas a stated hole is a fact an
        /// operator can act on. Whatever a drop costs is named on the wire as
        /// <see cref="Meta.GapSinceUt"/> rather than left to be inferred.</para>
        ///
        /// <para>1200 entries. At the ~4 Hz a Delayed channel emits when
        /// something is actually changing that is five minutes of continuous
        /// full-rate recording per topic, and far longer for the change-gated
        /// majority; under time warp, where the long outages happen, a tick
        /// covers a large UT stride and the count for a given UT span collapses.
        /// It is a COUNT rather than a UT window on purpose: memory is what is
        /// being bounded, and a UT window bounds memory only if you assume a
        /// sample rate, which is the assumption the client-side twin of this
        /// guard was making (see <c>ClientTimelineOptions</c>).</para>
        /// </summary>
        internal const int RecorderCapacityPerTopic = 1200;

        /// <summary>
        /// Soft cap on samples the blackout recorder dumps into the Courier per
        /// second of UT, across every topic and subject.
        ///
        /// <para>A dump is the one place in this class where a single tick hands
        /// the Courier an unbounded-looking burst instead of one sample per topic,
        /// so it is the path that needs watching. Steady state is ZERO: nothing is
        /// recorded while the link is up, and a dump is a discrete event at a
        /// reacquisition edge, seconds or hours apart.</para>
        ///
        /// <para>4000 per UT second. One subject reacquiring with every topic's
        /// recorder full is about 40 x <see cref="RecorderCapacityPerTopic"/>, and
        /// that is a legitimate one-off, so the threshold is set to catch the
        /// shapes that are NOT one-off: a link flapping across the edge every
        /// tick (which would dump, re-record and re-dump), or a subject whose
        /// recorder is being drained without being emptied. Both show up as this
        /// rate staying high across consecutive seconds rather than spiking
        /// once.</para>
        /// </summary>
        internal const double BlackoutReplayBudget = 4000;

        private PerfBudget? _blackoutReplayBudget;

        // Ground-side pending-uplink roster backing system.uplink.pending (see
        // UplinkPendingTopic's doc comment). Courier-thread-only, same
        // discipline as _signalDelaySeconds above: EVERY mutation/read happens
        // inside a job the single-threaded CourierLoop dequeues one at a
        // time -- ProcessDispatchCommand (appends), the UplinkPendingTopic
        // channel-source mapper and the prune step (both run inside
        // ProcessTick) -- so no lock is needed; the Courier thread itself is
        // the mutual-exclusion boundary. Confirmed by RefreshSignalDelayFromCapability's
        // own doc comment ("Mapper runs on the Courier thread") for the
        // identical _channelSources[topic] invocation pattern.
        private readonly List<PendingUplink> _pending = new List<PendingUplink>();

        private readonly Dictionary<string, ChannelDeclaration> _channelDeclarations = new Dictionary<string, ChannelDeclaration>();
        private readonly Dictionary<string, Func<KspSnapshot?, object?>> _channelSources = new Dictionary<string, Func<KspSnapshot?, object?>>();

        // Dynamic namespaces (see IUplinkHost.RegisterDynamicNamespace):
        // prefix -> (template declaration, owning uplink id). A concrete
        // "prefix + subTopic" topic is lazily materialized into
        // _channelDeclarations/_channelOwner (cloned from the template) the
        // first time it is published or subscribed; see
        // EnsureDynamicTopicDeclared/FindDynamicNamespaceForTopic. Ordered
        // by insertion is irrelevant; prefixes are matched by simple
        // StartsWith, so two prefixes where one is a prefix of the other
        // would be ambiguous, not a real concern for the small, hand-owned
        // set of dynamic namespaces this exists for today.
        private readonly Dictionary<string, ChannelDeclaration> _dynamicNamespaces = new Dictionary<string, ChannelDeclaration>();
        private readonly Dictionary<string, string> _dynamicNamespaceOwner = new Dictionary<string, string>();

        // Prefixes of the dynamic namespaces that declared
        // ChannelDeclaration.PerVesselNode: NodeFor routes a topic under one of
        // them onto that craft's own fleet.<guid> node. Written during
        // Register() (before Start()), same single-writer-before-start
        // discipline as _dynamicNamespaces above, then only read.
        private readonly List<string> _perVesselNamespacePrefixes = new List<string>();

        // Per-prefix listeners registered via IDynamicChannelSource.OnSubscribed
        // (Gap A of the terminal-integrity adversarial review), invoked from
        // ProcessSubscribe, on the COURIER thread, once per individual session
        // subscribe under the owning prefix. Populated only during Register()
        // (before Start()), same single-writer-before-start discipline as
        // _dynamicNamespaces/_dynamicNamespaceOwner above; read-only (well,
        // appended to via AddDynamicNamespaceSubscribeListener before Start(),
        // then only enumerated) on the Courier thread afterward.
        private readonly Dictionary<string, List<Action<string>>> _dynamicNamespaceSubscribeListeners = new Dictionary<string, List<Action<string>>>();

        private readonly Dictionary<string, CommandDeclaration> _commandDeclarations = new Dictionary<string, CommandDeclaration>();
        private readonly Dictionary<string, Func<object?, object?>> _commandHandlers = new Dictionary<string, Func<object?, object?>>();
        private readonly Dictionary<string, Func<object?, string, object?>> _vantageCommandHandlers =
            new Dictionary<string, Func<object?, string, object?>>();

        // Owner travels WITH each sampler (rather than a parallel dictionary
        // keyed by the sampler instance) because a sampler has no natural
        // string key the way a channel/command topic does. Populated in
        // AddSampler from _currentRegisteringUplinkId, same mechanism
        // _channelOwner/_commandOwner use below.
        private readonly List<(string OwnerId, ISnapshotSampler Sampler)> _samplers = new List<(string OwnerId, ISnapshotSampler Sampler)>();

        // Capture-on-main / handle-on-Courier sources (see
        // IUplinkHost.AddSampledSource). Populated in AddSampledSource before
        // Start(), then only ENUMERATED afterward (RunCaptures on the
        // main-loop thread, ProcessTick's capture loop on the Courier thread);
        // never mutated post-Start, same single-writer-before-start rule
        // the other registration collections rely on. Each entry's Disabled
        // flag IS mutated post-start (fail-soft), but it is a volatile bool
        // whose read/write is atomic across the main-loop / Courier threads
        // (see SampledSource): the ONLY mutable-after-start cross-thread
        // state here, deliberately kept to a single atomic flag.
        private readonly List<SampledSource> _sampledSources = new List<SampledSource>();
        private readonly Dictionary<string, Availability> _availability = new Dictionary<string, Availability>();

        // Retained uplink instances, keyed by Manifest.Id: populated in
        // RegisterUplink alongside _availability/_channelOwner/_commandOwner.
        // Unlike those maps (which only track ownership/status BY id), this
        // one keeps the actual ISitrepUplink reference, because the built-in
        // system.uplinks channel source (see BuildSystemUplinksPayload) needs
        // to poll each uplink's own ISitrepUplink.Health.Health(): the
        // engine is the only component that ever sees every registered
        // uplink at once, so this is the sole place that self-report can be
        // aggregated. Single-writer-before-start, same discipline as every
        // other registration collection on this class (see the NOTE above
        // Start()): read-only after Start(), safe for the Courier thread to
        // enumerate without locking.
        private readonly Dictionary<string, ISitrepUplink> _registeredUplinks = new Dictionary<string, ISitrepUplink>();

        /// <summary>
        /// The contract version each discovered uplink declared it was built against,
        /// keyed by id, recorded for the refused and the accepted alike so
        /// <see cref="BuildSystemUplinksPayload"/> can state it on every roster entry.
        /// Empty for an uplink registered through <see cref="RegisterUplink"/> directly
        /// (no discovery, so nothing declared a version), whose entry reports null.
        /// </summary>
        private readonly Dictionary<string, ContractDeclaration> _declaredContract = new Dictionary<string, ContractDeclaration>();

        /// <summary>
        /// Every uplink <see cref="PassesContractMajorCheck"/> refused, keyed by id.
        /// Refusal skips <see cref="RegisterUplink"/> entirely, so these ids are absent
        /// from <see cref="_registeredUplinks"/> and used to be absent from
        /// <see cref="UplinksTopic"/> with them: an operator saw the capability simply
        /// not exist, with nothing anywhere saying why. They ride the roster as
        /// present-and-refused instead.
        /// </summary>
        private readonly Dictionary<string, ContractRefusal> _contractRefusals = new Dictionary<string, ContractRefusal>();

        // Thread-safe MIRROR of "which topics currently have >=1 subscriber",
        // maintained on the Courier thread (the only writer, Process
        // Subscribe/Unsubscribe/Disconnect + the C2-3 subscribe rollback, in
        // lock-step with _subscriptions) and READ on the main-loop thread by
        // RunCaptures to subscription-gate a SampledSource's capture (see
        // AddSampledSource's prefix overload / SampledSource.TopicPrefixes).
        // _subscriptions itself is a plain Dictionary that must never be touched
        // off the Courier thread, so a capture running on the main-loop thread
        // cannot consult it directly; this ConcurrentDictionary is the
        // cross-thread window onto the same fact. Keyed by full concrete topic
        // (dynamic sub-topics included), value byte is unused.
        private readonly ConcurrentDictionary<string, byte> _subscribedTopics = new ConcurrentDictionary<string, byte>();

        // topic/command -> owning uplink id, populated in RegisterUplink
        // alongside _channelDeclarations/_commandDeclarations. Lets Tick's
        // channel loop and ProcessDispatchCommand consult _availability
        // per-channel/per-command (see IsChannelAvailable/IsCommandAvailable)
        // rather than tracking availability without acting on it. This is the
        // fail-soft half of the contract: a throwing Register(), or a channel
        // mapper/command handler that throws at RUNTIME (see
        // FailSoftChannel/FailSoftCommand), takes the WHOLE owning uplink's
        // channels and commands inert together, rather than leaving
        // already-registered ones live against a half-broken uplink. The
        // sampler loop (see ProcessTick) applies the same rule via each pair's
        // OwnerId above.
        private readonly Dictionary<string, string> _channelOwner = new Dictionary<string, string>();
        private readonly Dictionary<string, string> _commandOwner = new Dictionary<string, string>();

        // topic -> "this channel has emitted at least one non-null value" --
        // the M2 finding-B fix's channel-birth guard (see ProcessTick's
        // channel loop). A channel that has never been "born" produces no
        // tombstone when its mapper returns null (pre-flight/main-menu: not
        // yet a subject); once born, a null flows into Decide like any
        // other value, and Decide's existing null-vs-value Equals handling
        // (ChannelEmitter.HasChangedBeyondQuantum) already change-gates it
        // correctly -- present->null emits once, null->null is suppressed.
        //
        // On a quickload rewind, this is RECOMPUTED (not blanket-cleared --
        // see RecomputeChannelBirthFromArchive) from the archive's own
        // post-prune tail: a topic with ANY surviving sample -- a real
        // value OR a tombstone -- stays born (so a subsequent null mapper
        // result still corrects a stale real value with a tombstone instead
        // of leaving it archived forever as a frozen "ghost" a late
        // subscriber's catch-up would serve as Fresh, AND a surviving
        // tombstone tail keeps re-announcing the absence on the normal
        // cadence/reset-keyframe path rather than going silent for a
        // continuously-connected subscriber whose actual tombstone delivery
        // got dropped by the rewind -- see Archive.HasAnyTail's doc comment).
        // Only a topic with NO surviving sample at all is NOT born, so a null
        // mapper result keeps being skipped there, matching the pre-rewind
        // behaviour. Neither simpler definition of born survives the two cases
        // above: clearing _born wholesale on rewind makes every channel
        // unborn and silently suppresses the corrective tombstone for a stale
        // NON-NULL tail, and defining born as "has a non-null tail" silently
        // suppresses it for a stale TOMBSTONE tail.
        //
        // Subject-scoped (vessel-switch) resets are a SEPARATE, narrower
        // mechanism: see ResetChannelBirth/IUplinkHost.ResetChannelBirth,
        // called by VesselEpochSampler alongside (not instead of)
        // ForceKeyframe -- clearing birth on every 0->1 subscribe (which
        // ForceKeyframe alone doubles as) would wrongly suppress the
        // tombstone re-keyframe a reconnecting subscriber is supposed to
        // see for an already-tombstoned channel.
        private readonly HashSet<string> _born = new HashSet<string>();

        private string? _currentRegisteringUplinkId;

        private readonly ConcurrentDictionary<string, ClientSession> _sessions = new ConcurrentDictionary<string, ClientSession>();

        private long _ackSeq;
        private long _requestSeq;

        public int BoundPort => _listener.BoundPort;

        /// <param name="bindUri">A <c>ws://host:port</c> URI: see <see cref="FleckTransportListener"/>.</param>
        /// <param name="networkDelaySeconds">
        /// SEED value for the whole-network delay default, the third and lowest
        /// tier of <see cref="INetwork.DelayTo"/>. It is the one-way delay the
        /// Courier applies between record and delivery for any (vantage, node)
        /// pair with no <see cref="INetwork.SetNodeDelay"/> node-default and no
        /// explicit <see cref="INetwork.SetDelay"/> pair, which in practice
        /// means the active vessel's <see cref="NodeId"/> node.
        ///
        /// <para>It is a SEED, not the operating value: <see
        /// cref="CaptureSignalDelay"/> overwrites it every tick from the live
        /// <c>comms.delay</c> scalar. Production therefore leaves this at 0 and
        /// gets its light-time at runtime instead. Do not read "production
        /// passes nothing" as "the whole-network default is unused": tier 3 is
        /// how the active vessel's signal delay reaches the Courier and the
        /// reveal gate, and neutering it fails the reveal-gate suite.</para>
        /// </param>
        /// <param name="executeCommandsOnMainThread">
        /// F2 Part 1: when <c>true</c>, command handlers are marshaled onto the
        /// main-thread queue (drained by <see cref="RunPendingCommands"/> from
        /// <c>GonogoAddon.FixedUpdate</c>) instead of running inline on the
        /// Courier thread: required in production so live KSP/Unity actuation
        /// runs on the main thread. Defaults to <c>false</c> (inline on the
        /// Courier thread) for headless callers/tests that don't stand up a
        /// main-thread pump.
        /// </param>
        /// <param name="mainThreadCommandTimeoutSeconds">
        /// F2-fix backstop: how long <see cref="RunOnMainThread"/> blocks the
        /// Courier thread waiting for the main-thread pump to drain a command
        /// before returning a synthetic <see cref="CommandErrorCode.Timeout"/>
        /// failure. Generous enough to ride a slow frame / brief load, finite
        /// so the Courier can never park indefinitely (the pause self-wedge the
        /// F2 review found), and (F4) kept BELOW <see cref="Stop"/>'s 5s Join
        /// so the timeout backstop can never dead-heat the Join even if the
        /// shutdown re-check in <see cref="RunOnMainThread"/> is somehow missed.
        /// Only consulted when
        /// <paramref name="executeCommandsOnMainThread"/> is <c>true</c>.
        /// </param>
        public ChannelEngine(string bindUri, double networkDelaySeconds = 0, bool executeCommandsOnMainThread = false, double mainThreadCommandTimeoutSeconds = 4.0)
        {
            _executeCommandsOnMainThread = executeCommandsOnMainThread;
            _mainThreadCommandTimeout = TimeSpan.FromSeconds(mainThreadCommandTimeoutSeconds);
            _clock = new ManualClock();
            // `networkDelaySeconds` is a SEED, not the delay. In production it is
            // never passed (GonogoAddon constructs with the default 0) and the live
            // one-way light-time arrives every tick through
            // `SetDefaultDelay(_signalDelaySeconds)` in CaptureSignalDelay, sourced
            // from the elected comms backend via CommsCoreUplink.ComputeDelayOnMain.
            //
            // So the whole-network default is the ACTIVE carrier of signal delay for
            // the primary node, not a leftover: `NodeId` is "system", nothing writes
            // a node-level default for it, and SetVesselDelay/SetAuthorityDelay only
            // ever write `fleet.*` nodes and command-centre pairs. For an operator
            // vantage observing the active vessel, this tier is the ONLY one that
            // resolves. Emptying `SetDefaultDelay` reds eight RevealGateTests.
            var stubNetwork = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            // Pin the meta-vantage to 0 so instant/exempt topics on the active
            // vessel's node stay instant. The whole-network default underneath
            // is not 0 for long: CaptureSignalDelay drives it from the live
            // comms.delay every tick, so an exempt topic that fell through to
            // it would pick up the signal delay it is exempt from.
            //
            // Written as an EXPLICIT (vantage, node) pair rather than left to
            // any default, because DelayTo resolves the explicit pair FIRST and
            // that is the only tier nothing else writes to. It is NOT made
            // redundant by networkDelaySeconds being 0 here: that argument only
            // seeds tier 3, which the live delay then overwrites within a tick.
            //
            // The Subscribe path re-asserts the same pin per instant topic (see
            // the SetDelay(MetaVantage, NodeFor(topic), 0.0) there, which also
            // covers fleet.<guid> nodes minted later), so this one holds the
            // active vessel's node for any DelayTo(meta, system) read that
            // happens before a subscription exists. Nothing currently in the
            // suite distinguishes the two: removing this line leaves
            // Sitrep.Host.IntegrationTests fully green, so treat that greenness
            // as unmeasured rather than as permission to delete it.
            stubNetwork.SetDelay(MetaVantage, NodeId, 0.0);
            _network = stubNetwork;
            _courier = new Courier(_clock, _network);
            // Routed through InvokeCommandHandler (not a raw dictionary
            // lookup + call) so a handler that throws on THIS delayed path,
            // fired from the Courier thread's own clock callback, see
            // Courier.ScheduleCommand: fail-softs its owning uplink
            // instead of unwinding out of the Courier's scheduled callback
            // and killing the thread. See InvokeCommandHandler's doc comment.
            _courier.SetCommandHandler(
                (command, args, node, vantage) => InvokeCommandHandler(command, args, vantage));
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Sitrep-ChannelEngine-Courier" };
            /*
             * The change-gate compares a structured payload by value, so an
             * identical rebuild of an unchanged payload is suppressed. That is
             * right for a LossyLatest channel, whose whole contract is that the
             * outbox coalesces to the freshest sample: a repeat of the value
             * the subscriber already holds is not news.
             *
             * It is wrong for the ReliableOrdered lane, where the contract is
             * that every sample is delivered and none is coalesced away. A kOS
             * terminal that prints the same line twice really did print it
             * twice, and suppressing the second corrupts the screen. Read here
             * off the lane each channel already declares, rather than asked of
             * every uplink again, so there is nothing new to remember when
             * declaring a channel.
             */
            _emitter = new ChannelEmitter(
                topic => _channelDeclarations[topic].Emission,
                topic => _channelDeclarations[topic].Delivery == Delivery.ReliableOrdered);

            // Built-in system.uplinks declaration + source: see
            // UplinksTopic's doc comment for why this is registered directly
            // here rather than through an ISitrepUplink.Manifest. Declared
            // (and its mapper wired) BEFORE Start(), same single-writer-
            // before-start rule every other _channelDeclarations/
            // _channelSources entry follows.
            _channelDeclarations[UplinksTopic] = new ChannelDeclaration
            {
                Topic = UplinksTopic,
                Delivery = Delivery.LossyLatest,
                // A registered-uplink roster with mostly-static health barely
                // changes tick to tick, same cadence class as system.bodies,
                // so the 30s keyframe floor is what the steady state costs.
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Uplink health/availability is a ground-side fact about the
                // MOD itself (is this uplink even working), not something
                // that flows through a vessel's comms link, same class as
                // system.bodies/scansat.available, so TrueNow.
                Delay = DelayRole.TrueNow,
            };
            _channelSources[UplinksTopic] = BuildSystemUplinksPayload;

            _commandDeclarations[PlanForVantageCommand] = new CommandDeclaration
            {
                Command = PlanForVantageCommand,
                Delayed = false,
            };
            _vantageCommandHandlers[PlanForVantageCommand] =
                (args, vantage) => PlanForVantage(args, vantage);

            // Built-in system.uplink.pending declaration + source: see
            // UplinkPendingTopic's doc comment. Declared (and its source
            // wired) BEFORE Start(), same single-writer-before-start rule as
            // UplinksTopic above.
            _channelDeclarations[UplinkPendingTopic] = new ChannelDeclaration
            {
                Topic = UplinkPendingTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Ground-side bookkeeping: what the CENTRE dispatched and
                // when: not vessel telemetry, so it does not ride gonogo's
                // reveal clock. Same class as UplinksTopic/comms.connectivity/
                // system.bodies: TrueNow.
                Delay = DelayRole.TrueNow,
            };
            // Live pruned pending list -- populated by ProcessDispatchCommand's
            // delayed branch, pruned every Tick (see PrunePendingUplinks,
            // called from ProcessTick before this loop runs). _pending.ToList()
            // hands back a fresh List reference every call (same
            // always-reads-as-changed shape as BuildSystemUplinksPayload
            // above), and this mapper itself runs on the Courier thread (see
            // _pending's doc comment) -- same thread that
            // ProcessDispatchCommand appends on, so no synchronization is
            // needed here either.
            _channelSources[UplinkPendingTopic] = _ => new PendingUplinkQueue { Pending = _pending.ToList() };

            // Built-in system.uplink.gates declaration + source: see
            // UplinkGatesTopic's doc comment. Declared before Start(), same
            // single-writer-before-start rule as the two above.
            _channelDeclarations[UplinkGatesTopic] = new ChannelDeclaration
            {
                Topic = UplinkGatesTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Whether the game will accept a command is a fact about the
                // GAME as the mod sees it, not something that travelled up a
                // vessel's comms link, same class as UplinksTopic and
                // UplinkPendingTopic. TrueNow.
                //
                // Worth being explicit about why this is not Delayed even though
                // it describes commands that ARE: the gate says what the ground
                // knows about the game right now, and holding it behind the
                // light-time horizon would tell an operator the pad was clear
                // minutes after a rocket rolled out onto it. The DISPATCH still
                // takes its delay; knowing in advance does not.
                Delay = DelayRole.TrueNow,
            };
            // The mapper hands back the last MAIN-THREAD sample and reads
            // nothing live. Volatile because the sampler writes from the Unity
            // main thread and this runs on the Courier thread; the reference
            // swap is the whole synchronisation, since each report is built
            // fresh and never mutated after publication.
            _channelSources[UplinkGatesTopic] = _ => Volatile.Read(ref _commandGateReport);
            _commandGateBudget = new PerfBudget(
                "ChannelEngine gate evaluations/sec",
                threshold: GateEvaluationBudget,
                windowSec: 1.0,
                unit: "evaluations",
                warn: LogHost);

            // Built-in system.units declaration + source: see UnitsTopic's
            // doc comment. The payload is a STRING holding the descriptor
            // JSON rather than a structured shape, deliberately: the document
            // describes the contract's own types, so giving it a contract
            // type would put it inside the thing it describes, and its schema
            // is the descriptor's `version` field rather than this assembly's.
            _channelDeclarations[UnitsTopic] = new ChannelDeclaration
            {
                Topic = UnitsTopic,
                Delivery = Delivery.LossyLatest,
                // It cannot change while the mod is loaded: it is reflected
                // off assembly metadata. A long keyframe floor is purely so a
                // late subscriber gets it without waiting for a restart.
                Emission = new EmissionPolicy(keyframeIntervalUt: 60, quantum: EmissionQuantum.Absolute(0)),
                // A fact about the CONTRACT, not about a vessel, so it does
                // not ride the reveal clock. Same class as UplinksTopic.
                Delay = DelayRole.TrueNow,
            };
            // LAZY, and fail-soft. Built on first sample rather than here,
            // and never allowed to throw: this channel is the engine
            // describing itself, which is a convenience for consumers that
            // are not TypeScript. Computing it in the constructor put a
            // reflection pass in the way of the engine EXISTING, so an
            // assembly whose types cannot all be resolved stopped telemetry
            // rather than stopping the descriptor. Cached after the first
            // build: the reflection is not free and the answer is immutable
            // for the lifetime of the process.
            _channelSources[UnitsTopic] = _ => UnitsDescriptorJson();

            // Built-in system.channels declaration + source: see ChannelsTopic's
            // comment. Declared before Start(), same single-writer-before-start
            // rule as the four above.
            _channelDeclarations[ChannelsTopic] = new ChannelDeclaration
            {
                Topic = ChannelsTopic,
                Delivery = Delivery.LossyLatest,
                // MinSampleIntervalUt matters more than the keyframe floor here.
                // The mapper's own throttle already decides how often the report
                // CHANGES, but without a cadence gate the emitter would still
                // structurally compare a roster of a few hundred rows against
                // its predecessor on every tick to conclude nothing moved. The
                // gate is checked before that compare, so it is what keeps a
                // diagnostic channel off the hot path. Five UT seconds pairs it
                // with ChannelCounterIntervalSec at 1x time; under warp the gate
                // opens sooner and finds the cached report unchanged.
                Emission = new EmissionPolicy(
                    keyframeIntervalUt: 30,
                    quantum: EmissionQuantum.Absolute(0),
                    minSampleIntervalUt: 5),
                // A fact about the ENGINE, not about a vessel, so it does not
                // ride the reveal clock. Same class as UplinksTopic. Holding a
                // diagnostic behind the light-time horizon would be perverse:
                // the operator asking why a channel is silent is asking about
                // the mod in front of them.
                Delay = DelayRole.TrueNow,
            };
            _channelSources[ChannelsTopic] = _ => ChannelEmissionRoster();
            _channelCounterBudget = new PerfBudget(
                "ChannelEngine channel-counter rows/sec",
                threshold: ChannelCounterRowBudget,
                windowSec: 1.0,
                unit: "rows",
                warn: LogHost);

            _blackoutReplayBudget = new PerfBudget(
                "ChannelEngine blackout-replay samples/sec",
                threshold: BlackoutReplayBudget,
                windowSec: 1.0,
                unit: "samples",
                warn: LogHost);
        }

        /// <summary>
        /// The <see cref="ChannelsTopic"/> mapper: every declared channel's
        /// emission counters, rebuilt at most once per
        /// <see cref="ChannelCounterIntervalSec"/> and otherwise handed back
        /// unchanged, so the change-gate declines the repeat.
        ///
        /// <para>Courier-thread only, which is what makes it able to answer at
        /// all: <c>_emitter</c>, <c>_subscriptions</c> and <c>_born</c> are all
        /// Courier-owned, and this reads the three of them plus the availability
        /// map together to say which gate held a never-considered channel
        /// back.</para>
        /// </summary>
        private ChannelEmissionReport ChannelEmissionRoster()
        {
            var nowSec = _channelCounterClock.Elapsed.TotalSeconds;
            if (nowSec - _lastChannelCounterAtSec < _channelCounterIntervalSec)
            {
                return _channelCounterReport;
            }
            _lastChannelCounterAtSec = nowSec;

            var rows = new List<ChannelEmissionEntry>(_channelDeclarations.Count);
            foreach (var topic in _channelDeclarations.Keys)
            {
                var counters = _emitter.CountersFor(topic);
                rows.Add(new ChannelEmissionEntry
                {
                    Topic = topic,
                    Considered = counters.Considered,
                    Emitted = counters.Emitted,
                    Skipped = counters.Skipped,
                    Subscribers = _subscriptions.SubscriberCount(topic),
                    Available = IsChannelAvailable(topic),
                    Born = _born.Contains(topic),
                    TickMapped = _channelSources.ContainsKey(topic),
                });
            }
            // Sorted so a reader diffing two captures compares like with like:
            // dictionary order is registration order, which a dynamic namespace
            // changes as vessels come and go.
            rows.Sort((left, right) => string.CompareOrdinal(left.Topic, right.Topic));

            _channelCounterBudget?.Record(rows.Count, nowSec);
            _channelCounterReport = new ChannelEmissionReport { Channels = rows };
            return _channelCounterReport;
        }

        // NOTE: every RegisterUplink call MUST happen before Start().
        // Registration mutates plain (non-concurrent) Dictionary/List fields
        // (_channelDeclarations, _channelSources, _commandDeclarations,
        // _commandHandlers, _samplers, _channelOwner, _commandOwner) that the
        // Courier thread (started by Start()) later only ever ENUMERATES,
        // never mutates itself. That single-writer-before-start / read-only-
        // after-start split is what makes those plain collections safe
        // without locks; registering an uplink AFTER Start() would race
        // the Courier thread's enumeration of them with no synchronization.
        public void Start()
        {
            // Every Uplink has registered by now, so this is the first moment
            // the declared-kind/evaluator pairing is knowable. Before the
            // threads, so a bad declaration fails without a half-started engine
            // to tear down. See ValidateGateDeclarations for why it cannot live
            // in AddCommandHandler beside the missing-declaration check.
            ValidateGateDeclarations();
            _courierThread.Start();
            _listener.Start();
        }

        public void Stop()
        {
            // Same ordering rationale as GonogoBodiesServer.Stop: stop the
            // listener first so any Closed callback it raises while tearing
            // down enqueues its DisconnectJob before the sentinel StopJob,
            // guaranteeing FIFO drain processes it.
            _listener.Stop();

            EnqueueJob(new StopJob());
            // F2-fix (Fix #2): raise the shutdown gate BEFORE the flush so any
            // command the Courier dequeues after FailPendingMainThreadCommands
            // drains fails fast in RunOnMainThread (no enqueue, no wait) instead
            // of re-populating the queue and blocking the Courier past the Join.
            // Closes the single-pass-flush race the review flagged.
            _engineStopping = true;
            // Unblock any command handler currently marshaled onto the
            // main-thread queue (the pump has stopped, so it would never
            // complete on its own) BEFORE the Join, so the Courier thread can
            // finish its in-flight job and reach the StopJob rather than
            // wedging out the full 5s timeout.
            FailPendingMainThreadCommands();
            _courierThread.Join(TimeSpan.FromSeconds(5));

            foreach (var session in _sessions.Values)
            {
                session.Outbox.Stop();
            }
        }

        public void Dispose() => Stop();

        // ----------------------------------------------------------------
        // Uplink registration (main thread, at load)
        // ----------------------------------------------------------------

        /// <summary>
        /// Registers one <see cref="ISitrepUplink"/>: records every
        /// channel/command it declares (manifest-first: see
        /// <see cref="ChannelDeclaration"/>'s doc comment), then calls its
        /// <see cref="ISitrepUplink.Register"/> so it can wire mappers/
        /// handlers against this engine (passed as <see cref="IUplinkHost"/>).
        /// A throwing <see cref="ISitrepUplink.Register"/> fail-softs ONLY
        /// this uplink (see <see cref="Availability"/>): every other
        /// registered uplink is unaffected.
        /// </summary>
        public void RegisterUplink(ISitrepUplink uplink)
        {
            var id = uplink.Manifest.Id;
            // Two-pass fix: do NOT clobber an existing availability entry. The
            // capability-declaration pass (DeclareUplinkCapabilities) may have
            // already marked this uplink Unavailable (its DeclareCapabilities
            // threw); overwriting to Available here would resurrect a broken
            // uplink. First registration (no prior entry) still starts Available.
            if (!_availability.ContainsKey(id))
            {
                _availability[id] = Availability.Available;
            }

            _registeredUplinks[id] = uplink;

            foreach (var channel in uplink.Manifest.Channels)
            {
                _channelDeclarations[channel.Topic] = channel;
                _channelOwner[channel.Topic] = id;
            }
            foreach (var command in uplink.Manifest.Commands)
            {
                _commandDeclarations[command.Command] = command;
                _commandOwner[command.Command] = id;
            }

            _currentRegisteringUplinkId = id;
            try
            {
                uplink.Register(this);
            }
            catch (Exception ex)
            {
                // Fix #4: route through MarkUplinkUnavailable (NOT a direct
                // _availability write) so a Register() that added a SampledSource
                // and THEN threw has that source's Disabled flag set too,
                // otherwise RunCaptures (which gates only on source.Disabled)
                // would keep invoking the half-initialised capture every tick
                // forever. Safe here: registration is pre-Start, single-threaded.
                MarkUplinkUnavailable(id, "registration threw: " + SafeExceptionMessage(ex));
            }
            finally
            {
                _currentRegisteringUplinkId = null;
            }
        }

        public Availability AvailabilityOf(string uplinkId)
        {
            return _availability.TryGetValue(uplinkId, out var availability)
                ? availability
                : Availability.Unavailable("unknown uplink \"" + uplinkId + "\"");
        }

        /// <summary>
        /// <see cref="UplinksTopic"/>'s mapper: the mod-side half of the
        /// Uplink health self-reporting feature. Walks every currently
        /// <see cref="_registeredUplinks"/> entry and produces one wire entry
        /// per uplink: <c>{ id, version, available, reason, health: { state,
        /// detail, facts } }</c>. <c>available</c>/<c>reason</c> come straight from
        /// <see cref="AvailabilityOf"/> (the registration-time fail-soft
        /// status this engine already tracked before this feature existed).
        /// <c>health</c> comes from <see cref="ISitrepUplink.Health"/>
        /// when the uplink implements it: wrapped in try/catch, same
        /// fail-soft shape <see cref="RegisterUplink"/>'s own Register() call
        /// uses, so a throwing Health() reports as
        /// <see cref="UplinkHealthState.Degraded"/> rather than taking down
        /// this whole channel (or the uplink's OWN availability/other
        /// channels: this is a read, not a registration step). An uplink
        /// that does NOT implement <see cref="ISitrepUplink.Health"/>
        /// derives its health straight from availability: Available →
        /// <see cref="UplinkHealthState.Healthy"/>, Unavailable →
        /// <see cref="UplinkHealthState.Unavailable"/> carrying the same
        /// reason: so every uplink shows SOME health, even the 14 built-ins
        /// that predate this interface and need no change to appear here.
        /// Ignores <paramref name="snapshot"/> entirely: this reads engine
        /// registration state, not KSP telemetry.
        /// </summary>
        /// <summary>Empty string to null, so an unset field is absent on the wire
        /// rather than an empty one a consumer has to special-case.</summary>
        private static string? Blank(string value) =>
            string.IsNullOrEmpty(value) ? null : value;

        private object? BuildSystemUplinksPayload(KspSnapshot? snapshot)
        {
            var entries = new List<object?>();
            foreach (var kvp in _registeredUplinks)
            {
                var id = kvp.Key;
                var uplink = kvp.Value;
                var availability = AvailabilityOf(id);
                var clientSource = uplink.Manifest.ClientSource;
                var declared = _declaredContract.TryGetValue(id, out var contract)
                    ? (ContractDeclaration?)contract
                    : null;
                entries.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["version"] = uplink.Manifest.Version,
                    // Provenance for the consent dialog: who wrote this, and
                    // where to go and look. Omitted entirely when unset, so an
                    // Uplink that predates the fields costs nothing on the wire.
                    ["name"] = Blank(uplink.Manifest.Name),
                    ["author"] = Blank(uplink.Manifest.Author),
                    ["repo"] = Blank(uplink.Manifest.Repo),
                    ["expectedClientHash"] = uplink.Manifest.ExpectedClientHash,   // H_mod (null for mod-only / older / dev DLL)
                    // D5: where the client bundle lives, so a third-party Uplink
                    // is self-describing. null for a mod-only Uplink (no client half).
                    ["clientSource"] = clientSource == null
                        ? null
                        : new Dictionary<string, object?>
                        {
                            ["url"] = clientSource.Url,
                            ["devPath"] = clientSource.DevPath,
                        },
                    ["available"] = availability.IsAvailable,
                    ["reason"] = availability.Reason,
                    // What this uplink declared it was built against, so a client can
                    // read a version against the core's own without inferring it from
                    // prose. Null for an uplink registered outside discovery, which
                    // declared nothing.
                    ["contractMajor"] = declared.HasValue ? (int?)declared.Value.Major : null,
                    ["contractMinor"] = declared.HasValue ? (int?)declared.Value.Minor : null,
                    ["health"] = BuildUplinkHealthPayload(uplink, availability),
                    ["ownedPrefixes"] = ComputeOwnedPrefixes(id),
                });
            }

            foreach (var kvp in _contractRefusals)
            {
                // An id that ALSO registered (two DLLs claiming one id, one stale and
                // one current) is already spoken for by the loop above, and the
                // registered one is the copy actually serving channels.
                if (_registeredUplinks.ContainsKey(kvp.Key))
                {
                    continue;
                }

                entries.Add(BuildContractRefusalEntry(kvp.Value));
            }

            return new Dictionary<string, object?>
            {
                ["uplinks"] = entries,
                // Stated once, because it is a fact about this core rather than about
                // any one uplink: the version the host speaks, which is the other half
                // of every refusal reason on the roster.
                ["coreContractMajor"] = Sitrep.Contract.ContractVersion.Major,
                ["coreContractMinor"] = Sitrep.Contract.ContractVersion.Minor,
            };
        }

        /// <summary>
        /// One refused uplink's roster entry. Built entirely from the
        /// <see cref="ContractRefusal"/> record, never by calling back into the refused
        /// uplink: its <see cref="ISitrepUplink.Manifest"/>, its
        /// <see cref="ISitrepUplink.Health"/> and everything they carry belong to
        /// another contract major, which is the whole reason it was refused. So the
        /// provenance fields an operator would otherwise get (name, author, repo, the
        /// client bundle) are null here, and the entry says the one thing that IS
        /// known and actionable: which version it was built for, and that this core
        /// speaks a different one.
        /// </summary>
        private static Dictionary<string, object?> BuildContractRefusalEntry(ContractRefusal refusal)
        {
            return new Dictionary<string, object?>
            {
                ["id"] = refusal.Id,
                // Its manifest is the unreadable half, so there is no version string to
                // report. Empty rather than null, keeping the field's type: the version
                // that matters for a refusal is the contract one below.
                ["version"] = "",
                ["name"] = null,
                ["author"] = null,
                ["repo"] = null,
                ["expectedClientHash"] = null,
                ["clientSource"] = null,
                ["available"] = false,
                ["reason"] = refusal.Reason,
                ["contractMajor"] = refusal.DeclaredMajor,
                ["contractMinor"] = refusal.DeclaredMinor,
                ["health"] = new Dictionary<string, object?>
                {
                    ["state"] = (int)UplinkHealthState.Unavailable,
                    ["detail"] = refusal.Reason,
                    ["facts"] = new List<object?>(),
                },
                // Register never ran, so it owns nothing. Present and empty, so a
                // client enumerates this entry exactly like every other one.
                ["ownedPrefixes"] = new List<string>(),
            };
        }

        /// <summary>
        /// Every topic/prefix this uplink OWNS: the Phase-1 half of the
        /// uplink-health render-gating design
        /// (local_docs/uplink-health-render-gating-design.md): the client resolves
        /// a widget's declared channels to an owning uplink via longest-prefix
        /// match against this list, instead of re-deriving a client-side
        /// TOPIC_OWNER map. Two sources, concatenated:
        /// <list type="bullet">
        /// <item><description>every statically-declared channel topic this uplink
        /// owns (<see cref="_channelOwner"/>: each entry there is already a
        /// maximal-length "prefix", since an exact match always wins longest-prefix
        /// resolution).</description></item>
        /// <item><description>every dynamic-namespace prefix this uplink registered
        /// (<see cref="_dynamicNamespaceOwner"/>: e.g. "kos.terminal.", covering
        /// every kos.terminal.&lt;coreId&gt; sub-topic before any one of them is
        /// ever materialized).</description></item>
        /// </list>
        /// NOTE: once a dynamic sub-topic materializes (see
        /// <see cref="EnsureDynamicTopicDeclared"/>), it ALSO gets its own
        /// <see cref="_channelOwner"/> entry: so this list can end up containing
        /// both the registered prefix ("kos.terminal.") and one of its already-
        /// materialized full topics ("kos.terminal.1"). Harmless redundancy: a
        /// longest-prefix match against either entry resolves to the same owner.
        /// </summary>
        private List<string> ComputeOwnedPrefixes(string uplinkId)
        {
            var prefixes = new List<string>();
            foreach (var kvp in _channelOwner)
            {
                if (kvp.Value == uplinkId)
                {
                    prefixes.Add(kvp.Key);
                }
            }
            foreach (var kvp in _dynamicNamespaceOwner)
            {
                if (kvp.Value == uplinkId)
                {
                    prefixes.Add(kvp.Key);
                }
            }
            return prefixes;
        }

        /// <summary>
        /// Resolves one uplink's <see cref="UplinkHealth"/>: self-reported
        /// via <see cref="ISitrepUplink.Health"/> when implemented (fail-soft
        /// wrapped), else derived from <paramref name="availability"/>: and
        /// packs it into the wire shape <see cref="BuildSystemUplinksPayload"/>
        /// uses. <see cref="UplinkHealthState"/> is serialized as its integer
        /// ordinal, matching every other enum in this codec (see
        /// <c>CareerViewProvider.ToWire(CareerMode)</c> for the identical
        /// convention).
        /// </summary>
        private static Dictionary<string, object?> BuildUplinkHealthPayload(ISitrepUplink uplink, Availability availability)
        {
            // Health is MANDATORY on ISitrepUplink, so this is a single
            // self-report call with no "does it implement Health?" branch. But
            // availability stays the presence
            // AUTHORITY: an uplink whose Register threw (fail-soft-caught by the
            // engine → marked Unavailable) never completed its health setup, so its
            // Health() cannot be trusted: report Unavailable with the registration
            // reason instead. An intentionally-inert uplink (RA/AGX/SCANsat) reports
            // the same Unavailable from its own Health() anyway, so this only changes
            // the register-threw case. When the uplink IS available, its Health() is
            // authoritative; the try/catch stays (a thrown Health() → Degraded, a read
            // fault must not crash the tick or take the uplink's channels down).
            UplinkHealth health;
            if (!availability.IsAvailable)
            {
                health = new UplinkHealth(UplinkHealthState.Unavailable, availability.Reason);
            }
            else
            {
                try
                {
                    health = uplink.Health();
                }
                catch (Exception ex)
                {
                    health = new UplinkHealth(UplinkHealthState.Degraded, "Health() threw: " + SafeExceptionMessage(ex));
                }
            }

            var facts = new List<object?>();
            foreach (var fact in health.Facts)
            {
                facts.Add(new Dictionary<string, object?>
                {
                    ["label"] = fact.Label,
                    ["value"] = fact.Value,
                });
            }

            return new Dictionary<string, object?>
            {
                ["state"] = (int)health.State,
                ["detail"] = health.Detail,
                // Flattened here rather than by the uplink, which is the point of
                // putting an uplink's dependency facts on this surface at all: the
                // wire writer emits core contract types and nothing else, so an
                // uplink publishing its own POCO on its own topic throws at the
                // boundary and takes every one of its channels and commands down
                // with it. Nothing an uplink hands to Health() reaches the writer
                // as anything but a string.
                ["facts"] = facts,
            };
        }

        /// <summary>
        /// The version-checked entry point <see cref="UplinkDiscovery.Discover"/>'s
        /// caller uses instead of the raw <see cref="RegisterUplink(ISitrepUplink)"/>;
        /// see <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>'s
        /// handshake design. A MAJOR mismatch between
        /// <paramref name="contractMajor"/> (what the Uplink was built
        /// against: see <see cref="Sitrep.Contract.SitrepUplinkAttribute"/>'s
        /// doc comment for why that's reliable even for a stale binary) and
        /// <see cref="Sitrep.Contract.ContractVersion.Major"/> (what THIS
        /// core actually is) fail-softs the Uplink WITHOUT ever calling its
        /// <see cref="ISitrepUplink.Register"/>: an Uplink built against a
        /// different major is not just "maybe buggy", it may not even
        /// deserialize/type-check against this core's contract shapes at
        /// all, so skipping Register entirely (rather than letting it run
        /// and rely on ordinary fail-soft) avoids handing it live wire types
        /// it was never compiled to expect. A MINOR mismatch (either
        /// direction) is fine, Minor bumps are additive-only, so an older-
        /// or newer-Minor Uplink and this core can always talk on their
        /// shared subset.
        /// </summary>
        public void RegisterDiscoveredUplink(ISitrepUplink uplink, int contractMajor, int contractMinor)
        {
            if (!PassesContractMajorCheck(uplink, declaredId: null, contractMajor, contractMinor))
            {
                return;
            }

            RegisterUplink(uplink);
        }

        /// <summary>
        /// Two-pass discovery registration: the order-independent fix for the
        /// capability-vs-provider registration hazard. Assembly-scan discovery
        /// (<see cref="UplinkDiscovery.Discover()"/>) fixes NO order between
        /// uplinks, and <see cref="Kernel.RegisterProvider"/> throws if its
        /// target capability is not yet registered. So registering uplinks
        /// one-at-a-time (each declaring its capability AND registering its
        /// providers inside a single <see cref="ISitrepUplink.Register"/>) could
        /// run a PROVIDER uplink (e.g. RealAntennas' <c>"comms"</c> provider)
        /// before the CAPABILITY-owning uplink: the provider registration would
        /// throw and be lost, silently dropping that provider from the election.
        ///
        /// <para>This method closes that by splitting registration into two
        /// passes over the SAME discovered set:</para>
        /// <list type="number">
        /// <item><b>Pass A: capabilities:</b> every uplink that implements
        /// <see cref="IUplinkCapabilityDeclarer"/> declares its capability
        /// descriptor(s) on the <see cref="Kernel"/>.</item>
        /// <item><b>Pass B: providers/sources:</b> every uplink's
        /// <see cref="ISitrepUplink.Register"/> runs (via
        /// <see cref="RegisterUplink"/>), by which point EVERY capability is
        /// already declared: so a provider registration can never miss its
        /// capability, whatever order discovery returned the uplinks in.</item>
        /// </list>
        /// Major-version-mismatched uplinks are filtered out up front (same
        /// rule as <see cref="RegisterDiscoveredUplink"/>) so neither pass ever
        /// touches them. An uplink whose Pass-A declaration throws is fail-softed
        /// to Unavailable and SKIPPED in Pass B.
        /// </summary>
        public void RegisterDiscoveredUplinks(IEnumerable<UplinkDiscovery.DiscoveredUplink> discovered)
        {
            var accepted = new List<ISitrepUplink>();
            foreach (var d in discovered)
            {
                if (PassesContractMajorCheck(d.Uplink, d.Id, d.ContractMajor, d.ContractMinor))
                {
                    accepted.Add(d.Uplink);
                }
            }

            // Pass A: declare every capability before any provider registers.
            foreach (var uplink in accepted)
            {
                DeclareUplinkCapabilities(uplink);
            }

            // Pass B: run Register (providers/channels/samplers). Skip any
            // uplink whose Pass-A declaration already failed it.
            foreach (var uplink in accepted)
            {
                if (!IsUplinkAvailable(uplink.Manifest.Id))
                {
                    continue;
                }
                RegisterUplink(uplink);
            }
        }

        /// <summary>
        /// Pass-A helper: runs one uplink's <see cref="IUplinkCapabilityDeclarer.DeclareCapabilities"/>
        /// (if it implements it) against the engine Kernel, fail-softing a throw
        /// to the uplink's availability so Pass B skips it. A no-op for an uplink
        /// that declares no capability of its own.
        /// </summary>
        private void DeclareUplinkCapabilities(ISitrepUplink uplink)
        {
            if (uplink is not IUplinkCapabilityDeclarer declarer)
            {
                return;
            }

            var id = uplink.Manifest.Id;
            if (!_availability.ContainsKey(id))
            {
                _availability[id] = Availability.Available;
            }

            try
            {
                declarer.DeclareCapabilities(_kernel);
            }
            catch (Exception ex)
            {
                MarkUplinkUnavailable(id, "capability declaration threw: " + SafeExceptionMessage(ex));
            }
        }

        /// <summary>One discovered uplink's declared contract version, as it rides <see cref="UplinksTopic"/>.</summary>
        private readonly struct ContractDeclaration
        {
            public int Major { get; }
            public int Minor { get; }

            public ContractDeclaration(int major, int minor)
            {
                Major = major;
                Minor = minor;
            }
        }

        /// <summary>
        /// One contract-major refusal, holding everything <see cref="UplinksTopic"/>
        /// needs to name it. All of it comes from the
        /// <see cref="Sitrep.Contract.SitrepUplinkAttribute"/> the scan resolved
        /// against THIS core's contract, never from the refused uplink itself: a
        /// refusal that could only be voiced by reading the refused uplink's own
        /// manifest would not survive the mismatch it exists to report.
        /// </summary>
        private readonly struct ContractRefusal
        {
            public string Id { get; }
            public int DeclaredMajor { get; }
            public int DeclaredMinor { get; }
            public string Reason { get; }

            public ContractRefusal(string id, int declaredMajor, int declaredMinor, string reason)
            {
                Id = id;
                DeclaredMajor = declaredMajor;
                DeclaredMinor = declaredMinor;
                Reason = reason;
            }
        }

        /// <summary>
        /// Shared MAJOR-version gate for both the single
        /// (<see cref="RegisterDiscoveredUplink"/>) and batch
        /// (<see cref="RegisterDiscoveredUplinks"/>) discovery paths. A MAJOR
        /// mismatch fail-softs the uplink to Unavailable WITHOUT registering it,
        /// see <see cref="RegisterDiscoveredUplink"/>'s original doc comment for
        /// the full handshake rationale, and records the refusal so
        /// <see cref="BuildSystemUplinksPayload"/> can carry it. Returns true iff the
        /// uplink may proceed.
        ///
        /// <para><paramref name="declaredId"/> is the id off the discovery attribute,
        /// and the refusal path uses ONLY that: a major-mismatched uplink's
        /// <see cref="ISitrepUplink.Manifest"/> is a shape belonging to a contract
        /// this core has just declared it cannot type-check against, so reaching for
        /// it can throw and take the whole registration pass with it. The
        /// manifest is still the fallback when the caller had no attribute to read,
        /// where it is the only name available and the uplink is one this core built
        /// its own discovery record for.</para>
        /// </summary>
        private bool PassesContractMajorCheck(ISitrepUplink uplink, string? declaredId, int contractMajor, int contractMinor)
        {
            if (contractMajor != Sitrep.Contract.ContractVersion.Major)
            {
                var refusedId = string.IsNullOrEmpty(declaredId) ? uplink.Manifest.Id : declaredId!;
                var reason =
                    $"contract v{contractMajor}.{contractMinor} vs core v{Sitrep.Contract.ContractVersion.Major}.{Sitrep.Contract.ContractVersion.Minor}: major mismatch";
                _availability[refusedId] = Availability.Unavailable(reason);
                _contractRefusals[refusedId] = new ContractRefusal(refusedId, contractMajor, contractMinor, reason);
                return false;
            }

            var acceptedId = string.IsNullOrEmpty(declaredId) ? uplink.Manifest.Id : declaredId!;
            _declaredContract[acceptedId] = new ContractDeclaration(contractMajor, contractMinor);
            return true;
        }

        // ----------------------------------------------------------------
        // IUplinkHost
        // ----------------------------------------------------------------

        // NOTE: called from the main thread (a registered uplink calling
        // this via its IUplinkHost during e.g. a command handler that
        // wants "now") while _clock itself is Courier-thread-owned, a
        // cross-thread READ of ManualClock's private double _currentUt with
        // no lock. This is fine on any 64-bit target (this mod's only
        // target, see the .csproj): a naturally-aligned double field read/
        // write is atomic on x86-64/ARM64, so this can observe a slightly
        // stale value but never a torn (half-written) one.
        double IUplinkHost.NowUt() => _clock.Now();

        // Recorded against the CURRENTLY-registering uplink id, same
        // mechanism AddChannelSource/AddCommandHandler rely on implicitly via
        // _channelOwner/_commandOwner: see the sampler loop in ProcessTick
        // for how this is consulted (skip-if-Unavailable) and acted on
        // (attribute-and-disable on a throw).
        public void AddSampler(ISnapshotSampler sampler) => _samplers.Add((_currentRegisteringUplinkId ?? "", sampler));

        // Recorded against the CURRENTLY-registering uplink id, same mechanism
        // as AddSampler above. The capture runs on the main-loop thread (see
        // RunCaptures, called from Tick), the handle on the Courier thread
        // (see ProcessTick's capture loop): see IUplinkHost.AddSampledSource
        // for the full threading contract.
        public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier)
        {
            AddSampledSource(captureOnMainThread, handleOnCourier, Array.Empty<string>());
        }

        // Subscription-gated overload (see IUplinkHost.AddSampledSource's
        // prefix overload): the declared topic prefixes let RunCaptures
        // early-out the capture on the main-loop thread when nothing this
        // source produces is subscribed. An empty prefix set means "never
        // gate": the original always-capture behaviour.
        public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes)
        {
            _sampledSources.Add(new SampledSource(
                _currentRegisteringUplinkId ?? "",
                captureOnMainThread,
                handleOnCourier,
                subscriptionTopicPrefixes ?? Array.Empty<string>()));
        }

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map)
        {
            RequireChannelDeclared(topic, nameof(AddChannelSource));
            _channelSources[topic] = map;
        }

        // Recorded against the CURRENTLY-registering uplink id, same mechanism
        // as AddSampledSource above: its owner is what MarkUplinkUnavailable /
        // FailSoftSignalDelaySource disable. See _signalDelaySource's field
        // doc comment and IUplinkHost.SetSignalDelaySource. Last registration
        // wins (a single delay authority is expected, the exclusive "comms"
        // uplink); a second registration simply replaces it.
        public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread)
        {
            _signalDelaySource = computeOnMainThread;
            _signalDelaySourceOwnerId = _currentRegisteringUplinkId ?? "";
            _signalDelaySourceDisabled = false;
        }

        // Same ownership and last-registration-wins discipline as
        // SetSignalDelaySource above, and registered by the same exclusive comms
        // uplink: a break is a statement about the route the delay authority is
        // already measuring, so a second opinion on it would be a second delay
        // model. See IUplinkHost.SetPathBreakSource.
        public void SetPathBreakSource(Func<KspSnapshot?, double, PathBreak?> computeOnMainThread)
        {
            _pathBreakSource = computeOnMainThread;
            _pathBreakSourceOwnerId = _currentRegisteringUplinkId ?? "";
            _pathBreakSourceDisabled = false;
        }

        public void SetVesselDelay(string vesselId, double oneWaySeconds)
        {
            // Per-vessel downlink delay (Plan 2): the vessel's fleet.<id> node
            // carries its own routed light-time for the single KSC observer.
            // NodeForTopic maps fleet.<id>.* topics to this node, so its
            // telemetry is delayed by DelayTo(vantage, fleet.<id>).
            var node = FleetNodePrefix + vesselId;

            // Snapshot the OUTGOING delay while the subject's link is still
            // known up, before this tick's fresh read replaces it: the per-vessel
            // twin of CaptureSignalDelay's _subjectLastConnectedDelay[NodeId]
            // write, and for the identical reason. The fleet capture keeps
            // reporting a vessel that has just gone dark, at a routed light-time
            // that has collapsed to 0 because there is no longer a path to
            // measure, so the incoming value on the disconnect tick is already
            // the useless one. fleet.<id>.contact reveals at this horizon (see
            // RevealDelayFor).
            if (SubjectConnected(node))
            {
                _subjectLastConnectedDelay[node] =
                    _vesselNodeDelay.TryGetValue(node, out var previous) ? previous : oneWaySeconds;
            }
            _vesselNodeDelay[node] = oneWaySeconds;

            _network.SetNodeDelay(node, oneWaySeconds);
        }

        public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds)
        {
            // Per-(authority, subject) command delay (Plan 3): the explicit
            // (vantage = centreId, node = fleet.<vesselId>) pair overrides the
            // SetVesselDelay node-default for an operator whose SelectedVantage is
            // this centre. DelayTo's 3-tier lookup keeps the node-default beneath
            // it for any unselected vantage, so KSC-only behaviour is unchanged.
            _network.SetDelay(centreId, FleetNodePrefix + vesselId, oneWaySeconds);
        }

        public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds)
        {
            // Centre-to-centre command delay: the same explicit (vantage, node)
            // tier as SetAuthorityDelay, with a centre on BOTH sides. Writing it
            // is what makes "send this from a deep-space centre to the home
            // centre" a lookup rather than a missing number.
            _network.SetDelay(fromCentreId, CentreNodePrefix + toCentreId, oneWaySeconds);
        }

        public void RegisterCommandCentreSource(ICommandCentreSource source)
        {
            _commandCentres.RegisterSource(source);
        }

        /// <summary>
        /// Apply a client set-vantage request (Plan 3): switch the connection's
        /// SelectedVantage to a command centre. <see cref="DefaultVantage"/> is
        /// always selectable (it resolves to Plan 2's node-default even before any
        /// home-node source is live); any other id must name a currently-active
        /// centre, else the prior vantage is kept and an error is returned.
        /// </summary>
        private void HandleSetVantage(ClientSession session, SetVantage sv)
        {
            var valid = sv.CentreId == DefaultVantage
                || _commandCentres.EnumerateActive().Any(c => c.Id == sv.CentreId);

            if (!valid)
            {
                var error = new ErrorMsg
                {
                    Code = "unknown-vantage",
                    Message = $"'{sv.CentreId}' is not an active command centre",
                };
                session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteErrorMsg(error)));
                return;
            }

            // Reference assignment is atomic; the Courier thread reads the new
            // vantage on subsequent subscribes/dispatches (an eventually-consistent
            // switch, matching the client re-subscribing its topics at the new vantage).
            session.SelectedVantage = sv.CentreId;
        }

        public void SetVesselConnectivity(string vesselId, bool connected)
        {
            // Per-vessel freeze (Plan 2b): the vessel's fleet.<id> subject
            // freezes on ITS OWN link. Rides the gated fleet capture (only
            // subscribed fleet vessels need freeze tracking); the active vessel
            // stays on the ungated SetConnectivitySource. Courier-thread-only,
            // like SetSubjectConnected's other caller.
            SetSubjectConnected(FleetNodePrefix + vesselId, connected, _clock.Now());
        }

        // Recorded against the CURRENTLY-registering uplink id, same mechanism
        // and lifecycle discipline as SetSignalDelaySource above: the
        // subscription-independent CONNECTED/DISCONNECTED authority the reveal
        // gate freezes on (see _commsConnected / CaptureConnectivityOnMain /
        // RefreshConnectivityFromCapability). Last registration wins.
        public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread)
        {
            _connectivitySource = computeOnMainThread;
            _connectivitySourceOwnerId = _currentRegisteringUplinkId ?? "";
            _connectivitySourceDisabled = false;
        }

        public IChannelPublisher Publisher(string topic)
        {
            RequireChannelDeclared(topic, nameof(Publisher));
            return new ChannelPublisher(this, topic);
        }

        public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template)
        {
            _dynamicNamespaces[prefix] = template;
            _dynamicNamespaceOwner[prefix] = _currentRegisteringUplinkId ?? "";
            if (template.PerVesselNode && !_perVesselNamespacePrefixes.Contains(prefix))
            {
                _perVesselNamespacePrefixes.Add(prefix);
            }
            return new DynamicChannelSource(this, prefix);
        }

        /// <summary>
        /// <see cref="IDynamicChannelSource.OnSubscribed"/>'s engine-side
        /// bookkeeping: see <see cref="_dynamicNamespaceSubscribeListeners"/>'s
        /// field doc comment and <see cref="NotifyDynamicNamespaceSubscribed"/>.
        /// </summary>
        private void AddDynamicNamespaceSubscribeListener(string prefix, Action<string> callback)
        {
            if (!_dynamicNamespaceSubscribeListeners.TryGetValue(prefix, out var listeners))
            {
                listeners = new List<Action<string>>();
                _dynamicNamespaceSubscribeListeners[prefix] = listeners;
            }
            listeners.Add(callback);
        }

        /// <summary>
        /// Courier-thread-only: fires every listener registered via
        /// <see cref="IDynamicChannelSource.OnSubscribed"/> for the dynamic
        /// namespace <paramref name="topic"/> falls under (a no-op if it
        /// falls under none, or none registered a listener). Called from
        /// <see cref="ProcessSubscribe"/> for EVERY individual session
        /// subscribe: see that call site's comment for why this must not
        /// be gated on <c>_subscriptions.Subscribe</c>'s aggregate 0-&gt;1
        /// return. A throwing listener is caught and logged here (not left
        /// to the CourierLoop's outer backstop) so it can never skip the
        /// ack/bookkeeping that follows this call in ProcessSubscribe.
        /// </summary>
        private void NotifyDynamicNamespaceSubscribed(string topic)
        {
            var prefix = FindDynamicNamespaceForTopic(topic);
            if (prefix == null || !_dynamicNamespaceSubscribeListeners.TryGetValue(prefix, out var listeners))
            {
                return;
            }
            foreach (var listener in listeners)
            {
                try
                {
                    listener(topic);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[ChannelEngine] dynamic-namespace subscribe listener for \"" + prefix + "\" threw: " + ex);
                }
            }
        }

        /// <summary>
        /// Materializes <paramref name="fullTopic"/> (<c>prefix + subTopic</c>)
        /// into an ordinary declared channel, cloned from
        /// <paramref name="prefix"/>'s registered template, if it hasn't
        /// been already: idempotent, safe to call on every publish/subscribe.
        /// After this call, <paramref name="fullTopic"/> behaves exactly
        /// like any statically-declared <see cref="ChannelDeclaration"/>:
        /// its own independent <see cref="ChannelEmitter"/> state (via
        /// <c>_channelDeclarations</c>'s per-topic Emission lookup), its own
        /// birth-guard entry, its own availability tracking.
        /// </summary>
        private void EnsureDynamicTopicDeclared(string prefix, string fullTopic)
        {
            if (_channelDeclarations.ContainsKey(fullTopic))
            {
                return;
            }

            var template = _dynamicNamespaces[prefix];
            _channelDeclarations[fullTopic] = new ChannelDeclaration
            {
                Topic = fullTopic,
                Delivery = template.Delivery,
                Emission = template.Emission,
                Delay = template.Delay,
                IsKeyframe = template.IsKeyframe,
            };
            _channelOwner[fullTopic] = _dynamicNamespaceOwner[prefix];
        }

        /// <summary>Returns the registered dynamic-namespace prefix that <paramref name="topic"/> falls under, or null.</summary>
        private string? FindDynamicNamespaceForTopic(string topic)
        {
            foreach (var prefix in _dynamicNamespaces.Keys)
            {
                if (topic.StartsWith(prefix, StringComparison.Ordinal))
                {
                    return prefix;
                }
            }
            return null;
        }

        public void AddGateEvaluator(ICommandGateEvaluator evaluator)
        {
            if (evaluator == null) throw new ArgumentNullException(nameof(evaluator));
            if (string.IsNullOrWhiteSpace(evaluator.Kind))
            {
                throw new InvalidOperationException(
                    "a gate evaluator must name the requirement Kind it answers");
            }
            if (_gateEvaluators.TryGetValue(evaluator.Kind, out var existing) && !ReferenceEquals(existing, evaluator))
            {
                // Two evaluators for one kind means two answers to the same
                // question, and which one wins would depend on Uplink
                // registration order. Refused rather than last-wins.
                throw new InvalidOperationException(
                    $"gate kind \"{evaluator.Kind}\" already has an evaluator ({existing.GetType().Name}); "
                        + $"{evaluator.GetType().Name} cannot also claim it");
            }
            _gateEvaluators[evaluator.Kind] = evaluator;
        }

        public void AddCommandRequirement(string command, CommandRequirement requirement)
        {
            if (string.IsNullOrWhiteSpace(command)) throw new ArgumentNullException(nameof(command));
            if (requirement == null) throw new ArgumentNullException(nameof(requirement));
            if (string.IsNullOrWhiteSpace(requirement.Kind))
            {
                throw new InvalidOperationException(
                    $"a requirement contributed to \"{command}\" must name the gate Kind that answers it");
            }

            // The command's OWN declaration may not have arrived yet: Uplink
            // registration order is not controllable, and a mod's Uplink may well
            // register before the one that declares the command it constrains.
            // ValidateGateDeclarations checks the pairing once, after all of them.
            if (!_contributedRequirements.TryGetValue(command, out var contributed))
            {
                contributed = new List<CommandRequirement>();
                _contributedRequirements[command] = contributed;
            }
            contributed.Add(requirement);
        }

        /// <summary>
        /// Everything that must hold for one command: what its owning Uplink
        /// declared, then what other Uplinks contributed, in that order.
        /// </summary>
        /// <remarks>
        /// Order is the whole reason this is a concatenation rather than a set.
        /// <see cref="EvaluateGatesHere"/> returns on the first non-Pass verdict,
        /// and core's own requirements are the ones answerable with no arguments
        /// at all: an occupied pad is a fact the game knows in advance, and a
        /// contributed requirement abstaining ahead of it would turn a control
        /// that goes dark with a reason into one that fails the press.
        /// </remarks>
        private CommandRequirement[] RequirementsFor(string command)
        {
            _commandDeclarations.TryGetValue(command, out var declaration);
            var declared = declaration?.Requires ?? EmptyRequirements;
            if (!_contributedRequirements.TryGetValue(command, out var contributed) || contributed.Count == 0)
            {
                return declared;
            }

            var all = new CommandRequirement[declared.Length + contributed.Count];
            Array.Copy(declared, all, declared.Length);
            contributed.CopyTo(all, declared.Length);
            return all;
        }

        private static readonly CommandRequirement[] EmptyRequirements = new CommandRequirement[0];

        /// <summary>
        /// Evaluate a command's declared requirements against what is known.
        ///
        /// <para>ONE evaluation, parameterised by how much of the call is
        /// supplied. An empty <paramref name="arguments"/> yields the
        /// addressability answer (static requirements decide, argument-dependent
        /// ones abstain); the full bag yields the dispatch answer. That is why
        /// there is no separate addressability path to keep in step with this
        /// one.</para>
        ///
        /// <para>Returns the first non-<see cref="GateOutcome.Pass"/> verdict, or
        /// Pass. First rather than all: a caller acts on one reason, and
        /// evaluating the rest after a Fail costs live game reads for an answer
        /// nobody reads.</para>
        ///
        /// <para><b>Runs where the handler runs.</b> An evaluator reads LIVE game
        /// state, which is the same Unity main-thread constraint every command
        /// handler is under, so it is marshaled through the same pump when the
        /// engine is configured for it. Without that a gate reading
        /// <c>FlightGlobals</c> or <c>PSystemSetup</c> off the Courier thread
        /// raises Unity's cross-thread exception, which this method catches as
        /// <see cref="GateOutcome.Unknown"/>, and Unknown refuses: a gate that
        /// cannot be evaluated would have refused its command for ever, and
        /// looked deliberate doing it.</para>
        /// </summary>
        internal GateVerdict EvaluateGates(string command, IGateArguments arguments)
        {
            if (RequirementsFor(command).Length == 0) return GateVerdict.Pass();

            if (!_executeCommandsOnMainThread) return EvaluateGatesHere(command, arguments);

            try
            {
                return RunOnMainThread(_ => EvaluateGatesHere(command, arguments), null) as GateVerdict
                    ?? GateVerdict.Unknown("the gate evaluation returned nothing");
            }
            catch (Exception ex)
            {
                // The marshaling itself failed (the engine is stopping, or the
                // main-thread pump stalled). Fail-closed, same as an evaluator
                // that threw, and say which so it does not read as a refusal the
                // game made.
                return GateVerdict.Unknown(
                    "could not reach the main thread to evaluate the gate: " + SafeExceptionMessage(ex));
            }
        }

        /// <summary>
        /// <see cref="EvaluateGates"/>'s body, on whichever thread the caller has
        /// arranged to be the right one.
        /// </summary>
        private GateVerdict EvaluateGatesHere(string command, IGateArguments arguments) =>
            EvaluateGatesHere(command, arguments, null);

        /// <summary>
        /// <paramref name="memo"/> caches one evaluator answer per distinct
        /// requirement WITHIN A SINGLE PASS OVER ONE ARGUMENT BAG, and is only
        /// ever supplied by <see cref="SampleCommandGates"/>. Nine of the eleven
        /// gated commands declare the same career-mode requirement, so without
        /// it a sample asks the same question of the same authority nine times
        /// per tick on the main thread. Keyed on the requirement's whole
        /// identity, never carried between passes: the point of sampling is that
        /// the answer changes.
        /// </summary>
        private GateVerdict EvaluateGatesHere(
            string command, IGateArguments arguments, Dictionary<string, GateVerdict>? memo)
        {
            var requirements = RequirementsFor(command);
            if (requirements.Length == 0) return GateVerdict.Pass();

            foreach (var requirement in requirements)
            {
                // Abstention, decided HERE and only here. An evaluator is never
                // asked a question it lacks the arguments to answer, so it never
                // has to implement this and so it cannot implement it wrongly.
                // Getting it wrong privately would publish the command as
                // permanently unaddressable, which disables the control for good
                // and looks like it is working.
                if (!HasAllNeeds(requirement, arguments))
                {
                    return new GateVerdict { Outcome = GateOutcome.Abstain };
                }

                if (!_gateEvaluators.TryGetValue(requirement.Kind ?? "", out var evaluator))
                {
                    // Unreachable once ValidateGateDeclarations has run, and
                    // deliberately Unknown rather than Pass if it ever is: an
                    // unevaluable gate must not read as no gate.
                    return GateVerdict.Unknown($"no evaluator registered for gate kind \"{requirement.Kind}\"");
                }

                var memoKey = memo == null ? null : RequirementKey(requirement);
                if (memoKey != null && memo!.TryGetValue(memoKey, out var remembered))
                {
                    if (remembered.Outcome != GateOutcome.Pass) return remembered;
                    continue;
                }

                GateVerdict verdict;
                try
                {
                    verdict = evaluator.Evaluate(requirement, arguments) ?? GateVerdict.Pass();
                }
                catch (Exception ex)
                {
                    // Same fail-soft posture as a channel mapper, with the
                    // opposite default: a throwing evaluator marks its owner
                    // unavailable AND the gate reads Unknown, never Pass.
                    FailSoftCommand(command, ex);
                    return GateVerdict.Unknown($"gate kind \"{requirement.Kind}\" threw: {SafeExceptionMessage(ex)}");
                }

                if (verdict.Outcome == GateOutcome.Abstain)
                {
                    // The arithmetic has leaked into an evaluator. Not honoured,
                    // because an evaluator that abstains when the host already
                    // decided it had everything it needs is answering a different
                    // question than the one asked.
                    return GateVerdict.Unknown(
                        $"gate kind \"{requirement.Kind}\" abstained despite having its declared arguments; "
                            + "abstention is the host's decision, not an evaluator's");
                }

                if (memoKey != null) memo![memoKey] = verdict;

                if (verdict.Outcome != GateOutcome.Pass) return verdict;
            }

            return GateVerdict.Pass();
        }

        /// <summary>
        /// A requirement's whole identity, for the sampler's per-pass memo. The
        /// separator is a unit separator rather than a dot or a slash because
        /// every part is free text an Uplink chose, and a separator that can
        /// appear inside a part would make two different requirements share one
        /// answer.
        /// </summary>
        private static string RequirementKey(CommandRequirement requirement) =>
            (requirement.Kind ?? "") + "\u001f" + (requirement.Facility ?? "")
                + "\u001f" + (requirement.Quantity ?? "");

        /// <summary>
        /// Re-read every gated command's requirements with an EMPTY argument bag
        /// and publish the answers to <c>system.uplink.gates</c>, so a control
        /// can be drawn dark before the operator presses it.
        ///
        /// <para><b>MUST be called from the Unity main thread</b>, once per frame
        /// from <c>GonogoAddon.Update</c> beside
        /// <see cref="RunPendingCommands"/>. This is the whole reason the channel
        /// has a sampler at all rather than doing its reads in the mapper like
        /// every other channel here: mappers run on the Courier thread, an
        /// evaluator reads live game state, and a Unity read from the wrong
        /// thread raises a cross-thread exception that
        /// <see cref="EvaluateGatesHere"/> catches as
        /// <see cref="GateOutcome.Unknown"/>. Unknown REFUSES, so the failure
        /// mode is every gated control published as permanently unavailable,
        /// with a reason that reads like the game's. That exact bug has already
        /// been shipped and fixed once on the dispatch path; this is the same
        /// trap one layer out, and
        /// <c>GateSamplingRunsOnTheMainThreadPumpNotTheCourierThread</c> is what
        /// stops it recurring.</para>
        ///
        /// <para>Called every frame, samples at
        /// <see cref="GateSampleIntervalSec"/>. The caller does not own the
        /// cadence: putting the throttle here rather than at the call site means
        /// a second caller cannot double the main-thread cost by accident.</para>
        ///
        /// <para>Never throws. A sampler that could break the frame would be a
        /// worse bargain than a stale verdict.</para>
        /// </summary>
        public void SampleCommandGates()
        {
            var nowSec = _gateSampleClock.Elapsed.TotalSeconds;
            if (nowSec - _lastGateSampleAtSec < GateSampleIntervalSec) return;
            _lastGateSampleAtSec = nowSec;

            var gates = new List<CommandGate>();
            var memo = new Dictionary<string, GateVerdict>(StringComparer.Ordinal);
            try
            {
                foreach (var pair in _commandDeclarations)
                {
                    // RequirementsFor, not the declaration's own array: a command
                    // an installed mod has constrained is gated whether or not
                    // core declared anything about it, and leaving it out would
                    // publish it as having nothing to say about itself.
                    if (RequirementsFor(pair.Key).Length == 0) continue;
                    gates.Add(new CommandGate
                    {
                        Command = pair.Key,
                        // Deliberately GateArguments.None: this is the
                        // addressability question, so an argument-dependent
                        // requirement abstains rather than guessing, and the
                        // client renders an Abstain as "no answer in advance".
                        Verdict = EvaluateGatesHere(pair.Key, GateArguments.None, memo),
                    });
                }
            }
            catch (Exception ex)
            {
                // EvaluateGatesHere already fail-softs a throwing evaluator, so
                // reaching here means the walk itself broke. Keep the previous
                // report rather than publishing a half-built one: a partial set
                // would read as "these commands are no longer gated".
                LogHost("gate sampling threw, keeping the previous verdicts: " + SafeExceptionMessage(ex));
                return;
            }

            // memo.Count is exactly the number of evaluator calls this pass made:
            // a repeated requirement is answered from the memo without one.
            _commandGateBudget?.Record(memo.Count, nowSec);
            Volatile.Write(ref _commandGateReport, new CommandGateReport { Gates = gates });
        }

        private static bool HasAllNeeds(CommandRequirement requirement, IGateArguments arguments)
        {
            var needs = requirement.Needs;
            if (needs == null || needs.Length == 0) return true;
            foreach (var path in needs)
            {
                if (!arguments.TryGet(path, out _)) return false;
            }
            return true;
        }

        /// <summary>
        /// Every declared gate kind has an evaluator. Run ONCE, after every
        /// Uplink has registered.
        ///
        /// <para>It cannot be a guard inside
        /// <see cref="AddCommandHandler{TArgs,TResult}"/>, which is where the
        /// missing-DECLARATION check lives, because evaluators and handlers both
        /// register during Uplink registration and Uplink order is not
        /// controllable: a command may legitimately declare a kind whose
        /// evaluator registers from a later Uplink.</para>
        ///
        /// <para>Throwing is the point. A misspelled kind, or an Uplink that
        /// declares a gate and forgets its evaluator, otherwise produces a gate
        /// that silently does not exist: nothing refused, nothing disabled,
        /// published as addressable. A startup failure names it once instead.</para>
        /// </summary>
        internal void ValidateGateDeclarations()
        {
            var missing = new List<string>();
            foreach (var pair in _commandDeclarations)
            {
                foreach (var requirement in RequirementsFor(pair.Key))
                {
                    var kind = requirement.Kind ?? "";
                    if (!_gateEvaluators.ContainsKey(kind))
                    {
                        missing.Add($"command \"{pair.Key}\" requires gate kind \"{kind}\"");
                    }
                }
            }

            // A contribution to a command nobody declares constrains nothing, and
            // reads exactly like one that is being enforced. Named here rather
            // than dropped, because the shape of the mistake is a typo in a
            // command id and the Uplink that made it cannot tell.
            foreach (var pair in _contributedRequirements)
            {
                if (pair.Value.Count > 0 && !_commandDeclarations.ContainsKey(pair.Key))
                {
                    missing.Add($"a requirement was contributed to \"{pair.Key}\", which no uplink declares");
                }
            }

            if (missing.Count > 0)
            {
                throw new InvalidOperationException(
                    "gate requirements that cannot be enforced: " + string.Join("; ", missing.ToArray())
                        + ". Register an ICommandGateEvaluator for each kind, name a command that exists, "
                        + "or remove the requirement: a gate nobody can evaluate is a gate that silently "
                        + "does not exist.");
            }
        }

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
            if (!_commandDeclarations.ContainsKey(command))
            {
                throw new InvalidOperationException(
                    $"AddCommandHandler(\"{command}\") has no matching CommandDeclaration, " +
                    "declare it in the registering uplink's Manifest.Commands first.");
            }
            // EnvelopeCodec deserializes wire command args to a GENERIC shape
            // (Dictionary<string, object?> for objects, double for numbers,
            // bool, string, List<object?> for arrays: never a typed TArgs;
            // see EnvelopeCodec's doc comment). A raw (TArgs)args! cast on
            // that generic shape throws InvalidCastException for every command
            // that takes a typed args record, which is exactly why the whole
            // command/write path was dead over the real socket. BindCommandArgs
            // converts the generic shape into the declared TArgs by reflection
            // (case-insensitive property match + primitive/enum conversion),
            // and passes already-typed args (in-process callers/tests) straight
            // through. A genuinely unconvertible value still throws, caught one
            // layer up in InvokeCommandHandler (the SOLE call site for every
            // registered command handler), which fail-softs just this command's
            // owning uplink instead of crashing the Courier thread.
            _commandHandlers[command] = args => handler((TArgs)BindCommandArgs(args, typeof(TArgs))!);
        }

        /// <summary>
        /// As <see cref="AddCommandHandler{TArgs,TResult}"/>, for the handlers whose
        /// answer depends on which command centre asked.
        ///
        /// <para>Kept in its own store rather than as a wider signature on the same
        /// one, so the hundred handlers that do not care are untouched. Args binding
        /// is identical: only the extra argument differs.</para>
        /// </summary>
        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler)
        {
            if (!_commandDeclarations.ContainsKey(command))
            {
                throw new InvalidOperationException(
                    $"AddVantageCommandHandler(\"{command}\") has no matching CommandDeclaration, " +
                    "declare it in the registering uplink's Manifest.Commands first.");
            }
            _vantageCommandHandlers[command] =
                (args, vantage) => handler((TArgs)BindCommandArgs(args, typeof(TArgs))!, vantage);
        }

        /// <summary>
        /// Converts a command's generic wire-deserialized args (the
        /// double/bool/string/<c>Dictionary&lt;string, object?&gt;</c>/
        /// <c>List&lt;object?&gt;</c> shape <see cref="EnvelopeCodec.ParseCommandRequest"/>
        /// produces) into the declared <paramref name="targetType"/> so a typed
        /// handler receives a real <c>TArgs</c> instead of throwing
        /// <c>InvalidCastException</c> on a raw cast. GENERIC by design: it
        /// reflects over the target type's writable properties rather than
        /// switching per command, so a new command's arg record binds with no
        /// per-type code (the same "no per-type switch" lesson the outbound
        /// <c>JsonWriter</c> learned the hard way).
        ///
        /// <para>Rules: an <c>args</c> already assignable to the target
        /// (in-process callers/tests, or a scalar that already matches) passes
        /// straight through; <c>null</c> args return <c>null</c> (commands like
        /// <c>vessel.control.stage</c> take <c>object?</c>/null); a missing
        /// object key leaves that property at its default (so an absent nullable
        /// discriminated-union field like <see cref="Sitrep.Contract.SetTargetArgs.BodyIndex"/>
        /// stays null, never defaulted to 0); an enum binds from a NUMERIC
        /// ordinal (the wire form) as well as a string name; a genuinely
        /// incompatible value (e.g. a number against a <c>string</c> property,
        /// or an object bag against a scalar) throws, and the throw is
        /// fail-softed by <see cref="InvokeCommandHandler"/>.</para>
        /// </summary>
        internal static object? BindCommandArgs(object? value, Type targetType)
        {
            if (value is null)
            {
                // Reference type / Nullable<T> / object? => null is a legal
                // value. A non-nullable value type can't hold null; let the
                // downstream cast surface that (fail-softed one layer up),
                // no real command declares a non-nullable-value TArgs.
                return null;
            }

            // Already the declared type: typed in-process args, a scalar wire
            // value that matches (double->double, string->string, bool->bool),
            // or an object? passthrough. No reflection needed.
            if (targetType.IsInstanceOfType(value))
            {
                return value;
            }

            var underlying = Nullable.GetUnderlyingType(targetType);
            if (underlying != null)
            {
                return BindCommandArgs(value, underlying);
            }

            if (targetType.IsEnum)
            {
                if (value is string enumName)
                {
                    return ParseEnumByNameMetadataOnly(targetType, enumName);
                }
                // Wire form is the numeric ordinal.
                return Enum.ToObject(targetType, Convert.ToInt64(value, CultureInfo.InvariantCulture));
            }

            if (targetType == typeof(string))
            {
                // A string property only accepts a string; never a coerced
                // number/bool (that would mask a genuine client/type mismatch).
                if (value is string s)
                {
                    return s;
                }
                throw new InvalidCastException(
                    $"Cannot bind wire value of type {value.GetType().Name} to string.");
            }

            if (targetType == typeof(bool))
            {
                if (value is bool b)
                {
                    return b;
                }
                throw new InvalidCastException(
                    $"Cannot bind wire value of type {value.GetType().Name} to bool.");
            }

            if (IsConvertibleNumeric(targetType))
            {
                // Numbers arrive as double off the wire; widen/narrow to the
                // declared numeric type. A bool/string/object bag is NOT a
                // number: reject it (Convert.ChangeType would either coerce
                // surprisingly or throw; be explicit for the object-bag case).
                if (value is bool || value is string || value is IDictionary<string, object?> || value is System.Collections.IEnumerable)
                {
                    throw new InvalidCastException(
                        $"Cannot bind wire value of type {value.GetType().Name} to numeric {targetType.Name}.");
                }
                return Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
            }

            if (value is IDictionary<string, object?> dict)
            {
                return BindObject(dict, targetType);
            }

            // Wire arrays arrive as List<object?> (never a typed List<T>): bind
            // each element to the declared element type of a List<T>/IList<T>/
            // IReadOnlyList<T>/IEnumerable<T>/T[] target. Placed AFTER the
            // string/numeric/dictionary branches so those (all also IEnumerable)
            // keep their own handling, the element-type probe returns null for
            // anything that isn't a recognised sequence target, so a genuine
            // mismatch still falls through to the throw below. Without this a
            // populated command-arg list (e.g. LaunchArgs.Crew) would throw here
            // and dead-soft the whole command over the real socket.
            var elementType = GetSequenceElementType(targetType);
            if (elementType != null && value is System.Collections.IEnumerable sequence)
            {
                var listType = typeof(List<>).MakeGenericType(elementType);
                var list = (System.Collections.IList)Activator.CreateInstance(listType)!;
                foreach (var item in sequence)
                {
                    list.Add(BindCommandArgs(item, elementType));
                }
                if (targetType.IsArray)
                {
                    var array = Array.CreateInstance(elementType, list.Count);
                    list.CopyTo(array, 0);
                    return array;
                }
                return list;
            }

            throw new InvalidCastException(
                $"Cannot bind wire value of type {value.GetType().Name} to {targetType.Name}.");
        }

        /// <summary>
        /// The element type of a supported sequence target (a
        /// <c>List&lt;T&gt;</c>, one of the read-only/collection interfaces
        /// assignable from it, or a <c>T[]</c>), or null when
        /// <paramref name="targetType"/> isn't a sequence the command binder
        /// materialises element-by-element.
        /// </summary>
        private static Type? GetSequenceElementType(Type targetType)
        {
            if (targetType.IsArray)
            {
                return targetType.GetElementType();
            }
            if (targetType.IsGenericType)
            {
                var def = targetType.GetGenericTypeDefinition();
                if (def == typeof(List<>) || def == typeof(IList<>) ||
                    def == typeof(IReadOnlyList<>) || def == typeof(ICollection<>) ||
                    def == typeof(IReadOnlyCollection<>) || def == typeof(IEnumerable<>))
                {
                    return targetType.GetGenericArguments()[0];
                }
            }
            return null;
        }

        private static bool IsConvertibleNumeric(Type t) =>
            t == typeof(double) || t == typeof(float) || t == typeof(decimal) ||
            t == typeof(int) || t == typeof(long) || t == typeof(short) ||
            t == typeof(byte) || t == typeof(sbyte) || t == typeof(uint) ||
            t == typeof(ulong) || t == typeof(ushort);

        /// <summary>
        /// Case-insensitive enum-name → value using ONLY metadata (each member's
        /// <see cref="MemberInfo.Name"/> + <see cref="FieldInfo.GetRawConstantValue"/>),
        /// never <see cref="Enum.Parse(Type,string,bool)"/>.
        ///
        /// <para>Metadata-only because it is strictly narrower work than
        /// <see cref="Enum.Parse(Type,string,bool)"/> on a hot command path:
        /// <see cref="Enum.ToObject"/> only boxes the value, where Parse
        /// constructs the enum type's custom attributes as well.</para>
        ///
        /// <para>Constructing those attributes is also the failure mode this
        /// avoids by construction. An enum carrying a codegen attribute whose
        /// assembly is absent at runtime makes Parse throw
        /// <see cref="System.IO.FileNotFoundException"/>, which dead-softs the
        /// whole command in-game rather than only in a test, and a string-form
        /// enum argument (e.g. <c>setTarget {kind:"Vessel"}</c>) is the path
        /// that reaches it. Nothing in <c>Sitrep.Contract</c> carries such an
        /// attribute today (they live in Sitrep.Contract.Codegen, and
        /// <c>Sitrep.Core.Tests.ContractEnumRenderingTests</c> asserts
        /// reflective enum parsing works on a contract enum), so this walk is
        /// not the only thing standing between a deploy and that throw. It
        /// costs nothing to keep it from being reachable at all.</para>
        /// </summary>
        private static object ParseEnumByNameMetadataOnly(Type enumType, string name)
        {
            foreach (var f in enumType.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    return Enum.ToObject(enumType, f.GetRawConstantValue()!);
                }
            }
            throw new ArgumentException($"'{name}' is not a valid {enumType.Name} value.");
        }

        /// <summary>
        /// Reflects over <paramref name="targetType"/>'s writable public
        /// properties and binds each from the matching (case-insensitive) key
        /// in <paramref name="dict"/>. A missing key leaves the property at its
        /// default: so absent optional/nullable fields stay null rather than
        /// being forced to a value. Recurses through <see cref="BindCommandArgs"/>
        /// so nested records/enums convert the same way.
        /// </summary>
        private static object BindObject(IDictionary<string, object?> dict, Type targetType)
        {
            var instance = Activator.CreateInstance(targetType);
            if (instance == null)
            {
                throw new InvalidCastException($"Cannot construct {targetType.Name} for command-arg binding.");
            }

            foreach (var prop in targetType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!prop.CanWrite || prop.GetIndexParameters().Length > 0)
                {
                    continue;
                }

                object? raw = null;
                var found = false;
                foreach (var kv in dict)
                {
                    if (string.Equals(kv.Key, prop.Name, StringComparison.OrdinalIgnoreCase))
                    {
                        raw = kv.Value;
                        found = true;
                        break;
                    }
                }

                if (!found)
                {
                    // Leave at default (null for reference/Nullable, 0/false for
                    // value types): an absent key is not an error.
                    continue;
                }

                prop.SetValue(instance, BindCommandArgs(raw, prop.PropertyType));
            }

            return instance;
        }

        public Kernel Kernel => _kernel;

        /// <summary>
        /// Drives the capability <see cref="Kernel"/> once every uplink has
        /// registered (its capabilities/providers wired during
        /// <see cref="RegisterUplink"/>) and BEFORE <see cref="Start"/>: so a
        /// channel-source closure that resolves an elected provider via
        /// <c>Kernel.Query</c> at Tick time (the comms backend election, see
        /// <c>Sitrep.Host.Comms.CommsElection</c>) sees a resolved kernel by
        /// the first tick. Separate from <see cref="Start"/> so a headless test
        /// can register, resolve, and inspect the election without standing up
        /// the Courier thread/listener.
        ///
        /// <para>Fail-soft: a throwing <see cref="Kernel.Resolve"/> (an
        /// ambiguous/cyclic capability graph) is caught and logged rather than
        /// aborting engine startup: a mis-declared capability must not take
        /// down the whole telemetry spine. The bundled comms wiring cannot
        /// produce such a graph, but a future third-party capability provider
        /// might.</para>
        /// </summary>
        public ResolveResult ResolveCapabilities()
        {
            try
            {
                return _kernel.Resolve(new ResolveOptions
                {
                    KernelVersion = Sitrep.Contract.ContractVersion.Major + "." + Sitrep.Contract.ContractVersion.Minor + ".0",
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[ChannelEngine] capability resolution threw: " + SafeExceptionMessage(ex));
                return new ResolveResult();
            }
        }

        public void SetAvailability(Availability availability)
        {
            if (_currentRegisteringUplinkId != null)
            {
                _availability[_currentRegisteringUplinkId] = availability;
            }
        }

        // Courier-thread-only (see IUplinkHost.ForceKeyframe's doc
        // comment) -- every legitimate call site (a registered
        // ISnapshotSampler's Sample, or a command handler invoked via
        // InvokeCommandHandler) already runs on this thread, per
        // ProcessTick's sampler loop / ProcessDispatchCommand /
        // Courier.SetCommandHandler, so this touches _emitter's per-channel
        // state directly rather than enqueuing a job.
        public void ForceKeyframe(string topic)
        {
            RequireChannelDeclared(topic, nameof(ForceKeyframe));
            _emitter.NotifySubscribed(topic);
        }

        // Courier-thread-only (see ForceKeyframe's doc comment -- same
        // rule): the M2 subject-scoped-birth seam. VesselEpochSampler calls
        // this ALONGSIDE ForceKeyframe (never instead of it) on a genuine
        // subject switch, for every topic it owns, so a channel the NEW
        // subject has never populated goes back to "not yet a subject"
        // rather than inheriting the PREVIOUS subject's birth state -- see
        // IUplinkHost.ResetChannelBirth's doc comment for the full
        // rationale.
        public void ResetChannelBirth(IEnumerable<string> topics)
        {
            foreach (var topic in topics)
            {
                _born.Remove(topic);
            }
        }

        /// <summary>
        /// The M2 "archive-derived birth" rewind fix: recomputes <see cref="_born"/>
        /// from the archive's own post-prune state instead of blanket-clearing
        /// it (see <see cref="_born"/>'s doc comment). MUST be called AFTER
        /// <see cref="Courier.ResetTimeline"/> has already dropped every
        /// sample ahead of the new timeline, so <see cref="Courier.HasAnyArchiveTail"/>
        /// reflects what actually SURVIVED the rewind, not the abandoned
        /// timeline's peak. Born iff ANY sample (value or tombstone)
        /// survived: see <see cref="Archive.HasAnyTail"/>'s doc comment for
        /// why a tombstone tail must count too.
        /// </summary>
        private void RecomputeChannelBirthFromArchive()
        {
            _born.Clear();
            foreach (var topic in _channelDeclarations.Keys)
            {
                if (_courier.HasAnyArchiveTail(NodeFor(topic), topic))
                {
                    _born.Add(topic);
                }
            }
        }

        private void RequireChannelDeclared(string topic, string caller)
        {
            if (!_channelDeclarations.ContainsKey(topic))
            {
                throw new InvalidOperationException(
                    $"{caller}(\"{topic}\") has no matching ChannelDeclaration, " +
                    "declare it in the registering uplink's Manifest.Channels first.");
            }
        }

        // ----------------------------------------------------------------
        // Availability-gated dispatch (IMPORTANT-A) + Courier-thread
        // exception fail-soft (CRITICAL-2), Courier-thread-only.
        // ----------------------------------------------------------------

        /// <summary>Whether <paramref name="topic"/>'s owning uplink (if tracked) is currently available, an untracked topic (shouldn't happen outside tests) is treated as available.</summary>
        private bool IsChannelAvailable(string topic)
        {
            return !_channelOwner.TryGetValue(topic, out var ownerId) || IsUplinkAvailable(ownerId);
        }

        /// <summary>Whether <paramref name="command"/>'s owning uplink (if tracked) is currently available.</summary>
        /// <summary>
        /// The sentence an operator reads when a dispatch is refused at
        /// <see cref="ProcessDispatchCommand"/>'s availability exit.
        /// </summary>
        ///
        /// <remarks>
        /// Names the owning uplink whenever there is one, which is the whole
        /// operational value of the refusal: "unavailable" alone tells an
        /// operator that something is wrong and nothing about where to look,
        /// and the case that actually happens in flight (an uplink that
        /// fail-softed) is exactly the case where the owner IS known. An
        /// unknown command has no owner to name and means something different,
        /// a client asking for a command this host has never heard of, so it
        /// gets its own sentence rather than a padded version of the other.
        ///
        /// It carries the uplink's OWN <see cref="Availability.Reason"/> rather
        /// than a cause inferred from the mechanism. This exit fires for a
        /// throwing Register, a prior runtime throw, AND an uplink that
        /// legitimately declared itself unavailable because its mod is absent
        /// ("RealAntennas assembly not loaded"), which is the most common case
        /// in a normal install. Saying "has failed" would be alarming and wrong
        /// there, and the reason is already on hand, so there is nothing to
        /// guess. An empty reason falls back to restating the fact rather than
        /// inventing a cause: circular beats wrong, and a missing reason is
        /// itself worth seeing.
        ///
        /// The CODE on the wire stays one value for both (see IMPORTANT-A);
        /// this is prose for a human, never something a client parses.
        /// </remarks>
        /// <summary>
        /// The sentence an operator reads when a declared gate refuses.
        /// </summary>
        ///
        /// <remarks>
        /// Prose for a human. The STRUCTURED form (facility, level, limit,
        /// actual) belongs on the wire beside it so a client can render the
        /// comparison in the operator's own units, which a sentence composed
        /// here cannot: this is the fallback for a refusal with no numbers, and
        /// the readable half of one that has them.
        /// </remarks>
        private static string GateRefusalReason(string command, GateVerdict verdict)
        {
            var breach = verdict.Breach;
            if (breach != null && breach.Limit.HasValue && breach.Actual.HasValue)
            {
                return $"command \"{command}\" is not permitted: {breach.Quantity} {breach.Actual.Value} "
                    + $"exceeds the {breach.Facility} limit of {breach.Limit.Value}";
            }
            if (!string.IsNullOrWhiteSpace(verdict.Detail))
            {
                return $"command \"{command}\" is not permitted: {verdict.Detail}";
            }
            return $"command \"{command}\" is not permitted";
        }

        /// <summary>
        /// The RESULT a decided gate refusal returns, the machine-readable half
        /// of <see cref="GateRefusalReason"/>'s sentence.
        /// </summary>
        ///
        /// <remarks>
        /// The evaluator names the arm, because only it knows which authority it
        /// asked: a full pad and an un-upgraded Tracking Station are both a gate
        /// saying no, and they are not the same refusal. Both halves it produced
        /// travel with it, the comparison and the game's own words, so the same
        /// client sentence serves a declared gate and an actuator that got far
        /// enough to look.
        /// </remarks>
        private static CommandResult GateRefusalResult(GateVerdict verdict)
        {
            return new CommandResult
            {
                Success = false,
                ErrorCode = verdict.ErrorCode,
                Breach = verdict.Breach,
                Detail = string.IsNullOrWhiteSpace(verdict.Detail) ? null : verdict.Detail,
            };
        }

        private string RefusalReason(string command)
        {
            if (!_commandOwner.TryGetValue(command, out var ownerId))
                return $"command \"{command}\" is not recognised by this host";
            var reason = _availability.TryGetValue(ownerId, out var availability) ? availability.Reason : null;
            return string.IsNullOrWhiteSpace(reason)
                ? $"command \"{command}\" is unavailable: its uplink \"{ownerId}\" is unavailable"
                : $"command \"{command}\" is unavailable: its uplink \"{ownerId}\" reports \"{reason}\"";
        }

        private bool IsCommandAvailable(string command)
        {
            return !_commandOwner.TryGetValue(command, out var ownerId) || IsUplinkAvailable(ownerId);
        }

        private bool IsUplinkAvailable(string uplinkId)
        {
            return !_availability.TryGetValue(uplinkId, out var availability) || availability.IsAvailable;
        }

        /// <summary>
        /// The SOLE call site that actually invokes a registered command
        /// handler: shared by <see cref="ProcessDispatchCommand"/>'s
        /// non-delayed (ground-infrastructure) branch and the delayed path's
        /// Courier clock-callback (wired via <see cref="Courier.SetCommandHandler"/>
        /// in the constructor). A command whose owning uplink has gone
        /// <see cref="Availability.Unavailable"/> (whether from a throwing
        /// <see cref="ISitrepUplink.Register"/> or a PRIOR runtime throw
        /// caught here) is skipped entirely, matching "unknown command"
        /// behavior. Otherwise the handler runs inside a try/catch: a
        /// mismatched-type wire arg (<see cref="AddCommandHandler{TArgs,TResult}"/>'s
        /// <c>(TArgs)args!</c> cast) or any other handler-author bug throws
        /// HERE rather than unwinding onto the Courier thread, caught,
        /// fail-softs just this command's owning uplink (every other
        /// registered channel/command is unaffected), and returns
        /// <c>null</c> as a graceful failure result instead of propagating
        /// and killing the thread (the CRITICAL-2 fix).
        /// </summary>
        /// <summary>
        /// The seeded propagator this engine plans with, or null when the install has
        /// none. Settable so a host can supply one built from the elected physics,
        /// and so the planning command refuses honestly rather than crashing when
        /// nothing is configured.
        /// </summary>
        public ISeededPropagationProvider? SeededPropagation { get; set; }

        /// <summary>
        /// Answer where a craft goes, from a given command centre's point of view.
        ///
        /// <para>The whole delay model in one call: the state comes from what THIS
        /// vantage has been told, the horizon comes from the operator, and the physics
        /// comes from whichever seeded provider is elected. Nothing here can reach the
        /// game's live state, which is the point.</para>
        /// </summary>
        /// <summary>
        /// Whether the dispatcher would recognise this command, reading the same
        /// stores its gate does.
        ///
        /// <para>Exposed because the gate and the invoke read DIFFERENT stores, and
        /// a test that checks registration alone passes while the gate refuses the
        /// command as unknown. That is not hypothetical: it is what the live game
        /// did. Read-only, and it asks the question the dispatcher asks rather than
        /// restating it, so the two cannot drift apart again.</para>
        /// </summary>
        internal bool RecognisesCommandForTests(string command) =>
            _commandHandlers.ContainsKey(command)
            || _vantageCommandHandlers.ContainsKey(command);

        private object? PlanForVantage(object? args, string vantage)
        {
            var bound = BindCommandArgs(args, typeof(VantagePlanRequest)) as VantagePlanRequest;
            if (bound == null || string.IsNullOrEmpty(bound.Topic))
            {
                return VantagePlanReply.Refused(
                    "This request named no topic, so there is nothing to plan from.");
            }

            var node = NodeFor(bound.Topic!);
            var nowUt = _clock.Now();
            var answer = VantagePlanning.Solve(
                _courier.ObserveAtVantage(node, bound.Topic!, vantage, nowUt, OrbitPayloadToState),
                SeededPropagation,
                bound.ToUt,
                bound.MaxPoints);

            // Flattened here rather than returned as a POCO, like every other command
            // result on this engine: the wire writer takes dictionaries, and the
            // reply type exists so a client has something to read it AS.
            var reply = answer.Solved
                ? VantagePlanReply.From(answer, vantage)
                : VantagePlanReply.Refused(answer.Refusal ?? "No trajectory could be computed.");
            return ToWire(reply);
        }

        /// <summary>
        /// The planning reply's wire shape.
        ///
        /// <para>The arc goes through <see cref="VesselViewProvider.ToWire(TrajectoryArc)"/>,
        /// the same flattener <c>vessel.orbit</c>'s own arc uses, rather than being
        /// dropped into the dictionary as a POCO. It used to be: JsonWriter has no
        /// case for a <see cref="TrajectoryArc"/>, so a SOLVED plan threw at the wire
        /// boundary and was dropped, while every refusal (whose arc is null) went out
        /// fine. A command that answers only when it has nothing to say.</para>
        ///
        /// <para>A named method taking the type, rather than the dictionary built
        /// inline where it is returned, because that is the shape the coverage gate
        /// can READ: an inline flatten inside an <c>object?</c>-returning handler is
        /// indistinguishable from no flatten at all.</para>
        /// </summary>
        private static Dictionary<string, object?> ToWire(VantagePlanReply reply) =>
            new Dictionary<string, object?>
            {
                ["solved"] = reply.Solved,
                ["arc"] = reply.Arc == null ? null : VesselViewProvider.ToWire(reply.Arc),
                ["seededAtUt"] = reply.SeededAtUt,
                ["vantage"] = reply.Vantage,
                ["refusal"] = reply.Refusal,
            };

        /// <summary>
        /// Turn an archived orbit sample into a state a propagation can start from.
        ///
        /// <para>The wire carries ELEMENTS, so this is where they become a position
        /// and a velocity, through the same two-body solve the analytic provider uses.
        /// Converting them a second way here would let two parts of one program
        /// disagree about where a craft is.</para>
        /// </summary>
        private static StateAboutBody? OrbitPayloadToState(object? payload)
        {
            if (payload is not VesselOrbit orbit)
            {
                return null;
            }
            // An orbit with no semi-major axis or a non-elliptical eccentricity is
            // not something the two-body solve can turn into a state, and guessing
            // one would seed an integrator with a craft that is not there.
            if (!(orbit.Sma > 0) || orbit.Ecc < 0 || orbit.Ecc >= 1 || !(orbit.Mu > 0))
            {
                return null;
            }

            var elements = new OrbitElements
            {
                Sma = orbit.Sma,
                Ecc = orbit.Ecc,
                Inc = orbit.Inc,
                Lan = orbit.Lan ?? 0.0,
                ArgPe = orbit.ArgPe ?? 0.0,
                MeanAnomalyAtEpoch = orbit.MeanAnomalyAtEpoch,
                Epoch = orbit.Epoch,
                Mu = orbit.Mu,
            };
            return new StateAboutBody(
                KeplerProvider.StateFrom(elements, orbit.Epoch), orbit.ReferenceBodyIndex);
        }

        private object? InvokeCommandHandler(string command, object? args, string vantage)
        {
            if (!IsCommandAvailable(command))
            {
                return null;
            }

            // A vantage-aware handler is tried first, and the two stores are
            // deliberately disjoint: a command registered in both would run whichever
            // lookup came first, which is a coin-toss nobody wrote down.
            if (_vantageCommandHandlers.TryGetValue(command, out var vantageHandler))
            {
                try
                {
                    return _executeCommandsOnMainThread
                        ? RunOnMainThread(a => vantageHandler(a, vantage), args)
                        : vantageHandler(args, vantage);
                }
                catch (Exception ex)
                {
                    FailSoftCommand(command, ex);
                    return null;
                }
            }

            if (!_commandHandlers.TryGetValue(command, out var handler))
            {
                return null;
            }

            try
            {
                // F2 Part 1: route the ACTUAL handler onto the Unity main
                // thread when configured (production), else run it inline on
                // the Courier thread (headless default). Either way the same
                // try/catch fail-softs a throwing handler to its owning
                // uplink: a marshaled throw is captured on the main thread,
                // re-surfaced here on the Courier thread (see RunOnMainThread),
                // and handled identically to an inline throw, so a bad command
                // never tears down the loop or any other command/uplink (F1
                // fail-soft parity).
                return _executeCommandsOnMainThread
                    ? RunOnMainThread(handler, args)
                    : handler(args);
            }
            catch (Exception ex)
            {
                FailSoftCommand(command, ex);
                return null;
            }
        }

        /// <summary>
        /// Marshals one command handler invocation onto the main-thread queue
        /// and blocks the CALLING (Courier) thread until
        /// <see cref="RunPendingCommands"/> runs it on the Unity main thread,
        /// then returns its result (or re-throws its exception on the Courier
        /// thread so <see cref="InvokeCommandHandler"/>'s fail-soft catch
        /// attributes it exactly as an inline throw). Blocking-handoff by
        /// design: a command's typed <see cref="CommandResult"/> must travel
        /// back to the Courier so the existing request-id correlation and
        /// <c>CommandResponse&lt;TResult&gt;</c> return path are unchanged.
        /// No deadlock in production: <c>GonogoAddon.FixedUpdate</c> runs
        /// independently of (and does not block on) the Courier thread, so it
        /// keeps draining this queue while the Courier waits.
        /// </summary>
        private object? RunOnMainThread(Func<object?, object?> handler, object? args)
        {
            // F2-fix (shutdown gate): once Stop() has begun, the main-thread
            // pump is gone, so enqueuing+waiting would only ever hit the
            // timeout. Fail immediately with the SAME exception
            // FailPendingMainThreadCommands surfaces, so InvokeCommandHandler's
            // fail-soft catch attributes it identically, and, crucially, a
            // command the Courier dequeues AFTER the single-pass flush can no
            // longer re-enqueue and block the Courier past Stop()'s Join.
            if (_engineStopping)
            {
                throw new InvalidOperationException("ChannelEngine stopped before the command executed on the main thread.");
            }

            var job = new MainThreadCommand(handler, args);
            _mainThreadCommands.Enqueue(job);

            // F4 (F2-fix residual): close the enqueue/flush race. The check
            // above can pass, then Stop() raise _engineStopping AND run its
            // single-pass FailPendingMainThreadCommands flush, and only THEN
            // this Enqueue land: leaving the job to sit until the timeout
            // (default a dead heat with Stop()'s 5s Join). Re-check AFTER
            // enqueuing: if shutdown has begun, mark the job abandoned so the
            // pump (should it ever resume) drops it, and fail fast with the SAME
            // exception the flush surfaces rather than blocking. We do not
            // dispose Done here: FailPendingMainThreadCommands may still dequeue
            // and Set() it; the abandoned flag routes disposal to whichever of
            // the pump/flush drains it.
            if (_engineStopping)
            {
                job.Abandoned = true;
                throw new InvalidOperationException("ChannelEngine stopped before the command executed on the main thread.");
            }

            // A BOUNDED wait, as the pause backstop. In production the drain
            // rides Update(), which runs even when Time.timeScale == 0, so a
            // paused game does not wedge this; the timeout is the last-resort guard
            // for a scene-load / loading-screen stall where even Update stops
            // pumping. On expiry we abandon the job (the pump may still run it
            // later: MainThreadCommand.Done is intentionally NOT disposed on
            // this path so that late Set() can't throw ObjectDisposedException)
            // and return a synthetic Timeout failure so the Courier resumes.
            if (!job.Done.Wait(_mainThreadCommandTimeout))
            {
                job.Abandoned = true;
                return CommandResult.Fail(CommandErrorCode.Timeout);
            }

            try
            {
                job.Captured?.Throw();
                return job.Result;
            }
            finally
            {
                // F2-fix (Fix #3): dispose the per-command wait handle on the
                // completed path. Safe here: the pump's Set() (in
                // RunPendingCommands / FailPendingMainThreadCommands) has
                // already returned by the time Wait() unblocks, and the job is
                // off the queue, so nothing else will touch Done again.
                job.Done.Dispose();
            }
        }

        /// <summary>
        /// Drains every command execution marshaled by <see cref="RunOnMainThread"/>,
        /// running each handler on the CURRENT thread. MUST be called from the
        /// Unity main thread: in production, once per <c>GonogoAddon.FixedUpdate</c>,
        /// alongside the snapshot build / <see cref="Tick"/>. Each handler's
        /// result (or its thrown exception, captured to re-surface on the
        /// Courier thread) is stored back on the job and its completion signal
        /// set, unblocking the waiting Courier thread. A no-op when nothing is
        /// queued (the common per-tick case). Never throws: a handler throw is
        /// captured, not propagated, so one bad command can't break the pump
        /// for the rest of the batch.
        /// </summary>
        public void RunPendingCommands()
        {
            while (_mainThreadCommands.TryDequeue(out var job))
            {
                // F3 (F2-fix residual): the waiter already timed out, reported
                // Timeout to the caller, and abandoned this job. Running the
                // handler now would apply its side effect (staging, a maneuver
                // node) seconds AFTER the caller was told it failed. So DROP the
                // job (do not run the handler) and dispose the handle (the
                // waiter deliberately left it for the pump to own on this path).
                if (job.Abandoned)
                {
                    job.Done.Dispose();
                    continue;
                }

                try
                {
                    job.Result = job.Handler(job.Args);
                }
                catch (Exception ex)
                {
                    job.Captured = System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(ex);
                }
                finally
                {
                    job.Done.Set();
                    // If the waiter abandoned this job WHILE the handler was
                    // running (the flag flipped after the top-of-loop check),
                    // no one will observe the result or dispose the handle, so
                    // the pump disposes it here: the waiter never disposes on
                    // its timeout path, so this is the sole owner.
                    if (job.Abandoned)
                    {
                        job.Done.Dispose();
                    }
                }
            }
        }

        /// <summary>
        /// Fails every command execution still blocked on the main-thread queue
        /// so the Courier thread can unblock and observe the <see cref="StopJob"/>
        /// instead of wedging until <see cref="Stop"/>'s Join times out, the
        /// main-thread pump (<c>GonogoAddon.FixedUpdate</c>) has stopped by the
        /// time <see cref="Stop"/> runs, so a command marshaled but not yet
        /// drained would otherwise never complete. Best-effort: a command
        /// enqueued in the tiny window after this drains still relies on the
        /// Join timeout as the backstop.
        /// </summary>
        private void FailPendingMainThreadCommands()
        {
            while (_mainThreadCommands.TryDequeue(out var job))
            {
                job.Captured = System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(
                    new InvalidOperationException("ChannelEngine stopped before the command executed on the main thread."));
                job.Done.Set();
                if (job.Abandoned)
                {
                    job.Done.Dispose();
                }
            }
        }

        private void FailSoftCommand(string command, Exception ex)
        {
            // Attribution must not depend on reading the offending
            // exception's Message: `ex.Message` is an ordinary virtual
            // getter: legal (if perverse) third-party code can override it
            // to throw. Reading it before the _commandOwner lookup and the
            // MarkUplinkUnavailable call, as a plain `$"...{ex.Message}"`
            // interpolation does, lets a throwing getter abort this method
            // early: the throw escapes to CourierLoop's non-attributing
            // backstop try/catch and the offending uplink's command stays live,
            // re-throwing forever. SafeExceptionMessage below cannot throw, so
            // the owner lookup and MarkUplinkUnavailable run regardless of what
            // ex.Message does.
            if (_commandOwner.TryGetValue(command, out var ownerId))
            {
                MarkUplinkUnavailable(ownerId, $"command \"{command}\" handler threw: {SafeExceptionMessage(ex)}");
            }
            Console.Error.WriteLine("[ChannelEngine] command \"" + command + "\" handler threw: " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// <paramref name="what"/> names WHICH part of the channel failed, and
        /// defaults to the mapper because that is every caller but one. The
        /// delivery-time serialization guard passes its own wording instead:
        /// a payload the wire codec cannot write is not a mapper fault at all
        /// (the mapper returned a perfectly good value), and an author sent to
        /// audit a mapper that never threw is being sent to the wrong file.
        /// </summary>
        private void FailSoftChannel(string topic, Exception ex, string what = "mapper threw")
        {
            // Same rationale as FailSoftCommand above: see its doc comment.
            var reason = $"channel \"{topic}\" {what}: {SafeExceptionMessage(ex)}";
            if (_channelOwner.TryGetValue(topic, out var ownerId))
            {
                MarkUplinkUnavailable(ownerId, reason);
                return;
            }
            // No owner to attribute it to, so MarkUplinkUnavailable's LogHost
            // call never runs: log it here instead. Console.Error alone is
            // invisible in KSP (see SetDiagnosticLog), and an unattributable
            // fail-soft is exactly the one worth not losing.
            LogHost(reason);
        }

        /// <summary>
        /// Tell the SUBSCRIBER that its channel's payload could not be put on
        /// the wire, instead of leaving it acked and then starved forever.
        ///
        /// <para>Without this the failure is invisible on the only surface an
        /// Uplink author is usually watching: the app receives
        /// <c>subscribed</c> and then nothing at all, which is byte-for-byte
        /// what a channel that has simply not produced a value yet looks like.
        /// The host log does carry the fault (FailSoftChannel above marks the
        /// uplink Unavailable, and MarkUplinkUnavailable logs through
        /// LogHost/UnityEngine.Debug), but only someone who already suspects
        /// the host goes looking there.</para>
        ///
        /// <para>This is the channel-side twin of the command path's
        /// <c>result-serialization-error</c>, which has sent an
        /// <see cref="ErrorMsg"/> rather than silence since C2-4; channels
        /// were simply never given the same treatment.</para>
        ///
        /// <para>The offending CLR type is read off the payload directly
        /// rather than trusted to appear in the exception message: the
        /// unsupported-type throw does name it, but a flattener that failed
        /// for some other reason (a property getter that threw) would not, and
        /// the type is the single most useful fact for the author.
        /// <c>GetType()</c> is non-virtual, so unlike <c>ex.Message</c> it
        /// cannot be overridden to throw.</para>
        /// </summary>
        private void PublishPayloadSerializationError(ClientSession session, string topic, object? payload, Exception ex)
        {
            var clrType = payload == null ? "null" : payload.GetType().FullName;
            var error = new ErrorMsg
            {
                Topic = topic,
                Code = "payload-serialization-error",
                Message = $"channel \"{topic}\" payload of type {clrType} could not be serialized: {SafeExceptionMessage(ex)}",
            };
            try
            {
                session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteErrorMsg(error)));
            }
            catch (Exception publishEx)
            {
                // Reporting the failure must never become a second failure on
                // the Courier thread. The uplink is already marked Unavailable
                // by this point, so the log line is all that is left to do.
                LogHost("could not deliver the payload-serialization error for channel \"" + topic + "\": " + SafeExceptionMessage(publishEx));
            }
        }
        /// <summary>
        /// Sampler counterpart of <see cref="FailSoftChannel"/>/<see cref="FailSoftCommand"/>,
        /// the coverage-sweep fix for the sampler loop's missing owner
        /// attribution (see <see cref="ProcessTick"/>'s sampler loop). Marks
        /// the sampler's owning uplink Unavailable so it (and every other
        /// sampler/channel/command it owns) is skipped from the next tick
        /// onward, instead of the same throwing sampler recurring forever.
        /// </summary>
        private void FailSoftSampler(string ownerId, ISnapshotSampler sampler, Exception ex)
        {
            MarkUplinkUnavailable(ownerId, $"sampler \"{sampler.GetType().Name}\" threw: {SafeExceptionMessage(ex)}");
            Console.Error.WriteLine("[ChannelEngine] sampler " + sampler.GetType().Name + " threw: " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// Sampled-source counterpart of <see cref="FailSoftSampler"/>: marks
        /// the source's own <see cref="SampledSource.Disabled"/> flag AND its
        /// owning uplink Unavailable (the latter via <see cref="MarkUplinkUnavailable"/>,
        /// which also disables every OTHER sampled source of the same owner),
        /// so a throwing capture/handle stops running on BOTH the main-loop
        /// (RunCaptures) and Courier (ProcessTick) paths from the next tick
        /// onward, together with the uplink's channels/commands/samplers.
        /// </summary>
        private void FailSoftSampledSource(SampledSource source, Exception ex)
        {
            source.Disabled = true;
            MarkUplinkUnavailable(source.OwnerId, $"sampled source threw: {SafeExceptionMessage(ex)}");
            LogHost("sampled source (owner \"" + source.OwnerId + "\") threw (DISABLED): " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// A CAPTURE-time throw (main-loop read that failed, e.g. a KSP/Planetarium
        /// read before the game is ready) is treated as TRANSIENT: the source is
        /// NOT disabled and NOT marked Unavailable: it retries on the next tick,
        /// and a later successful capture resets the streak. This is the fix for
        /// the SCANsat "coverage never surfaces" root cause, where an early
        /// Planetarium-not-ready throw permanently disabled the sampler for the
        /// whole session. Logged on the first throw and then sparsely, so a
        /// genuinely-broken capture stays visible without flooding every tick.
        /// </summary>
        private void RetrySampledSourceAfterCaptureThrow(SampledSource source, Exception ex)
        {
            source.ConsecutiveCaptureThrows++;
            if (source.ConsecutiveCaptureThrows == 1 || source.ConsecutiveCaptureThrows % 300 == 0)
            {
                LogHost("sampled source (owner \"" + source.OwnerId + "\") capture threw (attempt "
                    + source.ConsecutiveCaptureThrows + ", will retry): " + SafeExceptionMessage(ex));
            }
        }

        /// <summary>
        /// Optional Deck-visible diagnostic sink (e.g. <c>UnityEngine.Debug.LogWarning</c>,
        /// wired from <c>GonogoAddon</c>). <see cref="Sitrep.Host"/> otherwise logs
        /// only to <c>Console.Error</c>, which KSP does not capture, so fail-softs
        /// were invisible in the live log (that invisibility hid the SCANsat root
        /// cause for the whole investigation). Set once at startup; read on the
        /// Courier thread.
        /// </summary>
        public void SetDiagnosticLog(Action<string> log) => _diagnosticLog = log;
        private Action<string>? _diagnosticLog;

        /// <summary>Log to Console.Error (always) + the optional Deck-visible sink. Never lets a logging failure break the engine.</summary>
        private void LogHost(string message)
        {
            Console.Error.WriteLine("[ChannelEngine] " + message);
            var sink = _diagnosticLog;
            if (sink != null)
            {
                try
                {
                    sink("[ChannelEngine] " + message);
                }
                catch
                {
                    // A broken log sink must never take down the Courier thread.
                }
            }
        }

        private void MarkUplinkUnavailable(string uplinkId, string reason)
        {
            _availability[uplinkId] = Availability.Unavailable(reason);
            // Never silent: a disabled/unavailable uplink must leave a trace, or
            // this whole failure class stays invisible (it hid the SCANsat root
            // cause for the entire investigation).
            LogHost("uplink \"" + uplinkId + "\" marked UNAVAILABLE: " + reason);

            // Keep the whole uplink inert together (IMPORTANT-A): once an
            // owner goes Unavailable through ANY path (a throwing Register, a
            // channel mapper/command/sampler throw), its capture-on-main
            // sources must also stop firing on the main-loop thread. The main
            // loop reads only each source's volatile Disabled flag (never the
            // _availability dictionary, which is Courier-thread-owned), so
            // this is the write that makes owner-unavailability visible there.
            foreach (var source in _sampledSources)
            {
                if (source.OwnerId == uplinkId)
                {
                    source.Disabled = true;
                }
            }

            // Same rule for the server-side signal-delay source: once its owner
            // is Unavailable, stop invoking it on the main-loop thread too (the
            // main loop reads only this volatile flag, never _availability).
            if (_signalDelaySource != null && _signalDelaySourceOwnerId == uplinkId)
            {
                _signalDelaySourceDisabled = true;
            }

            // Same rule for the connectivity source. Once disabled it stops
            // firing on the main-loop thread; RefreshConnectivityFromCapability
            // then reverts _commsConnected to CONNECTED (fail-soft) so a broken
            // comms uplink can never leave the gate frozen forever.
            if (_connectivitySource != null && _connectivitySourceOwnerId == uplinkId)
            {
                _connectivitySourceDisabled = true;
            }
        }

        /// <summary>
        /// Reads <see cref="Exception.Message"/> defensively, it is an
        /// ordinary virtual getter, so a hostile/buggy custom exception type
        /// can legally override it to throw. Every fail-soft guard in this
        /// class reads a caught exception's Message only through here, so
        /// attribution (<see cref="MarkUplinkUnavailable"/>) can never be
        /// skipped by a poisoned Message getter.
        /// </summary>
        private static string SafeExceptionMessage(Exception ex)
        {
            try
            {
                return ex.Message;
            }
            catch (Exception)
            {
                return "<" + ex.GetType().Name + ".Message threw>";
            }
        }

        // ----------------------------------------------------------------
        // Main-loop domain (called from GonogoAddon.FixedUpdate, or a test driver)
        // ----------------------------------------------------------------

        /// <summary>
        /// Record one sample tick at <paramref name="ut"/>: runs every
        /// registered <see cref="ISnapshotSampler"/> against
        /// <paramref name="snapshot"/> (if given), then, for every registered
        /// pull-style channel whose topic has at least one subscriber, maps
        /// and change-gates a value and records it into the Courier, exactly
        /// <c>GonogoBodiesServer.Tick</c>'s single-topic behavior, generalized
        /// over every topic <see cref="AddChannelSource"/> registered.
        /// Callable from any thread: only touches primitives/the snapshot/
        /// mapper delegates and the explicit job queue, never the Courier/
        /// clock directly (those are Courier-thread-only).
        /// </summary>
        public void Tick(double ut, KspSnapshot? snapshot) => EnqueueJob(new TickJob(ut, snapshot, RunCaptures(snapshot), CaptureSignalDelayOnMain(snapshot), CaptureConnectivityOnMain(snapshot), CapturePathBreakOnMain(snapshot, ut), null));

        /// <summary>
        /// Runs every registered <see cref="AddSampledSource"/> capture on the
        /// CURRENT (main-loop) thread: this is called from <see cref="Tick"/>/
        /// <see cref="TickAndWait"/>, which in production run on the Unity main
        /// thread inside <c>GonogoAddon.FixedUpdate</c>, so the KSP/Unity reads
        /// a capture performs happen exactly where <see cref="KspSnapshot"/>
        /// itself is built. The opaque results (or a captured exception) are
        /// bundled into the <see cref="TickJob"/> and carried to the Courier
        /// thread, where <see cref="ProcessTick"/> hands each to its handle.
        /// A capture that throws is recorded (not rethrown) so the tick still
        /// proceeds and the fail-soft attribution happens Courier-side; see
        /// <see cref="ProcessTick"/>'s capture loop and <see cref="FailSoftSampledSource"/>.
        /// A source already <see cref="SampledSource.Disabled"/> (its owner
        /// went unavailable) is skipped entirely so a broken capture stops
        /// running on the main-loop thread too, not just its handle on the
        /// Courier thread.
        /// </summary>
        private CapturedSample[]? RunCaptures(KspSnapshot? snapshot)
        {
            if (_sampledSources.Count == 0)
            {
                return null;
            }

            var captured = new List<CapturedSample>(_sampledSources.Count);
            for (var i = 0; i < _sampledSources.Count; i++)
            {
                var source = _sampledSources[i];
                if (source.Disabled)
                {
                    continue;
                }

                // Fix #3: subscription-gate the capture. A source that declared
                // the topic prefixes it produces is SKIPPED entirely (no
                // main-thread work at all) on any tick where nothing under those
                // prefixes is currently subscribed. A source with no declared
                // prefixes is never gated (original always-capture behaviour).
                // Reads the Courier-maintained _subscribedTopics mirror; never
                // _subscriptions, which is Courier-thread-only.
                if (!AnyTopicPrefixSubscribed(source.TopicPrefixes))
                {
                    continue;
                }

                try
                {
                    captured.Add(new CapturedSample(i, source.Capture(snapshot), null));
                }
                catch (Exception ex)
                {
                    captured.Add(new CapturedSample(i, null, ex));
                }
            }

            return captured.Count == 0 ? null : captured.ToArray();
        }

        /// <summary>
        /// Runs the registered server-side signal-delay source (see
        /// <see cref="IUplinkHost.SetSignalDelaySource"/>) on the CURRENT
        /// (main-loop) thread: exactly where <see cref="RunCaptures"/> runs the
        /// sampled-source captures, so it may read the live elected comms backend
        /// safely. Called unconditionally every tick, NOT subscription-gated:
        /// the reveal gate must know the delay even when no client subscribed
        /// comms.delay. The <see cref="CommsDelay"/> (or a captured throw) is
        /// carried on the <see cref="TickJob"/> to the Courier thread, where
        /// <see cref="RefreshSignalDelayFromCapability"/> applies it before the
        /// channel loop. A source whose owner already went Unavailable (its
        /// <see cref="_signalDelaySourceDisabled"/> volatile flag is set) is
        /// skipped, same as a Disabled <see cref="SampledSource"/>. A throw is
        /// recorded (not rethrown) so the fail-soft attribution happens
        /// Courier-side: see <see cref="FailSoftSignalDelaySource"/>.
        /// </summary>
        private SignalDelayCapture CaptureSignalDelayOnMain(KspSnapshot? snapshot)
        {
            var source = _signalDelaySource;
            if (source == null || _signalDelaySourceDisabled)
            {
                return default;
            }

            try
            {
                return new SignalDelayCapture(source(snapshot), null);
            }
            catch (Exception ex)
            {
                return new SignalDelayCapture(null, ex);
            }
        }

        /// <summary>
        /// Drop-event twin of <see cref="CaptureSignalDelayOnMain"/>: runs the
        /// registered path-break source (see
        /// <see cref="IUplinkHost.SetPathBreakSource"/>) on the CURRENT
        /// (main-loop) thread with this tick's UT, so it may read the elected
        /// comms backend's hop geometry and ask its router whether a hop that
        /// left the route is still carrying. Only the resulting two doubles
        /// cross to the Courier thread; no live handle does.
        /// </summary>
        private PathBreakCapture CapturePathBreakOnMain(KspSnapshot? snapshot, double ut)
        {
            var source = _pathBreakSource;
            if (source == null || _pathBreakSourceDisabled)
            {
                return default;
            }

            try
            {
                return new PathBreakCapture(source(snapshot, ut), null);
            }
            catch (Exception ex)
            {
                return new PathBreakCapture(null, ex);
            }
        }

        /// <summary>
        /// Freeze-on-disconnect twin of <see cref="CaptureSignalDelayOnMain"/>:
        /// runs the registered connectivity source (see
        /// <see cref="IUplinkHost.SetConnectivitySource"/>) on the CURRENT
        /// (main-loop) thread so it may read the live elected comms backend,
        /// every tick regardless of subscription. The <c>bool?</c> (or a
        /// captured throw) is carried on the <see cref="TickJob"/> to the Courier
        /// thread, where <see cref="RefreshConnectivityFromCapability"/> applies
        /// it before the channel loop and <see cref="FlushReveal"/>. A source
        /// whose owner already went Unavailable (its volatile disabled flag set)
        /// is skipped. A throw is recorded, not rethrown.
        /// </summary>
        private ConnectivityCapture CaptureConnectivityOnMain(KspSnapshot? snapshot)
        {
            var source = _connectivitySource;
            if (source == null || _connectivitySourceDisabled)
            {
                return default;
            }

            try
            {
                return new ConnectivityCapture(source(snapshot), null);
            }
            catch (Exception ex)
            {
                return new ConnectivityCapture(null, ex);
            }
        }

        /// <summary>
        /// Main-loop-thread subscription check for a <see cref="SampledSource"/>'s
        /// declared topic prefixes (Fix #3). An EMPTY prefix set means the source
        /// opted out of gating: always "subscribed" (original always-capture
        /// behaviour). Otherwise returns true iff at least one currently-subscribed
        /// topic starts with one of the prefixes. Reads only the thread-safe
        /// <see cref="_subscribedTopics"/> mirror, never the Courier-owned
        /// <see cref="_subscriptions"/>.
        /// </summary>
        private bool AnyTopicPrefixSubscribed(string[] prefixes)
        {
            if (prefixes.Length == 0)
            {
                return true;
            }

            foreach (var topic in _subscribedTopics.Keys)
            {
                for (var i = 0; i < prefixes.Length; i++)
                {
                    if (topic.StartsWith(prefixes[i], StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>
        /// <see cref="IUplinkHost.IsAnyTopicSubscribed"/>: the public,
        /// single-prefix form of <see cref="AnyTopicPrefixSubscribed"/>. Reads
        /// only the thread-safe <see cref="_subscribedTopics"/> mirror, so it is
        /// callable from any thread (the kOS Uplink calls it from the KSP main
        /// thread, inside kOS's <c>PRINT</c>).
        /// </summary>
        public bool IsAnyTopicSubscribed(string topicPrefix)
        {
            if (string.IsNullOrEmpty(topicPrefix))
            {
                return false;
            }

            foreach (var topic in _subscribedTopics.Keys)
            {
                if (topic.StartsWith(topicPrefix, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Push a payload directly to <paramref name="topic"/> (obtained via
        /// <see cref="Publisher"/>): the event-driven counterpart to
        /// <see cref="Tick"/>'s pull-style mapping. Goes through the SAME
        /// per-channel Decide/Record processing as a Tick-driven channel.
        /// </summary>
        internal void Publish(string topic, object? payload, double ut) => EnqueueJob(new PublishJob(topic, payload, ut));

        /// <summary>Test-only deterministic variant of <see cref="Tick"/>: blocks until the Courier thread finishes processing this tick.</summary>
        internal void TickAndWait(double ut, KspSnapshot? snapshot, TimeSpan timeout)
        {
            var barrier = new ManualResetEventSlim(false);
            EnqueueJob(new TickJob(ut, snapshot, RunCaptures(snapshot), CaptureSignalDelayOnMain(snapshot), CaptureConnectivityOnMain(snapshot), CapturePathBreakOnMain(snapshot, ut), barrier));
            barrier.Wait(timeout);
        }

        /// <summary>
        /// Dispatch a command by name. If its declaration's
        /// <see cref="CommandDeclaration.Delayed"/> is <c>false</c> (ground
        /// infrastructure), the handler runs and <paramref name="onResult"/>
        /// fires on the SAME job-processing step: no Courier delay at all.
        /// Otherwise it rides <see cref="Courier.DispatchCommand"/>'s normal
        /// uplink/downlink delay, resolving only once <see cref="Tick"/>
        /// advances the clock far enough.
        /// </summary>
        public void DispatchCommand(string command, object? args, string vantage, Action<object?> onResult, string label = "", string topic = "", Action<string>? onRefused = null) =>
            EnqueueJob(new DispatchCommandJob(command, args, vantage, onResult, null, label, topic, onRefused));

        /// <summary>Test-only deterministic variant of <see cref="DispatchCommand"/>.</summary>
        internal void DispatchCommandAndWait(string command, object? args, string vantage, Action<object?> onResult, TimeSpan timeout, string label = "", string topic = "", Action<string>? onRefused = null)
        {
            var barrier = new ManualResetEventSlim(false);
            EnqueueJob(new DispatchCommandJob(command, args, vantage, onResult, barrier, label, topic, onRefused));
            barrier.Wait(timeout);
        }

        /// <summary>Test-only visibility into one topic's emission counters; see <c>GonogoBodiesServer.BodiesEmitterCounters</c>'s equivalent doc comment for why tests need this rather than inferring it from wire silence.</summary>
        internal EmissionCounters ChannelCounters(string topic) => _emitter.CountersFor(topic);

        /// <summary>
        /// Test-only: how long the <see cref="ChannelsTopic"/> roster may be
        /// served from cache. Call BEFORE <see cref="Start"/>, so the write
        /// lands under the same single-writer-before-start rule registration
        /// does and never races the Courier thread's read of it.
        ///
        /// <para>A seam rather than a slower test. The production value is a
        /// wall clock (see <see cref="ChannelCounterIntervalSec"/>) because the
        /// cost it paces is wall-clock cost, and a test that proved a counter
        /// had moved by sleeping five seconds per assertion would trade a
        /// readable suite for nothing: the throttle is not what the counters are
        /// for.</para>
        /// </summary>
        internal void SetChannelCounterIntervalForTests(double seconds) => _channelCounterIntervalSec = seconds;

        /// <summary>
        /// Test-only visibility into the OUTER (<see cref="SubscriptionRegistry"/>)
        /// gate's current subscriber count for a topic, used to prove a
        /// subscribe/unsubscribe/disconnect sequence never leaves an
        /// orphaned count behind. Deliberately NOT part
        /// of <see cref="IUplinkHost"/>: it wraps <c>_subscriptions</c>,
        /// which (per that field's own doc comment) must never be read
        /// off the Courier thread. Promoting it to a public
        /// <c>IUplinkHost</c> member so a main-thread caller like
        /// <c>KosTerminalManager.Poll</c> can read it directly is therefore
        /// wrong twice over: a main-thread read of Courier-owned state, and a
        /// reseed signal that only samples the aggregate once per poll.
        /// <see cref="IDynamicChannelSource.OnSubscribed"/> is the supported
        /// route for that need, a thread-safe per-subscription-transition push
        /// rather than a cross-thread pull.
        /// </summary>
        internal int SubscriberCountFor(string topic) => _subscriptions.SubscriberCount(topic);

        // ----------------------------------------------------------------
        // Courier domain (the dedicated Courier thread)
        // ----------------------------------------------------------------

        private void CourierLoop()
        {
            while (true)
            {
                _jobSignal.Wait(JobPollInterval);

                while (_jobs.TryDequeue(out var job))
                {
                    // Outer safety net (CRITICAL-2): the per-channel
                    // (ProcessTick's channel loop) and per-command
                    // (InvokeCommandHandler) fail-soft above already catch
                    // the specific, expected failure shapes and attribute
                    // them to the right uplink. This try/catch is the
                    // backstop for anything else that still manages to
                    // throw here (a bug in subscribe/unsubscribe/disconnect
                    // bookkeeping, say): the Courier thread must NEVER die:
                    // a dead Courier thread wedges the WHOLE engine (every
                    // subscriber, every channel, every command), permanently,
                    // which is strictly worse than dropping one bad job.
                    try
                    {
                        switch (job)
                        {
                            case StopJob:
                                return;
                            case TickJob tick:
                                ProcessTick(tick);
                                break;
                            case PublishJob publish:
                                ProcessPublish(publish);
                                break;
                            case DispatchCommandJob dispatch:
                                ProcessDispatchCommand(dispatch);
                                break;
                            case SubscribeJob subscribe:
                                ProcessSubscribe(subscribe.Session, subscribe.Topic);
                                break;
                            case UnsubscribeJob unsubscribe:
                                ProcessUnsubscribe(unsubscribe.Session, unsubscribe.Topic);
                                break;
                            case DisconnectJob disconnect:
                                ProcessDisconnect(disconnect.Session);
                                break;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("[ChannelEngine] Courier job " + job.GetType().Name + " threw: " + ex);
                    }
                }
            }
        }

        // ----------------------------------------------------------------
        // Server-side reveal gate (spec §4 / §7.3 Steps 1–3), Courier-thread-only
        // ----------------------------------------------------------------

        /// <summary>
        /// Route one emit decision through the reveal gate, the single funnel
        /// every <see cref="Courier.Record"/> now goes through, replacing the
        /// bare Record calls in <see cref="ProcessTick"/>/<see cref="ProcessPublish"/>.
        /// Snoops <c>comms.delay</c> to keep the gate's delay value current
        /// (§7.3 Step 2). A TrueNow / zero-delay channel is recorded LIVE,
        /// inline, exactly as before the gate existed, so with signal delay
        /// disabled (delay 0) every channel takes this path and the wire is
        /// byte-identical to the pre-gate LAN behaviour. A Delayed channel with
        /// a positive delay is buffered until <see cref="FlushReveal"/>'s
        /// horizon reaches its UT.
        /// </summary>
        private void Emit(string topic, object? value, double ut)
        {
            if (topic == CommsDelayTopic)
            {
                // Redundant with RefreshSignalDelayFromCapability (which is the
                // authoritative, subscription-independent source: see its doc
                // comment): kept as a cheap belt-and-braces snoop for a
                // comms.delay value pushed through Emit outside the pull-channel
                // path. Harmless duplicate; never the sole source anymore.
                CaptureSignalDelay(value);
            }

            var delay = RevealDelayFor(topic);
            if (delay <= 0.0)
            {
                RecordThrough(topic, value, ut);
                return;
            }

            // An infinite horizon is the in-blackout case (see RevealDelayFor):
            // this sample is one the subject took while out of contact, so what
            // happens to it is the recorder's decision, not the reveal window's.
            if (double.IsInfinity(delay))
            {
                if (!IsRecordable(topic))
                {
                    // Never aboard the craft, so there is nothing to have
                    // recorded it. Dropped, and the hole stated rather than
                    // closed silently: the next sample to reach the ground
                    // carries the span back to the last one that did.
                    OpenGap(topic);
                    return;
                }

                var recorder = BufferFor(topic);
                if (recorder.Count >= RecorderCapacityPerTopic)
                {
                    // Storage bound reached: the oldest held sample makes room
                    // for this one. See RecorderCapacityPerTopic for why oldest.
                    recorder.RemoveAt(0);
                    OpenGap(topic);
                }
                recorder.Add(new BufferedReveal(ut, value, delay));
                return;
            }

            BufferFor(topic).Add(new BufferedReveal(ut, value, delay));
        }

        /// <summary>
        /// Hand one sample to the Courier, carrying whatever
        /// <see cref="Meta.GapSinceUt"/> is owed on this topic and remembering
        /// its UT as the record's new right-hand edge. The single funnel every
        /// non-replayed <see cref="Courier.Record"/> from this class goes through,
        /// so a topic cannot deliver a sample and forget it delivered one.
        /// </summary>
        private void RecordThrough(string topic, object? value, double ut)
        {
            double? gap = null;
            if (_pendingGapSinceUt.TryGetValue(topic, out var gapSince))
            {
                gap = gapSince;
                _pendingGapSinceUt.Remove(topic);
            }
            _lastRecordedUt[topic] = ut;
            _courier.Record(NodeFor(topic), topic, value, ut, DeliveryFor(topic), IsKeyframeFor(topic, value), gap);
        }

        /// <summary>
        /// Note that <paramref name="topic"/>'s record now has a hole, running
        /// back to the last sample the ground actually received. Idempotent
        /// within one run of drops: the hole's left-hand edge does not move as it
        /// widens, only its right, and the right is whichever sample eventually
        /// carries the gap out.
        /// </summary>
        private void OpenGap(string topic)
        {
            if (_pendingGapSinceUt.ContainsKey(topic))
            {
                return;
            }
            if (_lastRecordedUt.TryGetValue(topic, out var lastUt))
            {
                _pendingGapSinceUt[topic] = lastUt;
            }
            // No entry means nothing has EVER been delivered on this topic, so
            // there is no known-good edge for a gap to run back to and the
            // client's "resyncing" (never heard from) is already the honest
            // reading. A fabricated edge would claim data was lost that the
            // ground was never going to have.
        }

        private List<BufferedReveal> BufferFor(string topic)
        {
            if (!_revealBuffer.TryGetValue(topic, out var list))
            {
                list = new List<BufferedReveal>();
                _revealBuffer[topic] = list;
            }
            return list;
        }

        /// <summary>
        /// Whether <paramref name="topic"/>'s samples are held through a loss of
        /// signal and replayed on reacquisition: see
        /// <see cref="ChannelDeclaration.Recordable"/>. An UNDECLARED topic
        /// records, matching that property's own default, so an engine-owned or
        /// dynamically-published topic is never silently dropped by omission.
        /// </summary>
        private bool IsRecordable(string topic) =>
            !_channelDeclarations.TryGetValue(topic, out var declaration) || declaration.Recordable;

        /// <summary>
        /// Whether <paramref name="value"/> is a self-contained "keyframe"
        /// baseline for <paramref name="topic"/>'s cursor-relative diff
        /// stream: see <see cref="ChannelDeclaration.IsKeyframe"/> and
        /// <see cref="Sitrep.Core.Courier"/>'s sticky-keyframe cache. Fail-soft:
        /// an undeclared topic or a throwing predicate (uplink-authored code,
        /// same discipline as every other Decide/map call in this class) is
        /// treated as "not a keyframe": never worse than before this hook
        /// existed, and never a reason to fail the Record call it gates.
        /// </summary>
        private bool IsKeyframeFor(string topic, object? value)
        {
            if (!_channelDeclarations.TryGetValue(topic, out var declaration) || declaration.IsKeyframe == null)
            {
                return false;
            }
            try
            {
                return declaration.IsKeyframe(value);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[ChannelEngine] IsKeyframe predicate for \"" + topic + "\" threw (treated as not-a-keyframe): " + SafeExceptionMessage(ex));
                return false;
            }
        }

        /// <summary>
        /// The reveal-horizon delay (seconds) for <paramref name="topic"/>: 0
        /// for a <see cref="DelayRole.TrueNow"/> channel and for
        /// <c>comms.delay</c> itself (the value that DEFINES the delay must
        /// never be gated by it: defended here regardless of how it was
        /// declared, §4.0), otherwise the current signal delay. Fail-soft: a
        /// non-finite or negative delay collapses to 0 (reveal live; never
        /// worse than today).
        /// </summary>
        /// <summary>
        /// The declared <see cref="Delivery"/> lane for <paramref name="topic"/>,
        /// threaded into <see cref="Courier.Record"/> so a
        /// <see cref="Delivery.ReliableOrdered"/> channel (the kOS terminal's
        /// ordered-diff stream) forwards every recorded sample in order instead
        /// of the state-topic re-read that coalesces same-<c>ValidAt</c> frames.
        /// Fail-soft to <see cref="Delivery.LossyLatest"/> (the historical
        /// behaviour) for any topic with no declaration, every real Record
        /// call site has one (it went through <see cref="ProcessPublish"/>/a
        /// declared source), but the default keeps state topics on the exact
        /// path they used before this gate existed.
        /// </summary>
        private Delivery DeliveryFor(string topic)
        {
            return _channelDeclarations.TryGetValue(topic, out var decl)
                ? decl.Delivery
                : Delivery.LossyLatest;
        }

        private double RevealDelayFor(string topic)
        {
            if (topic == CommsDelayTopic)
            {
                return 0.0;
            }
            if (_channelDeclarations.TryGetValue(topic, out var decl) && decl.Delay == DelayRole.TrueNow)
            {
                return 0.0;
            }

            // Connectivity MetaTopic (comms.link): Delayed but FREEZE-EXEMPT. It
            // must NOT take the !_commsConnected → +Inf branch below, a link
            // sample emitted DURING a blackout (connected:false) would otherwise
            // buffer with an infinite horizon and never mature, so the disconnect
            // edge could never reach the client and "NO SIGNAL" would never fire.
            // Instead it rides the ordinary finite delay (revealed at now-delay),
            // computed the same way as the connected path below. Placed BEFORE
            // the !_commsConnected check precisely because it applies while
            // disconnected. (The FlushReveal per-entry gate carries the matching
            // topic == ConnectivityMetaTopic exemption.)
            //
            // Reads _lastConnectedDelaySeconds, NOT the live _signalDelaySeconds:
            // a genuine disconnect collapses the live delay to 0 in the SAME tick
            // (no path ⇒ SignalDelay.Compute returns None ⇒ 0, the backend that
            // stops reporting connectivity is the same one that stops reporting
            // hop geometry), so using the live value here would reveal the
            // disconnect edge almost instantly instead of at the real last-known
            // light-time horizon. _lastConnectedDelaySeconds freezes at the value
            // in force the moment the link was last known up, which is the
            // physically honest number: KSC cannot learn of the outage faster
            // than light already in transit.
            if (topic == ConnectivityMetaTopic)
            {
                // comms.link is the ACTIVE vessel's link meta -> the "system"
                // subject's last-connected delay (Plan 2b).
                var metaDelay = _subjectLastConnectedDelay.TryGetValue(NodeId, out var m) ? m : 0.0;
                if (double.IsNaN(metaDelay) || double.IsInfinity(metaDelay) || metaDelay <= 0.0)
                {
                    return 0.0;
                }
                return metaDelay;
            }

            // Per-vessel contact MetaTopic (fleet.<guid>.contact): the same
            // exemption as comms.link, one subject at a time, and read from that
            // subject's own last-connected delay rather than the active vessel's.
            // Same reason as above for not using the live node delay: the routed
            // light-time collapses to 0 on the tick the craft drops off the
            // network, so a live read would hand the operator the silence report
            // instantly, ahead of the light that carries the evidence for it.
            if (IsFreezeExempt(topic))
            {
                var contactDelay = _subjectLastConnectedDelay.TryGetValue(NodeFor(topic), out var c) ? c : 0.0;
                if (double.IsNaN(contactDelay) || double.IsInfinity(contactDelay) || contactDelay <= 0.0)
                {
                    return 0.0;
                }
                return contactDelay;
            }

            // Freeze-on-disconnect: a down control link means nothing new can
            // reach KSC, so a Delayed channel is withheld as if the reveal
            // horizon were infinitely far off, Emit buffers it (Inf is not
            // ≤ 0) and FlushReveal never matures it (Ut ≤ now − Inf is always
            // false), so it stays frozen at last-known until the link returns
            // (on reacquisition the held recording is REPLAYED, see
            // ReplayInBlackoutBacklog; it used to be dropped).
            // Critically this fires even when _signalDelaySeconds is 0 (the
            // disconnect case: no path means SignalDelay None means 0), which
            // is exactly where a gate keyed on delay MAGNITUDE alone would
            // reveal live. The freeze is per-subject: a fleet.<guid> topic
            // freezes on ITS OWN vessel's link, and every non-fleet topic plus
            // the active vessel key by "system", which for a single-vessel
            // program is the same answer a single global bool gives.
            if (!SubjectConnected(NodeFor(topic)))
            {
                return double.PositiveInfinity;
            }

            // Delay migrated to the ledger (Plan 1): a connected ordinary
            // Delayed topic records straight through the gate; the Courier/
            // Archive apply the light-time via DelayTo. The gate now only
            // FREEZES (the !_commsConnected branch above returns +Inf); it no
            // longer carries the delay magnitude for ordinary topics.
            return 0.0;
        }

        /// <summary>
        /// Update <see cref="_signalDelaySeconds"/> from a just-emitted
        /// <c>comms.delay</c> payload. <see cref="CommsDelaySource.None"/>
        /// now covers two DIFFERENT values (comms-delay-nullable-when-no-path
        /// fix: see <see cref="CommsDelay.OneWaySeconds"/>'s own doc
        /// comment): 0 for delay-disabled-but-connected, null for no
        /// measurable path. This gate is UNCHANGED by that split, it only
        /// ever cared about "is there a positive delay to enforce", and both
        /// None cases collapse to "no" the same way 0 always did, so null
        /// coalesces to 0 here (<see cref="RevealDelayFor"/>'s ≤0 branch
        /// handles the rest via <see cref="_commsConnected"/>, not this
        /// magnitude). An unrecognized payload leaves the previous delay
        /// untouched (fail-soft; never reveals a Delayed channel earlier than
        /// the last known-good horizon by accident).
        /// </summary>
        private void CaptureSignalDelay(object? value)
        {
            if (value is CommsDelay commsDelay)
            {
                // Snapshot the delay in force while CONNECTED, before this
                // tick's fresh read overwrites it -- see
                // _lastConnectedDelaySeconds's doc comment. This runs BEFORE
                // RefreshConnectivityFromCapability (same tick), so
                // _commsConnected here still reflects connectivity as of the
                // outgoing value about to be replaced.
                if (SubjectConnected(NodeId))
                {
                    _subjectLastConnectedDelay[NodeId] = _signalDelaySeconds;
                }
                _signalDelaySeconds = commsDelay.OneWaySeconds ?? 0.0;

                // Ledger migration (Plan 1): drive the whole-network default
                // delay from the freshly-captured scalar so the Courier/Archive
                // apply the light-time for ordinary topics. The meta-vantage is
                // pinned to 0 (ctor), so instant/exempt topics stay instant.
                // Placed here (the single _signalDelaySeconds mutation point)
                // rather than at the refresh method's end so it can't be skipped
                // by the pull-channel fail-soft early-return.
                _network.SetDefaultDelay(_signalDelaySeconds);
            }
        }

        /// <summary>
        /// AUTHORITATIVE, subscription-independent refresh of the reveal-gate
        /// delay (§7.3 Step 2, hardened). Runs once per tick BEFORE the channel
        /// loop and <see cref="FlushReveal"/>, evaluating the registered
        /// <c>comms.delay</c> channel source DIRECTLY: the same closure that in
        /// production resolves the elected comms backend
        /// (<c>Kernel.Query&lt;ICommsBackend&gt;</c> via
        /// <see cref="Sitrep.Host.Comms.CommsElection"/>) and computes the
        /// one-way light-time over its hop geometry
        /// (<see cref="Sitrep.Host.Comms.SignalDelay.Compute"/>). Because it is
        /// driven off the SERVER-SIDE capability and not the wire, it fires
        /// every tick regardless of whether any client has subscribed
        /// <c>comms.delay</c>. This closes the subscription-coupling hole: the
        /// old <see cref="Emit"/> snoop only updated the delay while
        /// <c>comms.delay</c> was subscribed (the channel loop is
        /// subscription-gated), so a raw client subscribing a Delayed channel
        /// but NOT <c>comms.delay</c> would see it revealed live/ungated.
        ///
        /// <para>Fail-soft, byte-identical to today when there is no delay
        /// authority: no registered comms.delay source, an Unavailable owning
        /// uplink, a null mapper result, or a non-CommsDelay payload all leave
        /// the last-known delay untouched, and a throwing mapper is attributed
        /// to its owning uplink (<see cref="FailSoftChannel"/>) exactly as the
        /// channel loop would; never rethrown onto the Courier thread. Config-
        /// gating / no-geometry / None / ≤0 all flow through
        /// <see cref="CommsDelay.OneWaySeconds"/> == 0 and
        /// <see cref="RevealDelayFor"/>'s ≤0 collapse to "reveal live".</para>
        /// </summary>
        private void RefreshSignalDelayFromCapability(TickJob tick)
        {
            // Path 1: the AUTHORITATIVE server-side delay source (production:
            // CommsCoreUplink.SetSignalDelaySource). Computed on the main thread
            // in CaptureSignalDelayOnMain regardless of subscription or of how
            // comms.delay is otherwise registered, this is what closes the bug
            // where a Publisher/AddSampledSource-registered comms.delay never
            // reached the gate. A main-thread throw is fail-softed here, on the
            // Courier thread (the correct thread for _availability writes).
            if (tick.SignalDelay.Error != null)
            {
                FailSoftSignalDelaySource(tick.SignalDelay.Error);
            }
            else if (tick.SignalDelay.Value != null)
            {
                CaptureSignalDelay(tick.SignalDelay.Value);
            }

            // Path 2: a comms.delay registered as a pull-style channel source
            // (AddChannelSource). Production does NOT use this for comms.delay,
            // but some tests / a future uplink might; kept so the refresh reads
            // the delay whatever registration mechanism comms.delay lives in.
            // Mapper runs on the Courier thread (safe only for a KSP-free
            // mapper: the reason production uses the main-thread source above).
            if (_channelSources.TryGetValue(CommsDelayTopic, out var map) && IsChannelAvailable(CommsDelayTopic))
            {
                object? value;
                try
                {
                    value = map(tick.Snapshot);
                }
                catch (Exception ex)
                {
                    FailSoftChannel(CommsDelayTopic, ex);
                    return;
                }

                CaptureSignalDelay(value);
            }
        }

        /// <summary>
        /// Fail-soft for a throwing server-side signal-delay source (see
        /// <see cref="CaptureSignalDelayOnMain"/> / <see cref="SetSignalDelaySource"/>).
        /// RECOVERABLE by design: the source is a per-tick main-thread computation
        /// over live KSP state, which legitimately hits transient nulls (scene
        /// settle, a momentarily-unloaded vessel with no CommNet control path). A
        /// throw on one tick must NOT permanently kill delay enforcement for the
        /// rest of the session: so this does NOT set
        /// <see cref="_signalDelaySourceDisabled"/> and does NOT mark the owning
        /// comms uplink Unavailable (which would take the whole comms uplink
        /// down). The throwing tick simply yields no update, the last-known delay
        /// is left untouched, never revealing a Delayed channel earlier than the
        /// known horizon: and the source is RETRIED next tick. Contrast a genuine
        /// registration/Register throw, which staying-Unavailable is still correct
        /// for (see <see cref="RegisterUplink"/> / <see cref="MarkUplinkUnavailable"/>).
        /// </summary>
        private void FailSoftSignalDelaySource(Exception ex)
        {
            Console.Error.WriteLine("[ChannelEngine] signal delay source (owner \"" + _signalDelaySourceOwnerId + "\") threw (recoverable, retrying next tick): " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// Spend this tick's DROP EVENT on the delay ledger: everything the
        /// subject sent that had not crossed the break when it opened can never
        /// arrive, and <see cref="INetwork.DropPath"/> is what retires it (see
        /// <see cref="IUplinkHost.SetPathBreakSource"/>).
        ///
        /// <para>Scoped to <see cref="NodeId"/>, the active vessel's own node,
        /// and that is where the hop identity a break needs actually exists: the
        /// per-vessel fleet delays are routed light-times with no node ids on
        /// them, and the command-centre matrix's route hops structurally carry
        /// none. A fleet subject going dark is still handled the way it always
        /// was, by the reveal gate freezing it.</para>
        ///
        /// <para>Fail-soft in the safe direction: a source that threw raises
        /// nothing, because a break that cannot be established must behave
        /// exactly like no break, which is to deliver.</para>
        /// </summary>
        private void ApplyPathBreak(TickJob tick)
        {
            if (tick.PathBreak.Error != null)
            {
                Console.Error.WriteLine("[ChannelEngine] path break source (owner \"" + _pathBreakSourceOwnerId + "\") threw (recoverable, retrying next tick): " + SafeExceptionMessage(tick.PathBreak.Error));
                return;
            }
            var found = tick.PathBreak.Value;
            if (found == null)
            {
                return;
            }
            _network.DropPath(NodeId, found.Value.AtUt, found.Value.LightSecondsOut);
        }

        /// <summary>
        /// Freeze-on-disconnect refresh, run once per tick BEFORE the channel
        /// loop and <see cref="FlushReveal"/> (right after
        /// <see cref="RefreshSignalDelayFromCapability"/>). Applies the
        /// main-thread connectivity capture to <see cref="_commsConnected"/>.
        /// Fail-soft: a source that threw is attributed to its owning uplink and
        /// connectivity REVERTS to CONNECTED (never leave the gate frozen on the
        /// strength of a source that just threw); a null result leaves the
        /// last-known connectivity untouched.
        /// </summary>
        private void RefreshConnectivityFromCapability(TickJob tick)
        {
            if (tick.Connectivity.Error != null)
            {
                FailSoftConnectivitySource(tick.Connectivity.Error);
                SetCommsConnected(true, tick.Ut);
                return;
            }

            if (tick.Connectivity.Value.HasValue)
            {
                SetCommsConnected(tick.Connectivity.Value.Value, tick.Ut);
            }
        }

        /// <summary>
        /// Apply a CONNECTED/DISCONNECTED transition to the reveal gate for the
        /// ACTIVE vessel. On a DISCONNECTED→CONNECTED edge the withheld window
        /// is now REPLAYED as the craft's own recording rather than dropped: see
        /// <see cref="ReplayInBlackoutBacklog"/>. Reconstructing the gap used to
        /// be the client's job and there was nothing to reconstruct it from.
        /// Courier-thread-only.
        /// </summary>
        private void SetCommsConnected(bool connected, double ut) =>
            // Active-vessel connectivity entry point (the "system" subject),
            // unchanged semantics: RefreshConnectivityFromCapability drives it
            // every tick. Delegates to the per-subject sink (Plan 2b).
            SetSubjectConnected(NodeId, connected, ut);

        /// <summary>
        /// Current connectivity for a subject node (fleet.&lt;guid&gt; or
        /// "system"); a subject absent from the map reads as CONNECTED, so it is
        /// never spuriously frozen. Courier-thread-only.
        /// </summary>
        private bool SubjectConnected(string node) =>
            !_subjectConnected.TryGetValue(node, out var c) || c;

        /// <summary>
        /// Rewrite the delay ledger for this tick, AFTER
        /// <see cref="RefreshConnectivityFromCapability"/> has settled the
        /// tick's connectivity and BEFORE the clock advance fires any delivery.
        /// A subject that is out of contact keeps the light-time it had while it
        /// was last heard from, instead of the live 0 a lost path reports.
        ///
        /// <para>The freeze gate stops NEW telemetry crossing a dead link. It
        /// does nothing about telemetry that had ALREADY crossed and is still on
        /// its way, which is the Courier's business: each in-flight sample is a
        /// scheduled delivery that reads the archive at
        /// <c>fireUt - DelayTo(vantage, node)</c>. Let that delay collapse to 0
        /// at the cut and every one of those reads jumps a full light-time
        /// forward, handing the operator the last pre-cut sample immediately and
        /// skipping the seconds of telemetry that were genuinely still in
        /// transit. Holding the delay is what makes the tail play out at the
        /// rate it was recorded and then fall silent, which is what a real
        /// broadcast does.</para>
        ///
        /// <para>Freeze-exempt topics are unaffected: they ride
        /// <see cref="MetaVantage"/>, whose explicit (vantage, node) rows are
        /// pinned to 0 and outrank both the node-default and the whole-network
        /// default written here.</para>
        ///
        /// <para>Writes ONLY where it has something better to say: a connected
        /// subject, or one that has never been heard from, is left exactly as
        /// <see cref="CaptureSignalDelay"/> / <see cref="SetVesselDelay"/> wrote
        /// it. That is what keeps the constructor's seed (see
        /// <c>networkDelaySeconds</c>) alive for a caller that registers no
        /// delay authority at all.</para>
        /// </summary>
        private void RefreshLedgerDelays()
        {
            if (!SubjectConnected(NodeId) && _subjectLastConnectedDelay.TryGetValue(NodeId, out var systemHeld))
            {
                _network.SetDefaultDelay(systemHeld);
            }
            foreach (var node in _vesselNodeDelay.Keys)
            {
                if (!SubjectConnected(node) && _subjectLastConnectedDelay.TryGetValue(node, out var vesselHeld))
                {
                    _network.SetNodeDelay(node, vesselHeld);
                }
            }
        }

        /// <summary>
        /// Remove a FLEET subject's per-node freeze-map entries once its last
        /// topic is unsubscribed / its session disconnects (Plan 2b required
        /// addition 2): otherwise the maps accumulate one stale entry per vessel
        /// guid ever seen. The "system" subject is PERMANENT (never cleaned).
        /// Called AFTER the topic is removed from the subscribed-topics mirror,
        /// so <see cref="IsAnyTopicSubscribed"/> reflects the removal.
        /// </summary>
        private void CleanUpSubjectIfGone(string topic)
        {
            var node = NodeFor(topic);
            if (node == NodeId)
            {
                return; // "system" is permanent.
            }
            // Keep the subject while ANY of its topics (node + ".*") is still subscribed.
            if (IsAnyTopicSubscribed(node + "."))
            {
                return;
            }
            _subjectConnected.Remove(node);
            _subjectConnectivityHistory.Remove(node);
            _subjectLastConnectedDelay.Remove(node);
            _vesselNodeDelay.Remove(node);

            // The recorder's per-topic bookkeeping is keyed by TOPIC, not node,
            // so it needs its own sweep over this subject's namespace. Left
            // behind it would accumulate an entry per (vessel guid, field) ever
            // seen, and an unsubscribed-then-resubscribed vessel would claim a
            // gap running back to a sample the current subscriber never had.
            // Matched through NodeFor rather than a "<node>." prefix: this
            // subject's topics also live under the disjoint per-vessel
            // namespaces (currency., silence.), which route to the same node and
            // would survive a prefix test.
            foreach (var recordedTopic in new List<string>(_lastRecordedUt.Keys))
            {
                if (NodeFor(recordedTopic) == node)
                {
                    _lastRecordedUt.Remove(recordedTopic);
                }
            }
            foreach (var gapTopic in new List<string>(_pendingGapSinceUt.Keys))
            {
                if (NodeFor(gapTopic) == node)
                {
                    _pendingGapSinceUt.Remove(gapTopic);
                }
            }
        }

        /// <summary>
        /// Test hook: the delay ledger's current one-way seconds for a
        /// (vantage, node) pair. Exists so a test can assert that the
        /// command-delay matrix is populated even with NO client subscribed to
        /// anything, the property that makes a career outcome independent of
        /// which dashboard happens to be open. Read it only between ticks, it
        /// touches state the Courier thread otherwise owns.
        /// </summary>
        internal double LedgerDelayFor(string vantage, string node) => _network.DelayTo(vantage, node);

        /// <summary>Test hook (Plan 2b): whether any per-node freeze map still holds this subject.</summary>
        internal bool HasFreezeStateForSubject(string node) =>
            _subjectConnected.ContainsKey(node)
            || _subjectConnectivityHistory.ContainsKey(node)
            || _subjectLastConnectedDelay.ContainsKey(node);

        /// <summary>
        /// Apply a CONNECTED/DISCONNECTED transition for ONE subject to the
        /// reveal gate (Plan 2b). Other subjects are untouched.
        ///
        /// <para>On a DISCONNECTED→CONNECTED edge (reacquisition) that subject's
        /// withheld backlog is REPLAYED, as a recording dumped from the craft the
        /// moment the link returns: see
        /// <see cref="ReplayInBlackoutBacklog"/>. It used to be dropped, which
        /// deleted the outage window outright.</para>
        ///
        /// <para>On a CONNECTED→DISCONNECTED edge the Courier is told the subject's
        /// link is down, so a late or reconnecting subscriber's catch-up is
        /// stamped <see cref="Staleness.LastBeforeBlackout"/> instead of
        /// <see cref="Staleness.Fresh"/>. That seam existed unused since M2; the
        /// blackout authority is the only thing that ever knew enough to drive
        /// it.</para>
        ///
        /// <para>Courier-thread-only.</para>
        /// </summary>
        private void SetSubjectConnected(string node, bool connected, double ut)
        {
            var wasConnected = SubjectConnected(node);
            _subjectConnected[node] = connected;

            if (connected != wasConnected)
            {
                if (!_subjectConnectivityHistory.TryGetValue(node, out var history))
                {
                    // Seed default-connected at -Inf so a lookup before the first
                    // real transition fails soft to CONNECTED.
                    history = new List<(double, bool)> { (double.NegativeInfinity, true) };
                    _subjectConnectivityHistory[node] = history;
                }
                history.Add((ut, connected));
            }

            if (!connected)
            {
                if (connected != wasConnected)
                {
                    _subjectDarkSinceUt[node] = ut;
                }
                // Re-applied EVERY disconnected tick rather than on the edge
                // alone, always at the ORIGINAL loss-of-signal instant. The
                // Courier records the mark per (node, vantage) over the vantages
                // subscribed when it is called, so an edge-only mark would miss
                // an operator who opens a dashboard mid-outage: their catch-up
                // would resolve to a pre-outage sample and be stamped
                // Fresh, which is the exact lie this wiring exists to stop.
                // Idempotent, and the since-UT is held rather than re-read so it
                // cannot drift forward as the outage runs.
                _courier.MarkSubjectLinkDown(
                    node,
                    _subjectDarkSinceUt.TryGetValue(node, out var darkSince) ? darkSince : ut);
            }

            if (!wasConnected && connected)
            {
                _subjectDarkSinceUt.Remove(node);
                _courier.MarkSubjectLinkUp(node);
                ReplayInBlackoutBacklog(node, ut);
            }
        }

        /// <summary>
        /// Subject <paramref name="node"/>'s link CONNECTED state as of
        /// <paramref name="ut"/>, the connected flag of the latest transition at
        /// or before that UT. Fail-soft to CONNECTED when the subject has no
        /// recorded history. Courier-thread-only.
        /// </summary>
        private bool ConnectivityAt(string node, double ut)
        {
            if (!_subjectConnectivityHistory.TryGetValue(node, out var history))
            {
                return true;
            }
            var connected = true;
            for (var i = 0; i < history.Count; i++)
            {
                if (history[i].Ut <= ut)
                {
                    connected = history[i].Connected;
                }
                else
                {
                    break;
                }
            }
            return connected;
        }

        /// <summary>
        /// Hand subject <paramref name="node"/>'s in-blackout recording to the
        /// Courier as one dump transmitted from <paramref name="reacquiredAtUt"/>:
        /// every buffered entry on that subject's topics carrying an infinite
        /// horizon, which is exactly the set emitted while its link was down (see
        /// <see cref="RevealDelayFor"/>). Freeze-exempt entries carry a finite
        /// horizon and stay in the buffer to mature normally, as do the
        /// pre-outage in-flight tail's. Other subjects' buffers are untouched
        /// (Plan 2b per-subject reacquisition).
        ///
        /// <para>The dump's flight time is the light-time at the REACQUISITION
        /// geometry, not at loss of signal, and this method does not compute it:
        /// it hands the Courier the instant of transmission and the Courier
        /// applies <c>DelayTo(vantage, node)</c> at that instant, which by now is
        /// this tick's fresh value (the connectivity refresh runs after the delay
        /// refresh, see <see cref="ProcessTick"/>). The two differ by however far
        /// the craft moved during the outage, and telling them apart is the whole
        /// point: a recording does not travel until the link is back.</para>
        ///
        /// <para>Delivered here rather than left to mature in the reveal buffer
        /// because the buffer's per-entry horizon is a statement about ONE
        /// sample's own light-time, and a dump is the opposite shape: many
        /// samples, one transmission, one arrival. Encoding that as a re-stamped
        /// per-entry delay would have every entry carry a different number
        /// meaning the same instant.</para>
        /// </summary>
        private void ReplayInBlackoutBacklog(string node, double reacquiredAtUt)
        {
            foreach (var topic in new List<string>(_revealBuffer.Keys))
            {
                if (IsFreezeExempt(topic) || NodeFor(topic) != node)
                {
                    continue;
                }
                var list = _revealBuffer[topic];

                var recorded = new List<ArchiveSample>();
                var kept = 0;
                for (var i = 0; i < list.Count; i++)
                {
                    var entry = list[i];
                    if (double.IsInfinity(entry.Delay))
                    {
                        recorded.Add(new ArchiveSample(entry.Value, entry.Ut, _courier.CurrentEpoch));
                    }
                    else
                    {
                        list[kept++] = entry;
                    }
                }
                if (kept < list.Count)
                {
                    list.RemoveRange(kept, list.Count - kept);
                }
                if (list.Count == 0)
                {
                    _revealBuffer.Remove(topic);
                }

                if (recorded.Count == 0)
                {
                    continue;
                }

                _blackoutReplayBudget?.Record(recorded.Count, reacquiredAtUt);

                double? gap = null;
                if (_pendingGapSinceUt.TryGetValue(topic, out var gapSince))
                {
                    gap = gapSince;
                    _pendingGapSinceUt.Remove(topic);
                }
                _lastRecordedUt[topic] = recorded[recorded.Count - 1].ValidAt;

                _courier.ReplayRecorded(node, topic, recorded, reacquiredAtUt, gap);
            }
        }

        /// <summary>
        /// Prune EVERY subject's connectivity history to the reveal window
        /// (Plan 2b required addition 1): each per-vessel history would otherwise
        /// grow unbounded under connect/disconnect churn. Called each tick after
        /// FlushReveal, where the global prune was called.
        /// </summary>
        private void PruneAllConnectivityHistory()
        {
            foreach (var node in new List<string>(_subjectConnectivityHistory.Keys))
            {
                PruneConnectivityHistory(node);
            }
        }

        /// <summary>
        /// Prune subject <paramref name="node"/>'s connectivity transitions that
        /// no buffered sample of ITS topics can ever query again: every entry
        /// strictly older than that subject's oldest still-buffered sample is
        /// unreachable by <see cref="ConnectivityAt"/>. Keeps the LAST such entry
        /// (the state at the oldest buffered UT). Bounds the history by the reveal
        /// window, never by session length.
        /// </summary>
        private void PruneConnectivityHistory(string node)
        {
            if (!_subjectConnectivityHistory.TryGetValue(node, out var history) || history.Count <= 1)
            {
                return;
            }

            var oldestBufferedUt = double.PositiveInfinity;
            foreach (var kv in _revealBuffer)
            {
                if (NodeFor(kv.Key) != node)
                {
                    continue;
                }
                foreach (var entry in kv.Value)
                {
                    if (entry.Ut < oldestBufferedUt)
                    {
                        oldestBufferedUt = entry.Ut;
                    }
                }
            }

            // Find the last transition at or before the oldest buffered UT,
            // everything strictly before it is unreachable. If nothing is
            // buffered, collapse to the current state alone.
            var keepFrom = 0;
            for (var i = 0; i < history.Count; i++)
            {
                if (history[i].Ut <= oldestBufferedUt)
                {
                    keepFrom = i;
                }
                else
                {
                    break;
                }
            }
            if (keepFrom > 0)
            {
                history.RemoveRange(0, keepFrom);
            }
        }

        /// <summary>
        /// Fail-soft for a throwing connectivity source, twin of
        /// <see cref="FailSoftSignalDelaySource"/>, and RECOVERABLE for the same
        /// reason: a per-tick main-thread read of live KSP that hits a transient
        /// null must not permanently freeze/disable comms for the session. Does
        /// NOT set <see cref="_connectivitySourceDisabled"/> and does NOT mark the
        /// owning uplink Unavailable; the caller
        /// (<see cref="RefreshConnectivityFromCapability"/>) reverts connectivity
        /// to CONNECTED for the throwing tick, and the source is RETRIED next tick.
        /// </summary>
        private void FailSoftConnectivitySource(Exception ex)
        {
            Console.Error.WriteLine("[ChannelEngine] connectivity source (owner \"" + _connectivitySourceOwnerId + "\") threw (recoverable, retrying next tick): " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// Release every buffered Delayed-channel sample whose UT has reached
        /// its reveal horizon (<paramref name="now"/> − delay), recording it
        /// into the Courier so it goes on the wire. Called once per tick BEFORE
        /// the clock advance, so the Courier schedules the freed deliveries and
        /// the same <see cref="ManualClock.AdvanceTo"/> fires them. Runs
        /// independently of the channel loop, so a value that was buffered on an
        /// earlier tick (and whose change-gated channel emitted nothing since)
        /// still surfaces the moment the horizon overtakes it. The post-horizon
        /// tail stays buffered. This is the server-side twin of the SDK
        /// <c>ViewClock.confirmedEdgeUt()</c> clamp (§4.0).
        /// </summary>
        private void FlushReveal(double now)
        {
            if (_revealBuffer.Count == 0)
            {
                return;
            }

            // Freeze-on-disconnect is now PER-ENTRY, not a global early-return.
            // The pre-outage in-flight tail (finite horizon, captured while the
            // link was up) MUST still reveal as the advancing clock overtakes it,
            // that is the "last delaySeconds of pre-outage telemetry arrives,
            // THEN freezes" behaviour. Only samples captured DURING the blackout
            // are withheld: non-MetaTopic ones carry an infinite horizon
            // (RevealDelayFor's !_commsConnected branch) so they never mature,
            // and the connectivity gate below is the belt-and-braces guard. The
            // freeze-exempt topics (comms.link, fleet.<guid>.contact) are the
            // exception so their disconnect edge + through-blackout state reveal
            // at now-delay.
            foreach (var topic in new List<string>(_revealBuffer.Keys))
            {
                var list = _revealBuffer[topic];
                var freezeExempt = IsFreezeExempt(topic);

                var writeIdx = 0;
                for (var readIdx = 0; readIdx < list.Count; readIdx++)
                {
                    var entry = list[readIdx];
                    // Flap-leak fix: mature each entry against the delay that
                    // was in force when it was BUFFERED (captured on the entry),
                    // not the current delay re-read here. A later drop of the
                    // delay authority to 0 therefore cannot prematurely reveal a
                    // still-future sample.
                    var horizonReached = entry.Ut <= now - entry.Delay;
                    // Per-entry freeze gate: a freeze-exempt topic always passes;
                    // every other topic reveals only samples captured while the
                    // link was up at their UT. A finite-horizon non-exempt entry
                    // is only ever buffered while connected, so ConnectivityAt is
                    // true for it: this gate's real work is letting the exempt
                    // topics through (whose blackout samples are precisely the
                    // ones reporting connected:false / Silent / Lost).
                    if (horizonReached && (freezeExempt || ConnectivityAt(NodeFor(topic), entry.Ut)))
                    {
                        RecordThrough(topic, entry.Value, entry.Ut);
                    }
                    else
                    {
                        list[writeIdx++] = entry;
                    }
                }

                if (writeIdx < list.Count)
                {
                    list.RemoveRange(writeIdx, list.Count - writeIdx);
                }
                if (list.Count == 0)
                {
                    _revealBuffer.Remove(topic);
                }
            }
        }

        private void ProcessTick(TickJob tick)
        {
            // Quickload / timeline-rewind detection: paired 1:1 with the
            // identical check GonogoBodiesServer/ReplayBodiesServer both used
            // to carry separately: now there is exactly one copy. Live KSP's
            // UT jumps BACKWARD on an F9 quickload; without this,
            // ManualClock.AdvanceTo's forward-only no-op leaves the courier
            // wedged on the abandoned pre-quickload timeline. The emitter is
            // reset alongside the courier (for EVERY registered channel at
            // once: ChannelEmitter.Reset already iterates every channel it
            // knows about) so the next Decide per topic is an unconditional
            // keyframe on the new timeline too.
            if (tick.Ut < _clock.Now())
            {
                _courier.ResetTimeline(tick.Ut);
                _emitter.Reset(tick.Ut);
                // Drop every un-revealed buffered sample: they belong to the
                // abandoned pre-rewind timeline and must never surface on the
                // new one (the reveal-gate analogue of ResetTimeline dropping
                // in-flight Courier deliveries: §7.3 Step 3, on-reset flush).
                _revealBuffer.Clear();
                // Including the recorder's own bookkeeping: a held recording
                // describes the abandoned timeline, and both a "last delivered
                // UT" and an owed gap are statements about a record that no
                // longer exists. Carried forward, the first post-rewind sample
                // on a topic would claim a hole back to a pre-rewind UT.
                _lastRecordedUt.Clear();
                _pendingGapSinceUt.Clear();
                // The connectivity history's UTs belong to the abandoned
                // timeline too: collapse it to the current link state seeded at
                // -Inf so a post-rewind ConnectivityAt lookup fails soft to that
                // state rather than querying pre-rewind transitions.
                // Per-subject (Plan 2b): collapse EVERY subject's history to its
                // current link state seeded at -Inf, dropping pre-rewind transitions.
                foreach (var subjectNode in new List<string>(_subjectConnectivityHistory.Keys))
                {
                    _subjectConnectivityHistory[subjectNode] =
                        new List<(double, bool)> { (double.NegativeInfinity, SubjectConnected(subjectNode)) };
                }
                // Same abandoned-timeline treatment for the pending-uplink
                // roster: an in-flight prediction is anchored to the timeline it
                // was dispatched on, so its DispatchedAt/OneWaySeconds mean
                // nothing against the one the rewind lands on. Dropped whole
                // rather than carried forward or pruned normally.
                _pending.Clear();
                RecomputeChannelBirthFromArchive();
                BroadcastTimelineReset();
            }

            if (tick.Snapshot != null)
            {
                foreach (var (ownerId, sampler) in _samplers)
                {
                    /*
                     * A sampler is third-party (uplink) code running on the
                     * Courier thread, so an unguarded throw here kills the
                     * thread: the catch below is what keeps it alive.
                     *
                     * Catching alone is not enough. Without owner attribution a
                     * Sample() that throws every tick logs forever and is
                     * re-invoked next tick regardless, so the uplink never goes
                     * Unavailable the way a throwing channel mapper or command
                     * handler makes it (see IsChannelAvailable /
                     * IsCommandAvailable). So this follows the same rule as
                     * those: skip a sampler whose owner is already Unavailable,
                     * whether from a PRIOR tick's throw or a throwing
                     * Register(), and on a throw here attribute it to the
                     * owning uplink via FailSoftSampler so it stops recurring
                     * from the NEXT tick onward.
                     */
                    if (!IsUplinkAvailable(ownerId))
                    {
                        continue;
                    }

                    try
                    {
                        sampler.Sample(tick.Snapshot);
                    }
                    catch (Exception ex)
                    {
                        FailSoftSampler(ownerId, sampler, ex);
                    }
                }
            }

            // Capture-on-main / handle-on-Courier sources (see
            // IUplinkHost.AddSampledSource): the captures already ran on the
            // main-loop thread inside RunCaptures; here, on the Courier
            // thread, each captured payload is handed to its handle. Same
            // fail-soft discipline as the sampler loop above, skip a source
            // whose owner already went Unavailable, surface a capture-time
            // throw (recorded main-side) via FailSoftSampledSource, and guard
            // the handle itself so an off-thread handle throw takes only its
            // own owning uplink inert rather than the Courier thread.
            if (tick.Captures != null)
            {
                foreach (var captured in tick.Captures)
                {
                    var source = _sampledSources[captured.Index];
                    if (source.Disabled || !IsUplinkAvailable(source.OwnerId))
                    {
                        continue;
                    }

                    if (captured.Exception != null)
                    {
                        // TRANSIENT: retry next tick instead of permanent disable
                        // (see RetrySampledSourceAfterCaptureThrow: the SCANsat
                        // early-Planetarium-not-ready root cause).
                        RetrySampledSourceAfterCaptureThrow(source, captured.Exception);
                        continue;
                    }

                    // Successful capture: clear any transient-throw streak so a
                    // source that recovered (e.g. Planetarium now ready) is back to
                    // a clean state and its next throw is logged as a fresh attempt.
                    source.ConsecutiveCaptureThrows = 0;

                    try
                    {
                        source.Handle(captured.Value);
                    }
                    catch (Exception ex)
                    {
                        // A HANDLE throw is off-thread processing of already-captured
                        // data: far more likely a genuine fault than a not-ready
                        // transient, so it keeps the permanent fail-soft (now logged).
                        FailSoftSampledSource(source, ex);
                    }
                }
            }

            // AUTHORITATIVE delay refresh (§7.3 Step 2): source the reveal-gate
            // delay from the server-side SignalDelay capability every tick,
            // independent of any client subscription: BEFORE the channel loop
            // (so this tick's buffering decisions use the current delay) and
            // hence before FlushReveal. See RefreshSignalDelayFromCapability.
            RefreshSignalDelayFromCapability(tick);

            // Freeze-on-disconnect (server-side enforcement): apply the
            // CONNECTED/DISCONNECTED authority BEFORE the channel loop (so this
            // tick's Emit buffering decisions see it) and before FlushReveal (so
            // a down link withholds every buffered sample, and a reacquisition
            // hands the held recording to the Courier in time for this tick's
            // clock advance to schedule it). See RefreshConnectivityFromCapability.
            RefreshConnectivityFromCapability(tick);

            // The delay ledger is written LAST of the three, because holding a
            // dark subject's light-time needs this tick's connectivity, and both
            // the sampled-source handles (SetVesselDelay) and the delay refresh
            // above run before it is known. See RefreshLedgerDelays.
            RefreshLedgerDelays();

            // The DROP EVENT, written after the ledger's delays and well before
            // this tick's _clock.AdvanceTo: a break has to be on the books
            // before any delivery it dooms is allowed to fire, and every
            // scheduled delivery for this tick fires inside that advance.
            ApplyPathBreak(tick);

            // Prune the pending-uplink roster BEFORE the channel loop below so
            // the UplinkPendingTopic mapper (run inside that loop) always
            // observes the current, already-pruned list: see PendingUplink's
            // prediction-only doc comment: entries age out on the PREDICTED
            // round trip (DispatchedAt + 2*OneWaySeconds), independent of
            // whether anything is subscribed.
            PrunePendingUplinks(tick.Ut);

            foreach (var channelSource in _channelSources)
            {
                var topic = channelSource.Key;
                if (!IsChannelAvailable(topic))
                {
                    // IMPORTANT-A: the owning uplink went Unavailable
                    // (registration threw, or a PRIOR tick's mapper threw
                    // below): every channel it owns goes inert together,
                    // not just the one that originally failed.
                    continue;
                }

                var map = channelSource.Value;
                if (!_subscriptions.IsSubscribed(topic))
                {
                    continue;
                }

                object? value;
                try
                {
                    value = map(tick.Snapshot);
                }
                catch (Exception ex)
                {
                    // A channel mapper is uplink-authored code, and a throw
                    // here (an unexpected snapshot shape, say) kills the Courier
                    // thread if it escapes. Caught, it fail-softs ONLY this
                    // channel's owning uplink (see FailSoftChannel) and skips to
                    // the NEXT channel this same tick, so every other
                    // registered channel keeps ticking normally.
                    FailSoftChannel(topic, ex);
                    continue;
                }

                if (value == null)
                {
                    var hasDeclaration = _channelDeclarations.TryGetValue(topic, out var declaration);
                    var absenceIsData = hasDeclaration && declaration.AbsenceIsData;
                    if (hasDeclaration && declaration.NullIsUnreadable)
                    {
                        // The mapper could not take a reading, which is not the
                        // same claim as the subject having no value (see
                        // ChannelDeclaration.NullIsUnreadable). Emit nothing at
                        // all, born or not: the silence is what carries the
                        // client to its `stale` arm, holding the last real
                        // observation with the UT it was made at, and a
                        // tombstone here would overwrite that with a confirmed
                        // nothing. Checked before the birth gate because this
                        // answer does not depend on whether the channel has
                        // spoken before, and it outranks AbsenceIsData, which
                        // makes the opposite claim about the same null.
                        continue;
                    }
                    if (!_born.Contains(topic) && !absenceIsData)
                    {
                        // No data yet for this topic this tick, AND it has
                        // never had a real value (e.g. main menu, before
                        // FlightGlobals is ready), not yet a subject, so
                        // there is nothing to tombstone. Skip this topic
                        // entirely, same as before this fix; other topics/
                        // the clock advance below are unaffected.
                        //
                        // Exception: a channel that opts into
                        // AbsenceIsData (see ChannelDeclaration.AbsenceIsData)
                        // is a genuinely-sometimes-empty subject (e.g.
                        // vessel.target/dock/crew) rather than "no subject
                        // yet": for those, fall through to Decide even
                        // from birth so the client learns "NO DATA" instead
                        // of hanging on "SYNCING" forever.
                        continue;
                    }
                    // else: this channel WAS born (has emitted a real value
                    // before) -- a null now is a legitimate ABSENCE
                    // transition (finding B / M2 tombstone). Fall through
                    // into Decide with the null value: it is change-gated
                    // exactly like any other value (Equals(last, null) ->
                    // change, once; null -> null -> no change, suppressed by
                    // the deadband: see ChannelEmitter.HasChangedBeyondQuantum),
                    // keyframed, delayed, and archived through the SAME path
                    // as a real sample, so late subscribers/scrubs/replays
                    // learn the absence rather than seeing a frozen ghost of
                    // the last real value.
                }
                else
                {
                    _born.Add(topic);
                }

                // C2-1 (second fail-soft round): Decide is ALSO
                // uplink-authored code -- a structured payload's deadband
                // falls back to object.Equals (see
                // ChannelEmitter.HasChangedBeyondQuantum), which invokes the
                // VALUE's own Equals override. Before this fix, a throwing
                // Equals escaped this loop entirely (this call sat OUTSIDE
                // the try/catch above that only guarded map()), skipping
                // _clock.AdvanceTo below for the WHOLE tick -- wedging every
                // OTHER channel's delivery too, not just this one. Guarded
                // exactly like map(): fail-soft ONLY this channel's owning
                // uplink and move on to the next channel, same tick.
                EmissionDecision decision;
                try
                {
                    decision = _emitter.Decide(topic, value, tick.Ut);
                }
                catch (Exception ex)
                {
                    FailSoftChannel(topic, ex);
                    continue;
                }
                if (decision.ShouldEmit)
                {
                    Emit(topic, decision.Value, tick.Ut);
                }
            }

            // Release any buffered Delayed-channel samples the advancing horizon
            // has now overtaken, BEFORE AdvanceTo so the freed deliveries the
            // Courier schedules fire within this same clock advance (§7.3 Step 1/3).
            FlushReveal(tick.Ut);
            PruneAllConnectivityHistory();

            _clock.AdvanceTo(tick.Ut);
            tick.Done?.Set();
        }

        private void ProcessPublish(PublishJob publish)
        {
            if (!_subscriptions.IsSubscribed(publish.Topic))
            {
                return;
            }

            // C1-pub: publish.Ut is caller/uplink-stamped (typically via
            // IUplinkHost.NowUt(), read at some earlier point), entirely
            // independent of the Tick-driven clock advance. If a quickload
            // rewinds _clock backward AFTER an uplink captured its "now"
            // but BEFORE it got around to calling Publish, that captured ut
            // is a ghost from the abandoned timeline -- now numerically
            // AHEAD of the rewound clock's current position. Recording it
            // as-is would insert a sample stamped ahead of "now" into the
            // (already-reset) archive: Courier.ResetTimeline's retroactive
            // prune only ever runs AT the moment of the rewind itself, so it
            // can never catch a ghost that arrives strictly afterward.
            // Clamp forward to "now" instead of recording it as stamped.
            var ut = publish.Ut > _clock.Now() + PublishUtToleranceSeconds ? _clock.Now() : publish.Ut;

            EmissionDecision decision;
            try
            {
                decision = _emitter.Decide(publish.Topic, publish.Payload, ut);
            }
            catch (Exception ex)
            {
                FailSoftChannel(publish.Topic, ex);
                return;
            }
            if (decision.ShouldEmit)
            {
                // Event-driven publish rides the SAME reveal gate as a
                // Tick-driven channel. comms.delay (the production delay
                // authority: CommsCoreUplink publishes it via a Publisher) is
                // TrueNow, so it records live and updates the gate's delay here;
                // a Delayed publish is buffered and released by a subsequent
                // Tick's FlushReveal (ProcessPublish carries no clock advance
                // of its own: the horizon only moves on Tick).
                Emit(publish.Topic, decision.Value, ut);
            }
        }

        private void ProcessDispatchCommand(DispatchCommandJob job)
        {
            // IMPORTANT-A: an unknown command AND a command whose owning
            // uplink has gone Unavailable are treated identically at the WIRE
            // level, one "unknown/unavailable command" refusal code. They are
            // told apart only in the sentence an operator reads, because the
            // two ask for different things to be looked at: a version skew
            // versus one named uplink that has failed.
            //
            // Refused rather than dropped, because silence here is
            // indistinguishable from a command still in flight from every
            // consumer's vantage. The client's loss timer would reject the
            // promise as "signal-lost" when the link was fine, and the
            // operator's queue could not call it a failure at all: this exit
            // returns BEFORE the pending bookkeeping below, so there is no queue
            // entry to classify and the path was never down. The blast radius is
            // an uplink, not a command: one throwing mapper marks its owning
            // uplink Unavailable and every command that uplink owns lands here,
            // so a whole widget fails while the board shows a healthy link.
            // BOTH stores. They are deliberately disjoint at invoke time, and this
            // gate reading only one of them refuses every vantage-aware command
            // before its handler is reached, with the same sentence a command that
            // does not exist gets. Adding a handler store means finding every
            // reader of the existing one, and this is the easiest reader to miss.
            if (!IsCommandAvailable(job.Command)
                || (!_commandHandlers.ContainsKey(job.Command)
                    && !_vantageCommandHandlers.ContainsKey(job.Command)))
            {
                job.OnRefused?.Invoke(RefusalReason(job.Command));
                job.Done?.Set();
                return;
            }

            // Declared gates, evaluated before the handler runs and before the
            // Courier is involved, from the declaration alone. No actuator
            // performs a facility check: an actuator that did would be a second
            // source of truth able to disagree with the declaration the
            // addressability set is published from.
            //
            // Inert until a command declares a requirement: Requires defaults
            // empty, so EvaluateGates returns Pass on the first check.
            var gate = EvaluateGates(job.Command, new GateArguments(job.Args));
            if (gate.Outcome == GateOutcome.Fail)
            {
                // A DECIDED refusal: the gate looked at live state and the answer
                // was no. It rides the normal result channel as a failed
                // CommandResult, so the client lands in `refused` with the
                // comparison attached.
                //
                // Deliberately NOT OnRefused, which emits an E_UNAVAILABLE error
                // frame: that lands the client in `failed`, where
                // classifyCommandRejection reports "the machinery broke, a retry
                // may work". A limit breach is neither of those things. Nothing
                // broke, and no number of retries moves a limit.
                job.OnResult(GateRefusalResult(gate));
                job.Done?.Set();
                return;
            }
            if (gate.Outcome != GateOutcome.Pass)
            {
                // Abstain cannot mean "allow" here. It means a requirement
                // declared an argument path this call did not carry, so the gate
                // could not be evaluated on a REAL dispatch, which is a bad
                // declaration or a malformed call rather than a permission. Same
                // treatment as Unknown: refuse and say so, per fail-closed.
                //
                // These two stay on the error-frame path deliberately. Neither
                // decided anything, so neither is a refusal an operator can act
                // on: they are a bad declaration or unreadable live state, which
                // IS the machinery-broke class, and the prose naming the cause is
                // the whole value of them.
                job.OnRefused?.Invoke(GateRefusalReason(job.Command, gate));
                job.Done?.Set();
                return;
            }

            var delayed = !_commandDeclarations.TryGetValue(job.Command, out var declaration) || declaration.Delayed;

            if (!delayed)
            {
                // Ground infrastructure (e.g. kerbcast negotiate): bypasses
                // the Courier's light-time delay model entirely: see the
                // design doc §4.3. Routed through InvokeCommandHandler (the
                // SAME funnel the delayed path uses via
                // Courier.SetCommandHandler) so a throwing handler
                // fail-softs its own uplink instead of killing the
                // Courier thread: the CRITICAL-2 fix.
                var result = InvokeCommandHandler(job.Command, job.Args, job.Vantage);
                job.OnResult(result);
                job.Done?.Set();
                return;
            }

            // Comms-loss uplink gate: honest silence. A DELAYED command (a kOS
            // keystroke, a vessel actuation) dispatched while the link is DOWN
            // must be DROPPED (no execute, no response), symmetric with the
            // reveal gate freezing the DOWNLINK on disconnect (see
            // RevealDelayFor's !_commsConnected freeze). Without this the command
            // would ride the Courier's light-time delay and reach the vessel
            // after the blackout as if it never happened, the live-observed bug
            // where keystrokes still reached the CPU during signal loss.
            // _commsConnected is Courier-thread state (set by the tick job in
            // ApplyConnectivity), read here on that same thread.
            if (!SubjectConnected(NodeId))
            {
                job.Done?.Set();
                return;
            }

            // Uplink signal delay: a delayed command must reach the craft at
            // t0 + the LIVE one-way signal delay, symmetric with the downlink
            // reveal gate (RevealDelayFor). Without this the Courier used its
            // fixed network hop (0 in production), so keystrokes and vessel
            // actuation reached the craft near-instantly while the downlink
            // respected the full delay. When there is no live signal delay
            // (source absent, or magnitude NaN/Inf/≤0: same cases RevealDelayFor
            // collapses to "reveal live"), pass null so the Courier keeps its
            // historical network-hop delay.
            // Command delay now rides the same per-(vantage, node) ledger as
            // telemetry (Plan 1): DelayTo(vantage, node) == the whole-network
            // default == the live signal delay (driven by SetDefaultDelay in
            // CaptureSignalDelay). Used for the pending-uplink prediction here
            // and, via the Courier's own DelayTo fallback below, for the actual
            // round-trip. NaN/Inf/<=0 already collapse to 0 inside SetDefaultDelay.
            var uplinkDelay = _network.DelayTo(job.Vantage, NodeId);

            var requestId = NextRequestId();

            // Ground-side pending-uplink bookkeeping (system.uplink.pending) --
            // prediction-only, dispatch-time facts only (see PendingUplink's
            // doc comment). Only a genuinely delayed dispatch (a live signal
            // delay > 0) is worth predicting a round trip for; uplinkDelay is
            // null both when there is no live delay authority AND when it
            // resolved to <= 0 -- either way there is no meaningful "in
            // flight" window to show, so nothing is enqueued (D==0 is not
            // enqueued). Reuses the SAME requestId passed to
            // _courier.DispatchCommand below so PendingUplink.Id correlates
            // with the underlying dispatch.
            if (uplinkDelay > 0)
            {
                _pending.Add(new PendingUplink
                {
                    Id = requestId,
                    Command = job.Command,
                    Label = job.Label ?? "",
                    Topic = job.Topic ?? "",
                    // job.Vantage is a non-nullable readonly string (see
                    // DispatchCommandJob) -- no ?? needed, and adding one here
                    // regressed Roslyn's nullable-flow confidence for the
                    // later job.Vantage read passed to
                    // _courier.DispatchCommand below (CS8604).
                    Vantage = job.Vantage,
                    DispatchedAt = _clock.Now(),
                    OneWaySeconds = uplinkDelay,
                    // What the command asked for, when it is a declared control
                    // channel's write half. Still a dispatch-time fact (see
                    // PendingUplink.CommandedValue): the engine is reading the
                    // args it was handed, never the craft. Null for every other
                    // command, which is most of them.
                    CommandedValue = CommandedScalar(job),
                });
            }

            // No explicit uplinkDelaySeconds: the Courier falls back to
            // DelayTo(vantage, node) -- the same ledger delay used above -- so
            // telemetry and command delay share one per-(vantage, node) model.
            _courier.DispatchCommand(NodeId, requestId, job.Command, job.Args, job.Vantage, response =>
            {
                job.OnResult(response.Result);
                job.Done?.Set();
            });
        }

        /// <summary>
        /// The scalar a control-channel write carried, or null.
        /// </summary>
        ///
        /// <remarks>
        /// The command-to-value-key map is reflected ONCE and cached: it is a
        /// fact about the contract assembly's attributes, so it cannot change
        /// while the mod is loaded, and reflecting per dispatch would put a
        /// type walk on the command path.
        /// </remarks>
        private double? CommandedScalar(DispatchCommandJob job)
        {
            _controlChannelValueKeys ??= ControlChannelDescriptor.ValueKeyByCommand();
            return _controlChannelValueKeys.TryGetValue(job.Command, out var key)
                ? ControlChannelDescriptor.ScalarFrom(job.Args, key)
                : null;
        }

        private IReadOnlyDictionary<string, string> _controlChannelValueKeys;

        private string NextRequestId() => "c" + Interlocked.Increment(ref _requestSeq);

        /// <summary>
        /// Ages out every <see cref="PendingUplink"/> whose PREDICTED round
        /// trip (<c>DispatchedAt + 2*OneWaySeconds</c>) is now in the past,
        /// called every <see cref="ProcessTick"/>, BEFORE the channel loop, so
        /// <see cref="_pending"/> stays bounded even with zero subscribers and
        /// a subscriber always sees the current pruned list. Deliberately NOT
        /// tied to the real command completing/executing: see
        /// <see cref="PendingUplink"/>'s prediction-only doc comment.
        /// </summary>
        private void PrunePendingUplinks(double ut)
        {
            if (_pending.Count == 0)
            {
                return;
            }
            _pending.RemoveAll(entry => ut > entry.DispatchedAt + (2 * entry.OneWaySeconds));
        }

        private void ProcessSubscribe(ClientSession session, string topic)
        {
            // MEDIUM-3: gate on any DECLARED channel (_channelDeclarations),
            // not just source-backed ones (_channelSources): a
            // Publisher(topic)-only channel (event-driven, no
            // AddChannelSource mapper) is a legitimate channel too, and used
            // to be permanently unsubscribable because this check only ever
            // recognized the pull-style half of the two ways a channel can
            // be backed (see IUplinkHost.AddChannelSource vs. Publisher).
            //
            // A topic that isn't declared yet but falls under a registered
            // dynamic namespace (see RegisterDynamicNamespace) is ALSO a
            // legitimate subscribe target: materialize its declaration now
            // so a subscriber that connects before the uplink's first
            // publish to this exact sub-topic still succeeds, instead of
            // being permanently rejected for a topic that simply hasn't
            // emitted yet.
            if (!_channelDeclarations.ContainsKey(topic))
            {
                var dynamicPrefix = FindDynamicNamespaceForTopic(topic);
                if (dynamicPrefix == null)
                {
                    return;
                }
                EnsureDynamicTopicDeclared(dynamicPrefix, topic);
            }

            if (session.Unsubscribers.ContainsKey(topic))
            {
                return;
            }

            // A genuine 0 -> 1 subscriber transition: force an immediate
            // keyframe on the emitter's NEXT Decide call for THIS topic so a
            // newly-joined subscriber doesn't wait out whatever fraction of
            // the keyframe cadence remains.
            if (_subscriptions.Subscribe(topic))
            {
                _subscribedTopics[topic] = 0;
                _emitter.NotifySubscribed(topic);
            }

            // Instant/exempt topics ride the meta-vantage (DelayTo -> 0) so the
            // ledger never applies the whole-network signal delay to them; the
            // gate keeps their own delay semantics (comms.delay 0, comms.link and
            // fleet.<guid>.contact last-connected-delay, TrueNow 0). Ordinary
            // Delayed topics keep the real per-connection vantage, which the
            // ledger delays (Plan 1). A contact topic that kept the ordinary
            // vantage would be delayed TWICE: once by its own exempt horizon in
            // the gate, then again by the ledger's live per-vessel row.
            var isInstantClass = topic == CommsDelayTopic
                || IsFreezeExempt(topic)
                || _channelDeclarations[topic].Delay == DelayRole.TrueNow;
            var vantage = isInstantClass ? MetaVantage : session.SelectedVantage;
            if (isInstantClass)
            {
                // MetaVantage promises DelayTo(meta, *) == 0, but the constructor
                // can only pin the one node it knows up front ("system"); a
                // fleet.<guid> node is minted later by the fleet capture, and an
                // unpinned pair falls through to that node's own routed
                // light-time. Pinning here, at the single point where a topic is
                // routed onto the meta vantage, is what stops an exempt channel
                // being delayed once by its own gate horizon and then a second
                // time by the ledger.
                _network.SetDelay(MetaVantage, NodeFor(topic), 0.0);
            }
            var delivery = _channelDeclarations[topic].Delivery;

            Action unsubscribe;
            try
            {
                unsubscribe = _courier.SubscribeStream(NodeFor(topic), topic, vantage, streamData =>
                {
                    // C2-2(b): streamData.Payload is uplink-authored --
                    // some CLR shapes JsonWriter can never serialize (an
                    // arbitrary POCO, not a recognized numeric/string/
                    // dictionary/enumerable). This closure is invoked for
                    // EVERY delivery to this subscriber (both the
                    // synchronous subscribe-time catch-up below AND every
                    // later Courier-scheduled delivery), so guarding it here
                    // fail-softs the owning uplink on the FIRST failed
                    // serialization instead of the throw recurring silently,
                    // unattributed, on every subsequent tick.
                    byte[] bytes;
                    try
                    {
                        var json = EnvelopeCodec.WriteStreamData(streamData);
                        bytes = Encoding.UTF8.GetBytes(json);
                    }
                    catch (Exception ex)
                    {
                        FailSoftChannel(topic, ex, "payload could not be serialized");
                        PublishPayloadSerializationError(session, topic, streamData.Payload, ex);
                        return;
                    }

                    // A replayed sample rides the FIFO lane whatever the channel
                    // declared, because the declaration is about LIVE state and
                    // this is history. LossyLatest is correct for a state topic
                    // in flight: only the newest reading matters, so the outbox
                    // coalescing per topic loses nothing. A blackout dump is the
                    // exact opposite shape, many readings each meaningful and
                    // none superseded, so coalescing it deletes the outage window
                    // one layer below the gate that just took care to keep it.
                    // Measured: a 1200-sample dump arrived as 242 frames.
                    if (delivery == Delivery.ReliableOrdered
                        || streamData.Meta.Staleness == Staleness.Recorded)
                    {
                        // Reliable-ordered: rides the outbox's FIFO lane, never
                        // coalesced away: see Delivery's doc comment.
                        session.Outbox.PublishReliable(bytes);
                    }
                    else
                    {
                        session.Outbox.PublishTelemetry(topic, bytes);
                    }
                });
            }
            catch (Exception ex)
            {
                // C2-3: SubscribeStream's own synchronous catch-up delivery
                // (of an already-archived sample) runs INSIDE this call,
                // before it returns: a throw here (from anywhere in that
                // window, not just the onData closure above, which now
                // guards itself) would otherwise unwind AFTER
                // _subscriptions.Subscribe/the Courier's own subscriber-set
                // add above but BEFORE session.Unsubscribers[topic] and the
                // ack below are ever reached: an orphaned subscriber with no
                // ack and no bookkeeping for ProcessDisconnect to clean up
                // later. Roll back the registry-level subscribe so no
                // orphaned count survives, fail-soft the owning uplink,
                // and bail out WITHOUT setting Unsubscribers/sending an ack,
                // the client's subscribe simply never completes, matching
                // "unavailable channel" behavior elsewhere in this class.
                if (_subscriptions.Unsubscribe(topic))
                {
                    _subscribedTopics.TryRemove(topic, out _);
                }
                FailSoftChannel(topic, ex);
                return;
            }

            session.Unsubscribers[topic] = unsubscribe;

            // Gap A (terminal-integrity adversarial review): notify EVERY
            // individual session subscribe, not just a genuine aggregate
            // 0->1 transition (_subscriptions.Subscribe's return above) --
            // a second simultaneous viewer, or a resubscribe faster than a
            // polling consumer's own cadence, both still need to be seen as
            // distinct events by a listener like the kOS terminal's
            // full-repaint reseed. Placed AFTER the subscribe stream setup
            // succeeds (mirroring the C2-3 rollback above) so a throw
            // during SubscribeStream's synchronous catch-up still rolls
            // back cleanly without ever notifying a listener for a
            // subscribe that didn't actually complete.
            NotifyDynamicNamespaceSubscribed(topic);

            var ack = new EventMsg
            {
                Topic = topic,
                Name = "subscribed",
                Meta = new Meta
                {
                    Source = NodeId,
                    Vantage = vantage,
                    ValidAt = _clock.Now(),
                    DeliveredAt = _clock.Now(),
                    Seq = ++_ackSeq,
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = _courier.CurrentEpoch,
                },
            };
            session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteEventMsg(ack)));
        }

        /// <summary>
        /// Courier-thread-only: notify every currently connected session,
        /// once per topic it is subscribed to, that the timeline was reset
        /// (quickload UT-rewind): the same <see cref="EventMsg"/> shape
        /// (<c>name: "timeline-reset"</c>) <c>GonogoBodiesServer</c>/
        /// <c>ReplayBodiesServer</c> both broadcast for their single topic,
        /// generalized to fire once per (session, subscribed topic) pair so
        /// a multi-channel client can tell exactly which of its
        /// subscriptions needs to resync/abandon its delayed view.
        /// </summary>
        private void BroadcastTimelineReset()
        {
            foreach (var session in _sessions.Values)
            {
                foreach (var topic in session.Unsubscribers.Keys.ToArray())
                {
                    // LOW-4 (cross-lane ordering): a lossy-latest sample
                    // recorded on the OLD (now-abandoned) timeline can
                    // already be sitting in this session's outbox, written
                    // by a delivery that fired moments before this reset was
                    // detected, still waiting for the independent pump
                    // thread to drain it: and would otherwise reach the
                    // wire AFTER the timeline-reset event below, showing
                    // stale data. Clearing it here (before the reset event
                    // is queued) guarantees no pre-reset frame for this
                    // topic can drain post-reset; it's a genuine no-op if
                    // nothing was pending.
                    session.Outbox.ClearTopic(topic);

                    var reset = new EventMsg
                    {
                        Topic = topic,
                        Name = "timeline-reset",
                        Meta = new Meta
                        {
                            Source = NodeId,
                            Vantage = session.SelectedVantage,
                            ValidAt = _clock.Now(),
                            DeliveredAt = _clock.Now(),
                            Seq = ++_ackSeq,
                            Quality = Quality.OnRails,
                            Active = true,
                            Staleness = Staleness.Fresh,
                            // CurrentEpoch was already bumped (ResetTimeline
                            // increments it FIRST -- see its own doc comment)
                            // before this broadcast is reached, so this
                            // announces the NEW timeline's epoch, not the
                            // abandoned one.
                            TimelineEpoch = _courier.CurrentEpoch,
                        },
                    };
                    session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteEventMsg(reset)));
                }
            }
        }

        private void ProcessUnsubscribe(ClientSession session, string topic)
        {
            if (session.Unsubscribers.TryGetValue(topic, out var unsubscribe))
            {
                unsubscribe();
                session.Unsubscribers.Remove(topic);
                if (_subscriptions.Unsubscribe(topic))
                {
                    _subscribedTopics.TryRemove(topic, out _);
                }
                CleanUpSubjectIfGone(topic); // Plan 2b addition 2: drop a gone fleet subject's freeze maps.
            }
        }

        private void ProcessDisconnect(ClientSession session)
        {
            foreach (var topic in session.Unsubscribers.Keys)
            {
                if (_subscriptions.Unsubscribe(topic))
                {
                    _subscribedTopics.TryRemove(topic, out _);
                }
            }
            // After all this session's topics leave the subscribed mirror, drop
            // any fleet subject whose last topic just went away (Plan 2b addition 2).
            foreach (var topic in session.Unsubscribers.Keys)
            {
                CleanUpSubjectIfGone(topic);
            }
            foreach (var unsubscribe in session.Unsubscribers.Values)
            {
                unsubscribe();
            }
            session.Unsubscribers.Clear();
        }

        // ----------------------------------------------------------------
        // Socket domain (Fleck's connection threads)
        // ----------------------------------------------------------------

        private void OnClientConnected(ITransportConnection connection)
        {
            var session = new ClientSession(connection);
            _sessions[connection.Id] = session;

            connection.MessageReceived += payload => OnMessageReceived(session, payload);
            connection.Closed += () => OnConnectionClosed(session);
        }

        private void OnMessageReceived(ClientSession session, ArraySegment<byte> payload)
        {
            var text = Encoding.UTF8.GetString(payload.Array!, payload.Offset, payload.Count);
            try
            {
                var msg = EnvelopeCodec.ParseClientMessage(text);
                switch (msg)
                {
                    case Subscribe sub:
                        EnqueueJob(new SubscribeJob(session, sub.Topic));
                        break;
                    case Unsubscribe unsub:
                        EnqueueJob(new UnsubscribeJob(session, unsub.Topic));
                        break;
                    case SetVantage sv:
                        HandleSetVantage(session, sv);
                        break;
                    case CommandRequest<object?> req:
                        // Per-call vantage override (delay-UX): a command may pin its
                        // own dispatch vantage (e.g. "meta" for program-meta acts that
                        // must stay instant regardless of the selected centre); empty
                        // falls back to the connection's session vantage.
                        DispatchCommand(
                            req.Command,
                            req.Args,
                            string.IsNullOrEmpty(req.Vantage) ? session.SelectedVantage : req.Vantage,
                            result =>
                        {
                            // C2-4: `result` is whatever the uplink's
                            // command handler returned -- uplink-owned,
                            // same as a channel payload. This serialization
                            // sits OUTSIDE InvokeCommandHandler's guard: it
                            // runs here, in the RESULT callback, not inside the
                            // handler call itself, so unguarded an
                            // unserializable result throws unattributed and the
                            // client gets no response at all, not even an
                            // error, which is true silence. Guarded the same way
                            // as every other uplink-value touch point:
                            // fail-soft the owning command's uplink and send an
                            // explicit error response rather than dropping the
                            // reply on the floor.
                            try
                            {
                                var response = new CommandResponse<object?>
                                {
                                    RequestId = req.RequestId,
                                    Result = result,
                                    Meta = new Meta
                                    {
                                        Source = NodeId,
                                        Vantage = session.SelectedVantage,
                                        ValidAt = req.SentAt,
                                        DeliveredAt = _clock.Now(),
                                        Seq = Interlocked.Increment(ref _ackSeq),
                                        Quality = Quality.OnRails,
                                        Active = true,
                                        Staleness = Staleness.Fresh,
                                        // Defect B fix: this callback runs
                                        // synchronously, on the Courier
                                        // thread, at the exact instant the
                                        // command resolved (either the
                                        // same job-processing step for a
                                        // delayed:false command, or the
                                        // Courier's own ConfirmUt callback
                                        // for a delayed:true one) -- so
                                        // _courier.CurrentEpoch read HERE is
                                        // guaranteed to match whatever epoch
                                        // was current when the Courier
                                        // itself resolved this command (a
                                        // rewind can never race in between:
                                        // ResetTimeline drops every in-flight
                                        // PendingCommand, so this callback
                                        // could not still be about to fire
                                        // for an abandoned-timeline
                                        // dispatch). Reading the epoch off the
                                        // Courier rather than hand-rolling this
                                        // Meta is what keeps it off the wire
                                        // default of 0, which is what a
                                        // hand-rolled one carries even after a
                                        // rewind has bumped the Courier
                                        // forward.
                                        TimelineEpoch = _courier.CurrentEpoch,
                                    },
                                };
                                session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteCommandResponse(response)));
                            }
                            catch (Exception ex)
                            {
                                FailSoftCommand(req.Command, ex);
                                var error = new ErrorMsg
                                {
                                    RequestId = req.RequestId,
                                    Code = "result-serialization-error",
                                    Message = $"command \"{req.Command}\" result could not be serialized: {ex.Message}",
                                };
                                session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteErrorMsg(error)));
                            }
                        }, req.Label, req.Topic, onRefused: reason =>
                        {
                            // The dispatch never reached a handler (unknown
                            // command, or its uplink has fail-softed). An
                            // ErrorMsg rather than a CommandResponse carrying a
                            // failure, because no handler ran: the same category
                            // as PeerTransport's E_PEER_DISCONNECTED, a dispatch
                            // that could not be carried. It lands the client in
                            // `failed` with a code, instead of `confirmed` with a
                            // refusal buried in a payload, and it cancels the
                            // loss timer so the promise never rejects as
                            // "signal-lost" for a link that was up the whole time.
                            var error = new ErrorMsg
                            {
                                RequestId = req.RequestId,
                                Code = "E_UNAVAILABLE",
                                Message = reason,
                            };
                            session.Outbox.PublishReliable(Encoding.UTF8.GetBytes(EnvelopeCodec.WriteErrorMsg(error)));
                        });
                        break;
                }
            }
            catch (FormatException)
            {
                // Not a recognized envelope: echo back unchanged, matching
                // GonogoBodiesServer's diagnostic behavior for a stray message.
                session.Connection.TrySend(payload, SendClass.Response);
            }
        }

        private void OnConnectionClosed(ClientSession session)
        {
            _sessions.TryRemove(session.Connection.Id, out _);
            EnqueueJob(new DisconnectJob(session));
            session.Outbox.Stop();
        }

        private void EnqueueJob(IEngineJob job)
        {
            _jobs.Enqueue(job);
            _jobSignal.Release();
        }

        // ----------------------------------------------------------------
        // Job types
        // ----------------------------------------------------------------

        private interface IEngineJob
        {
        }

        private sealed class TickJob : IEngineJob
        {
            public readonly double Ut;
            public readonly KspSnapshot? Snapshot;

            // Captured-on-main-thread payloads for every registered
            // AddSampledSource, produced by RunCaptures on the main-loop
            // thread before this job was enqueued, consumed by ProcessTick's
            // capture loop on the Courier thread. Null when no sampled source
            // is registered (or none produced a capture this tick).
            public readonly CapturedSample[]? Captures;

            // AUTHORITATIVE signal-delay computed on the main-loop thread by
            // CaptureSignalDelayOnMain (see _signalDelaySource) and applied to
            // the reveal gate in ProcessTick before the channel loop. Default
            // (both fields null) when no delay source is registered.
            public readonly SignalDelayCapture SignalDelay;

            // Freeze-on-disconnect: CONNECTED/DISCONNECTED computed on the
            // main-loop thread by CaptureConnectivityOnMain (see
            // _connectivitySource) and applied to the reveal gate in ProcessTick
            // before the channel loop. Default (Value null, Error null) when no
            // connectivity source is registered, the gate stays CONNECTED.
            public readonly ConnectivityCapture Connectivity;

            // The DROP EVENT for this tick, computed on the main-loop thread by
            // CapturePathBreakOnMain (see _pathBreakSource) and spent in
            // ProcessTick on INetwork.DropPath before the clock advances.
            // Default (Value null, Error null) when no source is registered.
            public readonly PathBreakCapture PathBreak;
            public readonly ManualResetEventSlim? Done;
            public TickJob(double ut, KspSnapshot? snapshot, CapturedSample[]? captures, SignalDelayCapture signalDelay, ConnectivityCapture connectivity, PathBreakCapture pathBreak, ManualResetEventSlim? done)
            {
                Ut = ut;
                Snapshot = snapshot;
                Captures = captures;
                SignalDelay = signalDelay;
                Connectivity = connectivity;
                PathBreak = pathBreak;
                Done = done;
            }
        }

        /// <summary>
        /// One server-side connectivity computation carried from the main-loop
        /// thread to the Courier thread (see <see cref="CaptureConnectivityOnMain"/>).
        /// Twin of <see cref="SignalDelayCapture"/>: a non-null <see cref="Error"/>
        /// means the source threw and its owning uplink is fail-softed Courier-
        /// side; a null <see cref="Value"/> with null <see cref="Error"/> means
        /// "no source / nothing computed this tick" and leaves the last-known
        /// connectivity untouched.
        /// </summary>
        private readonly struct ConnectivityCapture
        {
            public readonly bool? Value;
            public readonly Exception? Error;
            public ConnectivityCapture(bool? value, Exception? error)
            {
                Value = value;
                Error = error;
            }
        }

        /// <summary>
        /// One server-side signal-delay computation carried from the main-loop
        /// thread to the Courier thread (see <see cref="CaptureSignalDelayOnMain"/>).
        /// At most one of <see cref="Value"/> / <see cref="Error"/> is
        /// meaningful: a non-null <see cref="Error"/> means the source threw on
        /// the main-loop thread and its owning uplink must be fail-softed
        /// Courier-side; a null <see cref="Value"/> with null <see cref="Error"/>
        /// means "no source registered / nothing computed this tick" and leaves
        /// the last-known delay untouched.
        /// </summary>
        private readonly struct SignalDelayCapture
        {
            public readonly CommsDelay? Value;
            public readonly Exception? Error;
            public SignalDelayCapture(CommsDelay? value, Exception? error)
            {
                Value = value;
                Error = error;
            }
        }

        private readonly struct PathBreakCapture
        {
            public readonly PathBreak? Value;
            public readonly Exception? Error;
            public PathBreakCapture(PathBreak? value, Exception? error)
            {
                Value = value;
                Error = error;
            }
        }

        /// <summary>
        /// One <see cref="AddSampledSource"/> capture's result carried from the
        /// main-loop thread to the Courier thread. <see cref="Index"/> keys
        /// back into <see cref="_sampledSources"/> (stable after Start).
        /// Exactly one of <see cref="Value"/> / <see cref="Exception"/> is
        /// meaningful: a non-null <see cref="Exception"/> means the capture
        /// threw on the main-loop thread and the Courier-side handle must be
        /// skipped and fail-softed.
        /// </summary>
        private readonly struct CapturedSample
        {
            public readonly int Index;
            public readonly object? Value;
            public readonly Exception? Exception;
            public CapturedSample(int index, object? value, Exception? exception)
            {
                Index = index;
                Value = value;
                Exception = exception;
            }
        }

        /// <summary>
        /// A registered capture-on-main / handle-on-Courier source (see
        /// <see cref="IUplinkHost.AddSampledSource"/>). <see cref="Disabled"/>
        /// is the single mutable-after-start field, a volatile bool so the
        /// main-loop thread (RunCaptures) and Courier thread (ProcessTick /
        /// fail-soft) can read/write it without a lock; everything else is set
        /// once at registration (before Start) and only read afterward.
        /// </summary>
        private sealed class SampledSource
        {
            public readonly string OwnerId;
            public readonly Func<KspSnapshot?, object?> Capture;
            public readonly Action<object?> Handle;

            // Channel-topic prefixes this source PRODUCES. When non-empty,
            // RunCaptures skips Capture on any tick where no subscribed topic
            // starts with one of these (see AddSampledSource's prefix overload).
            // Empty => never gated (original always-capture behaviour). Set once
            // at registration, only read afterward.
            public readonly string[] TopicPrefixes;
            public volatile bool Disabled;

            // Consecutive capture-throw streak, Courier-thread-owned (touched only
            // in ProcessTick's capture loop). A capture throw is treated as
            // TRANSIENT (retry next tick) rather than permanently disabling the
            // source: the SCANsat "coverage never surfaces" root cause was an
            // early Planetarium-not-ready capture throw permanently disabling the
            // sampler. Reset to 0 on the next successful capture.
            public int ConsecutiveCaptureThrows;

            public SampledSource(string ownerId, Func<KspSnapshot?, object?> capture, Action<object?> handle, string[] topicPrefixes)
            {
                OwnerId = ownerId;
                Capture = capture;
                Handle = handle;
                TopicPrefixes = topicPrefixes;
            }
        }

        /// <summary>
        /// One change-gated (UT, value) decision held in the reveal gate's
        /// <see cref="_revealBuffer"/> until its channel's horizon reaches
        /// <see cref="Ut"/>: see <see cref="Emit"/>/<see cref="FlushReveal"/>.
        /// </summary>
        private readonly struct BufferedReveal
        {
            public readonly double Ut;
            public readonly object? Value;

            // The effective reveal delay captured at ENQUEUE time (see Emit),
            // NOT re-read at flush. FlushReveal computes this entry's horizon as
            // (now − Delay), so each entry matures on the horizon that was in
            // force when it was buffered, and a later flap of the delay
            // authority down to 0 (comms.delay momentarily dropping to
            // CommsDelaySource.None mid-buffer, say) cannot prematurely reveal a
            // still-future buffered sample. Always > 0: a sample whose delay was
            // ≤ 0 is recorded live in Emit and never reaches the buffer.
            public readonly double Delay;
            public BufferedReveal(double ut, object? value, double delay)
            {
                Ut = ut;
                Value = value;
                Delay = delay;
            }
        }

        private sealed class PublishJob : IEngineJob
        {
            public readonly string Topic;
            public readonly object? Payload;
            public readonly double Ut;
            public PublishJob(string topic, object? payload, double ut)
            {
                Topic = topic;
                Payload = payload;
                Ut = ut;
            }
        }

        private sealed class DispatchCommandJob : IEngineJob
        {
            public readonly string Command;
            public readonly object? Args;
            public readonly string Vantage;
            public readonly string Label;
            public readonly string Topic;
            public readonly Action<object?> OnResult;
            /// <summary>
            /// Called instead of <see cref="OnResult"/> when the dispatch is
            /// REFUSED before any handler could run, carrying the sentence an
            /// operator reads. Null for a caller that does not care (every
            /// in-process test dispatch); the socket layer always supplies one,
            /// because a client that gets neither a result nor a refusal has
            /// no way to tell the two apart from silence.
            /// </summary>
            public readonly Action<string>? OnRefused;
            public readonly ManualResetEventSlim? Done;
            public DispatchCommandJob(string command, object? args, string vantage, Action<object?> onResult, ManualResetEventSlim? done, string label = "", string topic = "", Action<string>? onRefused = null)
            {
                Command = command;
                Args = args;
                Vantage = vantage;
                OnResult = onResult;
                OnRefused = onRefused;
                Done = done;
                Label = label;
                Topic = topic;
            }
        }

        private sealed class SubscribeJob : IEngineJob
        {
            public readonly ClientSession Session;
            public readonly string Topic;
            public SubscribeJob(ClientSession session, string topic)
            {
                Session = session;
                Topic = topic;
            }
        }

        private sealed class UnsubscribeJob : IEngineJob
        {
            public readonly ClientSession Session;
            public readonly string Topic;
            public UnsubscribeJob(ClientSession session, string topic)
            {
                Session = session;
                Topic = topic;
            }
        }

        private sealed class DisconnectJob : IEngineJob
        {
            public readonly ClientSession Session;
            public DisconnectJob(ClientSession session)
            {
                Session = session;
            }
        }

        private sealed class StopJob : IEngineJob
        {
        }

        /// <summary>
        /// F2 Part 1: one command handler invocation marshaled from the
        /// Courier thread onto the main-thread queue. Exactly one of
        /// <see cref="Result"/> / <see cref="Captured"/> is meaningful once
        /// <see cref="Done"/> is set, a non-null <see cref="Captured"/> means
        /// the handler threw on the main thread and the Courier thread
        /// re-throws it (preserving the original stack) so the existing
        /// fail-soft attribution runs. Not an <see cref="IEngineJob"/>: it
        /// rides its OWN queue (<see cref="_mainThreadCommands"/>), drained on
        /// the main thread, not the Courier's job queue.
        /// </summary>
        private sealed class MainThreadCommand
        {
            public readonly Func<object?, object?> Handler;
            public readonly object? Args;
            public object? Result;
            public System.Runtime.ExceptionServices.ExceptionDispatchInfo? Captured;
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);

            // F2-fix: set by the Courier-side waiter (RunOnMainThread) when its
            // bounded wait times out and it walks away. The pump reads this so
            // it can dispose the handle it just Set() (no waiter remains), and
            // never assumes a waiter is still listening.
            public volatile bool Abandoned;

            public MainThreadCommand(Func<object?, object?> handler, object? args)
            {
                Handler = handler;
                Args = args;
            }
        }

        private sealed class ClientSession
        {
            public readonly ITransportConnection Connection;
            public readonly ChannelOutbox Outbox;
            public readonly Dictionary<string, Action> Unsubscribers = new Dictionary<string, Action>();

            /// <summary>
            /// The command centre this connection commands from and observes at
            /// (Plan 3 vantage selection). Governs BOTH the downlink cursor read
            /// (<c>ReadAtVantage(topic, SelectedVantage, ...)</c>) and the command
            /// dispatch vantage (<c>DelayTo(SelectedVantage, node)</c>). Defaults to
            /// <see cref="DefaultVantage"/> (KSC); set by the set-vantage message.
            /// </summary>
            public string SelectedVantage = DefaultVantage;

            public ClientSession(ITransportConnection connection)
            {
                Connection = connection;
                Outbox = new ChannelOutbox(connection);
            }
        }

        private sealed class ChannelPublisher : IChannelPublisher
        {
            private readonly ChannelEngine _engine;
            private readonly string _topic;

            public ChannelPublisher(ChannelEngine engine, string topic)
            {
                _engine = engine;
                _topic = topic;
            }

            public void Publish(object? payload, double ut) => _engine.Publish(_topic, payload, ut);
        }

        private sealed class DynamicChannelSource : IDynamicChannelSource
        {
            private readonly ChannelEngine _engine;
            private readonly string _prefix;

            public DynamicChannelSource(ChannelEngine engine, string prefix)
            {
                _engine = engine;
                _prefix = prefix;
            }

            public IChannelPublisher Publisher(string subTopic)
            {
                var fullTopic = _prefix + subTopic;
                _engine.EnsureDynamicTopicDeclared(_prefix, fullTopic);
                return new ChannelPublisher(_engine, fullTopic);
            }

            public void OnSubscribed(Action<string> callback)
            {
                if (callback == null)
                {
                    throw new ArgumentNullException(nameof(callback));
                }
                _engine.AddDynamicNamespaceSubscribeListener(_prefix, callback);
            }
        }
    }

    /// <summary>
    /// The Courier -&gt; socket queue crossing for one connection, the
    /// engine's copy of <c>Gonogo.KSP.GonogoOutbox</c> /
    /// <c>Sitrep.Host.IntegrationTests.ReplayOutbox</c> /
    /// <c>Sitrep.Skeleton.ConnectionOutbox</c> (all <c>internal</c> to their
    /// own assemblies and so not reusable here; see those classes' doc
    /// comments for the full lossy-latest-telemetry / reliable-FIFO-response
    /// rationale, unchanged here).
    /// </summary>
    internal sealed class ChannelOutbox
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

        private readonly ITransportConnection _connection;
        private readonly ConcurrentDictionary<string, byte[]> _latestByTopic = new ConcurrentDictionary<string, byte[]>();
        private readonly ConcurrentQueue<byte[]> _reliable = new ConcurrentQueue<byte[]>();
        private readonly SemaphoreSlim _signal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _pumpThread;
        private volatile bool _stopping;

        public ChannelOutbox(ITransportConnection connection)
        {
            _connection = connection;
            _pumpThread = new Thread(PumpLoop) { IsBackground = true, Name = "Sitrep-ChannelEngine-Outbox-" + connection.Id };
            _pumpThread.Start();
        }

        /// <summary>Courier-thread-only: publish the latest serialized telemetry frame for a topic. Never blocks. Coalesces, a later call before the pump drains replaces the earlier one.</summary>
        public void PublishTelemetry(string topic, byte[] payload)
        {
            _latestByTopic[topic] = payload;
            _signal.Release();
        }

        /// <summary>Courier-thread-only: enqueue a reliable (never-dropped, never-coalesced) frame, acks, echoes, command responses, and reliable-ordered channel samples.</summary>
        public void PublishReliable(byte[] payload)
        {
            _reliable.Enqueue(payload);
            _signal.Release();
        }

        /// <summary>
        /// Courier-thread-only: drop any currently-queued (not yet pumped)
        /// lossy-latest frame for <paramref name="topic"/>: the LOW-4
        /// timeline-reset fix. Called from <c>ChannelEngine.BroadcastTimelineReset</c>
        /// for every topic a session is subscribed to, right before the
        /// reset event itself is queued, so an abandoned pre-reset frame can
        /// never drain to the wire after that event. A genuine no-op if
        /// nothing was queued for the topic (the common case).
        /// </summary>
        public void ClearTopic(string topic) => _latestByTopic.TryRemove(topic, out _);

        /// <summary>Test-only: whether a lossy-latest frame is currently queued (not yet pumped) for <paramref name="topic"/>. See <see cref="ChannelEngine.AnySessionHasQueuedFrame"/>.</summary>
        internal bool HasQueuedFrame(string topic) => _latestByTopic.ContainsKey(topic);

        private void PumpLoop()
        {
            while (true)
            {
                _signal.Wait(PollInterval);

                if (_stopping && _reliable.IsEmpty && _latestByTopic.IsEmpty)
                {
                    return;
                }

                while (_reliable.TryDequeue(out var reliableMsg))
                {
                    _connection.TrySend(new ArraySegment<byte>(reliableMsg), SendClass.Response);
                }

                foreach (var topic in _latestByTopic.Keys.ToArray())
                {
                    if (!_latestByTopic.TryRemove(topic, out var payload))
                    {
                        continue;
                    }
                    _connection.TrySend(new ArraySegment<byte>(payload), SendClass.Telemetry);
                }
            }
        }

        /// <summary>Signals the pump thread to drain and exit, non-blocking, safe from any thread.</summary>
        public void Stop()
        {
            _stopping = true;
            _signal.Release();
        }
    }
}
