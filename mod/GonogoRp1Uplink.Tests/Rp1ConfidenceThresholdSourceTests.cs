using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// RP-1's contribution to what a SCET alarm may be armed against: Confidence,
    /// so an operator warping toward the next Program is stopped on the tick they
    /// can commit to it.
    ///
    /// <para>The builder is exercised through the real
    /// <see cref="IScetThresholdSources"/> surface rather than called directly,
    /// because the whole point of the seam is that core reaches it that way.</para>
    /// </summary>
    public class Rp1ConfidenceThresholdSourceTests
    {
        private static Func<Rp1ConfidenceRaw?> Reading(double? confidence, double? earned = 100) =>
            () => new Rp1ConfidenceRaw { Confidence = confidence, Earned = earned };

        private static IDictionary<string, object?>? Build(Func<Rp1ConfidenceRaw?> read)
        {
            var source = new Rp1ConfidenceThresholdSource(read).Sources().Single();
            return source.Build(null) as IDictionary<string, object?>;
        }

        [Fact]
        public void It_offers_the_topic_rp1_already_publishes()
        {
            // The Topic an operator reads on screen, so the field path they arm
            // against is the one the wire uses rather than a second spelling.
            var source = new Rp1ConfidenceThresholdSource(Reading(30)).Sources().Single();

            Assert.Equal("rp1.confidence", source.Topic);
            Assert.NotNull(source.Build);
        }

        [Fact]
        public void The_reading_carries_the_same_fields_the_channel_does()
        {
            var payload = Build(Reading(confidence: 30, earned: 120));

            Assert.NotNull(payload);
            Assert.Equal(30.0, payload!["confidence"]);
            Assert.Equal(120.0, payload["earned"]);
        }

        [Fact]
        public void It_stamps_game_so_a_threshold_can_be_armed_against_it()
        {
            // Without the stamp the arm is accepted and the alarm never comes due,
            // which an operator cannot tell apart from a condition not yet met.
            // "game" because Confidence belongs to the save, not to anything flying.
            var payload = Build(Reading(30));
            var meta = Assert.IsType<Dictionary<string, object?>>(payload!["meta"]);

            Assert.Equal("game", meta["source"]);
        }

        [Fact]
        public void No_confidence_system_reads_as_nothing_rather_than_as_zero()
        {
            // A career that has spent its Confidence genuinely sits at 0, so a save
            // with no Confidence system reporting 0 would fire "confidence below 10"
            // on an install that has no such quantity at all.
            Assert.Null(Build(() => null));
        }

        [Fact]
        public void An_unreadable_balance_is_absent_rather_than_substituted()
        {
            var payload = Build(Reading(confidence: null));

            Assert.NotNull(payload);
            Assert.Null(payload!["confidence"]);
        }

        [Fact]
        public void A_reflection_walk_that_throws_costs_this_tick_and_not_the_capture()
        {
            // The builder runs inside the SCET alarm's own main-thread capture, and
            // that capture decides whether the warp stops. An RP-1 shape change must
            // cost a reading, never the arm.
            Assert.Null(Build(() => throw new InvalidOperationException("RP-1 moved a field")));
        }
    }
}
