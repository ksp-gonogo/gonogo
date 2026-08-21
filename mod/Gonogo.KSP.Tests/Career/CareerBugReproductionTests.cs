using Gonogo.KSP.Career;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Three refusals the game makes and we do not. Each one names the stock
    /// code that refuses, decompiled from the installed build.
    /// </summary>
    public class CareerBugReproductionTests
    {
        /// <summary>
        /// <c>RDTech.ResearchTech</c> reads
        /// <c>GameVariables.Instance.GetScienceCostLimit(GetFacilityLevel(ResearchAndDevelopment))</c>
        /// and returns <c>OperationResult.ScienceCostLimitExceeded</c> when the
        /// node costs more. A tier-1 R&amp;D building caps a node at 90 science;
        /// a 300-science node is refused there and unlocks fine at tier 3.
        /// </summary>
        [Fact]
        public void ANodeOverTheRnDTiersScienceCostLimitIsRefused()
        {
            var breach = CareerRefusals.ScienceCostBreach(
                "ResearchAndDevelopment", "R&D", 0.0, scienceCost: 300, scienceCostLimit: 90);

            Assert.NotNull(breach);
            Assert.Equal("scienceCost", breach!.Quantity);
            Assert.Equal(90, breach.Limit);
            Assert.Equal(300, breach.Actual);
        }

        [Fact]
        public void ANodeWithinTheRnDTiersScienceCostLimitIsNotRefused()
        {
            Assert.Null(CareerRefusals.ScienceCostBreach(
                "ResearchAndDevelopment", "R&D", 1.0, scienceCost: 300, scienceCostLimit: 1000));
        }

        /// <summary>
        /// <c>MissionControl.RefreshUIControls</c> greys its Accept button on
        /// <c>ContractSystem.Instance.GetActiveContractCount() &lt; maxActiveContracts</c>,
        /// and <c>Contract.Accept()</c> gates on state alone. Any caller that is
        /// not that UI, which is us, walks past the cap.
        /// </summary>
        [Fact]
        public void AcceptingPastMissionControlsActiveContractCapIsRefused()
        {
            var breach = CareerRefusals.ActiveContractsBreach(
                "MissionControl", "Mission Control", 0.5, activeContracts: 7, contractsLimit: 7);

            Assert.NotNull(breach);
            Assert.Equal("activeContracts", breach!.Quantity);
            Assert.Equal(7, breach.Limit);
            Assert.Equal(7, breach.Actual);
        }

        [Fact]
        public void AcceptingWithARemainingContractSlotIsNotRefused()
        {
            Assert.Null(CareerRefusals.ActiveContractsBreach(
                "MissionControl", "Mission Control", 0.5, activeContracts: 6, contractsLimit: 7));
        }

        /// <summary>
        /// Stock never compares a raw balance. It runs
        /// <c>CurrencyModifierQuery.RunQuery(reason, …).CanAfford(…)</c>, whose
        /// modifier chain an active strategy joins to discount or surcharge that
        /// exact <c>TransactionReasons</c>. Outsourced R&amp;D discounting a
        /// 300-science node by 90 makes it cost 210, and a 250-science balance
        /// covers it. The raw comparison says it does not.
        /// </summary>
        [Fact]
        public void AStrategyThatDiscountsASpendChangesWhatItCosts()
        {
            var query = new CurrencyModifierQuery(TransactionReasons.RnDTechResearch, 0f, -300f, 0f);
            query.AddDelta(Currency.Science, 90f);

            Assert.Equal(210, CareerAffordability.PriceOf(query, Currency.Science), 3);
        }

        [Fact]
        public void AStrategyThatSurchargesASpendChangesWhatItCosts()
        {
            var query = new CurrencyModifierQuery(TransactionReasons.StructureConstruction, -100_000f, 0f, 0f);
            query.AddDelta(Currency.Funds, -50_000f);

            Assert.Equal(150_000, CareerAffordability.PriceOf(query, Currency.Funds), 3);
        }

        /// <summary>
        /// The sign convention, in one place: a cost is a negative delta on the
        /// query, which is how stock phrases it.
        /// </summary>
        [Fact]
        public void AnUnmodifiedSpendPricesAtItsStickerPrice()
        {
            var query = new CurrencyModifierQuery(TransactionReasons.CrewRecruited, -42_500f, 0f, 0f);

            Assert.Equal(42_500, CareerAffordability.PriceOf(query, Currency.Funds), 3);
        }
    }
}
