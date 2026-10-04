using System.Threading.Tasks;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command centre's contact plan and routes are sent to that centre
    /// alone, the instant they are made: the light-time was spent by the craft
    /// states on their way in.
    /// </summary>
    public class ContactPlanPublishingTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.Relay;

        [Fact]
        public async Task APlanArrivesAtItsOwnCentreTheInstantItIsMade()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 2, 700, 702);
            await world.SettleAsync();

            var home = world.Home.ContactsMeta!.Value;
            Assert.Equal(home.ValidAt, home.DeliveredAt);
            Assert.Equal(Home, home.Vantage);
            var far = world.Far.ContactsMeta!.Value;
            Assert.Equal(far.ValidAt, far.DeliveredAt);
            Assert.Equal(Far, far.Vantage);
        }

        /// <summary>
        /// The far centre hears of the relay at 300 s and plans it; the home
        /// centre has not heard of it and is sent nothing, though its own
        /// session is subscribed to the same topic.
        /// </summary>
        [Fact]
        public async Task ACentreIsNeverSentAnotherCentresPlan()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 2, 3);
            await world.SettleAsync();
            var homeFrames = world.Home.ContactsFrames;
            Assert.False(world.Home.PlansPair(Home, Relay));

            Ticks(world, 300, 302, 304);
            await world.SettleAsync();

            Assert.True(world.Far.PlansPair(Far, Relay), "the far centre should have planned the relay it has now heard of");
            Assert.Equal(homeFrames, world.Home.ContactsFrames);
            Assert.False(world.Home.PlansPair(Home, Relay));
        }

        /// <summary>A plan is state, and an addressed sample is not kept for whoever subscribes after it landed, so it is said again.</summary>
        [Fact]
        public async Task ASessionThatSitsDownLaterIsSentItsCentresPlanAndRoutes()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 2, 700, 702);
            await world.SettleAsync();

            var (late, view) = await world.SitDownAtAsync(Home);
            await using var _ = late;
            Ticks(world, 703, 704);
            await Task.WhenAll(world.SettleAsync(), ReckonedVantageWorld.SettleAsync(late, view));

            Assert.Equal(world.Home.Contacts, view.Contacts);
            Assert.Equal(world.Home.Routes, view.Routes);
            Assert.True(view.PlansPair(Home, Relay));
        }

        [Fact]
        public async Task APairWithAnEndHeardMidBurnIsLowConfidenceUntilTheCraftIsHeardSettled()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 2, 700, 702);
            await world.SettleAsync();
            Assert.False(world.Home.LowConfidence(Home, Relay));

            // Read moving at 1000; found holding still at 1012 and read settled.
            world.Game.BurnRelay(1000);
            Ticks(world, 1000, 1012, 1601, 1602);
            await world.SettleAsync();
            Assert.True(world.Home.LowConfidence(Home, Relay));

            Ticks(world, 1611, 1613, 1614);
            await world.SettleAsync();
            Assert.False(world.Home.LowConfidence(Home, Relay));
        }

        private static void Ticks(ReckonedVantageWorld world, params double[] uts)
        {
            foreach (var ut in uts)
            {
                world.Tick(ut);
            }
        }
    }
}
