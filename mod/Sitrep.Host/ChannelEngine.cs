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
    /// see <c>local_docs/telemetry-mod/extension-sdk-contract-design.md</c>
    /// §1.2/§6.1). Owns EVERYTHING those two paired, hand-copied classes
    /// owned — the <see cref="SubscriptionRegistry"/> outer gate, the
    /// per-topic <see cref="ChannelEmitter"/> inner gate, the <see cref="Courier"/>
    /// + delay, the timeline-reset broadcast, and the three-domain threading
    /// model (main-loop / Courier / socket) — but drives a SET of channels
    /// and commands registered by <see cref="ISitrepExtension"/>s, not one
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
    public sealed class ChannelEngine : IExtensionHost, IDisposable
    {
        public const string NodeId = "system";

        private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(50);

        /// <summary>
        /// C1-pub tolerance: <see cref="ProcessPublish"/> clamps a
        /// caller-stamped <c>ut</c> that lands meaningfully ahead of the
        /// clock's current position at processing time. A tiny epsilon
        /// (rather than an exact `&gt;`) absorbs floating-point noise only --
        /// it is NOT meant to tolerate genuine slack between when an
        /// extension reads "now" and when its Publish call is processed.
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

        // The OUTER (SubscriptionRegistry) / INNER (ChannelEmitter) gate pair,
        // Courier-thread-only, shared across every registered topic — both
        // classes are already keyed by channelId/topic internally, so no
        // per-topic instance is needed (see their own doc comments).
        private readonly SubscriptionRegistry _subscriptions = new SubscriptionRegistry();
        private readonly ChannelEmitter _emitter;

        private readonly Dictionary<string, ChannelDeclaration> _channelDeclarations = new Dictionary<string, ChannelDeclaration>();
        private readonly Dictionary<string, Func<KspSnapshot?, object?>> _channelSources = new Dictionary<string, Func<KspSnapshot?, object?>>();

        private readonly Dictionary<string, CommandDeclaration> _commandDeclarations = new Dictionary<string, CommandDeclaration>();
        private readonly Dictionary<string, Func<object?, object?>> _commandHandlers = new Dictionary<string, Func<object?, object?>>();

        // Owner travels WITH each sampler (rather than a parallel dictionary
        // keyed by the sampler instance) because a sampler has no natural
        // string key the way a channel/command topic does. Populated in
        // AddSampler from _currentRegisteringExtensionId, same mechanism
        // _channelOwner/_commandOwner use below.
        private readonly List<(string OwnerId, ISnapshotSampler Sampler)> _samplers = new List<(string OwnerId, ISnapshotSampler Sampler)>();
        private readonly Dictionary<string, Availability> _availability = new Dictionary<string, Availability>();

        // topic/command -> owning extension id, populated in RegisterExtension
        // alongside _channelDeclarations/_commandDeclarations. Lets Tick's
        // channel loop and ProcessDispatchCommand consult _availability
        // per-channel/per-command (see IsChannelAvailable/IsCommandAvailable)
        // instead of only tracking availability without ever acting on it —
        // the fail-soft half of the contract that used to be missing: a
        // throwing Register(), or a channel mapper/command handler that
        // throws at RUNTIME (see FailSoftChannel/FailSoftCommand), now takes
        // the WHOLE owning extension's channels/commands inert together,
        // rather than leaving already-registered ones live against a
        // half-broken extension. The sampler loop (see ProcessTick) applies
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
        // Cleared on a quickload rewind (below) so the abandoned timeline's
        // birth state never survives onto the new one.
        //
        // KNOWN GAP (deferred, not required by this task's verify list):
        // the design doc also calls for resetting this per SUBJECT epoch
        // (vessel-switch, M1 §6.1) so a newly-switched-to vessel that hasn't
        // emitted yet doesn't inherit the PREVIOUS vessel's birth state. That
        // reset can't reuse IExtensionHost.ForceKeyframe as-is: that method
        // is ALSO the 0->1 subscribe-transition mechanism (see
        // ChannelEmitter.NotifySubscribed), and clearing birth on every
        // subscribe would wrongly suppress the tombstone re-keyframe a
        // reconnecting subscriber is supposed to see for an
        // already-tombstoned channel. A correct fix needs a NEW, separate
        // IExtensionHost seam that VesselEpochSampler calls alongside (not
        // instead of) ForceKeyframe -- left for a follow-up task.
        private readonly HashSet<string> _born = new HashSet<string>();

        private string? _currentRegisteringExtensionId;

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
        public ChannelEngine(string bindUri, double networkDelaySeconds = 0)
        {
            _clock = new ManualClock();
            _network = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            _courier = new Courier(_clock, _network);
            // Routed through InvokeCommandHandler (not a raw dictionary
            // lookup + call) so a handler that throws on THIS delayed path —
            // fired from the Courier thread's own clock callback, see
            // Courier.ScheduleCommand — fail-softs its owning extension
            // instead of unwinding out of the Courier's scheduled callback
            // and killing the thread. See InvokeCommandHandler's doc comment.
            _courier.SetCommandHandler((command, args, node) => InvokeCommandHandler(command, args));
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Sitrep-ChannelEngine-Courier" };
            _emitter = new ChannelEmitter(topic => _channelDeclarations[topic].Emission);
        }

        // NOTE: every RegisterExtension call MUST happen before Start().
        // Registration mutates plain (non-concurrent) Dictionary/List fields
        // (_channelDeclarations, _channelSources, _commandDeclarations,
        // _commandHandlers, _samplers, _channelOwner, _commandOwner) that the
        // Courier thread — started by Start() — later only ever ENUMERATES,
        // never mutates itself. That single-writer-before-start / read-only-
        // after-start split is what makes those plain collections safe
        // without locks; registering an extension AFTER Start() would race
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
            _courierThread.Join(TimeSpan.FromSeconds(5));

            foreach (var session in _sessions.Values)
            {
                session.Outbox.Stop();
            }
        }

        public void Dispose() => Stop();

        // ----------------------------------------------------------------
        // Extension registration (main thread, at load)
        // ----------------------------------------------------------------

        /// <summary>
        /// Registers one <see cref="ISitrepExtension"/>: records every
        /// channel/command it declares (manifest-first — see
        /// <see cref="ChannelDeclaration"/>'s doc comment), then calls its
        /// <see cref="ISitrepExtension.Register"/> so it can wire mappers/
        /// handlers against this engine (passed as <see cref="IExtensionHost"/>).
        /// A throwing <see cref="ISitrepExtension.Register"/> fail-softs ONLY
        /// this extension (see <see cref="Availability"/>) — every other
        /// registered extension is unaffected.
        /// </summary>
        public void RegisterExtension(ISitrepExtension extension)
        {
            var id = extension.Manifest.Id;
            _availability[id] = Availability.Available;

            foreach (var channel in extension.Manifest.Channels)
            {
                _channelDeclarations[channel.Topic] = channel;
                _channelOwner[channel.Topic] = id;
            }
            foreach (var command in extension.Manifest.Commands)
            {
                _commandDeclarations[command.Command] = command;
                _commandOwner[command.Command] = id;
            }

            _currentRegisteringExtensionId = id;
            try
            {
                extension.Register(this);
            }
            catch (Exception ex)
            {
                _availability[id] = Availability.Unavailable("registration threw: " + ex.Message);
            }
            finally
            {
                _currentRegisteringExtensionId = null;
            }
        }

        public Availability AvailabilityOf(string extensionId)
        {
            return _availability.TryGetValue(extensionId, out var availability)
                ? availability
                : Availability.Unavailable("unknown extension \"" + extensionId + "\"");
        }

        // ----------------------------------------------------------------
        // IExtensionHost
        // ----------------------------------------------------------------

        // NOTE: called from the main thread (a registered extension calling
        // this via its IExtensionHost during e.g. a command handler that
        // wants "now") while _clock itself is Courier-thread-owned — a
        // cross-thread READ of ManualClock's private double _currentUt with
        // no lock. This is fine on any 64-bit target (this mod's only
        // target — see the .csproj): a naturally-aligned double field read/
        // write is atomic on x86-64/ARM64, so this can observe a slightly
        // stale value but never a torn (half-written) one.
        double IExtensionHost.NowUt() => _clock.Now();

        // Recorded against the CURRENTLY-registering extension id, same
        // mechanism AddChannelSource/AddCommandHandler rely on implicitly via
        // _channelOwner/_commandOwner — see the sampler loop in ProcessTick
        // for how this is consulted (skip-if-Unavailable) and acted on
        // (attribute-and-disable on a throw).
        public void AddSampler(ISnapshotSampler sampler) => _samplers.Add((_currentRegisteringExtensionId ?? "", sampler));

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

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
            if (!_commandDeclarations.ContainsKey(command))
            {
                throw new InvalidOperationException(
                    $"AddCommandHandler(\"{command}\") has no matching CommandDeclaration — " +
                    "declare it in the registering extension's Manifest.Commands first.");
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
            // owning extension instead of crashing the Courier thread.
            _commandHandlers[command] = args => handler((TArgs)args!);
        }

        public Kernel Kernel => _kernel;

        public void SetAvailability(Availability availability)
        {
            if (_currentRegisteringExtensionId != null)
            {
                _availability[_currentRegisteringExtensionId] = availability;
            }
        }

        // Courier-thread-only (see IExtensionHost.ForceKeyframe's doc
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

        private void RequireChannelDeclared(string topic, string caller)
        {
            if (!_channelDeclarations.ContainsKey(topic))
            {
                throw new InvalidOperationException(
                    $"{caller}(\"{topic}\") has no matching ChannelDeclaration — " +
                    "declare it in the registering extension's Manifest.Channels first.");
            }
        }

        // ----------------------------------------------------------------
        // Availability-gated dispatch (IMPORTANT-A) + Courier-thread
        // exception fail-soft (CRITICAL-2) — Courier-thread-only.
        // ----------------------------------------------------------------

        /// <summary>Whether <paramref name="topic"/>'s owning extension (if tracked) is currently available — an untracked topic (shouldn't happen outside tests) is treated as available.</summary>
        private bool IsChannelAvailable(string topic)
        {
            return !_channelOwner.TryGetValue(topic, out var ownerId) || IsExtensionAvailable(ownerId);
        }

        /// <summary>Whether <paramref name="command"/>'s owning extension (if tracked) is currently available.</summary>
        private bool IsCommandAvailable(string command)
        {
            return !_commandOwner.TryGetValue(command, out var ownerId) || IsExtensionAvailable(ownerId);
        }

        private bool IsExtensionAvailable(string extensionId)
        {
            return !_availability.TryGetValue(extensionId, out var availability) || availability.IsAvailable;
        }

        /// <summary>
        /// The SOLE call site that actually invokes a registered command
        /// handler — shared by <see cref="ProcessDispatchCommand"/>'s
        /// non-delayed (ground-infrastructure) branch and the delayed path's
        /// Courier clock-callback (wired via <see cref="Courier.SetCommandHandler"/>
        /// in the constructor). A command whose owning extension has gone
        /// <see cref="Availability.Unavailable"/> (whether from a throwing
        /// <see cref="ISitrepExtension.Register"/> or a PRIOR runtime throw
        /// caught here) is skipped entirely, matching "unknown command"
        /// behavior. Otherwise the handler runs inside a try/catch: a
        /// mismatched-type wire arg (<see cref="AddCommandHandler{TArgs,TResult}"/>'s
        /// <c>(TArgs)args!</c> cast) or any other handler-author bug throws
        /// HERE rather than unwinding onto the Courier thread — caught,
        /// fail-softs just this command's owning extension (every other
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
                return handler(args);
            }
            catch (Exception ex)
            {
                FailSoftCommand(command, ex);
                return null;
            }
        }

        private void FailSoftCommand(string command, Exception ex)
        {
            // Attribution must not depend on reading the offending
            // exception's Message: `ex.Message` is an ordinary virtual
            // getter — legal (if perverse) third-party code can override it
            // to throw. The pre-fix `$"...{ex.Message}"` interpolation ran
            // BEFORE the _commandOwner lookup/MarkExtensionUnavailable call,
            // so a throwing getter aborted this method early, escaping to
            // CourierLoop's non-attributing backstop try/catch and leaving
            // the offending extension's command live (and re-throwing)
            // forever. SafeExceptionMessage below can never throw, so the
            // owner lookup + MarkExtensionUnavailable are now guaranteed to
            // run regardless of what ex.Message does.
            if (_commandOwner.TryGetValue(command, out var ownerId))
            {
                MarkExtensionUnavailable(ownerId, $"command \"{command}\" handler threw: {SafeExceptionMessage(ex)}");
            }
            Console.Error.WriteLine("[ChannelEngine] command \"" + command + "\" handler threw: " + SafeExceptionMessage(ex));
        }

        private void FailSoftChannel(string topic, Exception ex)
        {
            // Same rationale as FailSoftCommand above — see its doc comment.
            if (_channelOwner.TryGetValue(topic, out var ownerId))
            {
                MarkExtensionUnavailable(ownerId, $"channel \"{topic}\" mapper threw: {SafeExceptionMessage(ex)}");
            }
            Console.Error.WriteLine("[ChannelEngine] channel \"" + topic + "\" mapper threw: " + SafeExceptionMessage(ex));
        }

        /// <summary>
        /// Sampler counterpart of <see cref="FailSoftChannel"/>/<see cref="FailSoftCommand"/>
        /// — the coverage-sweep fix for the sampler loop's missing owner
        /// attribution (see <see cref="ProcessTick"/>'s sampler loop). Marks
        /// the sampler's owning extension Unavailable so it (and every other
        /// sampler/channel/command it owns) is skipped from the next tick
        /// onward, instead of the same throwing sampler recurring forever.
        /// </summary>
        private void FailSoftSampler(string ownerId, ISnapshotSampler sampler, Exception ex)
        {
            MarkExtensionUnavailable(ownerId, $"sampler \"{sampler.GetType().Name}\" threw: {SafeExceptionMessage(ex)}");
            Console.Error.WriteLine("[ChannelEngine] sampler " + sampler.GetType().Name + " threw: " + SafeExceptionMessage(ex));
        }

        private void MarkExtensionUnavailable(string extensionId, string reason)
        {
            _availability[extensionId] = Availability.Unavailable(reason);
        }

        /// <summary>
        /// Reads <see cref="Exception.Message"/> defensively — it is an
        /// ordinary virtual getter, so a hostile/buggy custom exception type
        /// can legally override it to throw. Every fail-soft guard in this
        /// class reads a caught exception's Message only through here, so
        /// attribution (<see cref="MarkExtensionUnavailable"/>) can never be
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
        public void Tick(double ut, KspSnapshot? snapshot) => EnqueueJob(new TickJob(ut, snapshot, null));

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
            EnqueueJob(new TickJob(ut, snapshot, barrier));
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
                    // them to the right extension. This try/catch is the
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
                _born.Clear();
                BroadcastTimelineReset();
            }

            if (tick.Snapshot != null)
            {
                foreach (var (ownerId, sampler) in _samplers)
                {
                    // Coverage-sweep fix: a sampler is third-party
                    // (extension) code running on the Courier thread — an
                    // unguarded throw here used to kill the thread, so this
                    // catch is CRITICAL-2's original guard. But it used to
                    // stop there: no owner attribution meant a Sample() that
                    // throws every tick just logged forever and was
                    // re-invoked next tick regardless — unlike a channel
                    // mapper or command handler (see IsChannelAvailable/
                    // IsCommandAvailable), the extension never actually went
                    // Unavailable. Now mirrors that same pattern: skip a
                    // sampler whose owner already went Unavailable (from a
                    // PRIOR tick's throw, or a throwing Register()), and on a
                    // throw here, attribute it to the owning extension via
                    // FailSoftSampler so it stops recurring from the NEXT
                    // tick onward.
                    if (!IsExtensionAvailable(ownerId))
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

            foreach (var channelSource in _channelSources)
            {
                var topic = channelSource.Key;
                if (!IsChannelAvailable(topic))
                {
                    // IMPORTANT-A: the owning extension went Unavailable
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
                    // CRITICAL-2: a channel mapper is extension-authored
                    // code; a throw here (e.g. an unexpected snapshot shape)
                    // used to kill the Courier thread. Caught here instead:
                    // fail-softs ONLY this channel's owning extension (see
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
                // extension-authored code -- a structured payload's deadband
                // falls back to object.Equals (see
                // ChannelEmitter.HasChangedBeyondQuantum), which invokes the
                // VALUE's own Equals override. Before this fix, a throwing
                // Equals escaped this loop entirely (this call sat OUTSIDE
                // the try/catch above that only guarded map()), skipping
                // _clock.AdvanceTo below for the WHOLE tick -- wedging every
                // OTHER channel's delivery too, not just this one. Guarded
                // exactly like map(): fail-soft ONLY this channel's owning
                // extension and move on to the next channel, same tick.
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

            // C1-pub: publish.Ut is caller/extension-stamped (typically via
            // IExtensionHost.NowUt(), read at some earlier point), entirely
            // independent of the Tick-driven clock advance. If a quickload
            // rewinds _clock backward AFTER an extension captured its "now"
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
            // extension has gone Unavailable are treated identically —
            // "unknown/unavailable command" — a future wire-level
            // E_UNAVAILABLE response is the natural extension of this, not
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
                // fail-softs its own extension instead of killing the
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
            // be backed (see IExtensionHost.AddChannelSource vs. Publisher).
            if (!_channelDeclarations.ContainsKey(topic) || session.Unsubscribers.ContainsKey(topic))
            {
                return;
            }

            // A genuine 0 -> 1 subscriber transition: force an immediate
            // keyframe on the emitter's NEXT Decide call for THIS topic so a
            // newly-joined subscriber doesn't wait out whatever fraction of
            // the keyframe cadence remains.
            if (_subscriptions.Subscribe(topic))
            {
                _emitter.NotifySubscribed(topic);
            }

            var vantage = session.Connection.Id;
            var delivery = _channelDeclarations[topic].Delivery;

            Action unsubscribe;
            try
            {
                unsubscribe = _courier.SubscribeStream(NodeId, topic, vantage, streamData =>
                {
                    // C2-2(b): streamData.Payload is extension-authored --
                    // some CLR shapes JsonWriter can never serialize (an
                    // arbitrary POCO, not a recognized numeric/string/
                    // dictionary/enumerable). This closure is invoked for
                    // EVERY delivery to this subscriber (both the
                    // synchronous subscribe-time catch-up below AND every
                    // later Courier-scheduled delivery), so guarding it here
                    // fail-softs the owning extension on the FIRST failed
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
                // orphaned count survives, fail-soft the owning extension,
                // and bail out WITHOUT setting Unsubscribers/sending an ack
                // — the client's subscribe simply never completes, matching
                // "unavailable channel" behavior elsewhere in this class.
                _subscriptions.Unsubscribe(topic);
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
                _subscriptions.Unsubscribe(topic);
            }
        }

        private void ProcessDisconnect(ClientSession session)
        {
            foreach (var topic in session.Unsubscribers.Keys)
            {
                _subscriptions.Unsubscribe(topic);
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
                            // C2-4: `result` is whatever the extension's
                            // command handler returned -- extension-owned,
                            // same as a channel payload. This serialization
                            // used to run OUTSIDE InvokeCommandHandler's
                            // guard entirely (it happens here, in the
                            // RESULT callback, not inside the handler call
                            // itself), so an unserializable result threw
                            // unattributed and the client got no response at
                            // all, not even an error -- true silence. Guard
                            // it the same way as every other extension-value
                            // touch point: fail-soft the owning command's
                            // extension and send an explicit error response
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
            public readonly ManualResetEventSlim? Done;
            public TickJob(double ut, KspSnapshot? snapshot, ManualResetEventSlim? done)
            {
                Ut = ut;
                Snapshot = snapshot;
                Done = done;
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
