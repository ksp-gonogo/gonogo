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

        private readonly List<ISnapshotSampler> _samplers = new List<ISnapshotSampler>();
        private readonly Dictionary<string, Availability> _availability = new Dictionary<string, Availability>();
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
            _courier.SetCommandHandler((command, args, node) =>
                _commandHandlers.TryGetValue(command, out var handler) ? handler(args) : null);
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Sitrep-ChannelEngine-Courier" };
            _emitter = new ChannelEmitter(topic => _channelDeclarations[topic].Emission);
        }

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
            }
            foreach (var command in extension.Manifest.Commands)
            {
                _commandDeclarations[command.Command] = command;
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

        double IExtensionHost.NowUt() => _clock.Now();

        public void AddSampler(ISnapshotSampler sampler) => _samplers.Add(sampler);

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
                BroadcastTimelineReset();
            }

            if (tick.Snapshot != null)
            {
                foreach (var sampler in _samplers)
                {
                    sampler.Sample(tick.Snapshot);
                }
            }

            foreach (var channelSource in _channelSources)
            {
                var topic = channelSource.Key;
                var map = channelSource.Value;
                if (!_subscriptions.IsSubscribed(topic))
                {
                    continue;
                }

                var value = map(tick.Snapshot);
                if (value == null)
                {
                    // No data yet for this topic this tick (e.g. main menu,
                    // before FlightGlobals is ready) — distinct from "value
                    // didn't change enough to emit"; just skip this topic,
                    // other topics/the clock advance below are unaffected.
                    continue;
                }

                var decision = _emitter.Decide(topic, value, tick.Ut);
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

            var decision = _emitter.Decide(publish.Topic, publish.Payload, publish.Ut);
            if (decision.ShouldEmit)
            {
                _courier.Record(NodeId, publish.Topic, decision.Value, publish.Ut);
            }
        }

        private void ProcessDispatchCommand(DispatchCommandJob job)
        {
            if (!_commandHandlers.TryGetValue(job.Command, out var handler))
            {
                // Unknown/unavailable command — a future wire-level E_UNAVAILABLE
                // response is the natural extension of this, not built here.
                job.Done?.Set();
                return;
            }

            var delayed = !_commandDeclarations.TryGetValue(job.Command, out var declaration) || declaration.Delayed;

            if (!delayed)
            {
                // Ground infrastructure (e.g. kerbcast negotiate): bypasses
                // the Courier's light-time delay model entirely — see the
                // design doc §4.3.
                var result = handler(job.Args);
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
            if (!_channelSources.ContainsKey(topic) || session.Unsubscribers.ContainsKey(topic))
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
            var unsubscribe = _courier.SubscribeStream(NodeId, topic, vantage, streamData =>
            {
                var json = EnvelopeCodec.WriteStreamData(streamData);
                var bytes = Encoding.UTF8.GetBytes(json);
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
