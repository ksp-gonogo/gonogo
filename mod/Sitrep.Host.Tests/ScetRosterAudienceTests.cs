using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// When the SCET alarm roster goes on the wire, and in particular that an
    /// EMPTY roster does.
    /// </summary>
    public class ScetRosterAudienceTests
    {
        [Fact]
        public void NothingIsPublishedWhileNobodyIsSubscribed()
        {
            var audience = new ScetRosterAudience();

            Assert.False(audience.ShouldPublish(hasAudience: false, rosterChanged: false));
            Assert.False(audience.ShouldPublish(hasAudience: false, rosterChanged: true));
        }

        /// <summary>
        /// The defect, stated as a rule: a subscriber that arrives to an
        /// unchanged, empty roster is still owed an answer, because "empty" is
        /// the answer and nothing else will ever produce it.
        /// </summary>
        [Fact]
        public void TheFirstTickWithAnAudiencePublishesEvenThoughNothingChanged()
        {
            var audience = new ScetRosterAudience();
            audience.ShouldPublish(hasAudience: false, rosterChanged: false);

            Assert.True(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
        }

        [Fact]
        public void AnAnsweredAudienceIsPublishedToOnlyOnAChange()
        {
            var audience = new ScetRosterAudience();
            audience.ShouldPublish(hasAudience: true, rosterChanged: false);

            Assert.False(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
            Assert.True(audience.ShouldPublish(hasAudience: true, rosterChanged: true));
            Assert.False(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
        }

        /// <summary>
        /// The audience is a set, not a count, and the uplink cannot see who is
        /// in it. So the only safe reading of "nobody is subscribed" is that
        /// whoever comes next has heard nothing: a client that reconnects to an
        /// unchanged roster gets it again rather than nothing at all.
        /// </summary>
        [Fact]
        public void AnAudienceThatLeftAndCameBackIsAnsweredAgain()
        {
            var audience = new ScetRosterAudience();
            audience.ShouldPublish(hasAudience: true, rosterChanged: false);
            audience.ShouldPublish(hasAudience: false, rosterChanged: false);

            Assert.True(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
        }

        /// <summary>
        /// A change that happens while nobody is watching is not banked: the
        /// publish that follows the next subscribe carries the CURRENT roster,
        /// so there is nothing a dropped change could have cost.
        /// </summary>
        [Fact]
        public void AChangeWithNoAudienceIsNotBankedForTheNextOne()
        {
            var audience = new ScetRosterAudience();
            audience.ShouldPublish(hasAudience: true, rosterChanged: false);
            audience.ShouldPublish(hasAudience: false, rosterChanged: true);

            Assert.True(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
            Assert.False(audience.ShouldPublish(hasAudience: true, rosterChanged: false));
        }
    }
}
