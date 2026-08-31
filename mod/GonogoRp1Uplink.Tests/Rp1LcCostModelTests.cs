using System;
using System.Collections.Generic;
using RP0;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// RP-1's price for building and renovating a launch complex, pinned.
    ///
    /// <para><b>Why this file is written differently from every other test file
    /// in this Uplink.</b> Everywhere else a command invokes an RP-1 method that
    /// already does the thing, and a test proves the right member was called. Here
    /// there is no method: RP-1 computes the price inline in
    /// <c>KCT_GUI.DrawNewLCWindow</c>, interleaved with the GUILayout calls that
    /// draw it, and hands three doubles to <c>ProcessNewLC</c>. So the arithmetic
    /// is ours, and a mistake in it does not throw and does not refuse: it writes
    /// a wrong price onto a construction project, and RP-1 then draws that figure
    /// out of the career's funds over the following weeks of game time.</para>
    ///
    /// <para><b>Mostly RELATIONSHIPS rather than magic numbers, on purpose.</b> A
    /// test that restates the formula and compares it to the formula agrees with
    /// itself whatever either says. So each clause of RP-1's arithmetic is pinned
    /// as the property that clause EXISTS to produce: a downgrade costs half what
    /// the same move costs upward, a tonnage change costs at least a thousand, a
    /// growth is capped at what building outright would have cost. Those hold only
    /// if the clause is present and correct, and none of them can be satisfied by
    /// a transcription that dropped one.</para>
    ///
    /// <para>Two absolute pins sit beside them, because a suite made only of
    /// relationships would pass with every figure scaled or signed wrongly
    /// together.</para>
    ///
    /// <para><b>What these cannot do.</b> The stand-in reproduces
    /// <c>LCData.GetCostStats</c> and <c>ResModifyCost</c> from the shipped source,
    /// so a wrong COMBINATION of them is caught here and a wrong transcription of
    /// them is not: both this file and the fixture were read off the same
    /// disassembly, and if that reading is wrong they agree wrongly. The check
    /// that closes that gap is a different KIND (RP-1's own Modify window, showing
    /// its "Modify Cost" for a renovation this model has quoted) and it needs a
    /// running game. It has NOT been done.</para>
    /// </summary>
    public class Rp1LcCostModelTests
    {
        /// <summary>RP-1's shipped additional-pad multiplier, named rather than repeated.</summary>
        private const double PadMult = 0.5;

        private static Type ComplexType => typeof(LaunchComplex);

        /// <summary>
        /// A specification. Sizes are whole metres on purpose: RP-1 does its axis
        /// subtractions in float, and integral metres make the expected figures
        /// exact rather than nearly exact.
        /// </summary>
        private static LCData Spec(
            float massMax = 100f,
            float width = 10f,
            float height = 20f,
            float depth = 10f,
            bool humanRated = false,
            float? massOrig = null,
            LaunchComplexType type = LaunchComplexType.Pad,
            Dictionary<string, double>? resources = null)
        {
            var data = new LCData
            {
                Name = "LC-1",
                massMax = massMax,
                massOrig = massOrig ?? massMax,
                sizeMax = new UnityEngine.Vector3(width, height, depth),
                isHumanRated = humanRated,
                lcType = type,
            };
            if (resources != null)
            {
                foreach (var entry in resources)
                {
                    data.resourcesHandled[entry.Key] = entry.Value;
                }
            }
            return data;
        }

        /// <summary>A complex standing at a specification, which is the state a renovation starts from.</summary>
        private static LaunchComplex ComplexAt(LCData spec, int operationalPads = 1)
        {
            var lc = new LaunchComplex { Name = spec.Name ?? "LC-1", StatsValue = new LCData(spec) };
            lc.SyncFromStats();
            for (var i = 0; i < operationalPads; i++)
            {
                lc.LaunchPads.Add(new LCLaunchPad(Guid.NewGuid(), "Pad " + (i + 1), 0f)
                {
                    isOperational = true,
                    Lc = lc,
                });
            }
            return lc;
        }

        private static Rp1LcCostModel.Quote QuoteModify(
            LCData to,
            LaunchComplex from,
            int operationalPads = 1,
            bool isHangar = false)
        {
            var quote = Rp1LcCostModel.QuoteModify(
                to, from, from.Stats, isHangar, operationalPads, ComplexType, PadMult);
            Assert.NotNull(quote);
            return quote!;
        }

        private static (double Pad, double Integration, double Resources) Costs(LCData spec)
        {
            var total = spec.GetCostStats(out var pad, out var integration, out var resources);
            Assert.Equal(pad + integration + resources, total, 6);
            return (pad, integration, resources);
        }

        // ── Building one outright ──────────────────────────────────────────────

        [Fact]
        public void A_new_complex_costs_its_pad_its_integration_and_its_resources()
        {
            var spec = Spec();
            var expected = Costs(spec);

            var quote = Rp1LcCostModel.QuoteNew(spec, ComplexType, PadMult);

            Assert.NotNull(quote);
            // Nothing to compare against, so the three halves simply add up. The
            // one place in this model where the price is not a difference.
            Assert.Equal(expected.Pad + expected.Integration + expected.Resources, quote!.TotalCost, 6);
        }

        [Fact]
        public void A_new_complex_has_no_prior_cost_to_amortise()
        {
            var quote = Rp1LcCostModel.QuoteNew(Spec(), ComplexType, PadMult);

            // RP-1 turns (cost, oldCost) into a build DURATION, and a new complex
            // has no prior. A stale figure here would shorten the build rather than
            // change its price, which is the kind of error nothing on the wire
            // would show.
            Assert.Equal(0.0, quote!.OldTotalCost);
        }

        [Fact]
        public void Building_one_is_never_reported_as_a_downgrade()
        {
            var quote = Rp1LcCostModel.QuoteNew(Spec(), ComplexType, PadMult);

            // There is nothing to be smaller than. The flag drives an operator
            // warning, so a build that claimed to be a reduction would be a lie in
            // the one place the operator is reading for reassurance.
            Assert.False(quote!.IsDowngrade);
        }

        [Fact]
        public void Human_rating_a_new_complex_costs_half_again_on_the_pad_and_double_on_integration()
        {
            var plain = Costs(Spec(humanRated: false));
            var crewed = Costs(Spec(humanRated: true));

            // RP-1's own multipliers, and the reason humanRated is a REQUIRED
            // argument rather than a defaulted false: getting it wrong halves or
            // doubles the price of the thing being bought.
            Assert.Equal(plain.Pad * 1.5, crewed.Pad, 6);
            Assert.Equal(plain.Integration * 2.0, crewed.Integration, 6);
        }

        // ── The pad half of a renovation ───────────────────────────────────────

        [Fact]
        public void Growing_the_pad_costs_the_whole_difference()
        {
            var from = ComplexAt(Spec(massMax: 100f));
            var to = Spec(massMax: 180f, massOrig: 100f);
            var before = Costs(from.Stats);
            var after = Costs(to);

            var quote = QuoteModify(to, from);

            // The pad half, isolated: same size on both specs, so the integration
            // half is only the cost difference, and the resource half is zero.
            var padHalf = quote.TotalCost - Math.Abs(after.Integration - before.Integration);
            Assert.Equal(after.Pad - before.Pad, padHalf, 6);
        }

        [Fact]
        public void Shrinking_the_pad_costs_HALF_the_difference_and_is_never_a_refund()
        {
            var from = ComplexAt(Spec(massMax: 180f));
            var to = Spec(massMax: 100f, massOrig: 180f);
            var before = Costs(from.Stats);
            var after = Costs(to);

            var quote = QuoteModify(to, from);

            // THE CLAUSE THIS TEST EXISTS FOR: `(costPad - curPadCost) * 0.5`. You
            // pay to downgrade, at half rate, and a transcription that dropped the
            // 0.5 or flipped the sign fails here rather than quietly billing an
            // operator double or paying them.
            var padHalf = quote.TotalCost - Math.Abs(after.Integration - before.Integration) * 0.5;
            Assert.Equal((before.Pad - after.Pad) * 0.5, padHalf, 6);
            Assert.True(quote.TotalCost > 0.0, "a downgrade is a bill, never a refund");
        }

        [Fact]
        public void A_shrink_costs_exactly_half_what_the_same_move_upward_costs()
        {
            var small = Spec(massMax: 100f);
            var big = Spec(massMax: 180f);

            // The same two specifications, quoted both ways round, with massOrig
            // pinned so the renovation envelope and the metre rate are identical in
            // both directions and the ONLY difference is which way the pad moved.
            var up = QuoteModify(Spec(massMax: 180f, massOrig: 140f), ComplexAt(small));
            var down = QuoteModify(Spec(massMax: 100f, massOrig: 140f), ComplexAt(big));

            var upPad = up.TotalCost;
            var downPad = down.TotalCost;
            Assert.Equal(upPad * 0.5, downPad, 6);
        }

        [Fact]
        public void Every_pad_past_the_first_scales_the_pad_half()
        {
            var from = ComplexAt(Spec(massMax: 100f), operationalPads: 3);
            var to = Spec(massMax: 180f, massOrig: 100f);

            var one = QuoteModify(to, ComplexAt(Spec(massMax: 100f)), operationalPads: 1);
            var three = QuoteModify(to, from, operationalPads: 3);

            // Renovating a complex rebuilds every pad on it, so RP-1 scales the pad
            // half by 1 + (pads - 1) * mult. Three pads at the shipped 0.5 is twice
            // the price of one.
            Assert.Equal(1.0 + 2.0 * PadMult, three.TotalCost / one.TotalCost, 6);
        }

        // ── The thousand-fund floor ────────────────────────────────────────────

        [Fact]
        public void Any_change_to_the_tonnage_limit_costs_at_least_a_thousand()
        {
            var from = ComplexAt(Spec(massMax: 100f));
            // One tonne, whose natural pad difference is a few funds.
            var to = Spec(massMax: 101f, massOrig: 100f);
            var natural = Costs(to).Pad - Costs(from.Stats).Pad;
            Assert.True(natural < 1000.0, "the case only bites when the natural difference is small");

            var quote = QuoteModify(to, from);

            // RP-1's floor, and it lands on the PAD half rather than the total, so
            // it is exactly a thousand here where the size has not moved.
            Assert.Equal(Rp1LcCostModel.MassChangeCostFloor, quote.TotalCost, 6);
        }

        [Fact]
        public void The_floor_applies_to_a_REDUCTION_in_tonnage_too()
        {
            var from = ComplexAt(Spec(massMax: 101f));
            var to = Spec(massMax: 100f, massOrig: 101f);

            // Both directions, because the condition is Approximately(old, new)
            // rather than a comparison: shrinking by a tonne is a tonnage change and
            // costs the floor, which is the least intuitive corner of the whole
            // model and the one an operator is most likely to report as a bug.
            Assert.Equal(Rp1LcCostModel.MassChangeCostFloor, QuoteModify(to, from).TotalCost, 6);
        }

        [Fact]
        public void The_floor_does_NOT_apply_when_only_the_envelope_moves()
        {
            // A light complex, so the per-metre rate is at the bottom of its ramp
            // and one metre of height costs a hundred rather than nine hundred.
            // That is what lets a size-only renovation price BELOW the floor and so
            // makes the floor's absence observable at all.
            var from = ComplexAt(Spec(massMax: 10f, height: 20f));
            var sizeOnly = QuoteModify(Spec(massMax: 10f, height: 21f, massOrig: 10f), from);

            // The tonnage has not moved, so the floor is not reached and a cheap
            // size renovation stays cheap.
            Assert.True(
                sizeOnly.TotalCost < Rp1LcCostModel.MassChangeCostFloor,
                $"a size-only renovation should not reach the floor, was {sizeOnly.TotalCost}");
            Assert.True(sizeOnly.TotalCost > 0.0, "but it is not free either");

            // The SAME envelope move with one tonne added to it costs the floor on
            // top, which is what shows the floor lands on the pad half rather than
            // on the total. A model that floored the whole figure would price these
            // two identically and this comparison is the only thing that separates
            // them.
            var alsoTonnage = QuoteModify(Spec(massMax: 11f, height: 21f, massOrig: 10f), from);
            Assert.Equal(
                Rp1LcCostModel.MassChangeCostFloor + sizeOnly.TotalCost,
                alsoTonnage.TotalCost,
                6);
        }

        // ── The integration half ───────────────────────────────────────────────

        [Fact]
        public void Shrinking_the_envelope_costs_half_what_the_same_move_outward_costs()
        {
            // A LARGE complex moved by ONE metre, deliberately. The obvious version
            // of this test used a small complex and a twenty-metre move, and it
            // failed: the outward move hit RP-1's cap (a renovation cannot cost
            // more than a fresh build) and the two directions stopped being related
            // by a factor of two at all. The halving and the cap interact, and a
            // test that cannot tell them apart pins neither. See
            // <see cref="A_capped_growth_is_not_halved_and_the_two_clauses_do_not_compose"/>.
            var small = Spec(massMax: 100f, width: 100f, height: 100f, depth: 100f);
            var big = Spec(massMax: 100f, width: 100f, height: 101f, depth: 100f);

            var out_ = QuoteModify(
                Spec(massMax: 100f, width: 100f, height: 101f, depth: 100f, massOrig: 100f),
                ComplexAt(small));
            var in_ = QuoteModify(
                Spec(massMax: 100f, width: 100f, height: 100f, depth: 100f, massOrig: 100f),
                ComplexAt(big));

            // `if (costVAB2 < costVAB) num8 *= 0.5`. The tonnage is unchanged in
            // both, so no floor and no pad half: this isolates the integration
            // clause completely.
            Assert.Equal(out_.TotalCost * 0.5, in_.TotalCost, 6);
        }

        [Fact]
        public void A_capped_growth_is_not_halved_and_the_two_clauses_do_not_compose()
        {
            // A small complex grown a long way, which is the case the cap exists
            // for. Found by a test that assumed the halving always mirrors the
            // growth: it does not, because a capped growth is already smaller than
            // the per-metre charges that produced it.
            var small = Spec(massMax: 100f, height: 20f);
            var big = Spec(massMax: 100f, height: 40f);

            var grown = QuoteModify(Spec(massMax: 100f, height: 40f, massOrig: 100f), ComplexAt(small));
            var shrunk = QuoteModify(Spec(massMax: 100f, height: 20f, massOrig: 100f), ComplexAt(big));

            // The growth is capped at the finished integration cost, so it is
            // CHEAPER than the uncapped per-metre total, and the shrink is half of
            // that uncapped total rather than half of the capped figure.
            Assert.Equal(Costs(big).Integration, grown.TotalCost, 6);
            Assert.True(
                shrunk.TotalCost > grown.TotalCost * 0.5,
                "the shrink halves the UNCAPPED total, so it exceeds half the capped growth");
        }

        [Fact]
        public void Rebuilding_bigger_never_costs_more_than_building_it_outright()
        {
            var from = ComplexAt(Spec(massMax: 100f, width: 5f, height: 5f, depth: 5f));
            // A vast jump on every axis, so the per-metre charges alone would far
            // exceed what the finished complex costs.
            var to = Spec(massMax: 100f, width: 200f, height: 200f, depth: 200f, massOrig: 100f);
            var after = Costs(to);

            var quote = QuoteModify(to, from);

            // `if (costVAB2 > costVAB && num8 > costVAB2) num8 = costVAB2`. Without
            // the cap this renovation prices above a fresh build, which is a figure
            // no operator would believe and RP-1 does not charge.
            Assert.Equal(after.Integration, quote.TotalCost, 6);
        }

        [Fact]
        public void Height_is_charged_at_twice_the_rate_of_width_and_depth()
        {
            var from = ComplexAt(Spec(massMax: 100f, width: 20f, height: 20f, depth: 20f));

            var taller = QuoteModify(Spec(massMax: 100f, width: 20f, height: 30f, depth: 20f, massOrig: 100f), from);
            var wider = QuoteModify(Spec(massMax: 100f, width: 30f, height: 20f, depth: 20f, massOrig: 100f), from);

            // The two moves are the same ten metres and the same change in
            // sqrMagnitude, so the cost difference between them is the per-axis
            // rate alone: full on y, half on x and z.
            var fromCost = Costs(from.Stats);
            var tallerExtra = taller.TotalCost - Math.Abs(Costs(Spec(massMax: 100f, width: 20f, height: 30f, depth: 20f)).Integration - fromCost.Integration);
            var widerExtra = wider.TotalCost - Math.Abs(Costs(Spec(massMax: 100f, width: 30f, height: 20f, depth: 20f)).Integration - fromCost.Integration);
            Assert.Equal(tallerExtra * 0.5, widerExtra, 6);
        }

        [Fact]
        public void The_metre_rate_is_a_curve_over_the_tonnage_the_complex_was_BUILT_at()
        {
            // TWO COMPLEXES AT THE SAME CURRENT TONNAGE, built at different ones.
            // The obvious version of this test held massMax equal to massOrig in
            // both cases, which meant substituting massMax for massOrig in the model
            // changed nothing and the test passed while the clause was wrong. That
            // mutation was the one survivor of nine, and this is what caught it:
            // massOrig is on the wire precisely because a complex already renovated
            // up prices differently from one built at its current limit.
            //
            // A large envelope moved by ONE metre, so no cap and no floor: the
            // tonnage does not move in either quote.
            var builtSmall = ComplexAt(Spec(massMax: 50f, massOrig: 25f, width: 100f, height: 100f, depth: 100f));
            var builtLarge = ComplexAt(Spec(massMax: 50f, massOrig: 50f, width: 100f, height: 100f, depth: 100f));

            var fromSmall = QuoteModify(
                Spec(massMax: 50f, massOrig: 25f, width: 100f, height: 101f, depth: 100f),
                builtSmall);
            var fromLarge = QuoteModify(
                Spec(massMax: 50f, massOrig: 50f, width: 100f, height: 101f, depth: 100f),
                builtLarge);

            // The integration cost difference is identical in both (same size move,
            // same specification cost curve), so the whole gap between them IS the
            // per-metre rate: 400 against 900 for one metre of height.
            var rateFromSmall = fromSmall.TotalCost;
            var rateFromLarge = fromLarge.TotalCost;
            Assert.Equal(500.0, rateFromLarge - rateFromSmall, 6);

            // And the direction, stated separately so a sign error cannot hide
            // inside a difference that happens to be right.
            Assert.True(
                rateFromLarge > rateFromSmall,
                $"the heavier BUILD should charge more per metre, {rateFromLarge} vs {rateFromSmall}");
        }

        [Fact]
        public void An_envelope_moved_by_a_fraction_of_a_metre_is_priced_in_float_as_RP1_prices_it()
        {
            // 0.1 is not representable in binary, so float and double disagree about
            // this subtraction in the seventh significant digit, and the metre rate
            // multiplies the disagreement by up to a thousand.
            var delta = Rp1LcCostModel.AxisDelta(20.1, 20.0);

            Assert.Equal((double)(20.1f - 20.0f), delta, 12);
            // And it is NOT the double answer, which is what makes the narrowing
            // load-bearing rather than decorative.
            Assert.NotEqual(20.1 - 20.0, delta);
        }

        // ── The hangar, which prices without a pad ─────────────────────────────

        [Fact]
        public void Renovating_the_hangar_costs_no_pad_half_at_all()
        {
            var hangarSpec = Spec(massMax: float.MaxValue, type: LaunchComplexType.Hangar, height: 10f);
            var from = ComplexAt(hangarSpec);
            var to = Spec(
                massMax: float.MaxValue,
                type: LaunchComplexType.Hangar,
                height: 12f,
                massOrig: float.MaxValue);

            var quote = QuoteModify(to, from, isHangar: true);

            // The hangar has no pad, so the pad half and its thousand-fund floor
            // are both skipped: a hangar renovation of two metres is priced as two
            // metres and nothing else.
            var integration = Math.Abs(Costs(to).Integration - Costs(from.Stats).Integration);
            Assert.Equal(integration + 2.0 * 500.0, quote.TotalCost, 6);
        }

        [Fact]
        public void The_hangars_metre_rate_is_a_flat_five_hundred_rather_than_a_curve()
        {
            var from = ComplexAt(Spec(massMax: float.MaxValue, type: LaunchComplexType.Hangar, height: 10f));
            var to = Spec(
                massMax: float.MaxValue,
                type: LaunchComplexType.Hangar,
                height: 11f,
                massOrig: float.MaxValue);

            var quote = QuoteModify(to, from, isHangar: true);

            // Flat, because the curve it would otherwise use is over a tonnage the
            // hangar does not have. One metre of height at 500.
            var integration = Math.Abs(Costs(to).Integration - Costs(from.Stats).Integration);
            Assert.Equal(integration + 500.0, quote.TotalCost, 6);
        }

        // ── The figures a caller writes onto the project ───────────────────────

        [Fact]
        public void The_prior_cost_is_the_complexs_CURRENT_total_which_drives_the_build_time()
        {
            var from = ComplexAt(Spec(massMax: 100f));
            var expected = Costs(from.Stats);

            var quote = QuoteModify(Spec(massMax: 180f, massOrig: 100f), from);

            Assert.Equal(
                expected.Pad + expected.Integration + expected.Resources,
                quote.OldTotalCost,
                6);
        }

        [Fact]
        public void The_pad_price_is_ALWAYS_multiplied_which_is_a_deliberate_divergence()
        {
            var from = ComplexAt(Spec(massMax: 100f));
            // A renovation that changes nothing, so RP-1's own display branch
            // (`if (totalCost > 0.0)`) would not run and it would pass the
            // UNMULTIPLIED figure.
            var to = Spec(massMax: 100f, massOrig: 100f);

            var quote = QuoteModify(to, from);

            Assert.Equal(0.0, quote.TotalCost, 6);
            // RP-1 applies AdditionalPadCostMult from inside a block whose purpose
            // is drawing labels, so the value it passes to ProcessNewLC depends on
            // whether the renovation happened to price above zero. Its own
            // LCConstructionProject.ProcessCancel multiplies UNCONDITIONALLY when it
            // reprices the same pad constructions, which is the evidence that the
            // multiplied figure is the intended one. Matching cancel is the only
            // choice that makes queue and cancel agree about a pad's price.
            Assert.Equal(Costs(to).Pad * PadMult, quote.PadCost, 6);
        }

        [Fact]
        public void The_downgrade_flag_follows_the_integration_half_not_the_tonnage()
        {
            var from = ComplexAt(Spec(massMax: 100f, height: 40f));

            // Smaller envelope, bigger tonnage. RP-1's own halving condition is on
            // the integration cost alone, so this IS the reduced case even though
            // the complex can now lift more.
            var quote = QuoteModify(Spec(massMax: 180f, height: 20f, massOrig: 100f), from);

            Assert.True(quote.IsDowngrade);
        }

        [Fact]
        public void The_engineer_ceiling_comes_from_RP1_rather_than_from_us()
        {
            var spec = Spec(massMax: 100f, humanRated: true);

            var quote = Rp1LcCostModel.QuoteNew(spec, ComplexType, PadMult);

            // Passed straight through from LaunchComplex.MaxEngineersCalc, resolved
            // by first-parameter type. The assertion is that all three arguments
            // reached it in the right order, which the human-rated doubling shows.
            Assert.Equal(
                LaunchComplex.MaxEngineersCalc(spec.massMax, spec.sizeMax, spec.isHumanRated),
                quote!.MaxEngineers);
        }

        // ── Resources ─────────────────────────────────────────────────────────

        [Fact]
        public void Adding_a_resource_costs_more_than_taking_the_same_one_away()
        {
            Formula.TankCostPerUnit["LqdOxygen"] = 2.0;
            Database.ResourceInfo.LCResourceTypes["LqdOxygen"] = 1;
            try
            {
                var bare = Spec(massMax: 100f);
                var fuelled = Spec(
                    massMax: 100f,
                    resources: new Dictionary<string, double> { ["LqdOxygen"] = 1000.0 });

                var adding = QuoteModify(
                    Spec(massMax: 100f, massOrig: 100f, resources: new Dictionary<string, double> { ["LqdOxygen"] = 1000.0 }),
                    ComplexAt(bare));
                var removing = QuoteModify(Spec(massMax: 100f, massOrig: 100f), ComplexAt(fuelled));

                // RP-1 charges a reduction at a TENTH of the tank, so ripping a
                // tank out is cheap and not free. Ten to one, and the direction is
                // what matters: a model that treated the difference symmetrically
                // would overcharge every decommissioning tenfold.
                Assert.Equal(adding.TotalCost * 0.1, removing.TotalCost, 6);
            }
            finally
            {
                Formula.TankCostPerUnit.Remove("LqdOxygen");
                Database.ResourceInfo.LCResourceTypes.Remove("LqdOxygen");
            }
        }

        [Fact]
        public void A_resource_the_complex_ignores_is_free_and_so_changes_no_price()
        {
            // Flagged PadIgnore (4) as well as Fuel (1): a pad complex does not
            // handle it, RP-1's own formula returns zero for it, and a model that
            // priced it would bill for a tank the game never builds.
            Formula.TankCostPerUnit["Nitrogen"] = 5.0;
            Database.ResourceInfo.LCResourceTypes["Nitrogen"] = 1 | 4;
            try
            {
                var withIt = Spec(
                    massMax: 100f,
                    resources: new Dictionary<string, double> { ["Nitrogen"] = 1000.0 });

                Assert.Equal(0.0, Costs(withIt).Resources, 6);
            }
            finally
            {
                Formula.TankCostPerUnit.Remove("Nitrogen");
                Database.ResourceInfo.LCResourceTypes.Remove("Nitrogen");
            }
        }

        [Fact]
        public void The_handled_resource_list_is_RP1s_own_filtered_by_complex_kind()
        {
            Database.ResourceInfo.LCResourceTypes["LqdOxygen"] = 1;
            Database.ResourceInfo.LCResourceTypes["PadOnly"] = 1 | 8;
            Database.ResourceInfo.LCResourceTypes["HangarOnly"] = 1 | 4;
            Database.ResourceInfo.LCResourceTypes["NotAFluid"] = 2;
            try
            {
                var pad = Rp1LcCostModel.HandledResourceNames(typeof(Database), isHangar: false);
                var hangar = Rp1LcCostModel.HandledResourceNames(typeof(Database), isHangar: true);

                Assert.NotNull(pad);
                Assert.Contains("LqdOxygen", pad!);
                Assert.Contains("PadOnly", pad!);
                // Excluded by the flag a PAD ignores, and excluded because it is not
                // a fluid at all. Both are cases RP-1 stores silently and prices at
                // nothing, which is the shape the command refuses rather than
                // accepts: a complex holding a resource it will never handle looks
                // equipped and is not.
                Assert.DoesNotContain("HangarOnly", pad!);
                Assert.DoesNotContain("NotAFluid", pad!);

                Assert.NotNull(hangar);
                Assert.Contains("HangarOnly", hangar!);
                Assert.DoesNotContain("PadOnly", hangar!);
            }
            finally
            {
                Database.ResourceInfo.LCResourceTypes.Remove("LqdOxygen");
                Database.ResourceInfo.LCResourceTypes.Remove("PadOnly");
                Database.ResourceInfo.LCResourceTypes.Remove("HangarOnly");
                Database.ResourceInfo.LCResourceTypes.Remove("NotAFluid");
            }
        }

        // ── Refusing rather than substituting ──────────────────────────────────

        [Fact]
        public void A_specification_RP1_will_not_price_yields_no_quote_at_all()
        {
            // An object with none of LCData's members, standing for a build whose
            // GetCostStats was renamed or reshaped.
            var quote = Rp1LcCostModel.QuoteNew(new object(), ComplexType, PadMult);

            // Null rather than zero, and every caller must refuse on it: a
            // substituted price is the one failure mode that reaches the save.
            Assert.Null(quote);
        }

        [Fact]
        public void A_complex_whose_envelope_will_not_read_yields_no_quote()
        {
            var quote = Rp1LcCostModel.QuoteModify(
                Spec(), new object(), Spec(), false, 1, ComplexType, PadMult);

            Assert.Null(quote);
        }

        [Fact]
        public void The_additional_pad_multiplier_falls_back_to_RP1s_shipped_value()
        {
            // The ONE member this model defaults rather than refusing on. It scales
            // a price rather than deciding whether an act is legal, and refusing
            // every complex command because a settings field moved would cost far
            // more than a stale multiplier.
            Assert.Equal(0.5, Rp1LcCostModel.AdditionalPadCostMult(null));
            Assert.Equal(0.5, Rp1LcCostModel.AdditionalPadCostMult(typeof(object)));
            Assert.Equal(
                Database.SettingsSC.AdditionalPadCostMult,
                Rp1LcCostModel.AdditionalPadCostMult(typeof(Database)));
        }

        // ── The renovation envelope ────────────────────────────────────────────

        [Fact]
        public void The_renovation_envelope_is_double_and_half_the_BUILD_tonnage()
        {
            var spec = Spec(massMax: 100f, massOrig: 100f);

            Assert.Equal(200.0, Rp1LcCostModel.MaxPossibleMass(spec));
            Assert.Equal(50.0, Rp1LcCostModel.MinPossibleMass(spec));

            // And it does NOT move with the current limit: a complex already
            // renovated up has less headroom left than its present limit suggests,
            // which is the whole reason massOrig is on the wire.
            var renovated = Spec(massMax: 200f, massOrig: 100f);
            Assert.Equal(200.0, Rp1LcCostModel.MaxPossibleMass(renovated));
            Assert.True(Rp1LcCostModel.IsMassWithinMargins(renovated));

            Assert.False(Rp1LcCostModel.IsMassWithinMargins(Spec(massMax: 201f, massOrig: 100f)));
            Assert.False(Rp1LcCostModel.IsMassWithinMargins(Spec(massMax: 49f, massOrig: 100f)));
        }

        [Fact]
        public void The_envelope_has_floors_so_a_tiny_complex_can_still_be_renovated()
        {
            // max(3, floor(orig*2)) and max(1, ceil(orig*0.5)). Without them a
            // one-tonne complex would have an envelope of two to one and a
            // half-tonne complex none at all.
            var tiny = Spec(massMax: 1f, massOrig: 1f);

            Assert.Equal(3.0, Rp1LcCostModel.MaxPossibleMass(tiny));
            Assert.Equal(1.0, Rp1LcCostModel.MinPossibleMass(tiny));
        }
    }
}
