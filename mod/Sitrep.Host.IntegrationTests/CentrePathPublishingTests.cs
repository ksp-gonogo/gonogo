using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Each command centre is shown the active craft's path as its own contact
    /// plan has it, so a hop far from the centre changes on its screen only
    /// once the news of that hop has crossed to it.
    ///
    /// <para>The active craft is one light-second from both centres and
    /// reaches the ground through a relay. The relay is ten light-minutes from
    /// the home centre and five from the far one, so the hop from the relay to
    /// the ground is the far hop: one second away by the craft's telemetry,
    /// and minutes away by its own light.</para>
    /// </summary>
    public class CentrePathPublishingTests
    {
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;

        [Fact]
        public async Task AFarHopChangesOnACentresScreenNoSoonerThanThatHopsLightCouldReachIt()
        {
            await using var burned = await ReckonedVantageWorld.StartAsync();
            await using var control = await ReckonedVantageWorld.StartAsync();
            await TickBothAsync(burned, control, 1, 2, 700, 702);
            Assert.Equal(
                new[] { ScriptedContactGame.RelayGuid, Home },
                Hops(burned.Home.Path).Select(h => h.To).ToArray());
            Assert.Equal(
                new[] { ScriptedContactGame.RelayGuid, Far },
                Hops(burned.Far.Path).Select(h => h.To).ToArray());
            SameAsControl(burned.Home, control.Home, "the home centre, before anything has happened");
            SameAsControl(burned.Far, control.Far, "the far centre, before anything has happened");

            // The relay's burn moves the far hop at once in the game. The active
            // craft's own telemetry crosses to both centres in a second.
            burned.Game.BurnRelay(T0);
            await TickBothAsync(burned, control, T0, T0 + 2, T0 + 12, T0 + 14);
            SameAsControl(burned.Home, control.Home, "the home centre, seconds after the relay burned ten light-minutes away");
            SameAsControl(burned.Far, control.Far, "the far centre, seconds after the relay burned five light-minutes away");

            await TickBothAsync(burned, control, T0 + 299);
            SameAsControl(burned.Far, control.Far, "the far centre, one second before the burn's light reaches it");

            await TickBothAsync(burned, control, T0 + 301, T0 + 302, T0 + 304);
            Reckoned.Differs(control.Far.Path, burned.Far.Path, "the far centre's path, once the burn's light has reached it");
            SameAsControl(burned.Home, control.Home, "the home centre, after the far centre has heard of the burn");

            await TickBothAsync(burned, control, T0 + 599);
            SameAsControl(burned.Home, control.Home, "the home centre, one second before the burn's light reaches it");

            await TickBothAsync(burned, control, T0 + 601, T0 + 602, T0 + 604);
            Reckoned.Differs(control.Home.Path, burned.Home.Path, "the home centre's path, once the burn's light has reached it");
        }

        /// <summary>
        /// The relay is destroyed, so the game's own path for the active craft is
        /// gone that instant. Each centre goes on believing in it until the
        /// relay's silence could have reached that centre.
        /// </summary>
        [Fact]
        public async Task ARelayThatIsGoneStaysOnACentresPathUntilItsSilenceCouldHaveArrived()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            await using var control = await ReckonedVantageWorld.StartAsync();
            await TickBothAsync(world, control, 1, 2, 700, 702);

            world.Game.DestroyRelay();
            await TickBothAsync(world, control, T0, T0 + 2, T0 + 12, T0 + 599);
            SameAsControl(world.Home, control.Home, "the home centre, before the relay's silence could reach it");
            Assert.Equal(2, Hops(world.Home.Path).Length);

            await TickBothAsync(world, control, T0 + 601, T0 + 602, T0 + 604);
            Assert.Empty(Hops(world.Home.Path));
            using var network = JsonDocument.Parse(world.Home.Network!);
            Assert.Equal(0, network.RootElement.GetProperty("nodes").GetArrayLength());
            using var centre = JsonDocument.Parse(world.Home.CommandCentre!);
            Assert.Equal(JsonValueKind.Null, centre.RootElement.GetProperty("id").ValueKind);
        }

        [Fact]
        public async Task ACentresPathNamesItsNodesAndTheStationItEndsAtAndArrivesTheInstantItIsMade()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var hops = Hops(world.Home.Path);
            Assert.Equal(ScriptedContactGame.ActiveGuid, hops[0].From);
            Assert.Equal(ScriptedContactGame.RelayGuid, hops[0].To);
            Assert.False(hops[0].ToIsHome);
            Assert.Equal(Home, hops[1].To);
            Assert.True(hops[1].ToIsHome);
            Assert.All(hops, h => Assert.True(h.DistanceMeters > 0.0));

            using var network = JsonDocument.Parse(world.Home.Network!);
            Assert.Equal(
                new[] { "Lander", "Relay", Home },
                network.RootElement.GetProperty("nodes").EnumerateArray().Select(n => n.GetProperty("displayName").GetString()).ToArray());
            using var centre = JsonDocument.Parse(world.Home.CommandCentre!);
            Assert.Equal(Home, centre.RootElement.GetProperty("id").GetString());
            Assert.Equal("GroundStation", centre.RootElement.GetProperty("kind").GetString());

            foreach (var topic in new[] { ContactPlanSource.PathTopic, ContactPlanSource.NetworkTopic, ContactPlanSource.CommandCentreTopic })
            {
                var (validAt, deliveredAt) = world.Home.Stamps[topic];
                Assert.Equal(validAt, deliveredAt);
            }
        }

        /// <summary>A path is state, and an addressed sample is not kept for whoever subscribes after it landed, so it is said again.</summary>
        [Fact]
        public async Task ASessionThatSitsDownLaterIsSentItsCentresPath()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var (late, view) = await world.SitDownAtAsync(Home);
            await using var _ = late;
            world.Tick(703);
            world.Tick(704);
            await Task.WhenAll(world.SettleAsync(), ReckonedVantageWorld.SettleAsync(late, view));

            Assert.Equal(world.Home.Path, view.Path);
            Assert.Equal(world.Home.Network, view.Network);
            Assert.Equal(world.Home.CommandCentre, view.CommandCentre);
            Assert.NotNull(view.CommandCentre);
        }

        private static (string From, string To, bool ToIsHome, double DistanceMeters)[] Hops(string? path)
        {
            Assert.NotNull(path);
            using var doc = JsonDocument.Parse(path!);
            return doc.RootElement.GetProperty("hops").EnumerateArray()
                .Select(h => (
                    h.GetProperty("from").GetString()!,
                    h.GetProperty("to").GetString()!,
                    h.GetProperty("toIsHome").GetBoolean(),
                    h.GetProperty("distanceMeters").GetDouble()))
                .ToArray();
        }

        private static async Task TickBothAsync(ReckonedVantageWorld world, ReckonedVantageWorld control, params double[] uts)
        {
            foreach (var ut in uts)
            {
                world.Tick(ut);
                control.Tick(ut);
            }
            await Task.WhenAll(world.SettleAsync(), control.SettleAsync());
        }

        private static void SameAsControl(CentreView centre, CentreView control, string when)
        {
            Reckoned.Same(control.Path, centre.Path, "the path of " + when);
            Reckoned.Same(control.Network, centre.Network, "the network of " + when);
            Reckoned.Same(control.CommandCentre, centre.CommandCentre, "the command centre of " + when);
        }
    }
}
