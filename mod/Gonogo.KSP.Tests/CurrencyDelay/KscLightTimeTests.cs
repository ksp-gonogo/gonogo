using System;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// The rule these pin: a currency event is delayed by exactly ONE number,
    /// the one-way light-time of a live control path whose last hop is home
    /// (<c>local_docs/design/2026-08-15-unroutable-currency-consensus.md</c>).
    ///
    /// <para>This file used to test the opposite. It had cases named
    /// <c>Resolve_falls_back_to_straight_line_when_no_routed_delay_is_available</c>
    /// and a family of <c>FromDistance</c> tests, all asserting that a chord
    /// from the craft to KSC divided by <c>c</c> was an acceptable delay. It is
    /// not one: a chord passes through whatever the craft is hiding behind, so
    /// it quoted a confident, timed delay for a craft nothing could reach and
    /// science from the far side of the system was credited as though it had
    /// arrived. Those tests are gone with the code they protected.</para>
    /// </summary>
    public class KscLightTimeTests
    {
        private static SignalDelayConfig On(double scale = 1.0) =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = scale };

        [Fact]
        public void A_routed_light_time_is_carried_through_unchanged()
        {
            var delay = KscLightTimeMath.Resolve(routedOneWaySeconds: 4.25, config: On());

            Assert.Equal(KscDelayKind.Routed, delay.Kind);
            Assert.Equal(4.25, delay.Seconds, 6);
        }

        [Fact]
        public void No_routed_path_is_unroutable_never_a_distance()
        {
            var delay = KscLightTimeMath.Resolve(routedOneWaySeconds: null, config: On());

            Assert.Equal(KscDelayKind.Unroutable, delay.Kind);
            Assert.True(delay.IsUnroutable);
        }

        [Fact]
        public void Delay_disabled_is_a_genuine_zero_not_an_absence()
        {
            // The player asked for instant books. That is a real zero, and it
            // must stay distinguishable from "no route", which is not.
            var delay = KscLightTimeMath.Resolve(
                routedOneWaySeconds: null,
                config: new SignalDelayConfig { Enabled = false });

            Assert.Equal(KscDelayKind.Instant, delay.Kind);
            Assert.Equal(0.0, delay.Seconds);
        }

        [Fact]
        public void A_nonpositive_light_speed_scale_is_unroutable()
        {
            Assert.True(KscLightTimeMath.Resolve(1.0, On(scale: 0.0)).IsUnroutable);
            Assert.True(KscLightTimeMath.Resolve(1.0, On(scale: -1.0)).IsUnroutable);
        }

        [Fact]
        public void A_null_config_is_unroutable()
        {
            Assert.True(KscLightTimeMath.Resolve(1.0, config: null).IsUnroutable);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(-1.0)]
        public void A_nonsense_routed_value_is_unroutable_rather_than_carried(double seconds)
        {
            // Better to block than to enqueue a row that reveals in the past or
            // never matures at all.
            Assert.True(KscLightTimeMath.Resolve(seconds, On()).IsUnroutable);
        }

        /// <summary>
        /// The defect the type exists to prevent, asserted directly: reading
        /// seconds off an unroutable delay must be impossible, not zero.
        /// </summary>
        [Fact]
        public void Reading_seconds_off_an_unroutable_delay_throws_rather_than_yielding_zero()
        {
            var delay = KscDelay.Unroutable;

            var ex = Assert.Throws<InvalidOperationException>(() => delay.Seconds);
            Assert.Contains("Blocked", ex.Message);
        }

        [Fact]
        public void An_unroutable_event_reveals_at_the_policy_deadline_not_immediately()
        {
            var revealUt = KscDelay.Unroutable.RevealUt(eventUt: 1_000.0, silenceDeclarationSeconds: 86_400.0);

            Assert.Equal(87_400.0, revealUt);
        }

        [Fact]
        public void A_routed_event_reveals_at_its_own_light_time()
        {
            var revealUt = KscDelay.Routed(12.5).RevealUt(eventUt: 1_000.0, silenceDeclarationSeconds: 86_400.0);

            Assert.Equal(1_012.5, revealUt);
        }

        [Fact]
        public void An_instant_event_reveals_at_the_event()
        {
            Assert.Equal(1_000.0, KscDelay.Instant.RevealUt(1_000.0, 86_400.0));
        }

        /// <summary>
        /// Turning the feature off must make currency instant everywhere, not
        /// just on the one path that happens to consult the flag.
        ///
        /// <para>The gate lived inside <c>Resolve</c>, and every Unroutable
        /// literal elsewhere skipped it — so with signal delay switched OFF,
        /// ordinary science still revealed a Kerbin day late. The off switch has
        /// to be checked where the delay is CONSUMED, not only where it is
        /// computed.</para>
        /// </summary>
        [Fact]
        public void With_delay_disabled_even_an_unroutable_event_is_instant()
        {
            var off = new SignalDelayConfig { Enabled = false, SilenceDeclarationSeconds = 86_400.0 };

            var revealUt = KscDelayPolicy.RevealUt(KscDelay.Unroutable, eventUt: 1_000.0, config: off);

            Assert.Equal(1_000.0, revealUt);
        }

        [Fact]
        public void With_delay_enabled_an_unroutable_event_waits_the_policy_deadline()
        {
            var on = new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 };

            Assert.Equal(87_400.0, KscDelayPolicy.RevealUt(KscDelay.Unroutable, 1_000.0, on));
        }

        [Fact]
        public void With_delay_disabled_the_aggregator_offset_is_zero()
        {
            var off = new SignalDelayConfig { Enabled = false, SilenceDeclarationSeconds = 86_400.0 };

            Assert.Equal(0.0, KscDelayPolicy.DelaySeconds(KscDelay.Unroutable, off));
        }

        [Fact]
        public void A_routed_delay_rejects_a_nonsense_value_at_construction()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => KscDelay.Routed(double.NaN));
            Assert.Throws<ArgumentOutOfRangeException>(() => KscDelay.Routed(-0.5));
        }
    }
}
