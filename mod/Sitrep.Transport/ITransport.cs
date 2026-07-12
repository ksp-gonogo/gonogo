using System;

namespace Sitrep.Transport
{
    /// <summary>
    /// Which delivery class an outbound send belongs to. Telemetry is lossy-latest
    /// (a dropped/failed send is fine — a fresher sample follows shortly); Response
    /// is reliable (command results, acks) and callers should treat a false return
    /// from <see cref="ITransportConnection.TrySend"/> as needing a retry/backoff,
    /// not a silent drop.
    /// </summary>
    public enum SendClass
    {
        Telemetry,
        Response,
    }

    /// <summary>
    /// One connected WebSocket peer, abstracted away from whichever library
    /// actually implements the socket. This is the seam a future kernel would
    /// register a transport provider against — see
    /// <c>docs/superpowers/plans/2026-07-06-telemetry-m5-csharp-mod.md</c>.
    /// </summary>
    public interface ITransportConnection
    {
        string Id { get; }

        /// <summary>
        /// Attempts to send <paramref name="payload"/> to this peer. Returns false
        /// (without throwing) if the connection is already closing/closed — callers
        /// should not treat that as an error, just as "nowhere to send this".
        /// A true return means the send was handed off, not that it was flushed;
        /// use <paramref name="cls"/> to decide how much that distinction matters.
        /// </summary>
        bool TrySend(ArraySegment<byte> payload, SendClass cls);

        /// <summary>Raised on a socket thread — never assume this runs on any particular thread.</summary>
        event Action<ArraySegment<byte>> MessageReceived;

        /// <summary>Raised on a socket thread when the connection has gone away, for any reason.</summary>
        event Action Closed;

        void Close(ushort code, string reason);
    }

    /// <summary>
    /// A listener that accepts inbound WebSocket connections and hands each one
    /// off as an <see cref="ITransportConnection"/>.
    /// </summary>
    public interface ITransportListener
    {
        event Action<ITransportConnection> ClientConnected;

        void Start();

        void Stop();
    }
}
