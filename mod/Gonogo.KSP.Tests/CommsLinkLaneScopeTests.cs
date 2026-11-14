using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// When a craft's link is said into its lane: a lane that said too little shows
    /// a switch the link a craft had long ago, and one that said every tick floods
    /// the record, so the rule is checked here rather than on a screen.
    /// </summary>
    public class CommsLinkLaneScopeTests
    {
        private static Dictionary<string, (bool Connected, double Ut)> Said() =>
            new Dictionary<string, (bool Connected, double Ut)>();

        [Fact]
        public void ALaneRepeatsAStandingLinkAsOftenAsTheChannelDoes()
        {
            var link = new CommsCoreUplink().Manifest.Channels.Single(c => c.Topic == CommsCoreUplink.LinkTopic);

            Assert.Equal(link.Emission.KeyframeIntervalUt, CommsLinkLaneScope.KeyframeUt);
        }

        [Fact]
        public void TheFirstReadingOfACraftIsSaid()
        {
            Assert.True(CommsLinkLaneScope.Due(Said(), "a", connected: true, ut: 100.0));
        }

        [Fact]
        public void AStandingLinkIsNotSaidAgainInsideTheKeyframeInterval()
        {
            var said = Said();
            CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0);

            Assert.False(CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0 + CommsLinkLaneScope.KeyframeUt - 1.0));
            Assert.True(CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0 + CommsLinkLaneScope.KeyframeUt));
        }

        [Fact]
        public void AChangeIsSaidAtOnce()
        {
            var said = Said();
            CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0);

            Assert.True(CommsLinkLaneScope.Due(said, "a", connected: false, ut: 101.0));
            Assert.True(CommsLinkLaneScope.Due(said, "a", connected: true, ut: 102.0));
        }

        [Fact]
        public void EachCraftIsTimedOnItsOwn()
        {
            var said = Said();
            CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0);

            Assert.True(CommsLinkLaneScope.Due(said, "b", connected: true, ut: 101.0));
        }

        [Fact]
        public void AReadingOnATimelineALoadWentBackToIsSaid()
        {
            var said = Said();
            CommsLinkLaneScope.Due(said, "a", connected: true, ut: 500.0);

            Assert.True(CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0));
        }

        [Fact]
        public void ACraftThatHasGoneIsForgotten()
        {
            var said = Said();
            CommsLinkLaneScope.Due(said, "a", connected: true, ut: 100.0);
            CommsLinkLaneScope.Due(said, "b", connected: true, ut: 100.0);

            CommsLinkLaneScope.ForgetGone(said, new HashSet<string> { "b" });

            Assert.Equal(new[] { "b" }, said.Keys);
        }
    }
}
