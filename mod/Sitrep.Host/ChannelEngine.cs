using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Transport;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host
{
    /// <summary>
    /// The multi-topic generalization of <c>Gonogo.KSP.GonogoBodiesServer</c> /
    /// <c>Sitrep.Host.IntegrationTests.ReplayBodiesServer</c> (both retired —
    /// see <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c>
    /// §1.2/§6.1). Owns EVERYTHING those two paired, hand-copied classes
    /// owned — the <see cref="SubscriptionRegistry"/> outer gate, the
    /// per-topic <see cref="ChannelEmitter"/> inner gate, the <see cref="Courier"/>
    /// + delay, the timeline-reset broadcast, and the three-domain threading
    /// model (main-loop / Courier / socket) — but drives a SET of channels
    /// and commands registered by <see cref="ISitrepUplink"/>s, not one
    /// hardwired <c>system.bodies</c> topic. This is the design doc's central
    /// rule made concrete: "providers are registered mappers; the engine owns
    /// the pipeline."
    ///
    /// KSP is never touched here — same discipline <c>GonogoBodiesServer</c>
    /// followed: the caller (<c>GonogoAddon.FixedUpdate</c> in production, a
    /// test driver headlessly) samples <see cref="IKspHost"/> and hands the
    /// already-built <see cref="KspSnapshot"/> to <see cref="Tick"/>, which
    /// only ever touches primitives, registered mapper delegates, and the
    /// explicit job queue.
    /// </summary>
    public sealed class ChannelEngine : IUplinkHost, IDisposable
    {
        public const string NodeId = "system";

        private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(50);

        /// <summary>
        /// C1-pub tolerance: <see cref="ProcessPublish"/> clamps a
        /// caller-stamped <c>ut</c> that lands meaningfully ahead of the
        /// clock's current position at processing time. A tiny epsilon
        /// (rather than an exact `&gt;`) absorbs floating-point noise only --
        /// it is NOT meant to tolerate genuine slack between when an
        /// uplink reads "now" and when its Publish call is processed.
        /// </summary>
        private const double PublishUtToleranceSeconds = 1e-6;

        private readonly ManualClock _clock;
        private readonly INetwork _network;
        private readonly Courier _courier;
        private readonly FleckTransportListener _listener;
        private readonly Kernel _kernel = new Kernel();

        private readonly ConcurrentQueue<IEngineJob> _jobs = new ConcurrentQueue<IEngineJob>();
        private readonly SemaphoreSlim _jobSignal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _courierThread;

        // F2 Part 1 (main-thread command execution): when true, a command
        // handler is NOT run inline on the Courier thread but marshaled onto
        // this queue, drained by RunPendingCommands on the Unity main thread
        // (GonogoAddon.FixedUpdate). The Courier thread blocks on the queued
        // job's completion signal and returns its typed result — the symmetric
        // WRITE-side twin of F1's capture-on-main / handle-on-Courier read
        // seam (AddSampledSource). KSP/Unity actuation (KspVesselActuator)
        // MUST run on the main thread; calling it from the Courier thread is
        // the crash class this closes. When false (the default, and every
        // headless test that doesn't stand up a main-thread pump), handlers
        // run inline on the Courier thread exactly as before — same behavior
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
        // already stopped — closing the single-pass-flush race. Engine-level;
        // distinct from ChannelOutbox._stopping (a per-connection field).
        private volatile bool _engineStopping;

        // The OUTER (SubscriptionRegistry) / INNER (ChannelEmitter) gate pair,
        // Courier-thread-only, shared across every registered topic — both
        // classes are already keyed by channelId/topic internally, so no
        // per-topic instance is needed (see their own doc comments).
        private readonly SubscriptionRegistry _subscriptions = new SubscriptionRegistry();
        private readonly ChannelEmitter _emitter;

        private readonly Dictionary<string, ChannelDeclaration> _channelDeclarations = new Dictionary<string, ChannelDeclaration>();
        private readonly Dictionary<string, Func<KspSnapshot?, object?>> _channelSources = new Dictionary<string, Func<KspSnapshot?, object?>>();

        // Dynamic namespaces (see IUplinkHost.RegisterDynamicNamespace):
        // prefix -> (template declaration, owning uplink id). A concrete
        // "prefix + subTopic" topic is lazily materialized into
        // _channelDeclarations/_channelOwner (cloned from the template) the
        // first time it is published or subscribed — see
        // EnsureDynamicTopicDeclared/FindDynamicNamespaceForTopic. Ordered
        // by insertion is irrelevant; prefixes are matched by simple
        // StartsWith, so two prefixes where one is a prefix of the other
        // would be ambiguous — not a real concern for the small, hand-owned
        // set of dynamic namespaces this exists for today.
        private readonly Dictionary<string, ChannelDeclaration> _dynamicNamespaces = new Dictionary<string, ChannelDeclaration>();
        private readonly Dictionary<string, string> _dynamicNamespaceOwner = new Dictionary<string, string>();

        private readonly Dictionary<string, CommandDeclaration> _commandDeclarations = new Dictionary<string, CommandDeclaration>();
        private readonly Dictionary<string, Func<object?, object?>> _commandHandlers = new Dictionary<string, Func<object?, object?>>();

        // Owner travels WITH each sampler (rather than a parallel dictionary
        // keyed by the sampler instance) because a sampler has no natural
        // string key the way a channel/command topic does. Populated in
        // AddSampler from _currentRegisteringUplinkId, same mechanism
        // _channelOwner/_commandOwner use below.
        private readonly List<(string OwnerId, ISnapshotSampler Sampler)> _samplers = new List<(string OwnerId, ISnapshotSampler Sampler)>();

        // Capture-on-main / handle-on-Courier sources (see
        // IUplinkHost.AddSampledSource). Populated in AddSampledSource before
        // Start(), then only ENUMERATED afterward (RunCaptures on the
        // main-loop thread, ProcessTick's capture loop on the Courier thread)
        // — never mutated post-Start, same single-writer-before-start rule
        // the other registration collections rely on. Each entry's Disabled
        // flag IS mutated post-start (fail-soft), but it is a volatile bool
        // whose read/write is atomic across the main-loop / Courier threads
        // (see SampledSource) — the ONLY mutable-after-start cross-thread
        // state here, deliberately kept to a single atomic flag.
        private readonly List<SampledSource> _sampledSources = new List<SampledSource>();
        private readonly Dictionary<string, Availability> _availability = new Dictionary<string, Availability>();

        // Thread-safe MIRROR of "which topics currently have >=1 subscriber",
        // maintained on the Courier thread (the only writer — Process
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
        // instead of only tracking availability without ever acting on it —
        // the fail-soft half of the contract that used to be missing: a
        // throwing Register(), or a channel mapper/command handler that
        // throws at RUNTIME (see FailSoftChannel/FailSoftCommand), now takes
        // the WHOLE owning uplink's channels/commands inert together,
        // rather than leaving already-registered ones live against a
        // half-broken uplink. The sampler loop (see ProcessTick) applies
        // the exact same rule via each pair's OwnerId above.
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
        // Only a topic with NO surviving sample at all is NOT born (so a
        // null mapper result keeps being skipped, matching pre-rewind
        // behavior). An unconditionally-cleared _born used to make EVERY
        // channel unborn on rewind, silently suppressing the corrective
        // tombstone for the stale-non-null-tail case; a "non-null tail"
        // definition of born (the first fix pass) still silently suppressed
        // it for the stale-tombstone-tail case above.
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

        /// <param name="bindUri">A <c>ws://host:port</c> URI — see <see cref="FleckTransportListener"/>.</param>
        /// <param name="networkDelaySeconds">
        /// One-way delay the Courier applies between record and delivery — see
        /// <c>GonogoBodiesServer</c>'s identical constructor parameter for the
        /// same-machine/LAN rationale.
        /// </param>
        /// <param name="executeCommandsOnMainThread">
        /// F2 Part 1: when <c>true</c>, command handlers are marshaled onto the
        /// main-thread queue (drained by <see cref="RunPendingCommands"/> from
        /// <c>GonogoAddon.FixedUpdate</c>) instead of running inline on the
        /// Courier thread — required in production so live KSP/Unity actuation
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
        /// F2 review found). Only consulted when
        /// <paramref name="executeCommandsOnMainThread"/> is <c>true</c>.
        /// </param>
        public ChannelEngine(string bindUri, double networkDelaySeconds = 0, bool executeCommandsOnMainThread = false, double mainThreadCommandTimeoutSeconds = 5.0)
        {
            _executeCommandsOnMainThread = executeCommandsOnMainThread;
            _mainThreadCommandTimeout = TimeSpan.FromSeconds(mainThreadCommandTimeoutSeconds);
            _clock = new ManualClock();
            _network = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            _courier = new Courier(_clock, _network);
            // Routed through InvokeCommandHandler (not a raw dictionary
            // lookup + call) so a handler that throws on THIS delayed path —
            // fired from the Courier thread's own clock callback, see
            // Courier.ScheduleCommand — fail-softs its owning uplink
            // instead of unwinding out of the Courier's scheduled callback
            // and killing the thread. See InvokeCommandHandler's doc comment.
            _courier.SetCommandHandler((command, args, node) => InvokeCommandHandler(command, args));
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Sitrep-ChannelEngine-Courier" };
            _emitter = new ChannelEmitter(topic => _channelDeclarations[topic].Emission);
        }

        // NOTE: every RegisterUplink call MUST happen before Start().
        // Registration mutates plain (non-concurrent) Dictionary/List fields
        // (_channelDeclarations, _channelSources, _commandDeclarations,
        // _commandHandlers, _samplers, _channelOwner, _commandOwner) that the
        // Courier thread — started by Start() — later only ever ENUMERATES,
        // never mutates itself. That single-writer-before-start / read-only-
        // after-start split is what makes those plain collections safe
        // without locks; registering an uplink AFTER Start() would race
        // the Courier thread's enumeration of them with no synchronization.
        public void Start()
        {
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
        /// channel/command it declares (manifest-first — see
        /// <see cref="ChannelDeclaration"/>'s doc comment), then calls its
        /// <see cref="ISitrepUplink.Register"/> so it can wire mappers/
        /// handlers against this engine (passed as <see cref="IUplinkHost"/>).
        /// A throwing <see cref="ISitrepUplink.Register"/> fail-softs ONLY
        /// this uplink (see <see cref="Availability"/>) — every other
        /// registered uplink is unaffected.
        /// </summary>
        public void RegisterUplink(ISitrepUplink uplink)
        {
            var id = uplink.Manifest.Id;
            _availability[id] = Availability.Available;

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
                // and THEN threw has that source's Disabled flag set too —
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
        /// The version-checked entry point <see cref="UplinkDiscovery.Discover"/>'s
        /// caller uses instead of the raw <see cref="RegisterUplink(ISitrepUplink)"/>
        /// — see <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>'s
        /// handshake design. A MAJOR mismatch between
        /// <paramref name="contractMajor"/> (what the Uplink was built
        /// against — see <see cref="Sitrep.Contract.SitrepUplinkAttribute"/>'s
        /// doc comment for why that's reliable even for a stale binary) and
        /// <see cref="Sitrep.Contract.ContractVersion.Major"/> (what THIS
        /// core actually is) fail-softs the Uplink WITHOUT ever calling its
        /// <see cref="ISitrepUplink.Register"/> — an Uplink built against a
        /// different major is not just "maybe buggy", it may not even
        /// deserialize/type-check against this core's contract shapes at
        /// all, so skipping Register entirely (rather than letting it run
        /// and rely on ordinary fail-soft) avoids handing it live wire types
        /// it was never compiled to expect. A MINOR mismatch (either
        /// direction) is fine — Minor bumps are additive-only, so an older-
        /// or newer-Minor Uplink and this core can always talk on their
        /// shared subset.
        /// </summary>
        public void RegisterDiscoveredUplink(ISitrepUplink uplink, int contractMajor, int contractMinor)
        {
            if (contractMajor != Sitrep.Contract.ContractVersion.Major)
            {
                var id = uplink.Manifest.Id;
                _availability[id] = Availability.Unavailable(
                    $"contract v{contractMajor}.{contractMinor} vs core v{Sitrep.Contract.ContractVersion.Major}.{Sitrep.Contract.ContractVersion.Minor} — major mismatch");
                return;
            }

            RegisterUplink(uplink);
        }

        // ----------------------------------------------------------------
        // IUplinkHost
        // ----------------------------------------------------------------

        // NOTE: called from the main thread (a registered uplink calling
        // this via its IUplinkHost during e.g. a command handler that
        // wants "now") while _clock itself is Courier-thread-owned — a
        // cross-thread READ of ManualClock's private double _currentUt with
        // no lock. This is fine on any 64-bit target (this mod's only
        // target — see the .csproj): a naturally-aligned double field read/
        // write is atomic on x86-64/ARM64, so this can observe a slightly
        // stale value but never a torn (half-written) one.
        double IUplinkHost.NowUt() => _clock.Now();

        // Recorded against the CURRENTLY-registering uplink id, same
        // mechanism AddChannelSource/AddCommandHandler rely on implicitly via
        // _channelOwner/_commandOwner — see the sampler loop in ProcessTick
        // for how this is consulted (skip-if-Unavailable) and acted on
        // (attribute-and-disable on a throw).
        public void AddSampler(ISnapshotSampler sampler) => _samplers.Add((_currentRegisteringUplinkId ?? "", sampler));

        // Recorded against the CURRENTLY-registering uplink id, same mechanism
        // as AddSampler above. The capture runs on the main-loop thread (see
        // RunCaptures, called from Tick), the handle on the Courier thread
        // (see ProcessTick's capture loop) — see IUplinkHost.AddSampledSource
        // for the full threading contract.
        public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier)
        {
            AddSampledSource(captureOnMainThread, handleOnCourier, Array.Empty<string>());
        }

        // Subscription-gated overload (see IUplinkHost.AddSampledSource's
        // prefix overload): the declared topic prefixes let RunCaptures
        // early-out the capture on the main-loop thread when nothing this
        // source produces is subscribed. An empty prefix set means "never
        // gate" — the original always-capture behaviour.
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

        public IChannelPublisher Publisher(string topic)
        {
            RequireChannelDeclared(topic, nameof(Publisher));
            return new ChannelPublisher(this, topic);
        }

        public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template)
        {
            _dynamicNamespaces[prefix] = template;
            _dynamicNamespaceOwner[prefix] = _currentRegisteringUplinkId ?? "";
            return new DynamicChannelSource(this, prefix);
        }

        /// <summary>
        /// Materializes <paramref name="fullTopic"/> (<c>prefix + subTopic</c>)
        /// into an ordinary declared channel, cloned from
        /// <paramref name="prefix"/>'s registered template, if it hasn't
        /// been already — idempotent, safe to call on every publish/subscribe.
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

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
            if (!_commandDeclarations.ContainsKey(command))
            {
                throw new InvalidOperationException(
                    $"AddCommandHandler(\"{command}\") has no matching CommandDeclaration — " +
                    "declare it in the registering uplink's Manifest.Commands first.");
            }
            // The raw (TArgs)args! cast below throws InvalidCastException for
            // any wire-shaped arg that doesn't match TArgs (EnvelopeCodec
            // deserializes command args to a generic double/string/bool/
            // Dictionary shape, not a typed TArgs — see EnvelopeCodec's doc
            // comment). That throw is deliberately left as-is here (a full
            // declared-payload-type conversion is a bigger feature, not
            // needed to close this out); it's caught one layer up, in
            // InvokeCommandHandler, which is the SOLE call site for every
            // registered command handler and fail-softs just this command's
            // owning uplink instead of crashing the Courier thread.
            _commandHandlers[command] = args => handler((TArgs)args!);
        }

        public Kernel Kernel => _kernel;

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
        /// survived — see <see cref="Archive.HasAnyTail"/>'s doc comment for
        /// why a tombstone tail must count too.
        /// </summary>
        private void RecomputeChannelBirthFromArchive()
        {
            _born.Clear();
            foreach (var topic in _channelDeclarations.Keys)
            {
                if (_courier.HasAnyArchiveTail(NodeId, topic))
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
                    $"{caller}(\"{topic}\") has no matching ChannelDeclaration — " +
                    "declare it in the registering uplink's Manifest.Channels first.");
            }
        }

        // ----------------------------------------------------------------
        // Availability-gated dispatch (IMPORTANT-A) + Courier-thread
        // exception fail-soft (CRITICAL-2) — Courier-thread-only.
        // ----------------------------------------------------------------

        /// <summary>Whether <paramref name="topic"/>'s owning uplink (if tracked) is currently available — an untracked topic (shouldn't happen outside tests) is treated as available.</summary>
        private bool IsChannelAvailable(string topic)
        {
            return !_channelOwner.TryGetValue(topic, out var ownerId) || IsUplinkAvailable(ownerId);
        }

        /// <summary>Whether <paramref name="command"/>'s owning uplink (if tracked) is currently available.</summary>
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
        /// handler — shared by <see cref="ProcessDispatchCommand"/>'s
        /// non-delayed (ground-infrastructure) branch and the delayed path's
        /// Courier clock-callback (wired via <see cref="Courier.SetCommandHandler"/>
        /// in the constructor). A command whose owning uplink has gone
        /// <see cref="Availability.Unavailable"/> (whether from a throwing
        /// <see cref="ISitrepUplink.Register"/> or a PRIOR runtime throw
        /// caught here) is skipped entirely, matching "unknown command"
        /// behavior. Otherwise the handler runs inside a try/catch: a
        /// mismatched-type wire arg (<see cref="AddCommandHandler{TArgs,TResult}"/>'s
        /// <c>(TArgs)args!</c> cast) or any other handler-author bug throws
        /// HERE rather than unwinding onto the Courier thread — caught,
        /// fail-softs just this command's owning uplink (every other
        /// registered channel/command is unaffected), and returns
        /// <c>null</c> as a graceful failure result instead of propagating
        /// and killing the thread (the CRITICAL-2 fix).
        /// </summary>
        private object? InvokeCommandHandler(string command, object? args)
        {
            if (!IsCommandAvailable(command) || !_commandHandlers.TryGetValue(command, out var handler))
            {
                return null;
            }

            try
            {
                // F2 Part 1: route the ACTUAL handler onto the Unity main
                // thread when configured (production), else run it inline on
                // the Courier thread (headless default). Either way the same
                // try/catch fail-softs a throwing handler to its owning
                // uplink — a marshaled throw is captured on the main thread,
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
            // fail-soft catch attributes it identically — and, crucially, a
            // command the Courier dequeues AFTER the single-pass flush can no
            // longer re-enqueue and block the Courier past Stop()'s Join.
            if (_engineStopping)
            {
                throw new InvalidOperationException("ChannelEngine stopped before the command executed on the main thread.");
            }

            var job = new MainThreadCommand(handler, args);
            _mainThreadCommands.Enqueue(job);

            // F2-fix (pause backstop): a BOUNDED wait. In production the drain
            // rides Update() (runs even when Time.timeScale == 0), so a paused
            // game no longer wedges this; the timeout is the last-resort guard
            // for a scene-load / loading-screen stall where even Update stops
            // pumping. On expiry we abandon the job (the pump may still run it
            // later — MainThreadCommand.Done is intentionally NOT disposed on
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
                // completed path. Safe here — the pump's Set() (in
                // RunPendingCommands / FailPendingMainThreadCommands) has
                // already returned by the time Wait() unblocks, and the job is
                // off the queue, so nothing else will touch Done again.
                job.Done.Dispose();
            }
        }

        /// <summary>
        /// Drains every command execution marshaled by <see cref="RunOnMainThread"/>,
        /// running each handler on the CURRENT thread. MUST be called from the
        /// Unity main thread — in production, once per <c>GonogoAddon.FixedUpdate</c>,
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
                    // F2-fix: if the waiter already timed out and abandoned this
                    // job, no one will observe the result or dispose the handle,
                    // so the pump disposes it here. The waiter deliberately does
                    // NOT dispose on its timeout path, so this is the sole owner.
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
        /// instead of wedging until <see cref="Stop"/>'s Join times out — the
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
            // getter — legal (if perverse) third-party code can override it
            // to throw. The pre-fix `$"...{ex.Message}"` interpolation ran
            // BEFORE the _commandOwner lookup/MarkUplinkUnavailable call,
            // so a throwing getter aborted this method early, escaping to
            // CourierLoop's non-attributing backstop try/catch and leaving
            // the offending uplink's command live (and re-throwing)
            // forever. SafeExceptionMessage below can never throw, so the
            // owner lookup + MarkUplinkUnavailable are now guaranteed to
            // run regardless of what ex.Message does.
            if (_commandOwner.TryGetValue(command, out var ownerId))
            {
                MarkUplinkUnavailable(ownerId, $"command \"{command}\" handler threw: {SafeExceptionMessage(ex)}");
            }
            Console.Error.WriteLine("[ChannelEngine] command \"" + command + "\" handler threw: " + SafeExceptionMessage(ex));
        }

        private void FailSoftChannel(string topic, Exception ex)
        {
            // Same rationale as FailSoftCommand above — see its doc comment.
            if (_channelOwner.TryGetValue(topic, out var ownerId))
            {
                MarkUplinkUnavailable(ownerId, $"channel \"{topic}\" mapper threw: {SafeExceptionMessage(ex)}");
            }
            Console.Error.WriteLine("[ChannelEngine] channel \"" + topic + "\" mapper threw: " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// Sampler counterpart of <see cref="FailSoftChannel"/>/<see cref="FailSoftCommand"/>
        /// — the coverage-sweep fix for the sampler loop's missing owner
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
        /// Sampled-source counterpart of <see cref="FailSoftSampler"/> — marks
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
            Console.Error.WriteLine("[ChannelEngine] sampled source (owner \"" + source.OwnerId + "\") threw: " + SafeExceptionMessage(ex));
        }

        private void MarkUplinkUnavailable(string uplinkId, string reason)
        {
            _availability[uplinkId] = Availability.Unavailable(reason);

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
        }

        /// <summary>
        /// Reads <see cref="Exception.Message"/> defensively — it is an
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
        /// and change-gates a value and records it into the Courier — exactly
        /// <c>GonogoBodiesServer.Tick</c>'s single-topic behavior, generalized
        /// over every topic <see cref="AddChannelSource"/> registered.
        /// Callable from any thread — only touches primitives/the snapshot/
        /// mapper delegates and the explicit job queue, never the Courier/
        /// clock directly (those are Courier-thread-only).
        /// </summary>
        public void Tick(double ut, KspSnapshot? snapshot) => EnqueueJob(new TickJob(ut, snapshot, RunCaptures(snapshot), null));

        /// <summary>
        /// Runs every registered <see cref="AddSampledSource"/> capture on the
        /// CURRENT (main-loop) thread — this is called from <see cref="Tick"/>/
        /// <see cref="TickAndWait"/>, which in production run on the Unity main
        /// thread inside <c>GonogoAddon.FixedUpdate</c>, so the KSP/Unity reads
        /// a capture performs happen exactly where <see cref="KspSnapshot"/>
        /// itself is built. The opaque results (or a captured exception) are
        /// bundled into the <see cref="TickJob"/> and carried to the Courier
        /// thread, where <see cref="ProcessTick"/> hands each to its handle.
        /// A capture that throws is recorded (not rethrown) so the tick still
        /// proceeds and the fail-soft attribution happens Courier-side — see
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
                // Reads the Courier-maintained _subscribedTopics mirror — never
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
        /// Main-loop-thread subscription check for a <see cref="SampledSource"/>'s
        /// declared topic prefixes (Fix #3). An EMPTY prefix set means the source
        /// opted out of gating — always "subscribed" (original always-capture
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
        /// Push a payload directly to <paramref name="topic"/> (obtained via
        /// <see cref="Publisher"/>) — the event-driven counterpart to
        /// <see cref="Tick"/>'s pull-style mapping. Goes through the SAME
        /// per-channel Decide/Record processing as a Tick-driven channel.
        /// </summary>
        internal void Publish(string topic, object? payload, double ut) => EnqueueJob(new PublishJob(topic, payload, ut));

        /// <summary>Test-only deterministic variant of <see cref="Tick"/> — blocks until the Courier thread finishes processing this tick.</summary>
        internal void TickAndWait(double ut, KspSnapshot? snapshot, TimeSpan timeout)
        {
            var barrier = new ManualResetEventSlim(false);
            EnqueueJob(new TickJob(ut, snapshot, RunCaptures(snapshot), barrier));
            barrier.Wait(timeout);
        }

        /// <summary>
        /// Dispatch a command by name. If its declaration's
        /// <see cref="CommandDeclaration.Delayed"/> is <c>false</c> (ground
        /// infrastructure), the handler runs and <paramref name="onResult"/>
        /// fires on the SAME job-processing step — no Courier delay at all.
        /// Otherwise it rides <see cref="Courier.DispatchCommand"/>'s normal
        /// uplink/downlink delay, resolving only once <see cref="Tick"/>
        /// advances the clock far enough.
        /// </summary>
        public void DispatchCommand(string command, object? args, string vantage, Action<object?> onResult) =>
            EnqueueJob(new DispatchCommandJob(command, args, vantage, onResult, null));

        /// <summary>Test-only deterministic variant of <see cref="DispatchCommand"/>.</summary>
        internal void DispatchCommandAndWait(string command, object? args, string vantage, Action<object?> onResult, TimeSpan timeout)
        {
            var barrier = new ManualResetEventSlim(false);
            EnqueueJob(new DispatchCommandJob(command, args, vantage, onResult, barrier));
            barrier.Wait(timeout);
        }

        /// <summary>Test-only visibility into one topic's emission counters — see <c>GonogoBodiesServer.BodiesEmitterCounters</c>'s equivalent doc comment for why tests need this rather than inferring it from wire silence.</summary>
        internal EmissionCounters ChannelCounters(string topic) => _emitter.CountersFor(topic);

        /// <summary>Test-only visibility into the OUTER (<see cref="SubscriptionRegistry"/>) gate's current subscriber count for a topic — used to prove a subscribe/unsubscribe/disconnect sequence never leaves an orphaned count behind (see the C2-3 fix).</summary>
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
                    // bookkeeping, say) — the Courier thread must NEVER die:
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

        private void ProcessTick(TickJob tick)
        {
            // Quickload / timeline-rewind detection: paired 1:1 with the
            // identical check GonogoBodiesServer/ReplayBodiesServer both used
            // to carry separately — now there is exactly one copy. Live KSP's
            // UT jumps BACKWARD on an F9 quickload; without this,
            // ManualClock.AdvanceTo's forward-only no-op leaves the courier
            // wedged on the abandoned pre-quickload timeline. The emitter is
            // reset alongside the courier (for EVERY registered channel at
            // once — ChannelEmitter.Reset already iterates every channel it
            // knows about) so the next Decide per topic is an unconditional
            // keyframe on the new timeline too.
            if (tick.Ut < _clock.Now())
            {
                _courier.ResetTimeline(tick.Ut);
                _emitter.Reset(tick.Ut);
                RecomputeChannelBirthFromArchive();
                BroadcastTimelineReset();
            }

            if (tick.Snapshot != null)
            {
                foreach (var (ownerId, sampler) in _samplers)
                {
                    // Coverage-sweep fix: a sampler is third-party
                    // (uplink) code running on the Courier thread — an
                    // unguarded throw here used to kill the thread, so this
                    // catch is CRITICAL-2's original guard. But it used to
                    // stop there: no owner attribution meant a Sample() that
                    // throws every tick just logged forever and was
                    // re-invoked next tick regardless — unlike a channel
                    // mapper or command handler (see IsChannelAvailable/
                    // IsCommandAvailable), the uplink never actually went
                    // Unavailable. Now mirrors that same pattern: skip a
                    // sampler whose owner already went Unavailable (from a
                    // PRIOR tick's throw, or a throwing Register()), and on a
                    // throw here, attribute it to the owning uplink via
                    // FailSoftSampler so it stops recurring from the NEXT
                    // tick onward.
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
            // fail-soft discipline as the sampler loop above — skip a source
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
                        FailSoftSampledSource(source, captured.Exception);
                        continue;
                    }

                    try
                    {
                        source.Handle(captured.Value);
                    }
                    catch (Exception ex)
                    {
                        FailSoftSampledSource(source, ex);
                    }
                }
            }

            foreach (var channelSource in _channelSources)
            {
                var topic = channelSource.Key;
                if (!IsChannelAvailable(topic))
                {
                    // IMPORTANT-A: the owning uplink went Unavailable
                    // (registration threw, or a PRIOR tick's mapper threw
                    // below) — every channel it owns goes inert together,
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
                    // CRITICAL-2: a channel mapper is uplink-authored
                    // code; a throw here (e.g. an unexpected snapshot shape)
                    // used to kill the Courier thread. Caught here instead:
                    // fail-softs ONLY this channel's owning uplink (see
                    // FailSoftChannel) and skips to the NEXT channel this
                    // same tick — every other registered channel keeps
                    // ticking normally.
                    FailSoftChannel(topic, ex);
                    continue;
                }

                if (value == null)
                {
                    if (!_born.Contains(topic))
                    {
                        // No data yet for this topic this tick, AND it has
                        // never had a real value (e.g. main menu, before
                        // FlightGlobals is ready) — not yet a subject, so
                        // there is nothing to tombstone. Skip this topic
                        // entirely, same as before this fix; other topics/
                        // the clock advance below are unaffected.
                        continue;
                    }
                    // else: this channel WAS born (has emitted a real value
                    // before) -- a null now is a legitimate ABSENCE
                    // transition (finding B / M2 tombstone). Fall through
                    // into Decide with the null value: it is change-gated
                    // exactly like any other value (Equals(last, null) ->
                    // change, once; null -> null -> no change, suppressed by
                    // the deadband — see ChannelEmitter.HasChangedBeyondQuantum),
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
                    _courier.Record(NodeId, topic, decision.Value, tick.Ut);
                }
            }

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
                _courier.Record(NodeId, publish.Topic, decision.Value, ut);
            }
        }

        private void ProcessDispatchCommand(DispatchCommandJob job)
        {
            // IMPORTANT-A: an unknown command AND a command whose owning
            // uplink has gone Unavailable are treated identically —
            // "unknown/unavailable command" — a future wire-level
            // E_UNAVAILABLE response is the natural uplink of this, not
            // built here.
            if (!IsCommandAvailable(job.Command) || !_commandHandlers.ContainsKey(job.Command))
            {
                job.Done?.Set();
                return;
            }

            var delayed = !_commandDeclarations.TryGetValue(job.Command, out var declaration) || declaration.Delayed;

            if (!delayed)
            {
                // Ground infrastructure (e.g. kerbcast negotiate): bypasses
                // the Courier's light-time delay model entirely — see the
                // design doc §4.3. Routed through InvokeCommandHandler (the
                // SAME funnel the delayed path uses via
                // Courier.SetCommandHandler) so a throwing handler
                // fail-softs its own uplink instead of killing the
                // Courier thread — the CRITICAL-2 fix.
                var result = InvokeCommandHandler(job.Command, job.Args);
                job.OnResult(result);
                job.Done?.Set();
                return;
            }

            _courier.DispatchCommand(NodeId, NextRequestId(), job.Command, job.Args, job.Vantage, response =>
            {
                job.OnResult(response.Result);
                job.Done?.Set();
            });
        }

        private string NextRequestId() => "c" + Interlocked.Increment(ref _requestSeq);

        private void ProcessSubscribe(ClientSession session, string topic)
        {
            // MEDIUM-3: gate on any DECLARED channel (_channelDeclarations),
            // not just source-backed ones (_channelSources) — a
            // Publisher(topic)-only channel (event-driven, no
            // AddChannelSource mapper) is a legitimate channel too, and used
            // to be permanently unsubscribable because this check only ever
            // recognized the pull-style half of the two ways a channel can
            // be backed (see IUplinkHost.AddChannelSource vs. Publisher).
            //
            // A topic that isn't declared yet but falls under a registered
            // dynamic namespace (see RegisterDynamicNamespace) is ALSO a
            // legitimate subscribe target — materialize its declaration now
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

            var vantage = session.Connection.Id;
            var delivery = _channelDeclarations[topic].Delivery;

            Action unsubscribe;
            try
            {
                unsubscribe = _courier.SubscribeStream(NodeId, topic, vantage, streamData =>
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
                        FailSoftChannel(topic, ex);
                        return;
                    }

                    if (delivery == Delivery.ReliableOrdered)
                    {
                        // Reliable-ordered: rides the outbox's FIFO lane, never
                        // coalesced away — see Delivery's doc comment.
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
                // before it returns — a throw here (from anywhere in that
                // window, not just the onData closure above, which now
                // guards itself) would otherwise unwind AFTER
                // _subscriptions.Subscribe/the Courier's own subscriber-set
                // add above but BEFORE session.Unsubscribers[topic] and the
                // ack below are ever reached: an orphaned subscriber with no
                // ack and no bookkeeping for ProcessDisconnect to clean up
                // later. Roll back the registry-level subscribe so no
                // orphaned count survives, fail-soft the owning uplink,
                // and bail out WITHOUT setting Unsubscribers/sending an ack
                // — the client's subscribe simply never completes, matching
                // "unavailable channel" behavior elsewhere in this class.
                if (_subscriptions.Unsubscribe(topic))
                {
                    _subscribedTopics.TryRemove(topic, out _);
                }
                FailSoftChannel(topic, ex);
                return;
            }

            session.Unsubscribers[topic] = unsubscribe;

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
        /// (quickload UT-rewind) — the same <see cref="EventMsg"/> shape
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
                    // already be sitting in this session's outbox — written
                    // by a delivery that fired moments before this reset was
                    // detected, still waiting for the independent pump
                    // thread to drain it — and would otherwise reach the
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
                            Vantage = session.Connection.Id,
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
                    case CommandRequest<object?> req:
                        DispatchCommand(req.Command, req.Args, session.Connection.Id, result =>
                        {
                            // C2-4: `result` is whatever the uplink's
                            // command handler returned -- uplink-owned,
                            // same as a channel payload. This serialization
                            // used to run OUTSIDE InvokeCommandHandler's
                            // guard entirely (it happens here, in the
                            // RESULT callback, not inside the handler call
                            // itself), so an unserializable result threw
                            // unattributed and the client got no response at
                            // all, not even an error -- true silence. Guard
                            // it the same way as every other uplink-value
                            // touch point: fail-soft the owning command's
                            // uplink and send an explicit error response
                            // instead of dropping the reply on the floor.
                            try
                            {
                                var response = new CommandResponse<object?>
                                {
                                    RequestId = req.RequestId,
                                    Result = result,
                                    Meta = new Meta
                                    {
                                        Source = NodeId,
                                        Vantage = session.Connection.Id,
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
                                        // dispatch). Previously this Meta was
                                        // hand-rolled here with no epoch at
                                        // all -- always the wire default (0),
                                        // even after a rewind had already
                                        // bumped the Courier forward.
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
            public readonly ManualResetEventSlim? Done;
            public TickJob(double ut, KspSnapshot? snapshot, CapturedSample[]? captures, ManualResetEventSlim? done)
            {
                Ut = ut;
                Snapshot = snapshot;
                Captures = captures;
                Done = done;
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
        /// is the single mutable-after-start field — a volatile bool so the
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

            public SampledSource(string ownerId, Func<KspSnapshot?, object?> capture, Action<object?> handle, string[] topicPrefixes)
            {
                OwnerId = ownerId;
                Capture = capture;
                Handle = handle;
                TopicPrefixes = topicPrefixes;
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
            public readonly Action<object?> OnResult;
            public readonly ManualResetEventSlim? Done;
            public DispatchCommandJob(string command, object? args, string vantage, Action<object?> onResult, ManualResetEventSlim? done)
            {
                Command = command;
                Args = args;
                Vantage = vantage;
                OnResult = onResult;
                Done = done;
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
        /// <see cref="Done"/> is set — a non-null <see cref="Captured"/> means
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
        }
    }

    /// <summary>
    /// The Courier -&gt; socket queue crossing for one connection — the
    /// engine's copy of <c>Gonogo.KSP.GonogoOutbox</c> /
    /// <c>Sitrep.Host.IntegrationTests.ReplayOutbox</c> /
    /// <c>Sitrep.Skeleton.ConnectionOutbox</c> (all <c>internal</c> to their
    /// own assemblies and so not reusable here — see those classes' doc
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

        /// <summary>Courier-thread-only: publish the latest serialized telemetry frame for a topic. Never blocks. Coalesces — a later call before the pump drains replaces the earlier one.</summary>
        public void PublishTelemetry(string topic, byte[] payload)
        {
            _latestByTopic[topic] = payload;
            _signal.Release();
        }

        /// <summary>Courier-thread-only: enqueue a reliable (never-dropped, never-coalesced) frame — acks, echoes, command responses, and reliable-ordered channel samples.</summary>
        public void PublishReliable(byte[] payload)
        {
            _reliable.Enqueue(payload);
            _signal.Release();
        }

        /// <summary>
        /// Courier-thread-only: drop any currently-queued (not yet pumped)
        /// lossy-latest frame for <paramref name="topic"/> — the LOW-4
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

        /// <summary>Signals the pump thread to drain and exit — non-blocking, safe from any thread.</summary>
        public void Stop()
        {
            _stopping = true;
            _signal.Release();
        }
    }
}
