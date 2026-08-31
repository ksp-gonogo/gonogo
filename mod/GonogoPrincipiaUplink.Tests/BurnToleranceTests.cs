// How close is the same, and how close is not.
//
// Measured on the rig on 2026-08-31, which is the only reason there is a
// tolerance here at all: a burn's ignition instant went into Principia as
// 4644.3399999141702 and came back as 4644.3399999141693. One ULP, nine parts in
// ten to the thirteenth of a second. Exact equality was refusing every burn
// insertion on that, and calling it a struct-layout failure while it did.
//
// So these tests are in two halves, and the second half is the one that matters.
// Admitting the drift is easy; the tolerance is only worth having if it still
// refuses everything it refused before, and a comparison loosened past the point
// where a real fault registers would be worse than the bug it replaced.
using System;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class BurnToleranceTests
    {
        /// <summary>The instant the rig actually sent, to the bit.</summary>
        private const double SentInstant = 4644.3399999141702;

        /// <summary>And the instant that came back.</summary>
        private const double ReturnedInstant = 4644.3399999141693;

        private static FakeBurn Burn(
            double initialTime = SentInstant,
            double thrust = 60.0,
            double deltaVTangent = 120.5) => new FakeBurn
        {
            thrust_in_kilonewtons = thrust,
            specific_impulse_in_seconds_g0 = 320.0,
            initial_time = initialTime,
            is_inertially_fixed = false,
            intensity = new FakeIntensity
            {
                coordinate_system_ = 1,
                xyz = new FakeXyz { x = deltaVTangent, y = 0.0, z = 0.0 },
            },
        };

        // ── The drift the rig measured ──────────────────────────────────────

        /// <summary>
        /// The exact pair of doubles the rig produced. A regression on the literal
        /// measurement rather than on a constructed near-miss, so this test fails if
        /// the tolerance is ever tightened back past the thing it was written for.
        /// </summary>
        [Fact]
        public void The_one_ULP_the_rig_measured_is_the_same_instant()
        {
            // The premise, asserted rather than assumed: these really are one ULP
            // apart and really are not equal, so the test is exercising the tolerance
            // and not a pair of identical doubles.
            Assert.NotEqual(SentInstant, ReturnedInstant);
            Assert.Equal(1, UlpsApart(SentInstant, ReturnedInstant));

            Assert.Null(
                PrincipiaLayoutProbe.DescribeBurnDifference(
                    Burn(initialTime: SentInstant), Burn(initialTime: ReturnedInstant)));
        }

        [Fact]
        public void A_delta_v_that_drifts_by_one_ULP_is_the_same_delta_v()
        {
            var came = NextAfter(120.5);

            Assert.NotEqual(120.5, came);
            Assert.Null(
                PrincipiaLayoutProbe.DescribeBurnDifference(
                    Burn(deltaVTangent: 120.5), Burn(deltaVTangent: came)));
        }

        // ── What it must still refuse ───────────────────────────────────────

        /// <summary>
        /// The protection that matters. A wrong field offset does not produce a value
        /// a few ULPs away; it produces a different exponent or a neighbouring
        /// field's value. Both are still refused, and both still name the field.
        /// </summary>
        [Fact]
        public void A_wrong_exponent_is_still_corruption()
        {
            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(
                Burn(initialTime: SentInstant), Burn(initialTime: SentInstant * 2.0));

            Assert.NotNull(difference);
            Assert.Contains("initial_time", difference!);
        }

        [Fact]
        public void A_neighbouring_fields_value_in_the_slot_is_still_corruption()
        {
            // Thrust arriving where the instant should be: the shape a field-offset
            // error actually takes.
            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(
                Burn(initialTime: SentInstant), Burn(initialTime: 60.0));

            Assert.NotNull(difference);
            Assert.Contains("initial_time", difference!);
        }

        /// <summary>
        /// The tolerance is tight enough that a difference a human would call
        /// negligible is still refused. A microsecond on an instant of 4644 is
        /// roughly a million ULPs, so nothing an operator could perceive is being
        /// waved through.
        /// </summary>
        [Fact]
        public void Even_a_microsecond_is_far_outside_the_tolerance()
        {
            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(
                Burn(initialTime: SentInstant), Burn(initialTime: SentInstant + 1e-6));

            Assert.NotNull(difference);
            Assert.Contains("initial_time", difference!);
        }

        /// <summary>
        /// A coordinate system one away is a different coordinate system, and is
        /// refused.
        ///
        /// <para><b>This does NOT prove that the discrete fields are compared
        /// exactly, and it was named as though it did until a planted change showed
        /// otherwise.</b> Comparing the coordinate system as a QUANTITY instead
        /// leaves every test here green, because 1 and 2 as doubles are about 2^52
        /// ULPs apart and no tolerance of four could conflate them. The exact/quantity
        /// split for these fields is a statement of intent that their own values
        /// cannot currently distinguish; what this test holds is the behaviour, which
        /// is the part an operator depends on.</para>
        /// </summary>
        [Fact]
        public void A_coordinate_system_one_away_is_still_corruption()
        {
            var went = Burn();
            var came = Burn();
            came.intensity.coordinate_system_ = 2;

            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(went, came);

            Assert.NotNull(difference);
            Assert.Contains("coordinate_system", difference!);
        }

        [Fact]
        public void A_flag_that_flipped_is_still_corruption()
        {
            var came = Burn();
            came.is_inertially_fixed = true;

            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(Burn(), came);

            Assert.Contains("is_inertially_fixed", difference!);
        }

        /// <summary>
        /// A value that came back NOT A NUMBER is refused, and by a route worth
        /// naming because it is not the tolerance.
        ///
        /// <para>The reader turns a non-finite double into an ABSENCE before any
        /// comparison sees it, so a burn whose instant came back NaN reads as a
        /// number that went in and an unreadable value that came back, and those
        /// never match. The tolerance is not consulted and could not help if it
        /// were.</para>
        ///
        /// <para>Two NaNs would therefore compare EQUAL here, as two unreadable
        /// values. That is unreachable rather than tolerated: the composer refuses a
        /// burn built from a value that is not a number, so a NaN cannot be the thing
        /// that went in.</para>
        /// </summary>
        [Fact]
        public void A_value_that_came_back_not_a_number_is_refused()
        {
            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(
                Burn(initialTime: SentInstant), Burn(initialTime: double.NaN));

            Assert.NotNull(difference);
            Assert.Contains("initial_time", difference!);
        }

        // ── The frame's bodies ──────────────────────────────────────────────

        /// <summary>
        /// The case the comparison could not see until now: same kind, same Δv, same
        /// instant, different BODY. Every other field agrees, so before the frame
        /// indices joined the snapshot this burn round-tripped clean.
        /// </summary>
        [Fact]
        public void A_burn_that_came_back_centred_on_another_body_is_refused()
        {
            var went = FromPlugin(centre: 1);
            var came = FromPlugin(centre: 5);

            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(went, came);

            Assert.NotNull(difference);
            Assert.Contains("centre_index", difference!);
            Assert.Contains("1", difference);
            Assert.Contains("5", difference);
        }

        /// <summary>
        /// The pair slots too, which a direction frame reads instead of the centre.
        /// Asserted separately rather than trusting that one loop covers three fields.
        /// </summary>
        [Fact]
        public void A_burn_whose_frame_pair_changed_is_refused()
        {
            // Built through the constructor rather than assigned, because the fake's
            // slots are non-public exactly as the producer's descriptor's are, and a
            // test that widened them would be exercising a shape RP-1 does not have.
            var primary = FromPlugin(primary: 9);
            Assert.Contains(
                "primary_index", PrincipiaLayoutProbe.DescribeBurnDifference(FromPlugin(), primary)!);

            var secondary = FromPlugin(secondary: 9);
            Assert.Contains(
                "secondary_index",
                PrincipiaLayoutProbe.DescribeBurnDifference(FromPlugin(), secondary)!);
        }

        /// <summary>
        /// And the complement, so the three tests above are not passing because the
        /// comparison refuses everything: an unchanged frame still round-trips clean.
        /// </summary>
        [Fact]
        public void An_unchanged_frame_is_still_the_same_frame()
        {
            Assert.Null(PrincipiaLayoutProbe.DescribeBurnDifference(FromPlugin(), FromPlugin()));
        }

        /// <summary>A burn as it comes OUT of the plugin: a frame with all four slots.</summary>
        private static FakeBurn FromPlugin(int centre = 1, int primary = -1, int secondary = -1)
        {
            var burn = new FakeBurn(new FakeBurnFrameParameters(6000, centre, primary, secondary))
            {
                initial_time = SentInstant,
                intensity = new FakeIntensity
                {
                    coordinate_system_ = 1,
                    xyz = new FakeXyz { x = 120.5, y = 0.0, z = 0.0 },
                },
            };
            return burn;
        }

        // ── The arithmetic the tests above lean on ──────────────────────────

        /// <summary>The next representable double above <paramref name="value"/>.</summary>
        private static double NextAfter(double value) =>
            BitConverter.Int64BitsToDouble(BitConverter.DoubleToInt64Bits(value) + 1);

        /// <summary>
        /// How many representable doubles lie between two values. Its own
        /// implementation rather than the production one, so a test asserting "one
        /// ULP" is not asserting it with the same code it is testing.
        /// </summary>
        private static long UlpsApart(double a, double b)
        {
            var left = BitConverter.DoubleToInt64Bits(a);
            var right = BitConverter.DoubleToInt64Bits(b);
            return Math.Abs(left - right);
        }
    }
}
