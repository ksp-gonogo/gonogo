#nullable disable
using System;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Authentication;
using System.Threading;
using Sitrep.Vendor.Fleck.Helpers;

namespace Sitrep.Vendor.Fleck
{
    public class WebSocketServer : IWebSocketServer
    {
        private readonly string _scheme;
        private readonly IPAddress _locationIP;
        private Action<IWebSocketConnection> _config;
        private volatile bool _disposed;
        private volatile bool _listening;
        private volatile bool _acceptArmed;
        private int _restarting;
        private Thread _watchdog;

        private const int RestartBackoffStartMs = 250;
        private const int RestartBackoffMaxMs = 5000;
        private const int WatchdogIntervalMs = 5000;

        public WebSocketServer(string location, bool supportDualStack = true)
        {
            var uri = new Uri(location);

            Port = uri.Port;
            Location = location;
            SupportDualStack = supportDualStack;

            _locationIP = ParseIPAddress(uri);
            _scheme = uri.Scheme;
            ListenerSocket = CreateListenerSocket();
            SupportedSubProtocols = new string[0];
        }

        private ISocket CreateListenerSocket()
        {
            var socket = new Socket(_locationIP.AddressFamily, SocketType.Stream, ProtocolType.IP);

            socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, 1);

            if (SupportDualStack)
            {
                if (!FleckRuntime.IsRunningOnMono() && FleckRuntime.IsRunningOnWindows())
                {
                    socket.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.IPv6Only, false);
                }
            }

