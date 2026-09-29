using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The delay-modifier fold every delay reader's config goes through: what a
    /// factor does to a light-time, how several compose, and what is refused.
    /// </summary>
    public class DelayModifiersTests
    {
        private static SignalDelayConfig On(double scale = 1.0) =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = scale, SilenceDeclarationSeconds = 3600.0 };

        private static CommsPath PathOfOneHop(double meters) => new CommsPath
        {
            Hops = new List<CommsHop> { new CommsHop { DistanceMeters = meters } },
        };

        [Fact]
        public void WithNothingHeldTheConfigIsUnchanged()
        {
            var config = On();

            Assert.Same(config, new DelayModifiers().Apply(config));
        }

        [Fact]
        public void AFactorMultipliesTheLightTime()
        {
            var modifiers = new DelayModifiers();
            modifiers.Register(1.5, "a test stretch");

            var delay = SignalDelay.Compute(
                modifiers.Apply(On()),
                PathOfOneHop(SignalDelay.SpeedOfLightMetersPerSecond * 10.0),
                "vessel:x",
                Quality.Loaded);

            Assert.Equal(15.0, delay.OneWaySeconds!.Value, 9);
            Assert.Equal(CommsDelaySource.SignalDelay, delay.Source);
        }

        [Fact]
        public void EveryFactorInForceMultiplies()
        {
            var modifiers = new DelayModifiers();
            modifiers.Register(2.0, "one");
            modifiers.Register(2.0, "two");
            modifiers.Register(0.5, "three");

            Assert.Equal(2.0, modifiers.Product);
            Assert.Equal(0.5, modifiers.Apply(On()).LightSpeedScale);
        }

        /// <summary>
        /// Zero is a switch, not a very short light-time: delay reads as off,
        /// the same zero an operator's own switch gives, and nothing else held
        /// can bring it back.
        /// </summary>
        [Fact]
        public void ZeroSwitchesDelayOffWhateverElseIsHeld()
        {
            var modifiers = new DelayModifiers();
            modifiers.Register(3.0, "a stretch");
            modifiers.Register(0.0, "a cut");

            var config = modifiers.Apply(On());
            var delay = SignalDelay.Compute(config, PathOfOneHop(1.0e9), "vessel:x", Quality.Loaded);

            Assert.False(config.Enabled);
            Assert.Equal(3600.0, config.SilenceDeclarationSeconds);
            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        [Fact]
        public void WithdrawingAModifierRestoresTheDelayAndASecondDisposeIsHarmless()
        {
            var modifiers = new DelayModifiers();
            var stretch = modifiers.Register(2.0, "a stretch");
            var cut = modifiers.Register(0.0, "a cut");

            cut.Dispose();
            cut.Dispose();

            Assert.Equal(2.0, modifiers.Product);
            Assert.True(modifiers.Apply(On()).Enabled);

            stretch.Dispose();

            Assert.Equal(1.0, modifiers.Product);
        }

        [Fact]
        public void ReplacingSwapsOneFactorForAnother()
        {
            var modifiers = new DelayModifiers();
            modifiers.Register(3.0, "another's");
            var held = modifiers.Register(2.0, "mine");

            var replaced = modifiers.Replace(held, 5.0, "mine, changed");

            Assert.Equal(15.0, modifiers.Product);
            held.Dispose();
            Assert.Equal(15.0, modifiers.Product);
            replaced.Dispose();
            Assert.Equal(3.0, modifiers.Product);
        }

        [Fact]
        public void ADisabledConfigIsLeftAlone()
        {
            var modifiers = new DelayModifiers();
            modifiers.Register(2.0, "a stretch");
            var off = SignalDelayConfig.Off();

            Assert.Same(off, modifiers.Apply(off));
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        [InlineData(-0.5)]
        public void AFactorThatIsNotZeroOrPositiveAndFiniteIsRefused(double factor)
        {
            var modifiers = new DelayModifiers();

            Assert.Throws<ArgumentOutOfRangeException>(() => modifiers.Register(factor, "a bad factor"));
            Assert.Equal(1.0, modifiers.Product);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("  ")]
        public void AModifierWithNoReasonIsRefused(string? reason)
        {
            Assert.Throws<ArgumentException>(() => new DelayModifiers().Register(2.0, reason!));
        }

        [Fact]
        public void TheEngineHoldsWhatAnUplinkRegisters()
        {
            // Never started, so never disposed: Stop joins a thread that does not exist yet.
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            var held = ((IUplinkHost)engine).RegisterDelayModifier(0.0, "a test cut");

            Assert.Equal(0.0, engine.DelayModifiers.Product);
            held.Dispose();
            Assert.Equal(1.0, engine.DelayModifiers.Product);
        }
    }
}
