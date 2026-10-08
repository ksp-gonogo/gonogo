using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft's telemetry from while it had no path to a command centre is
    /// carried to each centre as it went: handed to a relay when the craft can
    /// reach one, held there until the relay's own link onward opens, received
    /// when it lands, and never delivered to a centre before it got there.
    /// </summary>
    public class SpanRoutingTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Active = ScriptedContactGame.Active;
        private const string Relay = ScriptedContactGame.Relay;

        /// <summary>The craft's window to the relay closes at 200, and a sample handed over in its last seconds lands after it does: what the relay carries is what was taken before this.</summary>
        private const double RelayCarriedBefore = 190;

        /// <summary>A plan the test writes: each pair's windows and the light time across it, in game seconds.</summary>
        private static ContactPlan Plan(params (string A, string B, double Open, double? Close, double Light)[] pairs)
        {
            const double horizon = 100_000.0;
            var plans = pairs.Select(p =>
            {
                var meters = p.Light / ScriptedContactGame.LightFactor * PairPlan.SpeedOfLight;
                return new PairPlan(
                    p.A, p.B, horizon, new[] { new ContactWindow(p.Open, p.Close) }, 0.0, 1000.0, Enumerable.Repeat(meters, 101).ToArray());
            }).ToList();
            return new ContactPlan(0.0, horizon, 1000.0, plans, 0, 0);
        }

        private static void Ticks(ReckonedVantageWorld world, double from, double to, Action<double>? each = null)
        {
            for (var ut = from; ut <= to; ut += 1.0)
            {
                each?.Invoke(ut);
                world.Game.ActiveValue = ut;
                world.Tick(ut);
            }
        }

        private static async Task<ReckonedVantageWorld> StartAsync(ScriptedContactGame game, ContactPlan plan, Func<ContactPlan?>? later = null)
        {
            var world = await ReckonedVantageWorld.StartAsync(game);
            world.Engine.SetCentrePlans(_ => later?.Invoke() ?? plan, () => later?.Invoke() == null ? 1 : 2);
            return world;
        }

        private static string Show(IEnumerable<(double Value, double ValidAt, double DeliveredAt, Staleness Staleness, double? GapSinceUt)> frames) =>
            string.Join(" ", frames.Select(f => f.Value + "@" + f.DeliveredAt + (f.Staleness == Staleness.Recorded ? "R" : "")));

        [Fact]
        public async Task ARecordingWaitsAtTheRelayAndReachesEachCentreWhenItsOwnLinkOpens()
        {
            var game = new ScriptedContactGame
            {
                RelayFromHomeSeconds = 10, RelayFromFarSeconds = 20, ActiveSeconds = 1, RelayConnected = false, FarLinkedToRelay = false,
            };
            var plan = Plan(
                (Active, Relay, 60, 200, 5),
                (Relay, Home, 300, null, 10));
            await using var world = await StartAsync(game, plan);

            // Live until 50, then dark. The craft reaches the relay from 60 to 199.
            Ticks(world, 1, 449, ut =>
            {
                game.ActiveConnected = ut < 50;
                game.ActiveLinkedToRelaySeconds = ut >= 60 && ut < 200 ? 5.0 : (double?)null;
                game.RelayConnected = ut >= 300;
            });
            await world.SettleAsync();

            // Home has the recording the relay carried, whole, once, in order,
            // landed 10 s after the relay's link to it opened at 300.
            var recordedAtHome = world.Home.Telemetry.Where(f => f.Staleness == Staleness.Recorded).ToList();
            Assert.NotEmpty(recordedAtHome);
            Assert.All(recordedAtHome, f => Assert.Equal(310.0, f.DeliveredAt));
            Assert.Equal(
                Enumerable.Range(50, 140).Select(v => (double)v).ToArray(),
                recordedAtHome.Select(f => f.Value).OrderBy(v => v).Where(v => v < RelayCarriedBefore).ToArray());
            Assert.Equal(recordedAtHome.Select(f => f.ValidAt).OrderBy(v => v), recordedAtHome.Select(f => f.ValidAt));

            // Nothing of the dark stretch reached home before it could have.
            Assert.DoesNotContain(world.Home.Telemetry, f => f.Value >= 50 && f.DeliveredAt < 310.0);

            // The home centre, here the station the game marks home, hears through
            // every ground station, so it has the same recording when it lands at
            // the other one.
            var recordedAtHomeCentre = world.Far.Telemetry.Where(f => f.Staleness == Staleness.Recorded && f.Value < RelayCarriedBefore).ToList();
            Assert.All(recordedAtHomeCentre, f => Assert.Equal(310.0, f.DeliveredAt));
            Assert.Equal(Enumerable.Range(50, 140).Select(v => (double)v), recordedAtHomeCentre.Select(f => f.Value).OrderBy(v => v));
        }

        [Fact]
        public async Task AContactThatOpensWhileARelayHoldsASpanDeliversNewerDataFirstAndTheOlderSpanLater()
        {
            var game = new ScriptedContactGame
            {
                RelayFromHomeSeconds = 10, RelayFromFarSeconds = 20, ActiveSeconds = 1, RelayConnected = false, FarLinkedToRelay = false,
            };
            var plan = Plan(
                (Active, Relay, 60, 200, 5),
                (Relay, Home, 400, null, 10));
            var withContact = Plan(
                (Active, Relay, 60, 200, 5),
                (Active, Home, 250, null, 1),
                (Relay, Home, 400, null, 10));
            var contactKnown = false;
            await using var world = await StartAsync(game, plan, () => contactKnown ? withContact : null);

            Ticks(world, 1, 449, ut =>
            {
                contactKnown = ut >= 250;
                game.ActiveConnected = ut < 50 || ut >= 250;
                game.ActiveLinkedToRelaySeconds = ut >= 60 && ut < 200 ? 5.0 : (double?)null;
                game.ActiveLinkedToHomeSeconds = ut >= 250 ? 1.0 : (double?)null;
                game.RelayConnected = ut >= 400;
            });
            await world.SettleAsync();

            var live = world.Home.Telemetry.Where(f => f.Staleness != Staleness.Recorded && f.Value >= 250).ToList();
            var direct = world.Home.Telemetry.Where(f => f.Staleness == Staleness.Recorded && f.DeliveredAt < 400).ToList();
            var late = world.Home.Telemetry.Where(f => f.Staleness == Staleness.Recorded && f.DeliveredAt >= 400).ToList();

            Assert.NotEmpty(live);
            Assert.True(live.Min(f => f.ValidAt) >= 250.0);

            // What the craft still held when its path home opened came straight
            // home, and what the relay held lands last, behind data already shown.
            Assert.All(direct, f => Assert.Equal(250.0, f.DeliveredAt));
            Assert.All(late, f => Assert.Equal(410.0, f.DeliveredAt));
            Assert.InRange(late.Count, 130, 150);
            Assert.Contains(live, f => f.DeliveredAt < 410.0 && f.ValidAt > late.Max(l => l.ValidAt));

            // Between them every sample from the first dark second to the contact
            // arrived once.
            Assert.Equal(
                Enumerable.Range(50, 200).Select(v => (double)v),
                direct.Concat(late).Select(f => f.Value).OrderBy(v => v));
            Assert.True(late.Min(f => f.DeliveredAt) > direct.Max(f => f.DeliveredAt));
        }

        [Fact]
        public async Task ARecordingThatOutgrowsTheBudgetWhileARelayHoldsItLosesTheOldestAndStatesTheHole()
        {
            var game = new ScriptedContactGame
            {
                RelayFromHomeSeconds = 10, RelayFromFarSeconds = 20, ActiveSeconds = 1, RelayConnected = false, FarLinkedToRelay = false,
            };
            var plan = Plan(
                (Active, Relay, 60, 400, 5),
                (Relay, Home, 600, null, 10));
            await using var world = await StartAsync(game, plan);
            world.Engine.SetRecorderBudgetForTests(25_000);

            Ticks(world, 1, 699, ut =>
            {
                game.ActiveConnected = ut < 50;
                game.ActiveLinkedToRelaySeconds = ut >= 60 && ut < 400 ? 5.0 : (double?)null;
                game.RelayConnected = ut >= 600;
            });
            await world.SettleAsync();

            var recorded = world.Home.Telemetry.Where(f => f.Staleness == Staleness.Recorded).OrderBy(f => f.ValidAt).ToList();
            Assert.InRange(recorded.Count, 20, 300);
            Assert.Equal(49.0, recorded[0].GapSinceUt);
            Assert.All(recorded.Skip(1), f => Assert.Null(f.GapSinceUt));
            Assert.True(recorded[0].ValidAt > 50.0);
            Assert.Equal(recorded.Count, recorded.Select(f => f.Value).Distinct().Count());
            Assert.True(world.Engine.RecordedBytes <= 25_000);
        }
    }
}
