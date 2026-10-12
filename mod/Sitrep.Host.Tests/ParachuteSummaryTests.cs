using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The craft's parachutes folded into the three <c>vessel.landing</c> fields.
    /// </summary>
    public class ParachuteSummaryTests
    {
        private static Dictionary<string, object?> Of(params ParachuteReading[] chutes) =>
            ParachuteSummary.Fields(chutes);

        [Fact]
        public void ACraftWithNoParachuteSaysNoneAndNothingElse()
        {
            var fields = Of();
            Assert.Equal("none", fields["parachuteDeployment"]);
            Assert.Null(fields["parachuteDeploySafety"]);
            Assert.Null(fields["parachuteFullDeployAltitude"]);
        }

        [Fact]
        public void APackedParachuteIsStowedNotNone()
        {
            Assert.Equal("stowed", Of(new ParachuteReading("stowed", "safe", 1000))["parachuteDeployment"]);
        }

        [Fact]
        public void TheFurthestOpenSpeaksForTheCraftAndSemiDeployedIsNotDeployed()
        {
            Assert.Equal(
                "semi-deployed",
                Of(new ParachuteReading("armed", null, 1000), new ParachuteReading("semi-deployed", null, 500))["parachuteDeployment"]);
            Assert.Equal(
                "deployed",
                Of(new ParachuteReading("semi-deployed", null, 500), new ParachuteReading("deployed", null, null))["parachuteDeployment"]);
        }

        [Fact]
        public void ACutParachuteIsPassedOverUntilEveryOneIsCut()
        {
            Assert.Equal("armed", Of(new ParachuteReading("cut", null, null), new ParachuteReading("armed", "safe", 800))["parachuteDeployment"]);
            Assert.Equal("cut", Of(new ParachuteReading("cut", null, null))["parachuteDeployment"]);
        }

        [Fact]
        public void TheWorstRatingAmongThoseNotYetOpenSpeaksForTheCraft()
        {
            var fields = Of(
                new ParachuteReading("armed", "safe", 1000),
                new ParachuteReading("stowed", "unsafe", 1000),
                new ParachuteReading("deployed", "safe", null));
            Assert.Equal("unsafe", fields["parachuteDeploySafety"]);
        }

        [Fact]
        public void NoRatingOnceEveryParachuteIsOpenOrWhereTheGameGivesNone()
        {
            Assert.Null(Of(new ParachuteReading("deployed", "unsafe", null))["parachuteDeploySafety"]);
            Assert.Null(Of(new ParachuteReading("armed", null, 1000))["parachuteDeploySafety"]);
        }

        [Fact]
        public void TheGreatestOpeningHeightAmongArmedOrSemiDeployedIsTheOneThatOpensFirst()
        {
            var fields = Of(
                new ParachuteReading("armed", "safe", 500),
                new ParachuteReading("semi-deployed", null, 1200),
                new ParachuteReading("stowed", "safe", 3000),
                new ParachuteReading("deployed", null, 5000));
            Assert.Equal(1200.0, fields["parachuteFullDeployAltitude"]);
        }
    }
}
