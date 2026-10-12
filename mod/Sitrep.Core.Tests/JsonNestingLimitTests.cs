using System;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Every inbound frame is parsed by a recursive reader, and under Mono a stack overflow
    /// cannot be caught: it ends KSP. A frame nested past the limit must be refused as a
    /// malformed frame instead.
    /// </summary>
    public class JsonNestingLimitTests
    {
        [Theory]
        [InlineData('[')]
        [InlineData('{')]
        public void a_frame_nested_far_past_the_limit_is_refused_not_overflowed(char open)
        {
            var frame = new string(open, 100_000);

            Assert.ThrowsAny<FormatException>(() => EnvelopeCodec.ParseClientMessage(frame));
        }

        [Fact]
        public void a_field_nested_past_the_limit_is_refused()
        {
            var frame = "{\"type\":\"ping\",\"nonce\":\"7\",\"pad\":" + Nested(64) + "}";

            Assert.ThrowsAny<FormatException>(() => EnvelopeCodec.ParseClientMessage(frame));
        }

        [Fact]
        public void a_frame_nested_to_the_limit_still_parses()
        {
            // The frame's own object is the first level.
            var frame = "{\"type\":\"ping\",\"nonce\":\"7\",\"pad\":" + Nested(63) + "}";

            Assert.Equal("7", Assert.IsType<Ping>(EnvelopeCodec.ParseClientMessage(frame)).Nonce);
        }

        private static string Nested(int depth) => new string('[', depth) + new string(']', depth);
    }
}
