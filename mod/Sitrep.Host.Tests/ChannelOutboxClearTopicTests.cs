using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using Sitrep.Host;
using Sitrep.Transport;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// LOW-4 (cross-lane ordering, task-review): a lossy-latest sample
    /// recorded on an abandoned (pre-timeline-reset) timeline could still be
    /// sitting, serialized, in <c>ChannelOutbox</c>'s coalescing map when a
    /// quickload/rewind happens. Because the pump drains its reliable lane
    /// (acks, the timeline-reset event) BEFORE its lossy lane, that abandoned
    /// frame would then reach the wire AFTER the reset event the client uses
    /// to know the old timeline is gone — showing stale data.
    /// <c>ChannelEngine.BroadcastTimelineReset</c> now calls
    /// <see cref="ChannelOutbox.ClearTopic"/> for every subscribed topic,
    /// right before it queues the reset event, closing that window.
    ///
    /// The window is a genuine two-thread race against <c>ChannelOutbox</c>'s
    /// own independent pump thread, so it can't be reproduced deterministically
    /// by timing alone (the pump usually drains the frame to the wire almost
    /// immediately after it's queued). These tests instead make it
    /// deterministic with a <see cref="GatedConnection"/> that parks the pump
    /// mid-send while the stale frame + reset event are staged, so the
    /// ordering the fix guarantees is asserted exactly rather than raced.
    /// </summary>
    public class ChannelOutboxClearTopicTests
    {
        /// <summary>
        /// The fail-first proof for LOW-4's mechanism: with the pump parked
        /// mid-send (so both a stale lossy frame AND the reliable reset event
        /// are queued before the pump's next drain cycle), calling
        /// <see cref="ChannelOutbox.ClearTopic"/> before queuing the reset
        /// event means the stale frame NEVER reaches the wire — only the
        /// reset does. Remove the <c>ClearTopic</c> call below (as production's
        /// <c>BroadcastTimelineReset</c> used to lack it) and the stale frame
        /// drains to the wire AFTER the reset event, exactly the defect.
        /// </summary>
        [Fact]
        public void ClearTopicBeforeTheResetEventKeepsAStaleLossyFrameOffTheWireEntirely()
        {
            var connection = new GatedConnection();
            var outbox = new ChannelOutbox(connection);

            // Park the pump: publish a first reliable frame and let the pump
            // pick it up and BLOCK inside TrySend on the gate. Everything
            // staged after this is guaranteed to be queued before the pump's
            // NEXT drain cycle.
            outbox.PublishReliable(Bytes("ack"));
            Assert.True(connection.WaitUntilSending(TimeSpan.FromSeconds(2)), "pump never entered TrySend");

            // A stale lossy frame from the abandoned timeline is now sitting
            // in the coalescing map...
            outbox.PublishTelemetry("stale.topic", Bytes("STALE"));
            Assert.True(outbox.HasQueuedFrame("stale.topic"));

            // ...the fix: clear it before the reset event is queued. Comment
            // this line out to see the stale frame reach the wire after the
            // reset (the LOW-4 defect).
            outbox.ClearTopic("stale.topic");

            outbox.PublishReliable(Bytes("timeline-reset"));

            // Release the pump: it finishes "ack", then drains reliable
            // ("timeline-reset") before lossy — so if the stale frame had NOT
            // been cleared it would land right after the reset.
            connection.ReleaseGate();

            var sent = connection.WaitForSends(3, TimeSpan.FromSeconds(2));
            Assert.Equal(new[] { "ack", "timeline-reset" }, sent);
            Assert.DoesNotContain("STALE", sent);
        }

        [Fact]
        public void ClearTopicRemovesAQueuedLossyFrameFromTheCoalescingMap()
        {
            var connection = new GatedConnection();
            var outbox = new ChannelOutbox(connection);
            outbox.Stop();
            Thread.Sleep(150); // let the pump observe _stopping and exit

            outbox.PublishTelemetry("stale.topic", Bytes("STALE"));
            Assert.True(outbox.HasQueuedFrame("stale.topic"));

            outbox.ClearTopic("stale.topic");
            Assert.False(outbox.HasQueuedFrame("stale.topic"));
        }

        [Fact]
        public void ClearingATopicWithNothingQueuedIsANoOp()
        {
            var connection = new GatedConnection();
            var outbox = new ChannelOutbox(connection);
            outbox.Stop();
            Thread.Sleep(150);

            outbox.ClearTopic("never.published");
            Assert.False(outbox.HasQueuedFrame("never.published"));
        }

        private static byte[] Bytes(string s) => Encoding.UTF8.GetBytes(s);

        /// <summary>
        /// A connection whose FIRST <see cref="TrySend"/> blocks on a gate
        /// until <see cref="ReleaseGate"/> is called — used to park the
        /// outbox pump thread mid-drain so a test can stage further frames
        /// with a guarantee about which drain cycle they land in.
        /// </summary>
        private sealed class GatedConnection : ITransportConnection
        {
            private readonly ManualResetEventSlim _gate = new ManualResetEventSlim(false);
            private readonly ManualResetEventSlim _enteredSend = new ManualResetEventSlim(false);
            private readonly object _lock = new object();
            private readonly List<string> _sent = new List<string>();
            private int _sendCount;

            public string Id { get; } = "gated-connection";

            public event Action<ArraySegment<byte>> MessageReceived = delegate { };
            public event Action Closed = delegate { };

            public bool TrySend(ArraySegment<byte> payload, SendClass cls)
            {
                if (Interlocked.Increment(ref _sendCount) == 1)
                {
                    _enteredSend.Set();
                    _gate.Wait();
                }
                lock (_lock)
                {
                    _sent.Add(Encoding.UTF8.GetString(payload.Array!, payload.Offset, payload.Count));
                }
                return true;
            }

            public bool WaitUntilSending(TimeSpan timeout) => _enteredSend.Wait(timeout);

            public void ReleaseGate() => _gate.Set();

            public string[] WaitForSends(int count, TimeSpan timeout)
            {
                var deadline = DateTime.UtcNow + timeout;
                while (DateTime.UtcNow < deadline)
                {
                    lock (_lock)
                    {
                        if (_sent.Count >= count)
                        {
                            return _sent.ToArray();
                        }
                    }
                    Thread.Sleep(10);
                }
                lock (_lock)
                {
                    return _sent.ToArray();
                }
            }

            public void Close(ushort code, string reason)
            {
            }
        }
    }
}
