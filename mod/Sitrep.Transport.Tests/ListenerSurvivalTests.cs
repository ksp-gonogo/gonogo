using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Vendor.Fleck;
using Xunit;

namespace Sitrep.Transport.Tests
{
    public class ListenerSurvivalTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

        /// <summary>Wraps a real listening socket and fails its accept the first time it is armed.</summary>
        private sealed class FaultingListener : ISocket
        {
            private readonly ISocket _inner;
            private readonly Exception _fault;
            private int _armed;

            public FaultingListener(ISocket inner, Exception fault)
            {
                _inner = inner;
                _fault = fault;
            }

            public Task<ISocket> Accept(Action<ISocket> callback, Action<Exception> error)
            {
                if (Interlocked.Increment(ref _armed) == 1)
                {
                    return Task.Run(() =>
                    {
                        error(new AggregateException(_fault));
                        return (ISocket)null!;
                    });
                }

                return _inner.Accept(callback, error);
            }

            public bool Connected => _inner.Connected;
            public string RemoteIpAddress => _inner.RemoteIpAddress;
            public int RemotePort => _inner.RemotePort;
            public Stream Stream => _inner.Stream;
            public bool NoDelay { get => _inner.NoDelay; set => _inner.NoDelay = value; }
            public EndPoint LocalEndPoint => _inner.LocalEndPoint;
            public Task Send(byte[] buffer, Action callback, Action<Exception> error) => _inner.Send(buffer, callback, error);
            public Task<int> Receive(byte[] buffer, Action<int> callback, Action<Exception> error, int offset = 0) => _inner.Receive(buffer, callback, error, offset);
            public Task Authenticate(X509Certificate2 certificate, SslProtocols enabledSslProtocols, Action callback, Action<Exception> error) => _inner.Authenticate(certificate, enabledSslProtocols, callback, error);
            public void Dispose() => _inner.Dispose();
            public void Close() => _inner.Close();
            public void Bind(EndPoint ipLocal) => _inner.Bind(ipLocal);
            public void Listen(int backlog) => _inner.Listen(backlog);
        }

        private static Exception ThreadAbort() =>
            (Exception)RuntimeHelpers.GetUninitializedObject(typeof(ThreadAbortException));

        [Theory]
        [InlineData(false)]
        [InlineData(true)]
        public async Task AcceptLoopFault_ListenerRebindsAndAcceptsANewClient(bool threadAbort)
        {
            var server = new WebSocketServer("ws://127.0.0.1:0");
            server.ListenerSocket = new FaultingListener(
                server.ListenerSocket,
                threadAbort ? ThreadAbort() : new InvalidOperationException("accept failed"));

            var connected = new TaskCompletionSource<IWebSocketConnection>(TaskCreationOptions.RunContinuationsAsynchronously);
            var rebound = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var wentDown = 0;
            server.ListeningChanged += listening =>
            {
                if (!listening)
                {
                    Volatile.Write(ref wentDown, 1);
                    return;
                }

                if (Volatile.Read(ref wentDown) == 1) rebound.TrySetResult();
            };
            server.Start(socket => socket.OnOpen = () => connected.TrySetResult(socket));
            try
            {
                // The faulted socket is closed before the new one binds, so a client arriving earlier is reset
                await rebound.Task.WaitAsync(Timeout);
                var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
                using var client = new ClientWebSocket();
                using var cts = new CancellationTokenSource(Timeout);
                await client.ConnectAsync(uri, cts.Token);
                await connected.Task.WaitAsync(Timeout);
                Assert.True(server.IsListening);
            }
            finally
            {
                server.Dispose();
            }
        }

        [Fact]
        public async Task Dispose_ReleasesThePortAndDoesNotRebind()
        {
            var server = new WebSocketServer("ws://127.0.0.1:0");
            server.Start(_ => { });
            var port = server.Port;
            server.Dispose();
            await Task.Delay(1500);

            Assert.False(server.IsListening);
            using var probe = new TcpListener(IPAddress.Loopback, port);
            probe.Start();
        }
    }
}
