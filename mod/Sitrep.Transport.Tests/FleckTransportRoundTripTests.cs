using System;
using System.IO;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Transport;
using Sitrep.Vendor.Fleck;
using Xunit;

namespace Sitrep.Transport.Tests
{
    /// <summary>
    /// In-process integration test: a real <see cref="ClientWebSocket"/> talks RFC6455
    /// over loopback to a <see cref="FleckTransportListener"/>, proving the vendored
    /// Fleck handshake + framing works against a real client — headlessly, no KSP.
    /// The full KSP-Mono soak is a separate milestone (M5b); this only validates the
    /// transport seam in-process.
    /// </summary>
    public class FleckTransportRoundTripTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task ClientServer_RoundTripsMessagesAndClosesCleanly()
        {
            var listener = new FleckTransportListener("ws://127.0.0.1:0");

            var connectedTcs = new TaskCompletionSource<ITransportConnection>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            listener.ClientConnected += connection => connectedTcs.TrySetResult(connection);

            listener.Start();
            try
            {
                var uri = new Uri($"ws://127.0.0.1:{listener.BoundPort}/");

                using var client = new ClientWebSocket();
                using var connectCts = new CancellationTokenSource(Timeout);
                await client.ConnectAsync(uri, connectCts.Token);

                var serverConnection = await connectedTcs.Task.WaitAsync(Timeout);
                Assert.NotNull(serverConnection);
                Assert.False(string.IsNullOrEmpty(serverConnection.Id));

                // --- client -> server ---
                var messageReceivedTcs = new TaskCompletionSource<byte[]>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                serverConnection.MessageReceived += segment =>
                    messageReceivedTcs.TrySetResult(segment.ToArray());

                var clientToServer = Encoding.UTF8.GetBytes("hello-from-client");
                await client.SendAsync(
                    new ArraySegment<byte>(clientToServer), WebSocketMessageType.Binary, true, CancellationToken.None);

                var received = await messageReceivedTcs.Task.WaitAsync(Timeout);
                Assert.Equal(clientToServer, received);

                // --- server -> client ---
                var serverToClient = Encoding.UTF8.GetBytes("hello-from-server");
                var sent = serverConnection.TrySend(new ArraySegment<byte>(serverToClient), SendClass.Response);
                Assert.True(sent);

                var receiveBuffer = new byte[1024];
                var receiveResult = await client
                    .ReceiveAsync(new ArraySegment<byte>(receiveBuffer), CancellationToken.None)
                    .WaitAsync(Timeout);

                Assert.Equal(WebSocketMessageType.Binary, receiveResult.MessageType);
                Assert.Equal(serverToClient, receiveBuffer[..receiveResult.Count]);

                // --- clean close, client-initiated ---
                var closedTcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                serverConnection.Closed += () => closedTcs.TrySetResult();

                await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None)
                    .WaitAsync(Timeout);

