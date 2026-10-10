using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// At a centre the game routes the active craft's samples to, comms.path
    /// and comms.delay describe that route, the one the delay ledger times the
    /// samples by, even where the centre's own plan has a different and
    /// shorter path: a backend picks its route by its own measure, such as
    /// link strength or data rate, not by light-time.
    /// </summary>
    public class CentreRouteTakenTests
    {
        private const string Far = ScriptedContactGame.Far;
        private const string Home = ScriptedContactGame.Home;

        /// <summary>The craft to the relay to the far station, about 50 s of light as the game models it.</summary>
        private static List<CommsHop> FarRoute() => new List<CommsHop>
        {
            new CommsHop { From = ScriptedContactGame.ActiveGuid, To = ScriptedContactGame.RelayGuid, Kind = CommsHopKind.Relay, DistanceMeters = 150_000.0 },
            new CommsHop { From = ScriptedContactGame.RelayGuid, To = Far, ToIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 84_000.0 },
        };

        /// <summary>The craft to the relay to the home station, by way of a ground leg the plan never draws.</summary>
        private static List<CommsHop> HomeRoute() => new List<CommsHop>
        {
            new CommsHop { From = ScriptedContactGame.ActiveGuid, To = ScriptedContactGame.RelayGuid, Kind = CommsHopKind.Relay, DistanceMeters = 120_000.0 },
            new CommsHop { From = ScriptedContactGame.RelayGuid, To = ScriptedContactGame.HomeName, ToIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 40_000.0 },
        };

        [Fact]
        public async Task ANonHomeCentresDelayIsHowOldItsSamplesAreWhenTheyArrive()
        {
            var plan = await PlannedDelayAsync(Far);

            var game = new ScriptedContactGame();
            game.GameRoutes[Far] = FarRoute();
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var seated = await SeatedAsync(world, Far);

            var quoted = Delay(seated.Latest(ContactPlanSource.DelayTopic));
            var age = Age(seated);
            Assert.Equal(ScriptedContactGame.SecondsOver(FarRoute()), quoted!.Value, 6);
            Assert.Equal(quoted.Value, age, 6);
            Assert.NotEqual(plan, quoted);
            Assert.Equal(
                new[] { (ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid), (ScriptedContactGame.RelayGuid, Far) },
                Hops(seated.Path));
        }

        [Fact]
        public async Task TheHomeCentresDelayIsHowOldItsSamplesAreOverTheCraftsOwnPathToTheGround()
        {
            var plan = await PlannedDelayAsync(Home);

            var game = new ScriptedContactGame();
            game.GameRoutes[Home] = HomeRoute();
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var seated = await SeatedAsync(world, Home);

            var quoted = Delay(seated.Latest(ContactPlanSource.DelayTopic));
            Assert.Equal(ScriptedContactGame.SecondsOver(HomeRoute()), quoted!.Value, 6);
            Assert.Equal(quoted.Value, Age(seated), 6);
            Assert.NotEqual(plan, quoted);
            Assert.Equal(
                new[] { ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName },
                Hops(seated.Path).Select(h => h.To).ToArray());
        }

        [Fact]
        public async Task TheNetworkAndTerminusAtACentreAreTheRouteItsSamplesTake()
        {
            // By way of the home station, which the far centre's plan never routes through.
            var game = new ScriptedContactGame();
            game.GameRoutes[Far] = new List<CommsHop>
            {
                new CommsHop { From = ScriptedContactGame.ActiveGuid, To = ScriptedContactGame.HomeName, ToIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 90_000.0 },
                new CommsHop { From = ScriptedContactGame.HomeName, To = Far, FromIsHome = true, ToIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 60_000.0 },
            };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var seated = await SeatedAsync(world, Far);

            using var network = JsonDocument.Parse(seated.Network!);
            Assert.Equal(
                new[] { ScriptedContactGame.ActiveGuid, ScriptedContactGame.HomeName, Far },
                network.RootElement.GetProperty("nodes").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToArray());
            using var terminus = JsonDocument.Parse(seated.CommandCentre!);
            Assert.Equal(Far, terminus.RootElement.GetProperty("id").GetString());
        }

        [Fact]
        public async Task EachHopOfTheRouteTakenCarriesWhatTheCentreCanWorkOutOfItsStrength()
        {
            var game = new ScriptedContactGame { LinkStrengths = (a, b) => 0.7 };
            game.GameRoutes[Far] = FarRoute();
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var seated = await SeatedAsync(world, Far);

            using var path = JsonDocument.Parse(seated.Path!);
            var strengths = path.RootElement.GetProperty("hops").EnumerateArray()
                .Select(h => h.TryGetProperty("strength", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetDouble() : (double?)null)
                .ToArray();
            Assert.Equal(new double?[] { 0.7, 0.7 }, strengths);
        }

        [Fact]
        public async Task ACentreTheGameHasNoRouteForKeepsItsPlansPathAndNeverGetsAZero()
        {
            var game = new ScriptedContactGame();
            game.GameRoutes[Far] = FarRoute();
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var seated = await SeatedAsync(world, Home);

            Assert.Equal(
                new[] { ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName },
                Hops(seated.Path).Select(h => h.To).ToArray());
            Assert.NotEqual(0.0, Delay(seated.Latest(ContactPlanSource.DelayTopic)));
        }

        /// <summary>The delay a centre is quoted in a world where the game states no route, which is its plan's.</summary>
        private static async Task<double?> PlannedDelayAsync(string centre)
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var seated = await SeatedAsync(world, centre);
            return Delay(seated.Latest(ContactPlanSource.DelayTopic));
        }

        /// <summary>
        /// Ticks the world past the plan's first light and on long enough for
        /// a sample to cross the route, the craft's reading changing each
        /// second, and returns what a session seated at <paramref name="centre"/>
        /// was sent.
        /// </summary>
        private static async Task<CentreView> SeatedAsync(ReckonedVantageWorld world, string centre)
        {
            var (client, view) = await world.SitDownAtAsync(centre, ContactPlanSource.DelayTopic, ScriptedContactUplink.ActiveTelemetryTopic);
            await using var _ = client;
            foreach (var ut in new[] { 1.0, 2.0, 700.0 }.Concat(Enumerable.Range(701, 80).Select(s => (double)s)))
            {
                world.Game.ActiveValue = ut;
                world.Tick(ut);
            }
            await Task.WhenAll(world.SettleAsync(), ReckonedVantageWorld.SettleAsync(client, view));
            return view;
        }

        /// <summary>How old the newest sample of the craft's telemetry was when it reached the screen.</summary>
        private static double Age(CentreView view)
        {
            Assert.NotEmpty(view.Telemetry);
            var newest = view.Telemetry[view.Telemetry.Count - 1];
            return newest.DeliveredAt - newest.ValidAt;
        }

        private static double? Delay(string? payload)
        {
            Assert.NotNull(payload);
            using var doc = JsonDocument.Parse(payload!);
            var value = doc.RootElement.GetProperty("oneWaySeconds");
            return value.ValueKind == JsonValueKind.Null ? (double?)null : value.GetDouble();
        }

        private static (string From, string To)[] Hops(string? path)
        {
            Assert.NotNull(path);
            using var doc = JsonDocument.Parse(path!);
            return doc.RootElement.GetProperty("hops").EnumerateArray()
                .Select(h => (h.GetProperty("from").GetString()!, h.GetProperty("to").GetString()!))
                .ToArray();
        }
    }
}
