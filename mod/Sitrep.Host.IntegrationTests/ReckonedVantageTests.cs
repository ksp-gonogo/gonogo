using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Each command centre plans from where it believes every craft will be,
    /// reckoned forward from what that centre has heard, and never from where a
    /// craft really is now. So nothing a craft does can move a centre's contact
    /// plan, its routes or its commands' status until light has carried the
    /// news there.
    ///
    /// <para>The home centre is one light-second from the active craft and ten
    /// light-minutes from the relay; the far centre is five light-minutes from
    /// the relay. Each test runs the real engine and the real planner over a
    /// scripted game. Where two worlds are run side by side they are given the
    /// same ticks, and differ only in what the relay does.</para>
    /// </summary>
    public class ReckonedVantageTests
    {
        /// <summary>When the relay does whatever the test has it do: late enough that both centres have long since heard where it was.</summary>
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.Relay;

        [Fact]
        public async Task ARemoteBurnMovesEachCentresPlanOnlyWhenItsNewsArrives()
        {
            await using var burned = await ReckonedVantageWorld.StartAsync();
            await using var control = await ReckonedVantageWorld.StartAsync();
            await BothHaveHeardOfTheRelayAsync(burned, control);

            burned.Game.BurnRelay(T0);
            await TickBothAsync(burned, control, T0, T0 + 2, T0 + 12, T0 + 14);
            SameAsControl(burned.Home, control.Home, "the home centre, seconds after a burn ten light-minutes away");
            SameAsControl(burned.Far, control.Far, "the far centre, seconds after a burn five light-minutes away");

            await TickBothAsync(burned, control, T0 + 299);
            SameAsControl(burned.Far, control.Far, "the far centre, one second before the burn's light reaches it");

            await TickBothAsync(burned, control, T0 + 301, T0 + 302, T0 + 304);
            Reckoned.Differs(control.Far.Contacts, burned.Far.Contacts, "the far centre's contact plan, once the burn's light has reached it");
            SameAsControl(burned.Home, control.Home, "the home centre, after the far centre has heard of the burn");

            await TickBothAsync(burned, control, T0 + 599);
            SameAsControl(burned.Home, control.Home, "the home centre, one second before the burn's light reaches it");

            await TickBothAsync(burned, control, T0 + 601, T0 + 602, T0 + 604);
            Reckoned.Differs(control.Home.Contacts, burned.Home.Contacts, "the home centre's contact plan, once the burn's light has reached it");
            Reckoned.Differs(control.Home.Routes, burned.Home.Routes, "the home centre's routes, once the burn's light has reached it");
        }

        [Fact]
        public Task ACentresPlanStillMovesWhenNewsArrivesWhileTheActiveCraftIsDark() =>
            Reckoned.StillViolatedAsync("publishing each centre's plan to that centre alone, off the active craft's node (Saga 782)", async () =>
            {
                await using var burned = await ReckonedVantageWorld.StartAsync();
                await using var control = await ReckonedVantageWorld.StartAsync();
                await BothHaveHeardOfTheRelayAsync(burned, control);

                burned.Game.ActiveConnected = false;
                control.Game.ActiveConnected = false;
                burned.Game.BurnRelay(T0);
                await TickBothAsync(burned, control, T0, T0 + 2, T0 + 12, T0 + 599);
                SameAsControl(burned.Home, control.Home, "the home centre, before the burn's light reaches it, with the active craft dark");

                await TickBothAsync(burned, control, T0 + 601, T0 + 602, T0 + 604);
                Reckoned.Differs(control.Home.Contacts, burned.Home.Contacts, "the home centre's contact plan, once the burn's light has reached it, with the active craft dark");
            });

        [Fact]
        public async Task ADestroyedCraftStaysInACentresPlanUntilItsSilenceCouldHaveArrived()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            await using var control = await ReckonedVantageWorld.StartAsync();
            await BothHaveHeardOfTheRelayAsync(world, control);

            world.Game.DestroyRelay();
            await TickBothAsync(world, control, T0, T0 + 2, T0 + 12, T0 + 14);
            Reckoned.True(world.Home.PlansPair(Home, Relay), "the home centre's plan dropped a craft seconds after it was destroyed ten light-minutes away");
            SameAsControl(world.Home, control.Home, "the home centre, seconds after a craft was destroyed ten light-minutes away");

            await TickBothAsync(world, control, T0 + 599);
            SameAsControl(world.Home, control.Home, "the home centre, one second before the craft's silence could reach it");

            await TickBothAsync(world, control, T0 + 601, T0 + 602, T0 + 604);
            Reckoned.True(!world.Home.PlansPair(Home, Relay), "the home centre's plan still carries a craft whose silence has reached it");
        }

        [Fact]
        public Task ACommandSentOnTheCentresBeliefIsAcceptedAsLiveWhateverTheFarEndIsDoing() =>
            Reckoned.StillViolatedAsync("store-and-forward sending from the centre's own plan (Saga 782)", async () =>
            {
                await using var world = await ReckonedVantageWorld.StartAsync();
                await HasHeardOfTheRelayAsync(world);
                Assert.True(world.Home.PlansContactAt(Home, Relay, T0), "the scripted relay should be in the home centre's sight at T0");

                // The relay has just lost its link. Nothing can have told the home centre yet.
                world.Game.RelayConnected = false;
                world.Tick(T0);

                double? accepted = null;
                world.Engine.DispatchCommandAndWait(
                    ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op, onAccepted: seconds => accepted = seconds);

                Reckoned.True(accepted != null, "a command to a craft the centre believes it can reach was not accepted: the far end's link decided it at once");
                Reckoned.True(accepted == world.Game.RelayFromHomeSeconds, "the command was accepted at " + accepted + " s, not the centre's own light-time to the craft");
                var pending = Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending;
                Reckoned.True(
                    pending.Any(entry => entry.Command == ScriptedContactUplink.RelayCommand && entry.Vantage == Home),
                    "the command is not in the centre's pending queue");
            });

        /// <summary>
        /// Runs both worlds past the relay's light-time to the home centre, and
        /// checks they agree: two engines given the same game publish the same
        /// bytes, which is what lets a later difference be blamed on the relay.
        /// </summary>
        private static async Task BothHaveHeardOfTheRelayAsync(ReckonedVantageWorld world, ReckonedVantageWorld control)
        {
            await TickBothAsync(world, control, 1, 2, 700, 702, 704);
            Assert.True(world.Home.PlansPair(Home, Relay), "the home centre should have the relay in its plan by now");
            Assert.NotNull(world.Home.Routes);
            Assert.Equal(control.Home.Contacts, world.Home.Contacts);
            Assert.Equal(control.Home.Routes, world.Home.Routes);
            Assert.Equal(control.Far.Contacts, world.Far.Contacts);
            Assert.Equal(control.Far.Routes, world.Far.Routes);
        }

        private static async Task HasHeardOfTheRelayAsync(ReckonedVantageWorld world)
        {
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 704.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
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
            Reckoned.Same(control.Contacts, centre.Contacts, "the contact plan of " + when);
            Reckoned.Same(control.Routes, centre.Routes, "the routes of " + when);
        }
    }
}
