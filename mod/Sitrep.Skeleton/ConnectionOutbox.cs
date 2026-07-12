using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using Sitrep.Transport;

namespace Sitrep.Skeleton
{
    /// <summary>
    /// The COURIER -&gt; SOCKET queue crossing for one connection, and the
    /// per-connection "socket-adjacent" domain that drains it. Every telemetry
    /// <see cref="SendClass.Telemetry"/> delivery the Courier thread produces
    /// for this connection is written into <see cref="PublishTelemetry"/>
    /// rather than sent inline, so the Courier thread is never blocked by
    /// (and never directly calls) <see cref="ITransportConnection.TrySend"/>.
    ///
    /// Telemetry is LOSSY-LATEST: <see cref="_latestByTopic"/> holds at most
    /// one not-yet-sent payload per topic. A publish for a topic that already
    /// has an unsent payload OVERWRITES it — the older value is dropped, never
    /// queued. This bounds memory regardless of producer/consumer speed
    /// mismatch and means a slow-draining connection coalesces to whatever is
    /// freshest by the time its dedicated <see cref="_pumpThread"/> gets back
    /// around to it, instead of piling up an ever-growing backlog. Response
    /// (ack/echo) traffic goes through the separate <see cref="_reliable"/>
    /// FIFO queue instead, which is never coalesced or dropped.
    ///
    /// Each connection owns its OWN dedicated pump thread — a slow connection
    /// only ever stalls its own thread (see
    /// <see cref="SetArtificialTelemetrySendDelay"/>, used by the back-pressure
    /// test to simulate a non-draining client deterministically), never the
    /// Courier thread and never another connection's pump.
    /// </summary>
    internal sealed class ConnectionOutbox
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

        private readonly ITransportConnection _connection;
        private readonly ConcurrentDictionary<string, byte[]> _latestByTopic = new ConcurrentDictionary<string, byte[]>();
        private readonly ConcurrentQueue<byte[]> _reliable = new ConcurrentQueue<byte[]>();
        private readonly SemaphoreSlim _signal = new SemaphoreSlim(0, int.MaxValue);
        private readonly Thread _pumpThread;
        private volatile bool _stopping;
        private volatile int _artificialDelayMs;

        /// <summary>Count of telemetry frames actually handed to <see cref="ITransportConnection.TrySend"/> (post-coalescing) — used by tests to prove lossy-latest coalescing quantitatively.</summary>
        public long TelemetrySentCount;

        public ConnectionOutbox(ITransportConnection connection)
        {
            _connection = connection;
            _pumpThread = new Thread(PumpLoop) { IsBackground = true, Name = "Sitrep-Outbox-" + connection.Id };
            _pumpThread.Start();
        }

        /// <summary>
        /// Courier-thread-only call: publish the latest serialized telemetry
        /// frame for <paramref name="topic"/>. Never blocks — a dictionary
        /// write plus a semaphore release, regardless of how backed up this
        /// connection's own pump thread is.
        /// </summary>
        public void PublishTelemetry(string topic, byte[] payload)
        {
            _latestByTopic[topic] = payload;
            _signal.Release();
        }

        /// <summary>Courier-thread-only call: enqueue a reliable (never-dropped, never-coalesced) frame — acks, echoes, command responses.</summary>
        public void PublishReliable(byte[] payload)
        {
            _reliable.Enqueue(payload);
            _signal.Release();
        }

        /// <summary>
        /// Test-only knob: makes this connection's pump thread sleep for
        /// <paramref name="delay"/> before each telemetry send, simulating a
        /// slow/non-draining client at the outbound-send seam. This only ever
        /// stalls THIS connection's own dedicated thread — see the class doc
        /// comment and the M5a Task 9 report for why an artificial delay was
        /// chosen over trying to force genuine OS-level TCP-window
        /// backpressure (which is real but not deterministically reproducible
        /// in a fast, non-flaky unit test).
        /// </summary>
        public void SetArtificialTelemetrySendDelay(TimeSpan delay)
        {
            _artificialDelayMs = (int)delay.TotalMilliseconds;
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

                // Snapshot topic keys before draining: PublishTelemetry can add
                // new topics concurrently from the Courier thread mid-loop;
                // ConcurrentDictionary enumeration is weakly-consistent, so we
                // materialize first rather than iterate-while-mutating.
                foreach (var topic in _latestByTopic.Keys.ToArray())
                {
                    if (!_latestByTopic.TryRemove(topic, out var payload))
                    {
                        continue;
                    }

                    var delayMs = _artificialDelayMs;
                    if (delayMs > 0)
                    {
                        Thread.Sleep(delayMs);
                    }

                    _connection.TrySend(new ArraySegment<byte>(payload), SendClass.Telemetry);
                    Interlocked.Increment(ref TelemetrySentCount);
                }
            }
        }

        /// <summary>
        /// Signals the pump thread to drain whatever's queued and exit — non-blocking,
        /// safe to call from any thread. This deliberately does NOT join the pump
        /// thread: <see cref="SkeletonServer.OnConnectionClosed"/> calls this from
        /// whatever thread Fleck raises its <c>Closed</c> callback on, which may be a
        /// shared/pooled socket thread rather than one dedicated to this connection —
        /// a synchronous multi-second join there risked starving that pool under
        /// concurrent disconnects. <see cref="_pumpThread"/> is a background thread,
        /// so it never blocks process exit even if no caller ever observes it finish.
        /// </summary>
        public void Stop()
        {
            _stopping = true;
            _signal.Release();
        }
    }
}
