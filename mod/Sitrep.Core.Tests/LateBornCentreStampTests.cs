using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A sample is stamped with each command centre's light-time as it stood
    /// when the sample left. A centre that did not exist then has no row in
    /// that stamp, and used to read the stamp's base, which is the home
    /// centre's light-time: a crewed craft that became a centre a minute ago
    /// could catch up on an hour of another craft's telemetry on home's clock.
    /// It was not listening when that light left, so it never arrives there.
    /// </summary>
    public class LateBornCentreStampTests
    {
        private const string Node = "fleet.v";

        [Fact]
        public void ACentreBornAfterTheStampWasTakenIsNeverSentTheSample()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home" });
            var before = network.StampFor(Node);

            network.SetCentres(new[] { "ground:home", "vessel:late" });

            Assert.True(double.IsPositiveInfinity(before.For("vessel:late")));
            Assert.Equal(240.0, before.For("ground:home"));
        }

        [Fact]
        public void ACentreThatExistedThenReadsItsRowOrTheBaseAsItAlwaysDid()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home", "vessel:early" });
            network.SetDelay("vessel:early", Node, 5.0);

            var stamp = network.StampFor(Node);

            Assert.Equal(5.0, stamp.For("vessel:early"));
            Assert.Equal(240.0, stamp.For("ground:home"));
        }

        [Fact]
        public void AStampTakenOnceTheCentreExistsServesIt()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home" });
            network.StampFor(Node);
            network.SetCentres(new[] { "ground:home", "vessel:late" });

            var after = network.StampFor(Node);

            Assert.Equal(240.0, after.For("vessel:late"));
        }

        /// <summary>The meta vantage, a connection that has chosen no centre, and a test's own arbitrary vantage are not command centres, and read the base as they always did.</summary>
        [Fact]
        public void AVantageThatIsNoCentreReadsTheBase()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home" });

            var stamp = network.StampFor(Node);
            network.SetCentres(new[] { "ground:home", "vessel:late" });

            Assert.Equal(240.0, stamp.For(""));
            Assert.Equal(240.0, stamp.For("KSC"));
        }

        [Fact]
        public void TheWaitAddedToARecordingKeepsTheRule()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home" });
            var waited = network.StampFor(Node).Plus(60.0);

            network.SetCentres(new[] { "ground:home", "vessel:late" });

            Assert.True(double.IsPositiveInfinity(waited.For("vessel:late")));
            Assert.Equal(300.0, waited.For("ground:home"));
        }

        [Fact]
        public void ACentreThatLeftAndCameBackIsNewAgain()
        {
            var network = new StubNetwork(delay: 240.0);
            network.SetCentres(new[] { "ground:home", "vessel:crew" });
            network.SetCentres(new[] { "ground:home" });
            var whileGone = network.StampFor(Node);

            network.SetCentres(new[] { "ground:home", "vessel:crew" });

            Assert.True(double.IsPositiveInfinity(whileGone.For("vessel:crew")));
        }
    }
}
