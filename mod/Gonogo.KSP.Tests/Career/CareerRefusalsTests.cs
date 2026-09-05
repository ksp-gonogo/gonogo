using Gonogo.KSP.Career;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The career limits, at the level a headless process can reach them. The
    /// actuator's own bodies cannot be entered here at all (see
    /// <see cref="CareerRefusals"/>'s doc comment), so the rule is exercised
    /// where it lives and the actuator's job is reduced to reading the numbers.
    /// </summary>
    public class CareerRefusalsTests
    {
        [Fact]
        public void ACrewCapThatIsReachedRefusesWithBothNumbers()
        {
            var breach = CareerRefusals.CrewCapBreach(
                "AstronautComplex", "Astronaut Complex", 0.5, activeCrew: 16, crewLimit: 16);

            Assert.NotNull(breach);
            Assert.Equal("activeCrew", breach!.Quantity);
            Assert.Equal(16, breach.Limit);
            Assert.Equal(16, breach.Actual);
            Assert.Equal("Astronaut Complex", breach.FacilityName);
            Assert.Equal(Units.Count, breach.Unit);
        }

        [Fact]
        public void ACrewCapWithRoomLeftDoesNotRefuse()
        {
            Assert.Null(CareerRefusals.CrewCapBreach(
                "AstronautComplex", "Astronaut Complex", 0.5, activeCrew: 15, crewLimit: 16));
        }

        /// <summary>
        /// KSP reports "unlimited" as <c>int.MaxValue</c>, and a top-tier
        /// Astronaut Complex is genuinely uncapped. A breach against no limit
        /// would put 2,147,483,647 in front of an operator as though it were a
        /// number the game had chosen.
        /// </summary>
        [Fact]
        public void AnUnlimitedCapNeverBreaches()
        {
            Assert.Null(CareerRefusals.CrewCapBreach(
                "AstronautComplex", "Astronaut Complex", 1.0, activeCrew: 9000, crewLimit: int.MaxValue));
            Assert.Null(CareerRefusals.RealLimit(float.MaxValue));
            Assert.Null(CareerRefusals.RealLimit(int.MaxValue));
            Assert.Equal(18.0, CareerRefusals.RealLimit(18.0));
        }

        /// <summary>
        /// Tiers are 0-based to KSP and 1-based to an operator reading the same
        /// building's "Level 3" label, so both sides shift together.
        /// </summary>
        [Fact]
        public void AFacilityAtItsTopTierRefusesInOperatorTiers()
        {
            var breach = CareerRefusals.MaxTierBreach("LaunchPad", "Launch Pad", 1.0, level: 2, maxLevel: 2);

            Assert.NotNull(breach);
            Assert.Equal("tier", breach!.Quantity);
            Assert.Equal(3, breach.Limit);
            Assert.Equal(3, breach.Actual);
        }

        [Fact]
        public void AFacilityWithATierAboveItDoesNotRefuse()
        {
            Assert.Null(CareerRefusals.MaxTierBreach("LaunchPad", "Launch Pad", 0.5, level: 1, maxLevel: 2));
        }

        /// <summary>
        /// The price is what the call asked for and the balance is what was
        /// allowed, so they land on Actual and Limit in that order: the same way
        /// round as every other breach, which is what lets one client sentence
        /// serve all of them.
        /// </summary>
        [Fact]
        public void AShortfallPutsThePriceOnActualAndTheBalanceOnLimit()
        {
            var breach = CareerRefusals.ShortfallBreach(
                "LaunchPad", "Launch Pad", 0.5, "funds", price: 253000, balance: 189412, unit: Units.Funds);

            Assert.Equal(253000, breach.Actual);
            Assert.Equal(189412, breach.Limit);
            Assert.Equal(Units.Funds, breach.Unit);
        }
    
        /// <summary>
        /// An id the game does not know is genuinely not found, and says so
        /// with no scene talk attached.
        /// </summary>
        [Fact]
        public void AnUnknownFacilityIsNotFound()
        {
            var refusal = CareerRefusals.FacilityResolutionRefusal(
                facilityKnown: false, hasLiveInstance: false, facilityName: "Nonesuch", sceneName: "FLIGHT");

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.NotFound, refusal!.ErrorCode);
            Assert.Null(refusal.Detail);
        }

        /// <summary>
        /// A facility the game KNOWS but has not instantiated is a scene fact,
        /// never a missing facility. This is what an operator hit in flight: the
        /// launch pad plainly exists and the refusal said it could not be found.
        /// </summary>
        [Fact]
        public void AKnownFacilityWithNoLiveInstanceIsAWrongSceneRefusalThatNamesTheScene()
        {
            var refusal = CareerRefusals.FacilityResolutionRefusal(
                facilityKnown: true, hasLiveInstance: false, facilityName: "Launch Pad", sceneName: "FLIGHT");

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.WrongScene, refusal!.ErrorCode);
            Assert.Contains("Launch Pad", refusal.Detail);
            Assert.Contains("space centre", refusal.Detail);
            Assert.Contains("FLIGHT", refusal.Detail);
        }

        /// <summary>
        /// An unnamed scene still earns the actionable half of the sentence. The
        /// scene is the decoration; where the operator has to go is the point.
        /// </summary>
        [Fact]
        public void AWrongSceneRefusalStillSaysWhereToGoWhenTheSceneIsUnnamed()
        {
            var refusal = CareerRefusals.FacilityResolutionRefusal(
                facilityKnown: true, hasLiveInstance: false, facilityName: "Launch Pad", sceneName: null);

            Assert.Equal(CommandErrorCode.WrongScene, refusal!.ErrorCode);
            Assert.Contains("space centre", refusal.Detail);
        }

        /// <summary>A resolved facility is not refused at all.</summary>
        [Fact]
        public void AResolvedFacilityProceeds()
        {
            Assert.Null(CareerRefusals.FacilityResolutionRefusal(
                facilityKnown: true, hasLiveInstance: true, facilityName: "Launch Pad", sceneName: "SPACECENTER"));
        }
}
}
