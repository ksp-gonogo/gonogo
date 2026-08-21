using System.Collections.Generic;
using Gonogo.KSP.Career;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Stock refuses to upgrade a facility with craft parked on it, and the
    /// console used to upgrade under them.
    ///
    /// <para><c>KSCFacilityContextMenu</c>'s Upgrade arm is
    /// <c>if (WarnOfObstructingVessels(includeGrounds: true, onlyDestroyed: false)) break;</c>,
    /// a hard block with no proceed option. The vessels are found by two PUBLIC
    /// methods on <c>SpaceCenterBuilding</c>; what is exercised here is what
    /// their answer becomes.</para>
    /// </summary>
    public class FacilityObstructionTests
    {
        [Fact]
        public void AClearFacilityIsNotRefused()
        {
            Assert.Null(FacilityObstruction.Refusal(new List<string>(), "Vessels on ", "."));
        }

        [Fact]
        public void ANullListIsNotRefused()
        {
            Assert.Null(FacilityObstruction.Refusal(null!, "Vessels on ", "."));
        }

        [Fact]
        public void AParkedCraftRefusesTheUpgrade()
        {
            var refusal = FacilityObstruction.Refusal(
                new List<string> { "Kerbal X" }, "There are vessels on the Launch Pad: ", ". Move them first.");

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.SiteOccupied, refusal!.ErrorCode);
            Assert.Equal(
                "There are vessels on the Launch Pad: Kerbal X. Move them first.", refusal.Detail);
        }

        /// <summary>
        /// The operator has to go and move them, so all of them are named.
        /// </summary>
        [Fact]
        public void EveryObstructingCraftIsNamed()
        {
            var refusal = FacilityObstruction.Refusal(
                new List<string> { "Kerbal X", "Stayputnik 1" }, "On it: ", "");

            Assert.Equal("On it: Kerbal X, Stayputnik 1", refusal!.Detail);
        }

        /// <summary>
        /// A protovessel with no name is still an obstruction, but it cannot be
        /// the whole of a sentence: an empty list of names reads as a refusal
        /// that came back blank.
        /// </summary>
        [Fact]
        public void NamelessCraftDoNotProduceAnEmptyRefusal()
        {
            Assert.Null(FacilityObstruction.Refusal(new List<string> { "", "  " }, "On it: ", ""));
        }
    }
}
