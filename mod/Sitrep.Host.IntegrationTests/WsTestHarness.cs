using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The real-<see cref="ClientWebSocket"/> test harness shared by every
    /// integration test in this project that talks to a
    /// <see cref="ChannelEngine"/> over the wire — extracted from
    /// <c>ReplayToWebSocketEndToEndTests</c> (which used to keep its own
    /// private copy, same shape as <c>Sitrep.Skeleton.Tests</c>'s) so
    /// <c>ChannelEngineTests</c> doesn't need a second copy. Consumers add
    /// <c>using static Sitrep.Host.IntegrationTests.WsTestHarness;</c> to call
    /// these unqualified, matching the call-site shape both test classes
    /// already used before the extraction.
    /// </summary>
    internal static class WsTestHarness
    {
        public static async Task<EventMsg> SubscribeAsync(TestClient client, string topic, TimeSpan timeout)
        {
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = topic }));
            return await ReceiveTypedAsync<EventMsg>(client, timeout);
        }

        public static async Task<StreamData> ReceiveStreamDataAsync(TestClient client, TimeSpan timeout)
        {
            return await ReceiveTypedAsync<StreamData>(client, timeout);
        }

        /// <summary>
        /// Drains <see cref="StreamData"/> frames until none arrive for a
        /// short quiet window, returning the LAST one seen -- the
        /// lossy-latest convergence point for a coalescing per-topic outbox
        /// (see <c>ChannelOutbox</c>). Needed wherever two Courier deliveries
        /// for the same topic can become due within a single clock-advance:
        /// which of them (if any, besides the last) actually reaches the
        /// wire as its own frame depends on exactly when the outbox's
        /// independent pump thread wakes up relative to the Courier thread's
        /// writes -- a genuine two-thread race, not something a single
        /// "receive the next message" call can assert on deterministically.
        /// The LAST frame observed is NOT racy, though: whichever delivery's
        /// <c>PublishTelemetry</c> call happened last in real time is
        /// guaranteed to be what any subsequent send reflects. Same idiom as
        /// <c>SkeletonServerIntegrationTests.DrainToLatestAsync</c>.
        /// </summary>
        public static async Task<StreamData?> DrainToLatestStreamDataAsync(TestClient client, TimeSpan quietWindow)
        {
            StreamData? last = null;
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(quietWindow);
                }
                catch (OperationCanceledException)
                {
                    return last;
                }

                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData streamData)
                {
                    last = streamData;
                }
            }
        }

        /// <summary>
        /// Drains every message that arrives within <paramref name="quietWindow"/>
        /// of the last one seen, returning ALL <see cref="StreamData"/> frames
        /// observed (any topic), in arrival order — the counterpart to
        /// <see cref="DrainToLatestStreamDataAsync"/> for asserting on the
        /// FULL sequence (used to prove a reliable-ordered channel never
        /// drops/coalesces a frame, where "just the last one" isn't a strong
        /// enough assertion). Callers subscribed to more than one topic
        /// should partition the result themselves (by <c>.Topic</c>) rather
        /// than calling this once per topic — a second drain call would find
        /// the channel already exhausted by the first.
        /// </summary>
        public static async Task<System.Collections.Generic.List<StreamData>> DrainAllStreamDataAsync(TestClient client, TimeSpan quietWindow)
        {
            var seen = new System.Collections.Generic.List<StreamData>();
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(quietWindow);
                }
                catch (OperationCanceledException)
                {
                    return seen;
                }

                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData streamData)
                {
                    seen.Add(streamData);
                }
            }
        }

        public static async Task<T> ReceiveTypedAsync<T>(TestClient client, TimeSpan timeout) where T : class
        {
            var deadline = DateTime.UtcNow + timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException($"No {typeof(T).Name} arrived within {timeout}.");
                }
                var parsed = EnvelopeCodec.ParseServerMessage(await client.ReceiveAsync(remaining));
                if (parsed is T typed)
                {
                    return typed;
                }
            }
        }

        internal sealed class TestClient : IAsyncDisposable
        {
            private readonly ClientWebSocket _socket = new ClientWebSocket();

            // AllowSynchronousContinuations: when the pump thread hands a frame
            // to a test that is already parked in ReceiveAsync, run that
            // reader's continuation INLINE on the pump thread instead of
            // queuing it to the thread pool. Together with the dedicated pump
            // thread below, this takes the whole server->client delivery path
            // off the thread pool. That is the fix for this suite's flake: the
            // failures were never a server/engine wedge (the engine's Courier
            // and Outbox run on dedicated threads and were always found idle at
            // the stall) — they were the async CLIENT pipeline starving under
            // CPU contention, so a frame the server had already sent was not
            // picked up before the 10s per-op deadline.
            private readonly Channel<string> _incoming = Channel.CreateUnbounded<string>(
                new UnboundedChannelOptions
                {
                    AllowSynchronousContinuations = true,
                    SingleWriter = true,
                    SingleReader = false,
                });
            private readonly CancellationTokenSource _pumpCts = new CancellationTokenSource();
            private Thread? _pumpThread;

            public static async Task<TestClient> ConnectAsync(int port, TimeSpan timeout)
            {
                var client = new TestClient();
                using var connectCts = new CancellationTokenSource(timeout);
                await client._socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/"), connectCts.Token);
                client._pumpThread = new Thread(client.PumpLoop)
                {
                    IsBackground = true,
                    Name = "WsTestHarness-Pump",
                };
                client._pumpThread.Start();
                return client;
            }

            // Runs on a DEDICATED thread and BLOCKS on each receive rather than
            // awaiting it. The socket engine signals this thread's blocked wait
            // directly on completion, so frame delivery no longer depends on a
            // thread-pool worker being schedulable — the property that made the
            // suite robust to the CPU-starvation flake. Writes land via
            // TryWrite (the channel is unbounded, so it always succeeds and
            // never blocks the pump).
            private void PumpLoop()
            {
                var buffer = new byte[16384];
                try
                {
                    while (_socket.State == WebSocketState.Open && !_pumpCts.IsCancellationRequested)
                    {
                        using var ms = new MemoryStream();
                        WebSocketReceiveResult result;
                        do
                        {
                            result = _socket
                                .ReceiveAsync(new ArraySegment<byte>(buffer), _pumpCts.Token)
                                .GetAwaiter()
                                .GetResult();
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                return;
                            }
                            ms.Write(buffer, 0, result.Count);
                        } while (!result.EndOfMessage);

                        _incoming.Writer.TryWrite(Encoding.UTF8.GetString(ms.ToArray()));
                    }
                }
                catch (Exception)
                {
                    // Best-effort pump on a background thread: ANY exception
                    // (cancellation, WebSocketException, ObjectDisposedException
                    // from a torn-down socket on teardown, a faulted-task
                    // AggregateException from GetResult) just ends the loop.
                    // It must never escape and fault the thread.
                }
            }

            public Task SendAsync(string text)
            {
                var bytes = Encoding.UTF8.GetBytes(text);
                return _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }

            public async Task<string> ReceiveAsync(TimeSpan timeout)
            {
                using var cts = new CancellationTokenSource(timeout);
                return await _incoming.Reader.ReadAsync(cts.Token);
            }

            public async Task AssertNoMessageArrivesAsync(TimeSpan window)
            {
                using var cts = new CancellationTokenSource(window);
                await Xunit.Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
                    await _incoming.Reader.ReadAsync(cts.Token));
            }

            public ValueTask DisposeAsync()
            {
                _pumpCts.Cancel();
                // Abort() (not just Dispose) forces a pending blocking
                // ReceiveAsync on the pump thread to throw RIGHT NOW rather than
                // waiting on token propagation, so teardown doesn't stall while
                // the pump sits in a receive that has no more data coming.
                try { _socket.Abort(); } catch { }
                _socket.Dispose();
                // Deliberately NOT joining the pump thread here. It is a
                // background thread that unblocks off the Abort/Dispose above
                // and exits on its own; it holds no shared state past this
                // point and dies with the process. Joining would stall teardown
                // whenever ClientWebSocket.Abort doesn't interrupt the blocking
                // receive promptly — which, across ~100 tests, added ~minutes.
                return ValueTask.CompletedTask;
            }
        }
    }
}
