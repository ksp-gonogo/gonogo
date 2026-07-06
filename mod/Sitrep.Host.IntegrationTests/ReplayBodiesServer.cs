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

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Headless stand-in for <c>Gonogo.KSP.GonogoBodiesServer</c> -- the SAME
    /// wiring shape (<see cref="Courier"/> + <see cref="FleckTransportListener"/>
    /// over the single <see cref="SystemViewProvider.Topic"/> stream, following
    /// the three-domain threading model <c>Sitrep.Skeleton.SkeletonServer</c>
    /// proved out in M5a), copied rather than referenced: <c>Gonogo.KSP</c> is
    /// a net472 assembly with KSP/Unity reference assemblies (see its csproj),
    /// and Task 6 is explicitly required to stay KSP-free end to end, so this
    /// project cannot take a <c>ProjectReference</c> on it. This is the exact
    /// counterpart to how <c>GonogoBodiesServer</c> itself was built -- a
    /// same-shape copy of <c>Sitrep.Skeleton.SkeletonServer</c>'s
    /// Courier/outbox pattern, because THAT class's <c>ConnectionOutbox</c> is
    /// <c>internal</c> to its own assembly.
    ///
    /// The only behavioral difference from <c>GonogoBodiesServer</c>: ticks
    /// are driven from a <see cref="ReplayKspHost"/> instead of live KSP (see
    /// <c>ReplayToWebSocketEndToEndTests</c>'s driver loop), and this class
    /// exposes <see cref="LastCourierThreadId"/> / a job-barrier so the test
    /// can deterministically wait for one <see cref="Tick"/> to finish being
    /// processed on the Courier thread before asserting on the wire.
    /// </summary>
    internal sealed class ReplayBodiesServer : IDisposable
    {
        public const string SystemNode = "system";
        public static readonly string BodiesTopic = SystemViewProvider.Topic;

        private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(50);

        private readonly ManualClock _clock;
        private readonly INetwork _network;
        private readonly Courier _courier;
        private readonly FleckTransportListener _listener;

        private readonly ConcurrentQueue<ICourierJob> _jobs = new ConcurrentQueue<ICourierJob>();
        private readonly SemaphoreSlim _jobSignal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _courierThread;

        private readonly ConcurrentDictionary<string, ClientSession> _sessions = new ConcurrentDictionary<string, ClientSession>();

        private long _ackSeq;

        public int BoundPort => _listener.BoundPort;

        public ReplayBodiesServer(string bindUri, double networkDelaySeconds)
        {
            _clock = new ManualClock();
            _network = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            _courier = new Courier(_clock, _network);
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "ReplayBodies-Courier" };
        }

        public void Start()
        {
            _courierThread.Start();
            _listener.Start();
        }

        public void Stop()
        {
            // Same ordering rationale as SkeletonServer.Stop/GonogoBodiesServer.Stop:
            // stop the listener first so any Closed callback it raises while
            // tearing down enqueues its DisconnectJob before the sentinel
            // StopJob, guaranteeing FIFO drain processes it.
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
        // Main-loop domain (called from the test's replay-driving loop)
        // ----------------------------------------------------------------

        /// <summary>
        /// Record one <see cref="SystemViewProvider.BuildSystemBodies"/>
        /// payload at <paramref name="ut"/> -- the replay counterpart of
        /// <c>GonogoAddon.FixedUpdate</c> handing a sampled payload to
        /// <c>GonogoBodiesServer.Tick</c>. Callable from any thread -- it
        /// only touches primitives/the payload object and the explicit job
        /// queue, never <see cref="_courier"/>/<see cref="_clock"/> directly.
        /// </summary>
        public void Tick(double ut, object? bodiesPayload)
        {
            var barrier = new ManualResetEventSlim(false);
            EnqueueJob(new TickJob(ut, bodiesPayload, barrier));
            // Block the calling (test) thread until the Courier thread has
            // actually finished this job -- Record() + AdvanceTo() (and any
            // resulting synchronous delivery/outbox publish) are done by the
            // time Tick() returns. This is what lets the test drive the
            // replay deterministically: no message can be "still in flight
            // through the job queue" when the test goes on to assert on the
            // wire (or asserts none arrived yet).
            barrier.Wait(TimeSpan.FromSeconds(10));
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
                            // Gonogo.KSP.GonogoBodiesServer.CourierLoop --
                            // keep both in sync. This copy exists because
                            // Gonogo.KSP is a net472 assembly with KSP/Unity
                            // reference assemblies this headless test project
                            // cannot reference (see this class's own doc
                            // comment), so it has no direct test coverage of
                            // its own -- this test-side copy IS the coverage.
                            // See ServerClockRewindResetsCourierAndResumesDeliveryWithoutStalling
                            // in ReplayToWebSocketEndToEndTests.cs for the
                            // test that exercises this branch.
                            if (tick.Ut < _clock.Now())
                            {
                                _courier.ResetTimeline(tick.Ut);
                                BroadcastTimelineReset();
                            }
                            _courier.Record(SystemNode, BodiesTopic, tick.Payload, tick.Ut);
                            _clock.AdvanceTo(tick.Ut);
                            tick.Done.Set();
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
        /// <see cref="ProcessSubscribe"/>. Paired 1:1 with
        /// <c>Gonogo.KSP.GonogoBodiesServer.BroadcastTimelineReset</c>.
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

        private static void ProcessUnsubscribe(ClientSession session, string topic)
        {
            if (session.Unsubscribers.TryGetValue(topic, out var unsubscribe))
            {
                unsubscribe();
                session.Unsubscribers.Remove(topic);
            }
        }

        private static void ProcessDisconnect(ClientSession session)
        {
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
                        // CommandRequest<object?> is parsed but unhandled --
                        // no commands in this topic-only harness.
                }
            }
            catch (FormatException)
            {
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
            public readonly ManualResetEventSlim Done;
            public TickJob(double ut, object? payload, ManualResetEventSlim done)
            {
                Ut = ut;
                Payload = payload;
                Done = done;
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
            public readonly ReplayOutbox Outbox;
            public readonly Dictionary<string, Action> Unsubscribers = new Dictionary<string, Action>();

            public ClientSession(ITransportConnection connection)
            {
                Connection = connection;
                Outbox = new ReplayOutbox(connection);
            }
        }
    }

    /// <summary>
    /// The Courier -&gt; socket queue crossing for one connection -- a
    /// same-shape copy of <c>Gonogo.KSP.GonogoOutbox</c> /
    /// <c>Sitrep.Skeleton.ConnectionOutbox</c> (both <c>internal</c> to their
    /// own assemblies and so not reusable here). Lossy-latest per topic for
    /// telemetry, reliable FIFO for acks/echoes -- see those classes' doc
    /// comments for the full rationale.
    /// </summary>
    internal sealed class ReplayOutbox
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

        private readonly ITransportConnection _connection;
        private readonly ConcurrentDictionary<string, byte[]> _latestByTopic = new ConcurrentDictionary<string, byte[]>();
        private readonly ConcurrentQueue<byte[]> _reliable = new ConcurrentQueue<byte[]>();
        private readonly SemaphoreSlim _signal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _pumpThread;
        private volatile bool _stopping;

        public ReplayOutbox(ITransportConnection connection)
        {
            _connection = connection;
            _pumpThread = new Thread(PumpLoop) { IsBackground = true, Name = "ReplayBodies-Outbox-" + connection.Id };
            _pumpThread.Start();
        }

        public void PublishTelemetry(string topic, byte[] payload)
        {
            _latestByTopic[topic] = payload;
            _signal.Release();
        }

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

        public void Stop()
        {
            _stopping = true;
            _signal.Release();
        }
    }
}
