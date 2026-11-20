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
    /// A peer that has stopped reading, a suspended tablet or a closed laptop
    /// lid, keeps its socket open while nothing it is sent gets written. The
    /// outbox holds the latest frame per topic until the socket has written what
    /// it was given, so the backlog is one frame per topic and the peer wakes to
    /// the current value rather than minutes of stale ones.
    /// </summary>
    public class ChannelOutboxBusyPeerTests
    {
        [Fact]
        public void LossyFramesWaitWhileTheSocketIsStillWritingAndOnlyTheLatestGoes()
        {
            var connection = new BusyConnection { Busy = true };
            var outbox = new ChannelOutbox(connection);
            try
            {
                for (var i = 0; i < 50; i++)
                {
                    outbox.PublishTelemetry("vessel.flight", Encoding.UTF8.GetBytes("v" + i));
                    Thread.Sleep(2);
                }
                outbox.PublishReliable(Encoding.UTF8.GetBytes("ack"));
                Assert.Equal(new[] { "ack" }, connection.WaitForSends(1, TimeSpan.FromSeconds(2)));
                Thread.Sleep(150);
                Assert.Equal(new[] { "ack" }, connection.Sent());

                connection.Busy = false;

                Assert.Equal(new[] { "ack", "v49" }, connection.WaitForSends(2, TimeSpan.FromSeconds(2)));
            }
            finally
            {
                outbox.Stop();
            }
        }

        [Fact]
        public void LargeFramesGoOneAtATimeEachOnlyOnceTheSocketHasWrittenThePrevious()
        {
            var connection = new BusyConnection { BusyAfterSend = true };
            var outbox = new ChannelOutbox(connection);
            try
            {
                outbox.PublishBulk("bodies.texture.Kerbin", Encoding.UTF8.GetBytes("kerbin"));
                outbox.PublishBulk("bodies.texture.Mun", Encoding.UTF8.GetBytes("mun"));
                outbox.PublishBulk("bodies.texture.Duna", Encoding.UTF8.GetBytes("duna"));
                Assert.Equal(new[] { "kerbin" }, connection.WaitForSends(1, TimeSpan.FromSeconds(2)));

                outbox.PublishReliable(Encoding.UTF8.GetBytes("ack"));
                Assert.Equal(new[] { "kerbin", "ack" }, connection.WaitForSends(2, TimeSpan.FromSeconds(2)));
                Thread.Sleep(150);
                Assert.Equal(new[] { "kerbin", "ack" }, connection.Sent());

                connection.Busy = false;
                Assert.Equal(new[] { "kerbin", "ack", "mun" }, connection.WaitForSends(3, TimeSpan.FromSeconds(2)));
                connection.Busy = false;
                Assert.Equal(new[] { "kerbin", "ack", "mun", "duna" }, connection.WaitForSends(4, TimeSpan.FromSeconds(2)));
            }
            finally
            {
                outbox.Stop();
            }
        }

        [Fact]
        public void ClearingATopicDropsItsLargeFrameThatHasNotGoneYet()
        {
            var connection = new BusyConnection { Busy = true };
            var outbox = new ChannelOutbox(connection);
            try
            {
                outbox.PublishBulk("bodies.texture.Kerbin", Encoding.UTF8.GetBytes("old kerbin"));
                outbox.PublishBulk("bodies.texture.Mun", Encoding.UTF8.GetBytes("mun"));
                outbox.ClearTopic("bodies.texture.Kerbin");
                outbox.PublishBulk("bodies.texture.Kerbin", Encoding.UTF8.GetBytes("new kerbin"));

                connection.Busy = false;

                Assert.Equal(new[] { "mun", "new kerbin" }, connection.WaitForSends(2, TimeSpan.FromSeconds(2)));
            }
            finally
            {
                outbox.Stop();
            }
        }

        private sealed class BusyConnection : ITransportConnection
        {
            private readonly object _lock = new object();
            private readonly List<string> _sent = new List<string>();
            private volatile bool _busy;

            public bool Busy
            {
                get => _busy;
                set => _busy = value;
            }

            /// <summary>Whether each send leaves the socket writing until the test sets <see cref="Busy"/> back to false.</summary>
            public bool BusyAfterSend { get; set; }

            public string Id { get; } = "busy-connection";

            public bool IsBusy => _busy;

            public event Action<ArraySegment<byte>> MessageReceived = delegate { };

            public event Action Closed = delegate { };

            public bool TrySend(ArraySegment<byte> payload, SendClass cls)
            {
                lock (_lock)
                {
                    _sent.Add(Encoding.UTF8.GetString(payload.Array!, payload.Offset, payload.Count));
                }
                if (BusyAfterSend)
                {
                    _busy = true;
                }
                return true;
            }

            public string[] Sent()
            {
                lock (_lock)
                {
                    return _sent.ToArray();
                }
            }

            public string[] WaitForSends(int count, TimeSpan timeout)
            {
                var deadline = DateTime.UtcNow + timeout;
                while (DateTime.UtcNow < deadline)
                {
                    var sent = Sent();
                    if (sent.Length >= count)
                    {
                        Thread.Sleep(50);
                        return Sent();
                    }
                    Thread.Sleep(10);
                }
                return Sent();
            }

            public void Close(ushort code, string reason)
            {
            }
        }
    }
}
