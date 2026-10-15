using System;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The connection's own frames: the greeting a server opens with, and the
    /// ping a client may send to be answered with a pong.
    /// </summary>
    public class SessionEnvelopeCodecTests
    {
        [Fact]
        public void AHelloIsWrittenAndReadBackAsAServerMessage()
        {
            var json = EnvelopeCodec.WriteHello(new Hello { BootId = "3f2a" });

            Assert.Equal("{\"type\":\"hello\",\"bootId\":\"3f2a\"}", json);
            Assert.Equal("3f2a", Assert.IsType<Hello>(EnvelopeCodec.ParseServerMessage(json)).BootId);
        }

        [Fact]
        public void AGameStateIsWrittenAndReadBackAsAServerMessage()
        {
            var json = EnvelopeCodec.WriteGameState(new GameState { State = GameState.Loading, Scene = "FLIGHT" });

            Assert.Equal("{\"type\":\"game-state\",\"state\":\"loading\",\"scene\":\"FLIGHT\"}", json);
            var read = Assert.IsType<GameState>(EnvelopeCodec.ParseServerMessage(json));
            Assert.Equal("loading", read.State);
            Assert.Equal("FLIGHT", read.Scene);
        }

        [Fact]
        public void AGameStateWithNoStateIsRefusedAsAGameStateWithAFieldWrong()
        {
            Assert.Throws<InvalidEnvelopeException>(() => EnvelopeCodec.ParseServerMessage("{\"type\":\"game-state\",\"scene\":\"FLIGHT\"}"));
        }

        [Fact]
        public void APingIsReadAsAClientMessageAndAPongAsAServerMessage()
        {
            var ping = EnvelopeCodec.WritePing(new Ping { Nonce = "7" });
            var pong = EnvelopeCodec.WritePong(new Pong { Nonce = "7" });

            Assert.Equal("{\"type\":\"ping\",\"nonce\":\"7\"}", ping);
            Assert.Equal("7", Assert.IsType<Ping>(EnvelopeCodec.ParseClientMessage(ping)).Nonce);
            Assert.Equal("7", Assert.IsType<Pong>(EnvelopeCodec.ParseServerMessage(pong)).Nonce);
        }

        [Fact]
        public void APingWithNoNonceIsStillAPing()
        {
            Assert.Equal("", Assert.IsType<Ping>(EnvelopeCodec.ParseClientMessage("{\"type\":\"ping\"}")).Nonce);
        }

        [Fact]
        public void AHelloWithNoBootIdIsRefusedAsAHelloWithAFieldWrong()
        {
            var refused = Assert.Throws<InvalidEnvelopeException>(() => EnvelopeCodec.ParseServerMessage("{\"type\":\"hello\"}"));

            Assert.IsAssignableFrom<FormatException>(refused);
        }

        [Fact]
        public void NeitherSideReadsTheOthersFrames()
        {
            Assert.Throws<UnknownEnvelopeTypeException>(() => EnvelopeCodec.ParseClientMessage("{\"type\":\"hello\",\"bootId\":\"x\"}"));
            Assert.Throws<UnknownEnvelopeTypeException>(() => EnvelopeCodec.ParseServerMessage("{\"type\":\"ping\",\"nonce\":\"x\"}"));
        }
    }
}
