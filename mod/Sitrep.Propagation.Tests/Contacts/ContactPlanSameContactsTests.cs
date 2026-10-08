using System.Collections.Generic;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Propagation.Tests.Contacts
{
    /// <summary>
    /// Two plans predict the same contacts when their pairs have the same windows
    /// over the span both cover, however far apart their starts and horizons are.
    /// </summary>
    public class ContactPlanSameContactsTests
    {
        private static ContactPlan Plan(double from, double horizon, params (string A, string B, double Horizon, (double? Open, double? Close)[] Windows)[] pairs)
        {
            var list = new List<PairPlan>();
            foreach (var pair in pairs)
            {
                var windows = new List<ContactWindow>();
                foreach (var (open, close) in pair.Windows)
                {
                    windows.Add(new ContactWindow(open, close));
                }
                list.Add(new PairPlan(pair.A, pair.B, pair.Horizon, windows));
            }
            return new ContactPlan(from, horizon, 10.0, list, 0, 0);
        }

        [Fact]
        public void ALaterRoundThatFindsTheSameWindowsFurtherOnIsTheSamePlan()
        {
            var earlier = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[] { (100, 300) }));
            var later = Plan(50, 1500, ("a", "b", 1500, new (double?, double?)[] { (100.5, 300.5), (1200, 1400) }));

            Assert.True(earlier.SameContactsAs(later, 2.0));
            Assert.True(later.SameContactsAs(earlier, 2.0));
        }

        [Fact]
        public void AWindowThatMovedByMoreThanTheToleranceIsAnotherPlan()
        {
            var earlier = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[] { (100, 300) }));
            var later = Plan(50, 1500, ("a", "b", 1500, new (double?, double?)[] { (100, 340) }));

            Assert.False(earlier.SameContactsAs(later, 2.0));
        }

        [Fact]
        public void AContactThatAppearsInTheSharedSpanIsAnotherPlan()
        {
            var earlier = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[] { (100, 300) }));
            var later = Plan(50, 1500, ("a", "b", 1500, new (double?, double?)[] { (100, 300), (600, 700) }));

            Assert.False(earlier.SameContactsAs(later, 2.0));
        }

        [Fact]
        public void AWindowOpenAtTheStartIsTheSameWhicheverInstantTheRoundStartedAt()
        {
            var earlier = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[] { (null, 300) }));
            var later = Plan(50, 1500, ("a", "b", 1500, new (double?, double?)[] { (null, 300) }));

            Assert.True(earlier.SameContactsAs(later, 2.0));
        }

        [Fact]
        public void APairOnlyOnePlanKnowsOfIsADifferenceOnlyWhenItHasContactInTheSharedSpan()
        {
            var bare = Plan(0, 1000);
            var withDark = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[0]));
            var withContact = Plan(0, 1000, ("a", "b", 1000, new (double?, double?)[] { (100, 300) }));

            Assert.True(bare.SameContactsAs(withDark, 2.0));
            Assert.False(bare.SameContactsAs(withContact, 2.0));
        }
    }
}