            return new SocketWrapper(socket);
        }

        public ISocket ListenerSocket { get; set; }

        /// <summary>Whether a bound listener is currently waiting for clients. False while the listener is being rebuilt after a failure.</summary>
        public bool IsListening { get { return _listening; } }

        /// <summary>Raised with the new value whenever <see cref="IsListening"/> changes, on whatever thread noticed.</summary>
        public event Action<bool> ListeningChanged;
        public string Location { get; private set; }
        public bool SupportDualStack { get; }
        public int Port { get; private set; }
        public X509Certificate2 Certificate { get; set; }
        public SslProtocols EnabledSslProtocols { get; set; }
        public IEnumerable<string> SupportedSubProtocols { get; set; }

        public bool IsSecure
        {
            get { return _scheme == "wss" && Certificate != null; }
        }

        public void Dispose()
        {
            _disposed = true;
            SetListening(false);
            ListenerSocket.Dispose();
        }

        private void SetListening(bool value)
        {
            if (_listening == value) return;
            _listening = value;
            var handler = ListeningChanged;
            if (handler == null) return;
            try { handler(value); }
            catch (Exception ex) { FleckLog.Warn("Listening state handler threw", ex); }
        }

        private static void ResetAbort(Exception ex)
        {
            if (!(ex is ThreadAbortException)) return;
            try
            {
                var reset = typeof(Thread).GetMethod("ResetAbort", Type.EmptyTypes);
                if (reset != null) reset.Invoke(null, null);
            }
            catch (Exception) { }
        }

        private IPAddress ParseIPAddress(Uri uri)
        {
            string ipStr = uri.Host;

            if (ipStr == "0.0.0.0" ){
                return IPAddress.Any;
            }else if(ipStr == "[0000:0000:0000:0000:0000:0000:0000:0000]")
            {
                return IPAddress.IPv6Any;
            } else {
                try {
                    return IPAddress.Parse(ipStr);
                } catch (Exception ex) {
                    throw new FormatException("Failed to parse the IP address part of the location. Please make sure you specify a valid IP address. Use 0.0.0.0 or [::] to listen on all interfaces.", ex);
                }
            }
        }

        public void Start(Action<IWebSocketConnection> config)
        {
            _config = config;
            BindAndListen();
            if (_scheme == "wss")
            {
                if (Certificate == null)
                {
                    FleckLog.Error("Scheme cannot be 'wss' without a Certificate");
                    return;
                }

                if (EnabledSslProtocols == SslProtocols.None)
                {
                    EnabledSslProtocols = SslProtocols.Tls;
                    FleckLog.Debug("Using default TLS 1.0 security protocol.");
                }
            }
            ListenForClients();
            StartWatchdog();
        }

        private void BindAndListen()
        {
            var ipLocal = new IPEndPoint(_locationIP, Port);
            ListenerSocket.Bind(ipLocal);
            ListenerSocket.Listen(100);
            Port = ((IPEndPoint)ListenerSocket.LocalEndPoint).Port;
            FleckLog.Info(string.Format("Server started at {0} (actual port {1})", Location, Port));
            SetListening(true);
        }

        private void ListenForClients()
        {
            var listener = ListenerSocket;
            _acceptArmed = true;
            listener.Accept(
                clientSocket =>
                {
                    _acceptArmed = false;
                    OnClientConnect(clientSocket);
                },
                e =>
                {
                    _acceptArmed = false;
                    if (_disposed || !ReferenceEquals(listener, ListenerSocket)) return;
                    FleckLog.Error("Listener socket is closed", e);
                    RestartListener();
                });
        }

        /*
         * The accept loop is a chain of pool callbacks, each re-arming the next,
         * so one exception that escapes (an aborted pool thread included) ends
         * the chain while the bound socket keeps answering the kernel: clients
         * queue in the backlog and are never served. Recovery therefore runs on
         * a dedicated thread that retries until the port is bound again, and a
         * watchdog catches the case where no callback ever reported the failure.
         */
        private void RestartListener()
        {
            if (_disposed) return;
            if (Interlocked.CompareExchange(ref _restarting, 1, 0) != 0) return;

            SetListening(false);
            FleckLog.Info("Listener socket restarting");
            var thread = new Thread(RestartLoop) { IsBackground = true, Name = "Sitrep listener restart" };
            thread.Start();
        }

        private void RestartLoop()
        {
            var delay = RestartBackoffStartMs;
            while (!_disposed)
            {
                ISocket fresh = null;
                try
                {
                    try { ListenerSocket.Dispose(); } catch (Exception) { }

                    fresh = CreateListenerSocket();
                    ListenerSocket = fresh;
                    if (_disposed)
                    {
                        fresh.Dispose();
                        break;
                    }

                    BindAndListen();
                    ListenForClients();
                    FleckLog.Info("Listener socket restarted");
                    Interlocked.Exchange(ref _restarting, 0);
                    return;
                }
                catch (Exception ex)
                {
                    ResetAbort(ex);
                    FleckLog.Error("Listener could not be restarted, retrying", ex);
                    try { if (fresh != null) fresh.Dispose(); } catch (Exception) { }
                }

                try { Thread.Sleep(delay); }
                catch (Exception ex) { ResetAbort(ex); }
                delay = Math.Min(delay * 2, RestartBackoffMaxMs);
            }

            Interlocked.Exchange(ref _restarting, 0);
        }

        private void StartWatchdog()
        {
            if (_watchdog != null) return;
            _watchdog = new Thread(WatchdogLoop) { IsBackground = true, Name = "Sitrep listener watchdog" };
            _watchdog.Start();
        }

        private void WatchdogLoop()
        {
            var unarmedChecks = 0;
            while (!_disposed)
            {
                try
                {
                    Thread.Sleep(WatchdogIntervalMs);
                    if (_disposed) return;

                    unarmedChecks = _listening && !_acceptArmed && Volatile.Read(ref _restarting) == 0 ? unarmedChecks + 1 : 0;
                    if (unarmedChecks >= 2)
                    {
                        unarmedChecks = 0;
                        FleckLog.Error("Listener stopped accepting without reporting a failure");
                        RestartListener();
                    }
                }
                catch (Exception ex)
                {
                    ResetAbort(ex);
                }
            }
        }

        private void OnClientConnect(ISocket clientSocket)
        {
            if (clientSocket == null) return; // socket closed

            FleckLog.Debug(String.Format("Client connected from {0}:{1}", clientSocket.RemoteIpAddress, clientSocket.RemotePort.ToString()));
            ListenForClients();

            WebSocketConnection connection = null;

            connection = new WebSocketConnection(
                clientSocket,
                _config,
                bytes => RequestParser.Parse(bytes, _scheme),
                r => HandlerFactory.BuildHandler(r,
                                                 s => connection.OnMessage(s),
                                                 connection.Close,
                                                 b => connection.OnBinary(b),
                                                 b => connection.OnPing(b),
                                                 b => connection.OnPong(b)),
                s => SubProtocolNegotiator.Negotiate(SupportedSubProtocols, s));

            if (IsSecure)
            {
                FleckLog.Debug("Authenticating Secure Connection");
                clientSocket
                    .Authenticate(Certificate,
                                  EnabledSslProtocols,
                                  connection.StartReceiving,
                                  e => FleckLog.Warn("Failed to Authenticate", e));
            }
            else
            {
                connection.StartReceiving();
            }
        }
    }
}
