using System;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A connection is told which run of the mod it reached, and can ask
    /// whether it is still alive. A client that reconnects to the same run
    /// keeps what it knew, one that reaches another run starts again, and a
    /// connection that is merely quiet answers a ping.
    /// </summary>
    public class ConnectionGreetingTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static ChannelEngine Started()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.ResolveCapabilities();
            engine.Start();
            return engine;
        }

        [Fact]
        public async Task EveryConnectionToOneRunIsGreetedWithTheSameBootId()
        {
            using var engine = Started();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                var greeted = await first.HelloAsync(Timeout);

                Assert.NotEqual("", greeted.BootId);
                Assert.Equal(greeted.BootId, (await second.HelloAsync(Timeout)).BootId);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnotherRunGreetsWithAnotherBootId()
        {
            using var one = Started();
            using var other = Started();
            try
            {
                await using var atOne = await TestClient.ConnectAsync(one.BoundPort, Timeout);
                await using var atOther = await TestClient.ConnectAsync(other.BoundPort, Timeout);

                Assert.NotEqual((await atOne.HelloAsync(Timeout)).BootId, (await atOther.HelloAsync(Timeout)).BootId);
            }
            finally
            {
                one.Stop();
                other.Stop();
            }
        }

        /// <summary>Nothing is subscribed and nothing has ticked: the connection has nothing to say, and still answers.</summary>
        [Fact]
        public async Task APingIsAnsweredWithItsOwnNonceOnAConnectionThatHasSubscribedToNothing()
        {
            using var engine = Started();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WritePing(new Ping { Nonce = "first" }));
                await client.SendAsync("{\"type\":\"ping\"}");

                Assert.Equal("first", (await ReceiveTypedAsync<Pong>(client, Timeout)).Nonce);
                Assert.Equal("", (await ReceiveTypedAsync<Pong>(client, Timeout)).Nonce);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
