using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Transport;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Skeleton
{
    /// <summary>
    /// The M5a walking-skeleton: wires <see cref="Courier"/> (the delay engine),
    /// <see cref="FleckTransportListener"/> (a real WebSocket transport), and
    /// <see cref="EnvelopeCodec"/> (the wire format) together over exactly the
    /// three-domain threading model the committed architecture calls for — no
    /// KSP anywhere in this assembly. If this behaves correctly here, M5b is
    /// wiring into the game, not a bet.
    ///
    /// <para><b>The three domains</b></para>
    /// <list type="bullet">
    /// <item><description><b>Main-loop domain</b> — simulates KSP's
    /// <c>FixedUpdate</c>. <see cref="Tick"/> is the entry point: in KSP,
    /// Unity's main thread would call it every fixed frame; here, whichever
    /// thread calls it (a test thread driving UT deterministically, or a
    /// free-running caller) stands in for that role. It touches nothing but
    /// primitives (a UT double + a counter value) and hands them across the
    /// explicit main-&gt;courier queue — it never touches <see cref="Courier"/>,
    /// <see cref="ManualClock"/>, or any Fleck/socket type directly.</description></item>
    /// <item><description><b>Courier domain</b> — one dedicated background
    /// thread (<see cref="_courierThread"/>) that is the ONLY thread ever
    /// allowed to touch <see cref="_courier"/> / <see cref="_clock"/> (neither
    /// is internally thread-safe). It drains a single ordered job queue fed by
    /// BOTH the main-loop (<see cref="Tick"/>) and the socket domain (subscribe
    /// / unsubscribe / disconnect), so ordering between "record this sample"
    /// and "this client (un)subscribed" is preserved exactly as the two
    /// domains issued it. Serialization (<see cref="EnvelopeCodec"/>) also
    /// happens here, inside the Courier's own delivery callback — never on a
    /// socket thread.</description></item>
    /// <item><description><b>Socket domain</b> — Fleck's own connection
    /// threads. <see cref="ITransportConnection.MessageReceived"/> fires here;
    /// inbound envelopes are parsed and handed off as courier-queue jobs
    /// (never processed inline against <see cref="_courier"/>). Outbound bytes
    /// cross the explicit courier-&gt;socket queue
    /// (<see cref="ConnectionOutbox"/>) and are sent via
    /// <see cref="ITransportConnection.TrySend"/> from that connection's own
    /// dedicated pump thread — never from the Courier thread.</description></item>
    /// </list>
    ///
    /// <para><b>Protocol (deliberately minimal — echo / counter-stream only)</b></para>
    /// A client may <c>subscribe</c> to the single topic <see cref="CounterTopic"/>
    /// on the single node <see cref="ShipNode"/>; the server acks with an
    /// <see cref="EventMsg"/> (<c>name: "subscribed"</c>) sent as a reliable
    /// frame, then delivers delayed <see cref="StreamData"/> frames as the
    /// main loop records samples. Any inbound frame that ISN'T a recognized
    /// <c>subscribe</c>/<c>unsubscribe</c>/<c>command-request</c> envelope
    /// (i.e. <see cref="EnvelopeCodec.ParseClientMessage"/> throws
    /// <see cref="FormatException"/>) is echoed back byte-for-byte, unchanged
    /// — this proves the inbound-&gt;outbound socket-domain wiring directly and
    /// needs no delay-engine involvement. <c>command-request</c> is parsed but
    /// deliberately left unhandled: command dispatch is out of this
    /// skeleton's scope (echo / delayed counter-stream / back-pressure /
    /// disconnect only).
    /// </summary>
    public sealed class SkeletonServer : IDisposable
    {
        public const string ShipNode = "ship";
        public const string CounterTopic = "counter";

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

        /// <summary>Set from inside the Courier-thread job loop; read by tests to prove Courier work never runs on a socket thread.</summary>
        public int? LastCourierThreadId { get; private set; }

        /// <summary>Set from inside a socket-domain event handler; read by tests to prove socket work never runs on the Courier thread.</summary>
        public int? LastSocketThreadId { get; private set; }

        /// <summary>Raised (from the Courier thread) once a disconnect has been fully processed and the session removed — a deterministic hook for tests instead of a polling loop.</summary>
        public event Action<string>? SessionRemoved;

        public int BoundPort => _listener.BoundPort;

        public SkeletonServer(string bindUri, double networkDelaySeconds)
        {
            _clock = new ManualClock();
            _network = new StubNetwork(delay: networkDelaySeconds, reachable: true);
            _courier = new Courier(_clock, _network);
            _listener = new FleckTransportListener(bindUri);
            _listener.ClientConnected += OnClientConnected;
            _courierThread = new Thread(CourierLoop) { IsBackground = true, Name = "Sitrep-Courier" };
        }

        public void Start()
        {
            _courierThread.Start();
            _listener.Start();
        }

        public void Stop()
        {
            // Stop the listener BEFORE winding down the Courier thread: any
            // Closed callback the listener/socket domain still raises while
            // tearing down (a client disconnecting during shutdown, e.g.)
            // enqueues a DisconnectJob via OnConnectionClosed, and that job
            // must still be drained so its unsubscribe runs — a subscriber
            // stranded in Courier's own subscription state otherwise. Rather
            // than racing a volatile flag against _jobs.IsEmpty (the previous,
            // buggy ordering could exit the Courier loop with a DisconnectJob
            // still in flight), enqueue an explicit sentinel job:
            // ConcurrentQueue is FIFO, so everything enqueued before the
            // sentinel — including anything the listener stop just triggered
            // — is guaranteed to be dequeued and processed before the loop
            // sees the sentinel and returns.
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
        // Main-loop domain
        // ----------------------------------------------------------------

        /// <summary>
        /// The main-loop tick: record one sample of the monotonically
        /// increasing counter at <paramref name="ut"/>, and request the
        /// shared clock be advanced to <paramref name="ut"/>. Callable from
        /// any thread (see the class doc comment) — it only ever touches
        /// primitives and the explicit job queue, never <see cref="_courier"/>
        /// or <see cref="_clock"/> directly.
        /// </summary>
        public void Tick(double ut, long counterValue)
        {
            EnqueueJob(new TickJob(ut, counterValue));
        }

        /// <summary>Test/ops-only: makes a connection's outbound telemetry sends artificially slow, simulating a non-draining client. See <see cref="ConnectionOutbox.SetArtificialTelemetrySendDelay"/>.</summary>
        public void SetTelemetrySendDelay(string connectionId, TimeSpan delay)
        {
            if (_sessions.TryGetValue(connectionId, out var session))
            {
                session.Outbox.SetArtificialTelemetrySendDelay(delay);
            }
        }

        /// <summary>Test-only: how many telemetry frames have actually been sent (post lossy-latest coalescing) to a given connection.</summary>
        public long GetTelemetrySentCount(string connectionId)
        {
            return _sessions.TryGetValue(connectionId, out var session) ? session.Outbox.TelemetrySentCount : 0;
        }

        public bool HasSession(string connectionId) => _sessions.ContainsKey(connectionId);

        // ----------------------------------------------------------------
        // Courier domain (the dedicated Courier thread — the only thread
        // that may touch _courier / _clock)
        // ----------------------------------------------------------------

        private void CourierLoop()
        {
            LastCourierThreadId = Thread.CurrentThread.ManagedThreadId;

            while (true)
            {
                _jobSignal.Wait(JobPollInterval);

                while (_jobs.TryDequeue(out var job))
                {
                    switch (job)
                    {
                        case StopJob:
                            // Sentinel: Stop() enqueues this only after
                            // stopping the listener, so anything the listener
                            // teardown triggered (DisconnectJobs included) was
                            // enqueued — and, by the loop above, drained —
                            // before this case is ever reached.
                            return;
                        case TickJob tick:
                            _courier.Record(ShipNode, CounterTopic, tick.CounterValue, tick.Ut);
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
            if (topic != CounterTopic || session.Unsubscribers.ContainsKey(topic))
            {
                return;
            }

            var vantage = session.Connection.Id;
            var unsubscribe = _courier.SubscribeStream(ShipNode, topic, vantage, streamData =>
            {
                // Still the Courier thread: this callback runs synchronously
                // from inside Courier.SubscribeStream's catch-up call or from
                // inside ManualClock.AdvanceTo's drain loop. Serialization
                // happens here, then the bytes cross the explicit
                // courier->socket queue via the connection's ConnectionOutbox
                // — TrySend itself is called later, from that connection's
                // own pump thread, never from here.
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
                    Source = ShipNode,
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

        private static void ProcessUnsubscribe(ClientSession session, string topic)
        {
            if (session.Unsubscribers.TryGetValue(topic, out var unsubscribe))
            {
                unsubscribe();
                session.Unsubscribers.Remove(topic);
            }
        }

        private void ProcessDisconnect(ClientSession session)
        {
            foreach (var unsubscribe in session.Unsubscribers.Values)
            {
                unsubscribe();
            }
            session.Unsubscribers.Clear();
            SessionRemoved?.Invoke(session.Connection.Id);
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
            LastSocketThreadId = Thread.CurrentThread.ManagedThreadId;

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
                        // CommandRequest<object?> is parsed but deliberately
                        // unhandled here — out of scope for this skeleton.
                }
            }
            catch (FormatException)
            {
                // Not a recognized envelope: echo the raw bytes back exactly
                // as received. Pure socket-domain work — no Courier/delay
                // involvement needed for an instantaneous echo.
                session.Connection.TrySend(payload, SendClass.Response);
            }
        }

        private void OnConnectionClosed(ClientSession session)
        {
            _sessions.TryRemove(session.Connection.Id, out _);
            // Unsubscribing mutates Courier-owned state (the subscriber
            // HashSet) -- marshal it to the Courier thread rather than doing
            // it inline here on a Fleck socket thread.
            EnqueueJob(new DisconnectJob(session));
            session.Outbox.Stop();
        }

        private void EnqueueJob(ICourierJob job)
        {
            _jobs.Enqueue(job);
            _jobSignal.Release();
        }

        // ----------------------------------------------------------------
        // Job types crossing the main-loop/socket -> Courier queue
        // ----------------------------------------------------------------

        private interface ICourierJob
        {
        }

        private sealed class TickJob : ICourierJob
        {
            public readonly double Ut;
            public readonly long CounterValue;
            public TickJob(double ut, long counterValue)
            {
                Ut = ut;
                CounterValue = counterValue;
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

        /// <summary>Shutdown sentinel — see <see cref="Stop"/> and <see cref="CourierLoop"/>.</summary>
        private sealed class StopJob : ICourierJob
        {
        }

        /// <summary>
        /// Per-connection state. <see cref="Unsubscribers"/> is mutated ONLY
        /// from the Courier thread (Process* methods above) — same
        /// single-writer invariant as <see cref="_courier"/> itself.
        /// <see cref="Outbox"/> is the courier-&gt;socket queue crossing and
        /// owns its own independent pump thread (see
        /// <see cref="ConnectionOutbox"/>).
        /// </summary>
        private sealed class ClientSession
        {
            public readonly ITransportConnection Connection;
            public readonly ConnectionOutbox Outbox;
            public readonly Dictionary<string, Action> Unsubscribers = new Dictionary<string, Action>();

            public ClientSession(ITransportConnection connection)
            {
                Connection = connection;
                Outbox = new ConnectionOutbox(connection);
            }
        }
    }
}
