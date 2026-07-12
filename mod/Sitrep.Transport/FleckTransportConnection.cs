using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Sitrep.Vendor.Fleck;

namespace Sitrep.Transport
{
    /// <summary>
    /// Wraps a single vendored-Fleck <see cref="IWebSocketConnection"/> behind the
    /// transport seam. Nothing outside this file (and <see cref="FleckTransportListener"/>)
    /// should ever touch a <c>Sitrep.Vendor.Fleck</c> type directly.
    /// </summary>
    internal sealed class FleckTransportConnection : ITransportConnection
    {
        private readonly IWebSocketConnection _socket;

        // Single-flight send state: Fleck only write-serializes internally for
        // its SSL (QueuedStream) path -- the plain-TCP path used here issues a
        // raw NetworkStream.BeginWrite per Send() call, which throws
        // InvalidOperationException if a second BeginWrite lands before the
        // first completes. SocketWrapper.Send catches that and returns null
        // rather than a Task. So TrySend must never let two sends be in
        // flight at once; everything below exists to enforce that, guarded by
        // _sendLock.
        private readonly object _sendLock = new object();
        private readonly Queue<byte[]> _sendQueue = new Queue<byte[]>();
        private bool _sending;

        public FleckTransportConnection(IWebSocketConnection socket)
        {
            _socket = socket ?? throw new ArgumentNullException(nameof(socket));
            Id = socket.ConnectionInfo.Id.ToString("N");

            socket.OnMessage = message =>
            {
                var bytes = Encoding.UTF8.GetBytes(message);
                MessageReceived?.Invoke(new ArraySegment<byte>(bytes));
            };
            socket.OnBinary = bytes => MessageReceived?.Invoke(new ArraySegment<byte>(bytes));
            socket.OnClose = () => Closed?.Invoke();
            // Fleck already tears the connection down and raises OnClose on error;
            // there is nothing further for the seam to do here.
            socket.OnError = _ => { };
        }

        public string Id { get; }

        public event Action<ArraySegment<byte>>? MessageReceived;

        public event Action? Closed;

        public bool TrySend(ArraySegment<byte> payload, SendClass cls)
        {
            if (!_socket.IsAvailable || payload.Array is null)
            {
                return false;
            }

            var bytes = ToArray(payload);
            bool shouldStartDrain;

            lock (_sendLock)
            {
                _sendQueue.Enqueue(bytes);
                shouldStartDrain = !_sending;
                if (shouldStartDrain)
                {
                    _sending = true;
                }
            }

            // TrySend is synchronous-handoff by design (callers are not expected
            // to await a per-message Task) — but the actual Fleck Send() only
            // ever runs one-at-a-time below, never overlapping, regardless of
            // how many TrySend calls land back-to-back before the first
            // completes.
            if (shouldStartDrain)
            {
                DrainNext();
            }

            return true;
        }

        /// <summary>
        /// Sends exactly one queued buffer via the underlying socket, then — once
        /// that send's Task completes (success or fault) — recurses to send the
        /// next queued buffer, if any. This is what guarantees at most one Fleck
        /// <c>Send</c> is ever in flight for this connection at a time.
        /// </summary>
        private void DrainNext()
        {
            byte[] next;
            lock (_sendLock)
            {
                if (_sendQueue.Count == 0)
                {
                    _sending = false;
                    return;
                }

                next = _sendQueue.Dequeue();
            }

            Task? sendTask;
            try
            {
                sendTask = _socket.Send(next);
            }
            catch
            {
                sendTask = null;
            }

            if (sendTask is null)
            {
                // Fleck's own send-failure path (SocketWrapper.Send's catch
                // around a stale BeginWrite, or the "connection not
                // available" guard in WebSocketConnection.Send) has already
                // torn the connection down and raised OnClose/Closed
                // synchronously above this call. There is no Task to chain
                // off of and nothing further worth sending — stop the chain
                // here instead of calling .ContinueWith on null (the
                // unhandled-NRE bug this replaces).
                lock (_sendLock)
                {
                    _sendQueue.Clear();
                    _sending = false;
                }

                return;
            }

            sendTask.ContinueWith(
                t =>
                {
                    _ = t.Exception; // observe any fault so it never surfaces as an unobserved-task exception
                    DrainNext();
                },
                TaskContinuationOptions.ExecuteSynchronously);
        }

        public void Close(ushort code, string reason)
        {
            // Fleck's close frame only carries a status code (see
            // Vendor/Fleck/WebSocketConnection.cs Close(int)) — there is no wire
            // path for a reason string, so `reason` is accepted for seam-interface
            // symmetry but intentionally not transmitted.
            _socket.Close(code);
        }

        private static byte[] ToArray(ArraySegment<byte> segment)
        {
            // Always copy: Fleck's Send is fire-and-forget (it returns before the
            // socket write completes), so a zero-copy alias back to the caller's
            // backing array would let a caller that reuses/mutates its buffer right
            // after TrySend returns (the expected pattern on the telemetry hot path)
            // corrupt bytes still in flight. Correctness first — a zero-copy path
            // would require holding the buffer until the send Task completes.
            var copy = new byte[segment.Count];
            Buffer.BlockCopy(segment.Array!, segment.Offset, copy, 0, segment.Count);
            return copy;
        }
    }
}
