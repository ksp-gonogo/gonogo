using System;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The control frame must be answerable without the settings topic being
    /// subscribed.
    ///
    /// <para><b>Measured on the rig, not imagined.</b> A probe subscribing
    /// <c>system.frame</c> by itself saw ZERO frames in 45 seconds; the same
    /// probe with <c>principia.settings</c> added saw 28 in 30. The frame is
    /// derived from the settings observation, a sampled source only runs while
    /// its own topic has a subscriber, and this uplink holds the controlFrame
    /// capability EXCLUSIVELY, so answering null does not fall through to
    /// stock's vanilla. The channel simply never emitted: no exception, no log
    /// line.</para>
    ///
    /// <para>Falling back to stock would have been worse than the silence. Stock
    /// reports body-centred inertial, so a player sitting in a pulsating frame
    /// would have been told they were somewhere else, and every length on their
    /// boards would have been quoted as if it were a length.</para>
    /// </summary>
    public class ControlFrameWithoutSettingsTests
    {
        [Fact]
        public void AnUnconditionalSamplerKeepsTheSettingsObservationFresh()
        {
            var host = new RecordingUplinkHost();
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)));

            uplink.Register(host);

            // The seam that runs regardless of what is subscribed. Asserted by
            // its presence rather than by a count, because what matters is that
            // SOMETHING ungated refreshes the observation.
            Assert.NotEmpty(host.Samplers);
        }

        [Fact]
        public void TheSettingsTopicIsStillItsOwnSampledSource()
        {
            // The contrast: the fix adds an ungated refresh, it does not move the
            // settings channel onto it. Without this, deleting the sampled source
            // and leaving only the sampler would pass the test above while the
            // settings topic stopped publishing.
            var host = new RecordingUplinkHost();
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)));

            uplink.Register(host);

            Assert.Contains(PrincipiaUplink.SettingsTopic, host.SampledSourceTopics);
        }

        [Fact]
        public void DrivingTheSamplerDoesNotThrowBeforeTheProducerIsReadable()
        {
            // No settings source attached, which is the state on every tick before
            // the producer's windows exist. An
            // unconditional sampler runs on EVERY tick, so one that
            // threw here would take the tick down during scene load, before
            // anything it reads has been built.
            var host = new RecordingUplinkHost();
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)));
            uplink.Register(host);

            var sampler = host.Samplers.First();

            sampler.Sample(new KspSnapshot());
        }
    }
}
