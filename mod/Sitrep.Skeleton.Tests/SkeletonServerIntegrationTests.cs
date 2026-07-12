using System;
using System.Diagnostics;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Skeleton;
using Xunit;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Skeleton.Tests
{
    /// <summary>
    /// M5a Task 9: the walking-skeleton integration suite. Every test here
    /// drives a real <see cref="ClientWebSocket"/> against a real
    /// <see cref="SkeletonServer"/> (Courier + Fleck transport + envelope
    /// codec, wired over the three-domain threading model) — headlessly, no
    /// KSP. See <see cref="SkeletonServer"/>'s doc comment for the
    /// architecture these tests are proving.
    /// </summary>
    public class SkeletonServerIntegrationTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task Echo_RoundTripsUnrecognizedFramesUnchanged()
        {
            using var server = new SkeletonServer("ws://127.0.0.1:0", networkDelaySeconds: 1.0);
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);

                // Plain non-JSON text.
                const string plain = "just-a-plain-string-not-json";
                await client.SendAsync(plain);
                Assert.Equal(plain, await client.ReceiveAsync(Timeout));

                // Valid JSON, but not a recognized client envelope type.
                const string unrecognized = "{\"type\":\"echo\",\"message\":\"hi\"}";
                await client.SendAsync(unrecognized);
                Assert.Equal(unrecognized, await client.ReceiveAsync(Timeout));
            }
            finally
            {
                server.Stop();
            }
        }

        [Fact]
        public async Task DelayedCounterStream_ArrivesGenuinelyDelayed()
        {
            const double delaySeconds = 2.0;
            using var server = new SkeletonServer("ws://127.0.0.1:0", delaySeconds);
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, SkeletonServer.CounterTopic, Timeout);

                // Record two samples still in flight -- neither's delivery is due yet.
                server.Tick(10.0, 1);
                server.Tick(11.999, 2);

                // Structurally can't have arrived: ManualClock.AdvanceTo has only
                // reached 11.999, and value 1's delivery isn't scheduled until
                // validAt(10) + delay(2) = 12. This is a genuine, non-flaky
                // negative assertion -- Courier's own scheduling logic forbids
                // early delivery, the bounded wait is just how we observe it over
                // the wire without blocking forever.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // Advance the shared clock to exactly the first delivery's fire-UT.
                server.Tick(12.0, 3);
                var first = await ReceiveTypedAsync<StreamData>(client, Timeout);
                Assert.Equal(SkeletonServer.CounterTopic, first.Topic);
                Assert.Equal(1.0, (double)first.Payload!);
                Assert.Equal(10.0, first.Meta.ValidAt);
                Assert.Equal(12.0, first.Meta.DeliveredAt);
                Assert.Equal(delaySeconds, first.Meta.DeliveredAt - first.Meta.ValidAt, precision: 6);

                // Advance to the second delivery's fire-UT (11.999 + 2 = 13.999).
                server.Tick(13.999, 4);
                var second = await ReceiveTypedAsync<StreamData>(client, Timeout);
                Assert.Equal(2.0, (double)second.Payload!);
                Assert.Equal(11.999, second.Meta.ValidAt, precision: 3);
                Assert.Equal(13.999, second.Meta.DeliveredAt, precision: 3);
            }
            finally
            {
                server.Stop();
            }
        }

        [Fact]
        public async Task BackPressure_SlowClientCoalescesWithoutStallingFastClientOrCourier()
        {
            using var server = new SkeletonServer("ws://127.0.0.1:0", networkDelaySeconds: 0);
            server.Start();
            try
            {
                await using var fast = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await using var slow = await TestClient.ConnectAsync(server.BoundPort, Timeout);

                var fastAck = await SubscribeAsync(fast, SkeletonServer.CounterTopic, Timeout);
                var slowAck = await SubscribeAsync(slow, SkeletonServer.CounterTopic, Timeout);

                // Simulate a non-draining client at the outbound-send seam --
                // see ConnectionOutbox's doc comment for why an artificial delay
                // was chosen over forcing genuine OS-level TCP backpressure
                // (real, but not deterministically reproducible in a fast test).
                server.SetTelemetrySendDelay(slowAck.Meta.Vantage, TimeSpan.FromMilliseconds(150));

                const int tickCount = 30;
                var burst = Stopwatch.StartNew();
                for (var i = 1; i <= tickCount; i++)
                {
                    server.Tick(i, i);
                }
                burst.Stop();

                var lastFast = await DrainToLatestAsync(fast);
                Assert.NotNull(lastFast);
                Assert.Equal((double)tickCount, (double)lastFast!.Payload!);

                var slowDrain = Stopwatch.StartNew();
                var lastSlow = await DrainToLatestAsync(slow, overallTimeout: TimeSpan.FromSeconds(10));
                slowDrain.Stop();
                Assert.NotNull(lastSlow);
                Assert.Equal((double)tickCount, (double)lastSlow!.Payload!);

                // The main-loop domain must never be slowed by a non-draining
                // client. Proven RELATIVELY rather than against an absolute
                // wall-clock bound (which can flake on a loaded CI runner):
                // the slow connection's artificial per-send delay (150ms)
                // forces its own drain to take roughly tickCount * 150ms
                // regardless of machine load, so comparing the burst's
                // duration against that drain's duration is a load-tolerant
                // proxy for "Tick() wasn't blocked on the slow client's pump"
                // -- if it had been, the burst itself would take as long as
                // (or longer than) the slow drain, not a small fraction of it.
                Assert.True(
                    burst.ElapsedMilliseconds < slowDrain.ElapsedMilliseconds / 2,
                    $"Tick() burst took {burst.ElapsedMilliseconds}ms vs. {slowDrain.ElapsedMilliseconds}ms for the " +
                    "slow client to drain -- looks like it's blocking on a slow client.");

                var fastSent = server.GetTelemetrySentCount(fastAck.Meta.Vantage);
                var slowSent = server.GetTelemetrySentCount(slowAck.Meta.Vantage);
                Assert.True(
                    slowSent < tickCount,
                    $"expected lossy-latest coalescing (< {tickCount} sends) but the slow client got {slowSent}");
                Assert.True(
                    fastSent > slowSent,
                    $"expected the fast client ({fastSent} sends) to receive strictly more frames than the slow client ({slowSent})");

                // Courier tick isn't wedged after the burst: one more tick, fast
                // client sees it promptly.
                server.Tick(tickCount + 1, tickCount + 1);
                var after = await ReceiveTypedAsync<StreamData>(fast, Timeout);
                Assert.Equal((double)(tickCount + 1), (double)after.Payload!);
            }
            finally
            {
                server.Stop();
            }
        }

        [Fact]
        public async Task Disconnect_FreesSubscriptionStateAndServerStaysHealthy()
        {
            using var server = new SkeletonServer("ws://127.0.0.1:0", networkDelaySeconds: 0);
            server.Start();
            try
            {
                var removedTcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                server.SessionRemoved += id => removedTcs.TrySetResult(id);

                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                var ack = await SubscribeAsync(client, SkeletonServer.CounterTopic, Timeout);
                var connectionId = ack.Meta.Vantage;

                server.Tick(1, 1);
                var first = await ReceiveTypedAsync<StreamData>(client, Timeout);
                Assert.Equal(1.0, (double)first.Payload!);
                Assert.True(server.HasSession(connectionId));

                await client.CloseAsync(Timeout);
                var removedId = await removedTcs.Task.WaitAsync(Timeout);
                Assert.Equal(connectionId, removedId);
                Assert.False(server.HasSession(connectionId));

                // Server stays healthy after the disconnect: further ticks don't
                // crash/hang, and a brand-new client is served completely
                // normally (no global stall, no leaked state blocking new work).
                server.Tick(2, 2);

                await using var freshClient = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(freshClient, SkeletonServer.CounterTopic, Timeout);
                server.Tick(3, 3);
                var freshFirst = await ReceiveTypedAsync<StreamData>(freshClient, Timeout);
                Assert.Equal(3.0, (double)freshFirst.Payload!);
            }
            finally
            {
                server.Stop();
            }
        }

        [Fact]
        public async Task CourierAndSocketDomains_RunOnDifferentThreads()
        {
            using var server = new SkeletonServer("ws://127.0.0.1:0", networkDelaySeconds: 0);
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, SkeletonServer.CounterTopic, Timeout); // exercises the socket thread
                server.Tick(1, 1); // exercises the Courier thread
                await client.ReceiveAsync(Timeout);

                Assert.NotNull(server.LastCourierThreadId);
                Assert.NotNull(server.LastSocketThreadId);
                Assert.NotEqual(server.LastCourierThreadId, server.LastSocketThreadId);
            }
            finally
            {
                server.Stop();
            }
        }

        // ---------------------------------------------------------------
        // Test helpers
        // ---------------------------------------------------------------

        /// <summary>
        /// Sends a subscribe envelope and waits specifically for the
        /// "subscribed" ack (<see cref="EventMsg"/>) -- NOT just "the next
        /// message", because when the archive is non-empty (delay 0, or a
        /// sample already recorded) <c>Courier.SubscribeStream</c>'s
        /// synchronous catch-up can also produce an immediate
        /// <see cref="StreamData"/> delivery. Filtering by type here is what
        /// a real client would do anyway (dispatch on the envelope's "type"
        /// discriminant), and it makes this helper robust regardless of
        /// exactly how ack vs. catch-up interleave on the wire.
        /// </summary>
        private static async Task<EventMsg> SubscribeAsync(TestClient client, string topic, TimeSpan timeout)
        {
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = topic }));
            return await ReceiveTypedAsync<EventMsg>(client, timeout);
        }

        /// <summary>Receives messages, discarding any whose parsed envelope isn't a <typeparamref name="T"/>, until one matches or <paramref name="timeout"/> elapses.</summary>
        private static async Task<T> ReceiveTypedAsync<T>(TestClient client, TimeSpan timeout) where T : class
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

        /// <summary>Drains <see cref="StreamData"/> messages until none arrive for a short quiet window, returning the last one seen -- the lossy-latest convergence point for a coalescing connection. Non-StreamData frames (acks etc.) are ignored rather than treated as a type mismatch.</summary>
        private static async Task<StreamData?> DrainToLatestAsync(TestClient client, TimeSpan? overallTimeout = null)
        {
            var deadline = DateTime.UtcNow + (overallTimeout ?? TimeSpan.FromSeconds(2));
            StreamData? last = null;
            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    var parsed = EnvelopeCodec.ParseServerMessage(await client.ReceiveAsync(TimeSpan.FromMilliseconds(500)));
                    if (parsed is StreamData streamData)
                    {
                        last = streamData;
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
            return last;
        }

        /// <summary>
        /// Wraps a real <see cref="ClientWebSocket"/> with a background read
        /// pump so tests can assert both "a message arrives" and "no message
        /// arrives within a window" without violating .NET's one-outstanding-
        /// ReceiveAsync-call-at-a-time constraint.
        /// </summary>
        private sealed class TestClient : IAsyncDisposable
        {
            private readonly ClientWebSocket _socket = new ClientWebSocket();
            private readonly Channel<string> _incoming = Channel.CreateUnbounded<string>();
            private readonly CancellationTokenSource _pumpCts = new CancellationTokenSource();
            private Task? _pump;

            public static async Task<TestClient> ConnectAsync(int port, TimeSpan timeout)
            {
                var client = new TestClient();
                using var connectCts = new CancellationTokenSource(timeout);
                await client._socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/"), connectCts.Token);
                client._pump = Task.Run(client.PumpAsync);
                return client;
            }

            private async Task PumpAsync()
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
                            result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), _pumpCts.Token);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                return;
                            }
                            ms.Write(buffer, 0, result.Count);
                        } while (!result.EndOfMessage);

                        await _incoming.Writer.WriteAsync(Encoding.UTF8.GetString(ms.ToArray()), _pumpCts.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                }
                catch (WebSocketException)
                {
                }
                catch (ChannelClosedException)
                {
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

            /// <summary>Succeeds only if nothing arrives within <paramref name="window"/>.</summary>
            public async Task AssertNoMessageArrivesAsync(TimeSpan window)
            {
                using var cts = new CancellationTokenSource(window);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
                    await _incoming.Reader.ReadAsync(cts.Token));
            }

            public async Task CloseAsync(TimeSpan timeout)
            {
                using var cts = new CancellationTokenSource(timeout);
                await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", cts.Token);
            }

            public async ValueTask DisposeAsync()
            {
                _pumpCts.Cancel();
                _socket.Dispose();
                if (_pump != null)
                {
                    try
                    {
                        await _pump;
                    }
                    catch
                    {
                        // best-effort cleanup only
                    }
                }
            }
        }
    }
}
