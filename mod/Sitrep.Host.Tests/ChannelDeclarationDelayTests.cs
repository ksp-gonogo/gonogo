using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Round-trips <see cref="ChannelDeclaration.Delay"/> — the Minor-bump
    /// per-channel delay disposition (see
    /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>). Two things
    /// this proves:
    ///
    /// 1. The default is <see cref="DelayRole.Delayed"/> (matching
    ///    <see cref="CommandDeclaration.Delayed"/>'s own default-true
    ///    precedent) — every EXISTING call site that never sets this
    ///    property keeps compiling and defaulting the same way.
    /// 2. Both enum values round-trip through the property untouched — the
    ///    trivial "this is a real settable property, not a typo" smoke test
    ///    every new contract field needs.
    /// </summary>
    public class ChannelDeclarationDelayTests
    {
        [Fact]
        public void DefaultsToDelayed()
        {
            var declaration = new ChannelDeclaration { Topic = "test.topic" };
            Assert.Equal(DelayRole.Delayed, declaration.Delay);
        }

        [Theory]
        [InlineData(DelayRole.Delayed)]
        [InlineData(DelayRole.TrueNow)]
        public void RoundTripsExplicitDisposition(DelayRole role)
        {
            var declaration = new ChannelDeclaration { Topic = "test.topic", Delay = role };
            Assert.Equal(role, declaration.Delay);
        }
    }
}
