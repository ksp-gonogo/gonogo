using System.Collections.Generic;
using Sitrep.Contract;
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
            var carried = new Dictionary<string, Dictionary<string, CommsDirection>>();
            if (unroutableCentre != null && unroutableNode != null)
            {
                carried[unroutableCentre] = new Dictionary<string, CommsDirection> { [unroutableNode] = CommsDirection.None };
            }
            ledger.ReplaceCarried(carried);
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

            var sent = ledger.Reaches(centre, Prefix + "probe", Prefix, true, connected, Home, CommsDirection.Forward);

            Assert.Equal(CentreReach.Reaches(centre, "probe", true, connected, Home, offTheGround, centre == Far), sent);
        }

        [Fact]
        public void TheHomeCentreCannotSendToACraftWhoseRouteEndsOffTheGround()
        {
            var ledger = Ledger(null, null, "probe");

            Assert.False(ledger.Reaches(Home, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Forward));
            Assert.True(ledger.Reaches(Far, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Forward));
        }

        [Fact]
        public void ACrewedCentreReachesItsOwnCraftWhateverItsLinkHome()
        {
            var ledger = Ledger();

            Assert.True(ledger.Reaches("vessel:probe", Prefix + "probe", Prefix, true, false, Home, CommsDirection.Forward));
            Assert.False(ledger.Reaches(Far, Prefix + "probe", Prefix, true, false, Home, CommsDirection.Forward));
        }

        [Fact]
        public void ANodeThatIsNotACraftNeedsItsLinkUpAndARoute()
        {
            var ledger = Ledger(Far, "system");

            Assert.True(ledger.Reaches(Home, "system", Prefix, true, true, Home, CommsDirection.Forward));
            Assert.False(ledger.Reaches(Home, "system", Prefix, true, false, Home, CommsDirection.Forward));
            Assert.False(ledger.Reaches(Far, "system", Prefix, true, true, Home, CommsDirection.Forward));
        }

        [Theory]
        [InlineData(CommsDirection.Forward, true, false)]
        [InlineData(CommsDirection.Reverse, false, true)]
        [InlineData(CommsDirection.Both, true, true)]
        [InlineData(CommsDirection.None, false, false)]
        public void ARouteThatCarriesOneWayLetsACommandOrTelemetryThroughButNotBoth(CommsDirection carried, bool sends, bool hears)
        {
            var ledger = new ReachLedger();
            ledger.ReplaceCarried(new Dictionary<string, Dictionary<string, CommsDirection>>
            {
                [Far] = new Dictionary<string, CommsDirection> { [Prefix + "probe"] = carried },
            });

            Assert.Equal(sends, ledger.Reaches(Far, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Forward));
            Assert.Equal(hears, ledger.Reaches(Far, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Reverse));
        }

        [Fact]
        public void TheHomeCentreIsJudgedByTheDirectionsOfItsOwnRouteToo()
        {
            var ledger = new ReachLedger();
            ledger.ReplaceCarried(new Dictionary<string, Dictionary<string, CommsDirection>>
            {
                [Home] = new Dictionary<string, CommsDirection> { [Prefix + "probe"] = CommsDirection.Reverse },
            });

            Assert.False(ledger.Reaches(Home, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Forward));
            Assert.True(ledger.Reaches(Home, Prefix + "probe", Prefix, true, true, Home, CommsDirection.Reverse));
        }
    }
}
