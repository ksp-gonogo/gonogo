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
    /// samples by, even when the centre's own plan has a different path.
    /// </summary>
    public class CentreRouteTakenTests
    {
        private const string Far = ScriptedContactGame.Far;
        private const string Home = ScriptedContactGame.Home;

        private static List<CommsHop> GameRoute() => new List<CommsHop>
        {
            new CommsHop { From = ScriptedContactGame.ActiveGuid, To = "otherRelay", Kind = CommsHopKind.Relay, DistanceMeters = 9.0e9 },
            new CommsHop { From = "otherRelay", To = Far, ToIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 3.0e9 },
        };

        private static async Task TickAsync(ReckonedVantageWorld world)
        {
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
        }

        [Fact]
        public async Task ThePathAndDelayAtACentreAreTheRouteTheGameTimesSamplesBy()
        {
            await using var plain = await ReckonedVantageWorld.StartAsync();
            await TickAsync(plain);
            var plan = Delay(plain.Far.Latest(ContactPlanSource.DelayTopic));

            await using var world = await ReckonedVantageWorld.StartAsync();
            var route = GameRoute();
            world.Engine.SetActiveVesselRoutes(new Dictionary<string, IReadOnlyList<CommsHop>> { [Far] = route });
            await TickAsync(world);

            Assert.Equal(new[] { "otherRelay", Far }, Hops(world.Far.Path).Select(h => h.To).ToArray());
            var expected = SignalDelay.Compute(
                new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 / ScriptedContactGame.LightFactor },
                new CommsPath { Hops = route },
                "").OneWaySeconds;
            var arrives = Delay(world.Far.Latest(ContactPlanSource.DelayTopic));
            Assert.NotNull(expected);
            Assert.Equal(expected, arrives);
            Assert.NotEqual(plan, arrives);
        }

        [Fact]
        public async Task ACentreTheGameHasNoRouteForKeepsItsPlansPathAndNeverGetsAZero()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Engine.SetActiveVesselRoutes(new Dictionary<string, IReadOnlyList<CommsHop>> { [Far] = GameRoute() });
            await TickAsync(world);

            Assert.Equal(
                new[] { ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName },
                Hops(world.Home.Path).Select(h => h.To).ToArray());
            Assert.NotEqual(0.0, Delay(world.Home.Latest(ContactPlanSource.DelayTopic)));
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
