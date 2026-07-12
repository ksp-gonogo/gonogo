using System;
using Sitrep.Vendor.Fleck;

namespace Sitrep.Transport
{
    /// <summary>
    /// <see cref="ITransportListener"/> backed by the vendored Fleck WebSocket
    /// server (see <c>Vendor/Fleck/VENDORED.md</c>). <c>ws://</c> only — no TLS.
    /// </summary>
    public sealed class FleckTransportListener : ITransportListener
    {
        private readonly string _location;
        private WebSocketServer? _server;

        /// <param name="location">
        /// A <c>ws://host:port</c> URI Fleck's <see cref="WebSocketServer"/> binds
        /// to. Use <c>ws://0.0.0.0:port</c> to listen on all interfaces, or
        /// <c>ws://127.0.0.1:0</c> to bind an ephemeral port (read the actual bound
        /// port back off <see cref="BoundPort"/> after <see cref="Start"/>).
        /// </param>
        public FleckTransportListener(string location)
        {
            _location = location ?? throw new ArgumentNullException(nameof(location));
        }

        public event Action<ITransportConnection>? ClientConnected;

        /// <summary>The actual port bound after <see cref="Start"/> — useful when
        /// <c>location</c> requested an ephemeral port (":0").</summary>
        public int BoundPort => _server?.Port ?? 0;

        public void Start()
        {
            if (_server is not null)
            {
                throw new InvalidOperationException("FleckTransportListener is already started.");
            }

            var server = new WebSocketServer(_location);
            server.Start(socket =>
            {
                var connection = new FleckTransportConnection(socket);
                socket.OnOpen = () => ClientConnected?.Invoke(connection);
            });
            _server = server;
        }

        public void Stop()
        {
            _server?.Dispose();
            _server = null;
        }
    }
}
