using System;
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
    /// derived from the settings observation, a subscription-gated sampled source
    /// only runs while something under its own prefixes has a subscriber, and this
    /// uplink holds the controlFrame capability EXCLUSIVELY, so answering null does
    /// not fall through to stock's vanilla. The channel simply never emitted: no
    /// exception, no log line.</para>
    ///
    /// <para>Falling back to stock would have been worse than the silence. Stock
    /// reports body-centred inertial, so a player sitting in a pulsating frame
    /// would have been told they were somewhere else, and every length on their
    /// boards would have been quoted as if it were a length.</para>
    ///
    /// <para><b>These drive ticks rather than reading the registration.</b> The
    /// first guard here asserted only that SOMETHING unconditional was registered.
    /// That shape cannot see a refresher which is registered and then never
    /// refreshes: one that throws on every tick is caught by the engine's fail-soft
    /// and takes the uplink quietly Unavailable, and the assertion stays green
    /// through it. A guard on a silent-starvation fix that is itself blind to a
    /// silent failure is not a guard. Drive the tick, ask the capability, and
    /// require an answer.</para>
    /// </summary>
    public class ControlFrameWithoutSettingsTests
    {
        private static PrincipiaUplink Available(ISettingsSource settings) =>
            new PrincipiaUplink(
                PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)), settings);

        [Fact]
        public void TheFrameAnswersWithOnlyItsOwnTopicSubscribed()
        {
            var host = new RecordingUplinkHost();
            Available(new FakeSettingsSource()).Register(host);
            host.Resolve();

            // system.frame and nothing else: exactly the probe that saw silence.
            host.DriveTick(new KspSnapshot(), "system.frame");

            var frame = host.Kernel
                .Query<IControlFrameSource>(ControlFrameCapability.Id)
                .Frame;
            Assert.NotNull(frame);
            Assert.Equal(ControlFrameKind.RotatingPulsating, frame!.Kind);
        }

        [Fact]
        public void TheFrameAnswersWithNOTHINGSubscribed()
        {
            // The stronger form of the case above, and the one that says what the
            // fix actually claims: the observation is refreshed because the engine
            // ticks, not because some topic happened to be watched.
            var host = new RecordingUplinkHost();
            Available(new FakeSettingsSource()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot());

            Assert.NotNull(
                host.Kernel.Query<IControlFrameSource>(ControlFrameCapability.Id).Frame);
        }

        [Fact]
        public void TheSettingsTopicStillPublishesWhenItIsSubscribed()
        {
            // The contrast: making the reading unconditional must not cost the
            // settings channel its own publication. Without this, moving the read
            // and forgetting the publish would pass every test above while the
            // topic went silent.
            var host = new RecordingUplinkHost();
            Available(new FakeSettingsSource()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot(), PrincipiaUplink.SettingsTopic);

            Assert.NotEmpty(host.PublishedTo(PrincipiaUplink.SettingsTopic));
        }

        [Fact]
        public void TheReadingIsTakenOncePerTickWhenTheSettingsTopicIsSubscribed()
        {
            // One reading, not two. The reading touches Principia's plugin, and a
            // second one per tick is both waste and a second chance for the two
            // answers to disagree inside a single tick.
            var host = new RecordingUplinkHost();
            Available(new FakeSettingsSource()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot(), PrincipiaUplink.SettingsTopic);

            Assert.Single(host.PublishedTo(PrincipiaUplink.SettingsTopic));
        }

        [Fact]
        public void DrivingTheTickDoesNotThrowBeforeTheProducerIsReadable()
        {
            // No settings source attached, which is the state on every tick before
            // the producer's windows exist. An unconditional reading runs on EVERY
            // tick, so one that threw here would take the tick down during scene
            // load, before anything it reads has been built.
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)))
                .Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot());
        }
    }
}
