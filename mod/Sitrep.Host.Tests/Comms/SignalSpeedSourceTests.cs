using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class SignalSpeedSourceTests
    {
        private static SignalDelayConfig _config = new SignalDelayConfig();

        private static SignalSpeedSource Source(SignalDelayConfig config)
        {
            _config = config;
            return new SignalSpeedSource(() => _config);
        }

        [Fact]
        public void AnUnscaledLightSpeedIsTheRealSpeedOfLight()
        {
            var source = Source(new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 });

            SeamConformance.AssertProviderContract(source);
            Assert.Equal(SignalSpeedCapability.LightSpeedMetresPerSecond, source.Current.MetresPerSecond);
        }

        [Fact]
        public void AScaledLightSpeedIsTheScaleTimesTheSpeedOfLight()
        {
            var source = Source(new SignalDelayConfig { Enabled = true, LightSpeedScale = 1e-8 });

            Assert.Equal(SignalSpeedCapability.LightSpeedMetresPerSecond * 1e-8, source.Current.MetresPerSecond!.Value, 9);
        }

        [Fact]
        public void SignalDelaySwitchedOffIsNotASpeedAtAll()
        {
            var source = Source(new SignalDelayConfig { Enabled = false, LightSpeedScale = 0.5 });

            Assert.Null(source.Current.MetresPerSecond);
        }

        [Fact]
        public void AChangeIsAnnouncedOnceWithTheNewSpeedAndAnUnchangedSpeedIsNot()
        {
            var source = Source(new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 });
            var heard = new List<SignalSpeedReading>();
            source.Changed += heard.Add;

            source.Refresh();
            _config = new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.5 };
            source.Refresh();
            source.Refresh();

            Assert.Single(heard);
            Assert.Equal(SignalSpeedCapability.LightSpeedMetresPerSecond * 0.5, heard[0].MetresPerSecond);
            Assert.Same(heard[0], source.Current);
        }
    }
}