                await closedTcs.Task.WaitAsync(Timeout);
                Assert.Equal(WebSocketState.Closed, client.State);
            }
            finally
            {
                listener.Stop();
            }
        }

        [Fact]
        public async Task TrySend_BackToBackWithNoIntervalCompletion_AllPayloadsArriveInOrderWithNoUnhandledException()
        {
            // Regression coverage for M5a Task 9 review Fix 1: Fleck's raw
            // NetworkStream write (the non-SSL path used here) throws
            // InvalidOperationException if a second BeginWrite lands before
            // the first completes; the pre-fix TrySend called
            // `_socket.Send(bytes).ContinueWith(...)` fire-and-forget with no
            // per-connection serialization, so the outbox draining an ack +
            // telemetry catch-up in one pass (two overlapping TrySends) could
            // NRE on a background thread (SocketWrapper.Send returns null on
            // that caught error, and `.ContinueWith` on a null Task throws)
            // and/or silently drop a message. This fires several TrySends
            // back-to-back with zero intervening awaits -- the same shape the
            // outbox produces -- against a real listener/ClientWebSocket pair
            // and asserts every payload survives, in order, and TrySend itself
            // never throws. (The exact single-flight contract and the null-
            // Task NRE path are additionally pinned down deterministically by
            // TrySend_SecondCallBeforeFirstCompletes_... and
            // TrySend_WhenSendReturnsNull_... below, against a controllable
            // fake socket -- a process-global UnobservedTaskException hook
            // was tried here first but proved too noisy under xunit's
            // parallel test execution, picking up unrelated background-task
            // faults from other tests' listeners.)
            var listener = new FleckTransportListener("ws://127.0.0.1:0");

            var connectedTcs = new TaskCompletionSource<ITransportConnection>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            listener.ClientConnected += connection => connectedTcs.TrySetResult(connection);

            listener.Start();
            try
            {
                var uri = new Uri($"ws://127.0.0.1:{listener.BoundPort}/");

                using var client = new ClientWebSocket();
                using var connectCts = new CancellationTokenSource(Timeout);
                await client.ConnectAsync(uri, connectCts.Token);

                var serverConnection = await connectedTcs.Task.WaitAsync(Timeout);

                const int messageCount = 20;
                var payloads = new byte[messageCount][];
                for (var i = 0; i < messageCount; i++)
                {
                    // Pad each payload out so the underlying write has enough
                    // bytes to plausibly still be in flight when the next
                    // TrySend fires -- a tiny payload risks completing
                    // synchronously often enough to mask the race.
                    payloads[i] = Encoding.UTF8.GetBytes($"msg-{i:D3}-" + new string('x', 4096));
                }

                // Fire every send back-to-back with no intervening await --
                // exactly what a single outbox drain pass does when it has
                // both a reliable ack and a telemetry catch-up queued.
                for (var i = 0; i < messageCount; i++)
                {
                    var sent = serverConnection.TrySend(new ArraySegment<byte>(payloads[i]), SendClass.Response);
                    Assert.True(sent, $"TrySend #{i} was rejected (connection unavailable?)");
                }

                var receiveBuffer = new byte[8192];
                for (var i = 0; i < messageCount; i++)
                {
                    using var ms = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await client
                            .ReceiveAsync(new ArraySegment<byte>(receiveBuffer), CancellationToken.None)
                            .WaitAsync(Timeout);
                        ms.Write(receiveBuffer, 0, result.Count);
                    } while (!result.EndOfMessage);

                    Assert.Equal(payloads[i], ms.ToArray());
                }
            }
            finally
            {
                listener.Stop();
            }
        }

        [Fact]
        public async Task TrySend_AfterConnectionCloses_ReturnsFalse()
        {
            var listener = new FleckTransportListener("ws://127.0.0.1:0");

            var connectedTcs = new TaskCompletionSource<ITransportConnection>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            listener.ClientConnected += connection => connectedTcs.TrySetResult(connection);

            listener.Start();
            try
            {
                var uri = new Uri($"ws://127.0.0.1:{listener.BoundPort}/");

                using var client = new ClientWebSocket();
                using var connectCts = new CancellationTokenSource(Timeout);
                await client.ConnectAsync(uri, connectCts.Token);

                var serverConnection = await connectedTcs.Task.WaitAsync(Timeout);

                var closedTcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                serverConnection.Closed += () => closedTcs.TrySetResult();

                await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None)
                    .WaitAsync(Timeout);
                await closedTcs.Task.WaitAsync(Timeout);

                var sent = serverConnection.TrySend(
                    new ArraySegment<byte>(Encoding.UTF8.GetBytes("too-late")), SendClass.Telemetry);

                Assert.False(sent);
            }
            finally
            {
                listener.Stop();
            }
        }

        // Note: this is deliberately NOT a round-trip test against the real Fleck
        // listener/client. Fleck's own Hybi13 frame builder (WebSocketConnection.Send
        // -> Handler.FrameBinary -> MemoryStream.Write) copies the payload into a
        // fresh frame buffer *synchronously*, before FleckTransportConnection.TrySend
        // even returns to its caller. So a caller that mutates its buffer strictly
        // after TrySend returns can never observe wire corruption in-process,
        // regardless of whether TrySend itself aliased the array — the bug is
        // real (a future Fleck version, or a different Send path, might not copy
        // eagerly) but isn't reachable through the wire in a deterministic test.
        // Instead, this exercises FleckTransportConnection.TrySend directly (via
        // reflection, since the class is internal) against a fake
        // IWebSocketConnection that captures exactly what byte[] instance it was
        // handed — the same contract boundary the fix changed.
        [Fact]
        public void TrySend_CopiesPayload_SourceMutationAfterReturnDoesNotAffectSentBytes()
        {
            var fakeSocket = new FakeWebSocketConnection();
            var connection = CreateFleckTransportConnection(fakeSocket);

            var original = Encoding.UTF8.GetBytes("hello-from-server");
            var expected = (byte[])original.Clone();
            var source = (byte[])original.Clone();

            var sent = connection.TrySend(new ArraySegment<byte>(source), SendClass.Telemetry);
            Assert.True(sent);
            Assert.NotNull(fakeSocket.LastSentBytes);

            // Mutate the source buffer right after TrySend returns — the expected
            // reuse pattern on the telemetry hot path (pooled/reused buffers, lossy
            // latest sends). If TrySend aliased the caller's array instead of
            // copying it, the bytes handed to the socket change out from under it.
            for (var i = 0; i < source.Length; i++)
            {
                source[i] = 0xFF;
            }

            Assert.NotSame(source, fakeSocket.LastSentBytes);
            Assert.Equal(expected, fakeSocket.LastSentBytes);
        }

        private static ITransportConnection CreateFleckTransportConnection(IWebSocketConnection socket)
        {
            var type = typeof(ITransportConnection).Assembly.GetType(
                "Sitrep.Transport.FleckTransportConnection", throwOnError: true)!;

            return (ITransportConnection)Activator.CreateInstance(
                type,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.CreateInstance,
                binder: null,
                args: new object[] { socket },
                culture: null)!;
        }

        private sealed class FakeWebSocketConnection : IWebSocketConnection
        {
            public byte[]? LastSentBytes { get; private set; }

            public Action? OnOpen { get; set; }
            public Action? OnClose { get; set; }
            public Action<string>? OnMessage { get; set; }
            public Action<byte[]>? OnBinary { get; set; }
            public Action<byte[]>? OnPing { get; set; }
            public Action<byte[]>? OnPong { get; set; }
            public Action<Exception>? OnError { get; set; }

            public IWebSocketConnectionInfo ConnectionInfo { get; } = new FakeWebSocketConnectionInfo();

            public bool IsAvailable { get; set; } = true;

            public Task Send(string message) => Task.CompletedTask;

            public Task Send(byte[] message)
            {
                // Deliberately does NOT copy `message` — mirrors a downstream Send
                // path that has no defensive-copy behaviour of its own, so the test
                // isolates the seam's own copy-or-alias decision in TrySend/ToArray.
                LastSentBytes = message;
                return Task.CompletedTask;
            }

            public Task SendPing(byte[] message) => Task.CompletedTask;

            public Task SendPong(byte[] message) => Task.CompletedTask;

            public void Close() { }

            public void Close(int code) { }
        }

        private sealed class FakeWebSocketConnectionInfo : IWebSocketConnectionInfo
        {
            public string? SubProtocol => null;
            public string? Origin => null;
            public string? Host => null;
            public string? Path => null;
            public string? ClientIpAddress => null;
            public int ClientPort => 0;
            public System.Collections.Generic.IDictionary<string, string>? Cookies => null;
            public System.Collections.Generic.IDictionary<string, string>? Headers => null;
            public Guid Id { get; } = Guid.NewGuid();
            public string? NegotiatedSubProtocol => null;
        }

        [Fact]
        public async Task TrySend_DefaultSegment_ReturnsFalseAndDoesNotThrow()
        {
            var listener = new FleckTransportListener("ws://127.0.0.1:0");

            var connectedTcs = new TaskCompletionSource<ITransportConnection>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            listener.ClientConnected += connection => connectedTcs.TrySetResult(connection);

            listener.Start();
            try
            {
                var uri = new Uri($"ws://127.0.0.1:{listener.BoundPort}/");

                using var client = new ClientWebSocket();
                using var connectCts = new CancellationTokenSource(Timeout);
                await client.ConnectAsync(uri, connectCts.Token);

                var serverConnection = await connectedTcs.Task.WaitAsync(Timeout);

                var sent = serverConnection.TrySend(default, SendClass.Telemetry);

                Assert.False(sent);
            }
            finally
            {
                listener.Stop();
            }
        }

        // The two tests below exercise FleckTransportConnection.TrySend's
        // single-flight guarantee directly against a fully controllable fake
        // IWebSocketConnection, rather than over a real socket. This is
        // deliberate: on this test runtime (.NET 10), NetworkStream.BeginWrite
        // does not actually throw for a concurrent second call the way the
        // review that prompted this fix describes (verified empirically —
        // that guard is legacy/.NET-Framework-and-Mono-era NetworkStream
        // behaviour, relevant to the eventual KSP-Mono target but not
        // reproducible headlessly here), so a real-socket test can't be made
        // to deterministically hit the exact race. A controllable fake lets
        // these tests assert the seam's actual contract -- "at most one Send
        // in flight, ever" and "a null Task from Send never NREs" -- without
        // depending on runtime-specific stream internals.

        [Fact]
        public void TrySend_SecondCallBeforeFirstCompletes_NeverOverlapsSendsAndDeliversBothInOrder()
        {
            var fakeSocket = new ControllableWebSocketConnection();
            var connection = CreateFleckTransportConnection(fakeSocket);

            var first = Encoding.UTF8.GetBytes("first");
            var second = Encoding.UTF8.GetBytes("second");

            var sentFirst = connection.TrySend(new ArraySegment<byte>(first), SendClass.Response);
            Assert.True(sentFirst);

            // The first Send() has been issued but its Task is still
            // uncompleted (ControllableWebSocketConnection never completes
            // one on its own) -- this is the "no intervening completion"
            // window the review flagged. A second TrySend here must NOT
            // issue an overlapping Send() call: pre-fix, TrySend called
            // _socket.Send unconditionally on every invocation.
            Assert.Single(fakeSocket.Calls);

            var sentSecond = connection.TrySend(new ArraySegment<byte>(second), SendClass.Response);
            Assert.True(sentSecond);

            Assert.Single(fakeSocket.Calls); // still just the one in-flight Send()

            // Complete the first send -- the fix's continuation should now
            // dequeue and issue the second.
            fakeSocket.CompleteNext();
            Assert.Equal(2, fakeSocket.Calls.Count);
            Assert.Equal(first, fakeSocket.Calls[0]);
            Assert.Equal(second, fakeSocket.Calls[1]);

            fakeSocket.CompleteNext();
            Assert.Equal(2, fakeSocket.Calls.Count); // nothing further queued
        }

        [Fact]
        public void TrySend_WhenSendReturnsNull_DoesNotThrowAndStopsTheChain()
        {
            // Reproduces the exact pre-fix bug: SocketWrapper.Send's own
            // caught-error path returns null instead of a Task (see
            // Vendor/Fleck/SocketWrapper.cs), and the pre-fix TrySend called
            // `_socket.Send(bytes).ContinueWith(...)` unconditionally --
            // `null.ContinueWith(...)` throws NullReferenceException
            // synchronously, on whatever thread issued the send.
            var fakeSocket = new ControllableWebSocketConnection { ReturnNullFromSend = true };
            var connection = CreateFleckTransportConnection(fakeSocket);

            var exception = Record.Exception(() =>
                connection.TrySend(new ArraySegment<byte>(Encoding.UTF8.GetBytes("payload")), SendClass.Response));

            Assert.Null(exception);
            Assert.Single(fakeSocket.Calls);

            // The chain must be fully stopped, not wedged mid-drain: a
            // further TrySend (simulating IsAvailable still true briefly
            // before Fleck's own close machinery flips it, or just proving
            // the internal queue/`_sending` state didn't get stuck) is
            // accepted and attempts exactly one more Send() rather than
            // silently doing nothing forever.
            var secondException = Record.Exception(() =>
                connection.TrySend(new ArraySegment<byte>(Encoding.UTF8.GetBytes("payload-2")), SendClass.Response));

            Assert.Null(secondException);
            Assert.Equal(2, fakeSocket.Calls.Count);
        }

        /// <summary>
        /// A fully controllable <see cref="IWebSocketConnection"/> fake: every
        /// <see cref="Send"/> call is recorded, and its returned <see cref="Task"/>
        /// only completes when the test explicitly calls <see cref="CompleteNext"/> --
        /// which is what lets these tests force the "second TrySend before the first
        /// completes" window deterministically instead of racing real I/O.
        /// </summary>
        private sealed class ControllableWebSocketConnection : IWebSocketConnection
        {
            private readonly System.Collections.Generic.Queue<TaskCompletionSource<object?>> _pending = new();

            public System.Collections.Generic.List<byte[]> Calls { get; } = new();

            public bool ReturnNullFromSend { get; set; }

            public Action? OnOpen { get; set; }
            public Action? OnClose { get; set; }
            public Action<string>? OnMessage { get; set; }
            public Action<byte[]>? OnBinary { get; set; }
            public Action<byte[]>? OnPing { get; set; }
            public Action<byte[]>? OnPong { get; set; }
            public Action<Exception>? OnError { get; set; }

            public IWebSocketConnectionInfo ConnectionInfo { get; } = new FakeWebSocketConnectionInfo();

            public bool IsAvailable { get; set; } = true;

            public Task Send(string message) => Task.CompletedTask;

            public Task Send(byte[] message)
            {
                Calls.Add(message);

                if (ReturnNullFromSend)
                {
                    return null!;
                }

                // Deliberately NOT RunContinuationsAsynchronously: this fake needs
                // CompleteNext() to run the fix's ContinueWith synchronously and
                // deterministically on the calling (test) thread, so the test can
                // assert on fakeSocket.Calls immediately after CompleteNext()
                // returns without racing a thread-pool continuation.
                var tcs = new TaskCompletionSource<object?>();
                _pending.Enqueue(tcs);
                return tcs.Task;
            }

            /// <summary>Completes the oldest still-pending <see cref="Send(byte[])"/> Task.</summary>
            public void CompleteNext()
            {
                if (_pending.TryDequeue(out var tcs))
                {
                    tcs.SetResult(null);
                }
            }

            public Task SendPing(byte[] message) => Task.CompletedTask;

            public Task SendPong(byte[] message) => Task.CompletedTask;

            public void Close() { }

            public void Close(int code) { }
        }
    }
}
