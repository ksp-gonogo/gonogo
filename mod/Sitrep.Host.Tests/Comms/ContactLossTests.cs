using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class ContactLossTests
    {
        private const double Horizon = 7200.0;

        private static PairPlan Pair(string a, string b, double horizon, params ContactWindow[] windows) =>
            new PairPlan(a, b, horizon, windows);

        private static ContactPlan PlanOf(params PairPlan[] pairs) => new ContactPlan(0.0, Horizon, 10.0, pairs, 0, 0);

        private static CommsNextLoss Next(ContactPlan? plan, string? craft = "vessel:probe", double ut = 100.0, bool? live = null) =>
            ContactLoss.Next(plan, craft, "ground:ksc", "ground:ksc", new[] { "ground:ksc" }, ut, liveLink: live);

        [Fact]
        public void TheEndOfTheOnlyOpenWindowIsTheLoss()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1500.0)));

            var loss = Next(plan);

            Assert.Equal(NextLossBasis.PredictedLoss, loss.Basis);
            Assert.Equal(1500.0, loss.Ut!.Value, 9);
            Assert.Equal(Horizon, loss.CoveredToUt, 9);
        }

        /// <summary>A loss is predicted of a link that is there: with the craft's live link down, the plan's open window describes a link that is not.</summary>
        [Fact]
        public void ADownLiveLinkBeatsAnOpenPlanAndIsOutOfContact()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1500.0)));

            var loss = Next(plan, live: false);

            Assert.Equal(NextLossBasis.OutOfContact, loss.Basis);
            Assert.Null(loss.Ut);
            Assert.Equal(Horizon, loss.CoveredToUt, 9);
        }

        [Fact]
        public void ADownLiveLinkIsOutOfContactWhateverThePlanHoldsEvenOpenEnded()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, null)));

            Assert.Equal(NextLossBasis.OutOfContact, Next(plan, live: false).Basis);
        }

        [Fact]
        public void AnUpLiveLinkStillGetsThePlansPredictedLoss()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1500.0)));

            var loss = Next(plan, live: true);

            Assert.Equal(NextLossBasis.PredictedLoss, loss.Basis);
            Assert.Equal(1500.0, loss.Ut!.Value, 9);
        }

        /// <summary>No reading yet is not a disconnection: the plan answers as it always did.</summary>
        [Fact]
        public void NoLiveReadingKeepsThePlansAnswer()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1500.0)));

            Assert.Equal(NextLossBasis.PredictedLoss, Next(plan, live: null).Basis);
        }

        [Fact]
        public void NoCraftStaysNoCraftWhateverTheLiveLinkReads()
        {
            Assert.Equal(NextLossBasis.NoCraft, Next(null, craft: null, live: false).Basis);
        }

        [Fact]
        public void AHandoverBetweenRelaysIsNotALoss()
        {
            // Direct link closes at 1000 while a relay already holds the craft from 800 to 2400.
            var plan = PlanOf(
                Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1000.0)),
                Pair("ground:ksc", "vessel:relay", Horizon, new ContactWindow(null, null)),
                Pair("vessel:relay", "vessel:probe", Horizon, new ContactWindow(800.0, 2400.0)));

            var loss = Next(plan);

            Assert.Equal(NextLossBasis.PredictedLoss, loss.Basis);
            Assert.Equal(2400.0, loss.Ut!.Value, 9);
        }

        [Fact]
        public void ARelayLegThatClosesBeforeTheCraftIsReachedStillBreaksTheChain()
        {
            var plan = PlanOf(
                Pair("ground:ksc", "vessel:relay", Horizon, new ContactWindow(null, 1200.0)),
                Pair("vessel:relay", "vessel:probe", Horizon, new ContactWindow(null, null)));

            Assert.Equal(1200.0, Next(plan).Ut!.Value, 9);
        }

        [Fact]
        public void NoCloseBeforeTheHorizonIsNoLossInWindow()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, null)));

            var loss = Next(plan);

            Assert.Equal(NextLossBasis.NoLossInWindow, loss.Basis);
            Assert.Null(loss.Ut);
            Assert.Equal(Horizon, loss.CoveredToUt, 9);
        }

        [Fact]
        public void ACraftNotInContactNowIsOutOfContactAndGetsNoInstant()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(900.0, 1500.0)));

            var loss = Next(plan);

            Assert.Equal(NextLossBasis.OutOfContact, loss.Basis);
            Assert.Null(loss.Ut);
        }

        [Fact]
        public void APairHorizonEndsTheSearchRatherThanInventingAContinuingContact()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", 3000.0, new ContactWindow(null, null)));

            var loss = Next(plan);

            Assert.Equal(NextLossBasis.NoLossInWindow, loss.Basis);
            Assert.Equal(3000.0, loss.CoveredToUt, 9);
        }

        [Fact]
        public void ACraftTheCentreHasNotHeardOfHasNoPlan()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:other", Horizon, new ContactWindow(null, null)));

            Assert.Equal(NextLossBasis.NotPlanned, Next(plan).Basis);
            Assert.Equal(NextLossBasis.NotPlanned, Next(null).Basis);
        }

        [Fact]
        public void NoActiveCraftIsSaidSo()
        {
            Assert.Equal(NextLossBasis.NoCraft, Next(PlanOf(), craft: null).Basis);
        }

        [Fact]
        public void EveryGroundStationIsTheHomeCentresOwnAntenna()
        {
            var plan = PlanOf(Pair("ground:far", "vessel:probe", Horizon, new ContactWindow(null, 2000.0)));

            var loss = ContactLoss.Next(plan, "vessel:probe", "ground:ksc", "ground:ksc", new[] { "ground:ksc", "ground:far" }, 100.0);

            Assert.Equal(2000.0, loss.Ut!.Value, 9);
        }

        [Fact]
        public void AnUnsettledEndMarksTheInstantLowConfidence()
        {
            var plan = PlanOf(Pair("ground:ksc", "vessel:probe", Horizon, new ContactWindow(null, 1500.0)));

            var loss = ContactLoss.Next(plan, "vessel:probe", "ground:ksc", "ground:ksc", new[] { "ground:ksc" }, 100.0, new[] { "vessel:probe" });

            Assert.True(loss.LowConfidence);
        }
    }
}
