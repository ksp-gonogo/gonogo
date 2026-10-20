using System.Collections.Generic;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A copy sent to a craft and the word of who hears it answer to one rule, so
    /// the same centre and craft never read reachable to one and cut off to the other.
    /// </summary>
    public class ReachLedgerTests
    {
        private const string Home = "ground:home";
        private const string Far = "ground:far";
        private const string Prefix = "fleet.";

        private static ReachLedger Ledger(string? unroutableCentre = null, string? unroutableNode = null, params string[] offTheGround)
        {
            var ledger = new ReachLedger();
            var unroutable = new Dictionary<string, HashSet<string>>();
            if (unroutableCentre != null && unroutableNode != null)
            {
                unroutable[unroutableCentre] = new HashSet<string> { unroutableNode };
            }
            ledger.ReplaceUnroutable(unroutable);
            ledger.ReplaceOffTheGround(offTheGround);
            return ledger;
        }

        [Theory]
        [InlineData(Home, true, false)]
        [InlineData(Home, false, false)]
        [InlineData(Home, true, true)]
        [InlineData(Far, true, false)]
        [InlineData(Far, false, false)]
        [InlineData("vessel:probe", false, false)]
        [InlineData("vessel:probe", true, true)]
        public void ACommandAndTheWordOfWhoHearsACraftAgree(string centre, bool connected, bool offTheGround)
        {
            var ledger = Ledger(Far, Prefix + "probe", offTheGround ? new[] { "probe" } : new string[0]);

            var sent = ledger.Reaches(centre, Prefix + "probe", Prefix, true, connected, Home);

            Assert.Equal(CentreReach.Reaches(centre, "probe", true, connected, Home, offTheGround, centre == Far), sent);
        }

        [Fact]
        public void TheHomeCentreCannotSendToACraftWhoseRouteEndsOffTheGround()
        {
            var ledger = Ledger(null, null, "probe");

            Assert.False(ledger.Reaches(Home, Prefix + "probe", Prefix, true, true, Home));
            Assert.True(ledger.Reaches(Far, Prefix + "probe", Prefix, true, true, Home));
        }

        [Fact]
        public void ACrewedCentreReachesItsOwnCraftWhateverItsLinkHome()
        {
            var ledger = Ledger();

            Assert.True(ledger.Reaches("vessel:probe", Prefix + "probe", Prefix, true, false, Home));
            Assert.False(ledger.Reaches(Far, Prefix + "probe", Prefix, true, false, Home));
        }

        [Fact]
        public void ANodeThatIsNotACraftNeedsItsLinkUpAndARoute()
        {
            var ledger = Ledger(Far, "system");

            Assert.True(ledger.Reaches(Home, "system", Prefix, true, true, Home));
            Assert.False(ledger.Reaches(Home, "system", Prefix, true, false, Home));
            Assert.False(ledger.Reaches(Far, "system", Prefix, true, true, Home));
        }
    }
}
