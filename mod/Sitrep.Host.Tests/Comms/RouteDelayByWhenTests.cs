using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// How late a command centre that hears nothing new can say a craft is
    /// unchanged: the last instant a word could have left the craft and already
    /// have arrived, by what the centre believed of the route at the time.
    /// </summary>
    public class RouteDelayByWhenTests
    {
        private const string Relay = "vessel:relay";

        /// <summary>
        /// The craft's word reached the centre in ten seconds until its route
        /// lengthened to two hundred and fifty at UT 300. At 450 nothing sent
        /// since 300 can have arrived, so silence says nothing later than the
        /// last look before the route grew. Going by the ten seconds its last
        /// word took would say 440, a moment the centre cannot have heard from.
        /// </summary>
        [Fact]
        public void ARouteThatHasLengthenedSinceTheLastWordIsNotSpokenForPastWhereWordCouldHaveArrivedFrom()
        {
            var believed = new RouteDelayByWhen();
            believed.Note(Relay, 100.0, 10.0);
            believed.Note(Relay, 200.0, 10.0);
            believed.Note(Relay, 300.0, 250.0);
            believed.Note(Relay, 400.0, 250.0);

            Assert.Equal(200.0, believed.UnchangedTo(Relay, 450.0, lastWordSeconds: 10.0, floorSeconds: 10.0));
            Assert.Equal(300.0, believed.UnchangedTo(Relay, 550.0, lastWordSeconds: 10.0, floorSeconds: 10.0));
        }

        [Fact]
        public void OnASteadyRouteItIsTheLatestLookWhoseWordHasArrived()
        {
            var believed = new RouteDelayByWhen();
            for (var ut = 100.0; ut <= 1000.0; ut += 100.0)
            {
                believed.Note(Relay, ut, 250.0);
            }

            Assert.Equal(700.0, believed.UnchangedTo(Relay, 1000.0, lastWordSeconds: 250.0, floorSeconds: 250.0));
        }

        /// <summary>The plan can believe in a shorter route than the game carries word by. What the last word was measured to take is the limit.</summary>
        [Fact]
        public void ItIsNeverLaterThanTheLastWordWasMeasuredToTake()
        {
            var believed = new RouteDelayByWhen();
            believed.Note(Relay, 100.0, 5.0);
            believed.Note(Relay, 900.0, 5.0);

            Assert.Equal(700.0, believed.UnchangedTo(Relay, 1000.0, lastWordSeconds: 300.0, floorSeconds: 300.0));
        }

        [Fact]
        public void ALookThatBelievedInNoRouteIsNotSpokenFor()
        {
            var believed = new RouteDelayByWhen();
            believed.Note(Relay, 100.0, 10.0);
            believed.Note(Relay, 200.0, null);
            believed.Note(Relay, 300.0, null);

            Assert.Equal(100.0, believed.UnchangedTo(Relay, 400.0, lastWordSeconds: 10.0, floorSeconds: 10.0));
        }

        [Fact]
        public void WhereNoWordSentSinceCouldHaveArrivedNothingIsSaid()
        {
            var believed = new RouteDelayByWhen();
            believed.Note(Relay, 100.0, 500.0);
            believed.Note(Relay, 200.0, null);

            Assert.Null(believed.UnchangedTo(Relay, 400.0, lastWordSeconds: 10.0, floorSeconds: 10.0));
        }

        [Fact]
        public void WhereNothingWasBelievedOfTheRouteByThenTheFloorIsGoneBy()
        {
            var believed = new RouteDelayByWhen();
            believed.Note(Relay, 900.0, 10.0);

            Assert.Equal(400.0 - 60.0, believed.UnchangedTo(Relay, 400.0, lastWordSeconds: 20.0, floorSeconds: 60.0));
            Assert.Equal(400.0 - 60.0, believed.UnchangedTo("vessel:other", 400.0, lastWordSeconds: 20.0, floorSeconds: 60.0));
        }

        [Fact]
        public void OnlySoManyLooksAreKeptForACraftNobodyAsksAbout()
        {
            var believed = new RouteDelayByWhen();
            for (var i = 0; i < RouteDelayByWhen.MostKept + 500; i++)
            {
                believed.Note(Relay, i, 1.0);
            }

            // The oldest looks are gone, so an instant before the oldest kept is answered as if nothing had been believed by then.
            Assert.Equal(100.0 - 7.0, believed.UnchangedTo(Relay, 100.0, lastWordSeconds: 1.0, floorSeconds: 7.0));
        }
    }
}
