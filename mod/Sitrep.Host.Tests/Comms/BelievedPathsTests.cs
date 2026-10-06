using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class BelievedPathsTests
    {
        private static CentrePathView View() => new CentrePathView(new CommsPath(), new CommsNetwork(), new CommsCommandCentre());

        [Fact]
        public void ACentresBeliefAnswersForTheCraftItWasWorkedOutForAndNoOther()
        {
            var believed = new BelievedPaths();
            var ofProbe = View();
            believed.Keep("ground:ksc", "vessel:probe", ofProbe);

            Assert.Same(ofProbe, believed.Of("ground:ksc", "vessel:probe"));
            Assert.Null(believed.Of("ground:ksc", "vessel:lander"));
            Assert.Null(believed.Of("ground:far", "vessel:probe"));
        }

        [Fact]
        public void ANewBeliefReplacesTheOldAndAForgottenCentreHasNone()
        {
            var believed = new BelievedPaths();
            believed.Keep("ground:ksc", "vessel:probe", View());
            var ofLander = View();
            believed.Keep("ground:ksc", "vessel:lander", ofLander);

            Assert.Null(believed.Of("ground:ksc", "vessel:probe"));
            Assert.Same(ofLander, believed.Of("ground:ksc", "vessel:lander"));

            believed.Forget("ground:ksc");
            Assert.Null(believed.Of("ground:ksc", "vessel:lander"));
        }
    }
}
