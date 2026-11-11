using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A centre whose craft are coasting has nothing new to plan for: it plans
    /// again only when half its horizon has passed, its ground changes, or news
    /// changes what it would plan.
    /// </summary>
    public class ReplanRateTests
    {
        private readonly ITestOutputHelper _out;

        public ReplanRateTests(ITestOutputHelper output) => _out = output;

        [Fact]
        public async Task AQuietWorldDoesNotReplanEveryLook()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Tick(1);
            world.Tick(2);
            await world.SettleAsync();
            var before = Rounds(world.Uplink.Census);

            foreach (var ut in Enumerable.Range(3, 60))
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var census = world.Uplink.Census;
            _out.WriteLine(census);
            Assert.True(Rounds(census) - before <= 6, "plan rounds over a quiet minute: " + census);
        }

        /// <summary>
        /// A ground station read from the live game lands in a slightly different
        /// place on every look. It has not moved on its body, so that is no reason
        /// to plan again.
        /// </summary>
        [Fact]
        public async Task GroundStationsReadInASlightlyDifferentPlaceEachLookDoNotReplan()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Game.StationWobbleMeters = 2_000.0;
            world.Tick(1);
            world.Tick(2);
            await world.SettleAsync();
            var before = Rounds(world.Uplink.Census);

            foreach (var ut in Enumerable.Range(3, 60))
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var census = world.Uplink.Census;
            _out.WriteLine(census);
            Assert.True(Rounds(census) - before <= 6, "plan rounds over a minute of wobbling stations: " + census);
        }

        private static long Rounds(string census) =>
            long.Parse(Regex.Match(census, @"plan\.rounds=(\d+)").Groups[1].Value);
    }
}
