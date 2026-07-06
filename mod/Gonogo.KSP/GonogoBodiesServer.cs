using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Sitrep.Transport;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Gonogo.KSP
{
    /// <summary>
    /// In-game wiring of <see cref="Courier"/> (the delay engine) +
    /// <see cref="FleckTransportListener"/> over the single
    /// <see cref="SystemViewProvider.Topic"/> ("system.bodies") stream,
    /// following the exact three-domain threading model
    /// <c>Sitrep.Skeleton.SkeletonServer</c> proved out in M5a (main-loop /
    /// Courier / socket - see that class's doc comment for the full
    /// rationale). Not a direct reuse of <c>SkeletonServer</c>: that class's
    /// <c>Tick(double, long)</c> is hard-wired to its own demo counter
    /// topic/value type, and its <c>ConnectionOutbox</c> is <c>internal</c>
    /// to <c>Sitrep.Skeleton</c> - neither is reachable from here. This is a
    /// deliberately minimal, single-topic counterpart carrying an
    /// <c>object?</c> payload (the <see cref="SystemViewProvider"/> output)
    /// instead of a <c>long</c>, wired by <see cref="GonogoAddon"/>.
    ///
    /// KSP is NEVER touched here - <see cref="GonogoAddon"/>'s
    /// <c>FixedUpdate</c> samples <see cref="KspHost"/> on the main thread
    /// and hands the already-built payload to <see cref="Tick"/>, which only
    /// ever touches primitives and the explicit job queue itself.
    /// </summary>
    public sealed class GonogoBodiesServer : IDisposable
    {
        public const string SystemNode = "system";
        public static readonly string BodiesTopic = SystemViewProvider.Topic;

        private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(50);

        // system.bodies is a static structured channel (orbital elements
        // barely change tick to tick) - a 30s keyframe cadence plus
        // accepting a re-emit at whatever cadence GonogoAddon samples at
        // (currently ~1s UT) is fine per the streaming-slice-1 plan. The
        // quantum is irrelevant here: the payload is a Dictionary, so
        // ChannelEmitter's change-gate falls back to reference/Equals
        // comparison, and BuildSystemBodies hands back a fresh Dictionary
        // every call - so every considered sample reads as "changed".
        private static readonly EmissionPolicy BodiesEmissionPolicy = new EmissionPolicy(
            keyframeIntervalUt: 30,
            quantum: EmissionQuantum.Absolute(0));

        private readonly ManualClock _clock;
        private readonly INetwork _network;
        private readonly Courier _courier;
        private readonly FleckTransportListener _listener;

        private readonly ConcurrentQueue<ICourierJob> _jobs = new ConcurrentQueue<ICourierJob>();
        private readonly SemaphoreSlim _jobSignal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _courierThread;

        // The OUTER (SubscriptionRegistry) / INNER (ChannelEmitter) gate
        // pair from Sitrep.Core, Courier-thread-only: a zero-subscriber
        // system.bodies channel is never even considered by the emitter,
        // let alone recorded into the Courier's delayed-delivery timeline.
        // This is exactly the call-site shape SubscriptionRegistry's own
        // doc comment names this class as the intended caller of. Distinct
        // from Sitrep.Host.Recorder (wired in GonogoAddon), which samples
        // and records UNCONDITIONALLY regardless of this gate.
        private readonly SubscriptionRegistry _subscriptions = new SubscriptionRegistry();
        private readonly ChannelEmitter _bodiesEmitter = new ChannelEmitter(BodiesEmissionPolicy);

        private readonly ConcurrentDictionary<string, ClientSession> _sessions = new ConcurrentDictionary<string, ClientSession>();

        private long _ackSeq;

        public int BoundPort => _listener.BoundPort;

        /// <param name="bindUri">A <c>ws://host:port</c> URI - see <see cref="FleckTransportListener"/>.</param>
        /// <param name="networkDelaySeconds">
        /// One-way delay the Courier applies between record and delivery.
        /// 0 for a same-machine/LAN bind (the only deployment this build
        /// targets) - a future config surface could expose this, but
        /// there's no real light-time to model for a local WS client.
        /// </param>
        public GonogoBodiesServer(string bindUri, double networkDelaySeconds = 0)
        {
            _clock = new ManualClock();
            _network = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            _courier = new Courier(_clock, _network);
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Gonogo-Courier" };
        }

        public void Start()
        {
            _courierThread.Start();
            _listener.Start();
        }

        public void Stop()
        {
            // Same ordering rationale as SkeletonServer.Stop: stop the
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
        // Main-loop domain (called from GonogoAddon.FixedUpdate)
        // ----------------------------------------------------------------

        /// <summary>
        /// Record one <see cref="SystemViewProvider.BuildSystemBodies"/>
        /// payload at <paramref name="ut"/>. Callable from any thread - it
        /// only ever touches primitives/the payload object and the explicit
        /// job queue, never <see cref="_courier"/>/<see cref="_clock"/> directly.
        /// </summary>
        public void Tick(double ut, object? bodiesPayload)
        {
            EnqueueJob(new TickJob(ut, bodiesPayload));
        }

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
                            // Quickload / timeline-rewind detection: paired
                            // 1:1 with the identical check in
                            // Sitrep.Host.IntegrationTests.ReplayBodiesServer.CourierLoop
                            // -- keep both in sync. Live KSP's UT jumps
                            // BACKWARD on an F9 quickload; without this,
                            // ManualClock.AdvanceTo's forward-only no-op
                            // leaves the courier wedged on the abandoned
                            // pre-quickload timeline (deliveries scheduled
                            // against the old peak UT never fire) until game
                            // UT re-climbs past that old peak -- a
                            // multi-minute live stall of system.bodies. The
                            // emitter is reset alongside the courier so the
                            // next Decide (once someone is subscribed) is an
                            // unconditional keyframe on the new timeline too,
                            // rather than staying gated by pre-quickload
                            // cadence/deadband state.
                            if (tick.Ut < _clock.Now())
                            {
                                _courier.ResetTimeline(tick.Ut);
                                _bodiesEmitter.Reset(tick.Ut);
                                BroadcastTimelineReset();
                            }

                            // Subscription-gated STREAM: zero subscribers for
                            // system.bodies means Decide is never even
                            // called, let alone recorded into the courier's
                            // delayed-delivery timeline (see
                            // SubscriptionRegistry's doc comment for this
                            // exact outer/inner gate shape). The Recorder
                            // dev-capture path in GonogoAddon.FixedUpdate
                            // already captured this same sample
                            // UNCONDITIONALLY, before this job was ever
                            // enqueued -- this gate affects only the live WS
                            // stream.
                            if (_subscriptions.IsSubscribed(BodiesTopic))
                            {
                                var decision = _bodiesEmitter.Decide(BodiesTopic, tick.Payload, tick.Ut);
                                if (decision.ShouldEmit)
                                {
                                    _courier.Record(SystemNode, BodiesTopic, decision.Value, tick.Ut);
                                }
                            }

                            _clock.AdvanceTo(tick.Ut);
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

        private void ProcessSubscribe(ClientSession session, string topic)
        {
            if (topic != BodiesTopic || session.Unsubscribers.ContainsKey(topic))
            {
                return;
            }

            // A genuine 0 -> 1 subscriber transition for system.bodies:
            // force an immediate keyframe on the emitter's NEXT Decide call
            // so this newly-joined subscriber doesn't wait out whatever
            // fraction of the keyframe cadence remains.
            if (_subscriptions.Subscribe(topic))
            {
                _bodiesEmitter.NotifySubscribed(topic);
            }

            var vantage = session.Connection.Id;
            var unsubscribe = _courier.SubscribeStream(SystemNode, topic, vantage, streamData =>
            {
                var json = EnvelopeCodec.WriteStreamData(streamData);
                session.Outbox.PublishTelemetry(topic, Encoding.UTF8.GetBytes(json));
            });
            session.Unsubscribers[topic] = unsubscribe;

            var ack = new EventMsg
            {
                Topic = topic,
                Name = "subscribed",
                Meta = new Meta
                {
                    Source = SystemNode,
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
        /// Courier-thread-only: notify every currently connected session that
        /// the timeline was reset (quickload UT-rewind) -- a distinct
        /// <see cref="EventMsg"/> (<c>name: "timeline-reset"</c>) using the
        /// exact same shape as the subscribe-ack in
        /// <see cref="ProcessSubscribe"/>, so a future client can tell
        /// "subscribed" and "timeline-reset" apart on the wire and knows to
        /// resync/abandon its own delayed view rather than assume the next
        /// <c>system.bodies</c> frame is a continuation of the pre-reset one.
        /// Paired 1:1 with
        /// <c>Sitrep.Host.IntegrationTests.ReplayBodiesServer.BroadcastTimelineReset</c>.
        /// </summary>
        private void BroadcastTimelineReset()
        {
            foreach (var session in _sessions.Values)
            {
                var reset = new EventMsg
                {
                    Topic = BodiesTopic,
                    Name = "timeline-reset",
                    Meta = new Meta
                    {
                        Source = SystemNode,
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
                        // CommandRequest<object?> is parsed but unhandled -
                        // no commands in this first build.
                }
            }
            catch (FormatException)
            {
                // Not a recognized envelope: echo back unchanged, matching
                // SkeletonServer's diagnostic behavior for a stray message.
                session.Connection.TrySend(payload, SendClass.Response);
            }
        }

        private void OnConnectionClosed(ClientSession session)
        {
            _sessions.TryRemove(session.Connection.Id, out _);
            EnqueueJob(new DisconnectJob(session));
            session.Outbox.Stop();
        }

        private void EnqueueJob(ICourierJob job)
        {
            _jobs.Enqueue(job);
            _jobSignal.Release();
        }

        // ----------------------------------------------------------------
        // Job types
        // ----------------------------------------------------------------

        private interface ICourierJob
        {
        }

        private sealed class TickJob : ICourierJob
        {
            public readonly double Ut;
            public readonly object? Payload;
            public TickJob(double ut, object? payload)
            {
                Ut = ut;
                Payload = payload;
            }
        }

        private sealed class SubscribeJob : ICourierJob
        {
            public readonly ClientSession Session;
            public readonly string Topic;
            public SubscribeJob(ClientSession session, string topic)
            {
                Session = session;
                Topic = topic;
            }
        }

        private sealed class UnsubscribeJob : ICourierJob
        {
            public readonly ClientSession Session;
            public readonly string Topic;
            public UnsubscribeJob(ClientSession session, string topic)
            {
                Session = session;
                Topic = topic;
            }
        }

        private sealed class DisconnectJob : ICourierJob
        {
            public readonly ClientSession Session;
            public DisconnectJob(ClientSession session)
            {
                Session = session;
            }
        }

        private sealed class StopJob : ICourierJob
        {
        }

        private sealed class ClientSession
        {
            public readonly ITransportConnection Connection;
            public readonly GonogoOutbox Outbox;
            public readonly Dictionary<string, Action> Unsubscribers = new Dictionary<string, Action>();

            public ClientSession(ITransportConnection connection)
            {
                Connection = connection;
                Outbox = new GonogoOutbox(connection);
            }
        }
    }

    /// <summary>
    /// The Courier -&gt; socket queue crossing for one connection - a
    /// same-shape copy of <c>Sitrep.Skeleton.ConnectionOutbox</c> (which is
    /// <c>internal</c> to that assembly and so not reusable here). See that
    /// class's doc comment for the full lossy-latest-telemetry /
    /// reliable-FIFO-response rationale; this is the identical pattern
    /// scoped to <see cref="GonogoBodiesServer"/>'s single topic.
    /// </summary>
    internal sealed class GonogoOutbox
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

        private readonly ITransportConnection _connection;
        private readonly ConcurrentDictionary<string, byte[]> _latestByTopic = new ConcurrentDictionary<string, byte[]>();
        private readonly ConcurrentQueue<byte[]> _reliable = new ConcurrentQueue<byte[]>();
        private readonly SemaphoreSlim _signal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _pumpThread;
        private volatile bool _stopping;

        public GonogoOutbox(ITransportConnection connection)
        {
            _connection = connection;
            _pumpThread = new Thread(PumpLoop) { IsBackground = true, Name = "Gonogo-Outbox-" + connection.Id };
            _pumpThread.Start();
        }

        /// <summary>Courier-thread-only: publish the latest serialized telemetry frame for a topic. Never blocks.</summary>
        public void PublishTelemetry(string topic, byte[] payload)
        {
            _latestByTopic[topic] = payload;
            _signal.Release();
        }

        /// <summary>Courier-thread-only: enqueue a reliable (never-dropped) frame - acks, echoes.</summary>
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

        /// <summary>Signals the pump thread to drain and exit - non-blocking, safe from any thread. See <c>ConnectionOutbox.Stop</c> for why this doesn't join.</summary>
        public void Stop()
        {
            _stopping = true;
            _signal.Release();
        }
    }
}
