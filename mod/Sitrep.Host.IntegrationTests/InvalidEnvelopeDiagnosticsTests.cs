using System;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a THIRD-PARTY client sees when it sends an envelope the server
    /// half-understands.
    ///
    /// <para>Two very different situations used to reach one arm of
    /// <c>OnMessageReceived</c>'s <c>catch (FormatException)</c> and get the
    /// same answer, a byte-for-byte echo of the frame. For a stray message the
    /// echo is the right answer and stays: the server genuinely does not know
    /// what it was handed. For a RECOGNISED envelope with a bad field the echo
    /// was a lie by omission, because the server knew exactly which envelope
    /// and exactly which field, and said neither. Worse, an echoed
    /// command-request is byte-for-byte what the author sent, so it reads as a
    /// reply and the refusal disappears.</para>
    /// </summary>
    public class InvalidEnvelopeDiagnosticsTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        /// <summary>
        /// The headline case: the error names the envelope AND the field, and
        /// carries the requestId so the caller's pending dispatch settles
        /// rather than running out its loss timer.
        /// </summary>
        [Fact]
        public async Task ACommandRequestMissingSentAtIsNamedRatherThanEchoed()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync("{\"type\":\"command-request\",\"requestId\":\"r-1\",\"command\":\"noop\",\"args\":null}");

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("invalid-envelope", error.Code);
                Assert.Equal("r-1", error.RequestId);
                Assert.Contains("command-request", error.Message);
                Assert.Contains("sentAt", error.Message);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A requestId that is itself the broken field leaves nothing to
        /// correlate on, and the refusal still goes out rather than being
        /// swallowed for want of an id.
        /// </summary>
        [Fact]
        public async Task ACommandRequestWithNoRequestIdIsStillRefused()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync("{\"type\":\"command-request\",\"command\":\"noop\",\"sentAt\":1.0}");

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("invalid-envelope", error.Code);
                Assert.Null(error.RequestId);
                Assert.Contains("requestId", error.Message);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The other recognised client envelopes get the same treatment: the
        /// fix is about the TYPE being known, not about commands.
        /// </summary>
        [Theory]
        [InlineData("{\"type\":\"subscribe\"}", "subscribe", "topic")]
        [InlineData("{\"type\":\"unsubscribe\"}", "unsubscribe", "topic")]
        [InlineData("{\"type\":\"set-vantage\"}", "set-vantage", "centreId")]
        public async Task ARecognisedEnvelopeMissingItsOneFieldSaysWhichField(
            string frame,
            string envelopeType,
            string field)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(frame);

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("invalid-envelope", error.Code);
                Assert.Contains(envelopeType, error.Message);
                Assert.Contains(field, error.Message);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The echo is DELIBERATE for a frame this build cannot identify at
        /// all, and a third-party author may be relying on it as the "is
        /// anything listening" probe. Unparseable text, a JSON value that is
        /// not an object, a missing discriminant and an unknown one are all
        /// the same fact: the server does not know what it is holding.
        /// </summary>
        [Theory]
        [InlineData("just-a-plain-string-not-json")]
        [InlineData("[1,2,3]")]
        [InlineData("{\"message\":\"hi\"}")]
        [InlineData("{\"type\":\"teleport\",\"message\":\"hi\"}")]
        public async Task AFrameThisBuildCannotIdentifyIsStillEchoedUnchanged(string frame)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(frame);

                Assert.Equal(frame, await client.ReceiveAsync(Timeout));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
