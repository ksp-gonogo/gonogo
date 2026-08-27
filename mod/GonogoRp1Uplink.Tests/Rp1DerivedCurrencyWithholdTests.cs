using System;
using RP0;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The confidence leak, headless.
    ///
    /// <para><b>What was measured.</b> On the rig, run <c>conf-leak-1</c>, 2026-08-27:
    /// 25 science transmitted from an unroutable craft was correctly neutralised and
    /// parked in the pending-credit ledger, and RP-1's confidence went 700 -> 800 and
    /// <c>confidenceEarned</c> 200 -> 300 at the same instant. Confidence gates real
    /// career decisions in RP-1, so the operator knew the science had arrived six
    /// hours of game time before the model says they could.</para>
    ///
    /// <para><b>Why it happens.</b> <c>PatchRnD.Prefix_AddScience</c> fires
    /// <c>OnCurrencyModifierQuery</c>, then <c>OnCurrencyModified</c>, then
    /// <c>OnScienceChanged</c>. RP-1 banks its award on the middle one; the
    /// interceptor neutralises on the last one; and a neutralise is a
    /// <c>SetScience</c>, which fires no query at all, so RP-1 is never told to
    /// revisit the award.</para>
    ///
    /// <para><b>What these tests are and are not.</b> The award arithmetic in the
    /// stand-in is <c>RP0.Confidence.OnCurrenciesModified</c>'s, copied member for
    /// member off the shipped assembly, so the SHAPE of the leak and of the fix is
    /// real. The VALUES a running RP-1 would price are not, and nothing here can
    /// establish them: there is no RP-1 install on this machine or the test rig. The
    /// yardstick from the rig (+100 confidence per 25 science) is used as the award
    /// so the numbers in a red match the numbers in the measurement.</para>
    /// </summary>
    public class Rp1DerivedCurrencyWithholdTests : IDisposable
    {
        /// <summary>The rig's yardstick: 25 science credited at earn moved confidenceEarned 100 -> 200.</summary>
        private const double AwardFor25Science = 100.0;

        private const double ScienceBase = 25.0;

        private const double EarnUt = 4_000_000.0;

        public Rp1DerivedCurrencyWithholdTests()
        {
            Confidence.Instance = new Confidence(current: 700.0, earned: 200.0);
            Confidence.OnConfidenceChanged = new EventData<double, TransactionReasons>("OnConfidenceChanged");
            SpaceCenterManagement.Instance = new SpaceCenterManagement { SciPointsTotal = 27.0 };
        }

        public void Dispose()
        {
            Confidence.Instance = null;
            SpaceCenterManagement.Instance = null;
        }

        /// <summary>
        /// The whole defect in one case, and the one that reproduces run
        /// <c>conf-leak-1</c>'s reading: the science is withheld, so the confidence
        /// derived from it must be withheld too.
        /// </summary>
        [Fact]
        public void confidence_does_not_move_when_the_science_it_came_from_is_withheld()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(700.0, Confidence.Instance.Current, 6);
        }

        /// <summary>
        /// The second leak surface, and the reason the write cannot go through any
        /// public RP-1 member: <c>confidenceEarned</c> ratchets on a positive delta
        /// only, so nothing RP-1 exposes can lower it. An operator watching lifetime
        /// earned confidence learns of the arrival just as surely as one watching the
        /// balance.
        /// </summary>
        [Fact]
        public void the_lifetime_earned_total_does_not_move_either()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(200.0, Confidence.Instance.Earned, 6);
        }

        /// <summary>
        /// RP-1's own confidence readout is a text label pushed from
        /// <c>Confidence.OnConfidenceChanged</c> and updated by nothing else, so a
        /// balance put back in the field without firing that event leaves the leaked
        /// figure on the operator's screen. The state would be right and the leak
        /// would still be there to read.
        /// </summary>
        [Fact]
        public void the_readout_is_told_the_balance_went_back()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            var fired = Confidence.OnConfidenceChanged.Fired;
            Assert.Equal(700.0, fired[fired.Count - 1].Value, 6);
        }

        /// <summary>
        /// The science-points total the award is PRICED from moves at earn too, off
        /// an <c>OnCurrencyModified</c> handler with no reason filter at all. Leaving
        /// it moved would mean the reveal prices its award against a career that has
        /// already had the science, which is a wrong number as well as a leak.
        /// </summary>
        [Fact]
        public void the_science_points_the_award_is_priced_from_go_back_as_well()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            SpaceCenterManagement.Instance!.SciPointsTotal += ScienceBase;
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(27.0, SpaceCenterManagement.Instance.SciPointsTotal, 6);
        }

        /// <summary>
        /// Two science earns in one frame, one home and one away. The home earn's
        /// confidence is the career's to keep, so the away earn's withhold must put
        /// the balance back to where the home earn left it and not to where the frame
        /// started. This is why the observation is re-armed per earn rather than once
        /// per frame.
        /// </summary>
        [Fact]
        public void a_home_earn_in_the_same_frame_keeps_the_confidence_it_earned()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            // The home earn: observed like any other, then never withheld.
            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);

            // The away earn, same frame, same UT.
            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(800.0, Confidence.Instance.Current, 6);
            Assert.Equal(300.0, Confidence.Instance.Earned, 6);
        }

        /// <summary>
        /// One earn reaches the interceptor through more than one game event, so the
        /// withhold can be asked for twice. Putting a recorded value back twice has
        /// to land where putting it back once did. This is the shape the repo's
        /// recorded double-credit hazard took, in reverse.
        /// </summary>
        [Fact]
        public void withholding_the_same_earn_twice_lands_in_the_same_place()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(700.0, Confidence.Instance.Current, 6);
            Assert.Equal(200.0, Confidence.Instance.Earned, 6);
        }

        /// <summary>
        /// A withhold at a UT nothing was observed at must change nothing and must
        /// SAY so. Restoring an older reading would erase a currency movement that
        /// had nothing to do with this change, and a silent no-op is how the leak
        /// would report itself fixed.
        /// </summary>
        [Fact]
        public void a_withhold_with_no_observation_behind_it_restores_nothing_and_says_so()
        {
            var said = new System.Collections.Generic.List<string>();
            var withholder = new Rp1DerivedCurrencyWithholder { Diagnostic = said.Add };

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt + 1.0);

            Assert.Equal(800.0, Confidence.Instance.Current, 6);
            Assert.NotEmpty(said);
        }

        /// <summary>
        /// Confidence spent between the observation and the withhold is a real
        /// withdrawal, and restoring a pre-spend reading would hand it back. The rule
        /// is that only an INCREASE is ever taken away.
        /// </summary>
        [Fact]
        public void a_spend_between_the_observation_and_the_withhold_is_not_handed_back()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            Confidence.Instance!.Spend(150.0);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);

            Assert.Equal(550.0, Confidence.Instance.Current, 6);
        }

        /// <summary>
        /// Funds and reputation derive no confidence in RP-1: the award is priced off
        /// the query's SCIENCE input only. A withhold naming another primary currency
        /// must leave the balance alone rather than treat every neutralise as a
        /// science one.
        /// </summary>
        [Fact]
        public void a_neutralised_funds_change_takes_no_confidence_away()
        {
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Funds, EarnUt);
            Confidence.Instance!.AwardForScience(AwardFor25Science);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Funds, 1000.0, EarnUt);

            Assert.Equal(800.0, Confidence.Instance.Current, 6);
        }

        /// <summary>
        /// A stock install has no Confidence module at all. The arm has to be inert
        /// rather than throwing, because it is called from inside the interceptor's
        /// neutralise path and a throw there would leave the science un-neutralised.
        /// </summary>
        [Fact]
        public void an_install_without_the_confidence_module_is_inert()
        {
            Confidence.Instance = null;
            SpaceCenterManagement.Instance = null;
            var withholder = new Rp1DerivedCurrencyWithholder();

            withholder.ObserveBeforeDerivation(Sitrep.Contract.DerivedCurrencyCapability.Science, EarnUt);
            withholder.WithholdDerived(Sitrep.Contract.DerivedCurrencyCapability.Science, ScienceBase, EarnUt);
        }
    }
}
