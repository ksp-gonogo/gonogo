using System;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That a delay modifier reaches the one accessor every delay reader uses,
    /// <c>CommsCoreUplink.SignalDelayConfig</c>, and that the settings' own
    /// switch and light-speed scale arrive there the same way.
    ///
    /// <para><see cref="DelayModifiers"/> is unit-tested in
    /// <c>Sitrep.Host.Tests</c>, which proves the fold and nothing about
    /// whether the accessor folds through it. If it did not, every reader would
    /// go on applying the full light-time under a modifier of zero.</para>
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class DelayModifierWiringTests
    {
        [Fact]
        public void AModifierOfZeroSwitchesTheSharedDelayOffUntilWithdrawn()
        {
            WithDelayOn(modifiers =>
            {
                var held = modifiers.Register(0.0, "a test cut");

                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);
                // The authored config is untouched: the cut lasts only as long
                // as the modifier is held.
                Assert.True(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);

                held.Dispose();

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void AModifierScalesEveryLightTimeAndComposesWithTheSettingsScale()
        {
            WithDelayOn(modifiers =>
            {
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.5 });
                modifiers.Register(4.0, "a test stretch");

                // Twice the light-time from the settings, four times from the
                // modifier: one eighth of c.
                Assert.Equal(0.125, CommsCoreUplink.SignalDelayConfig.LightSpeedScale);
            });
        }

        /// <summary>
        /// The settings are modifiers too: switched off is a factor of zero, and
        /// a light speed of a quarter of c is a factor of four.
        /// </summary>
        [Fact]
        public void TheSettingsAreAppliedAsModifiers()
        {
            WithDelayOn(modifiers =>
            {
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.25 });
                Assert.Equal(4.0, modifiers.Product);
                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
                Assert.Equal(0.25, CommsCoreUplink.SignalDelayConfig.LightSpeedScale);

                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = false, LightSpeedScale = 0.25 });
                Assert.Equal(0.0, modifiers.Product);
                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);

                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 });
                Assert.Equal(1.0, modifiers.Product);
                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// Settings are read at boot, before the host's set exists, so moving to
        /// that set has to take them along or delay would come back on the
        /// moment the comms uplink registered.
        /// </summary>
        [Fact]
        public void MovingToTheHostsModifiersCarriesTheSettingsAcross()
        {
            WithDelayOn(before =>
            {
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0 });
                var host = new DelayModifiers();

                CommsCoreUplink.UseDelayModifiers(host);

                Assert.Equal(1.0, before.Product);
                Assert.Equal(0.0, host.Product);
                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// The config, the modifier set and the model probe behind the shared
        /// delay accessor are all process statics, so each case gets a set of
        /// its own and puts every one of them back.
        /// </summary>
        private static void WithDelayOn(Action<DelayModifiers> body)
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            var previous = CommsCoreUplink.DelayModifiersInForce;
            var modifiers = new DelayModifiers();
            try
            {
                CommsCoreUplink.ConfigureCommsModelProbe(() => true);
                CommsCoreUplink.UseDelayModifiers(modifiers);
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 });
                body(modifiers);
            }
            finally
            {
                CommsCoreUplink.ConfigureSignalDelay(authored);
                CommsCoreUplink.UseDelayModifiers(previous);
                CommsCoreUplink.ConfigureCommsModelProbe(null);
            }
        }
    }
}
