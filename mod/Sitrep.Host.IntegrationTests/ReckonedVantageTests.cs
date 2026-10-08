using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Comms;
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

            await TickBothAsync(burned, control, T0 + 301, T0 + 302);
            Reckoned.Differs(control.Far.Contacts, burned.Far.Contacts, "the far centre's contact plan, once the burn's light has reached it");
            SameAsControl(burned.Home, control.Home, "the home centre, after the far centre has heard of the burn");

            await TickBothAsync(burned, control, T0 + 599);
            SameAsControl(burned.Home, control.Home, "the home centre, one second before the burn's light reaches it");

            await TickBothAsync(burned, control, T0 + 601, T0 + 602);
            Reckoned.Differs(control.Home.Contacts, burned.Home.Contacts, "the home centre's contact plan, once the burn's light has reached it");
            Reckoned.Differs(control.Home.Routes, burned.Home.Routes, "the home centre's routes, once the burn's light has reached it");
        }

        [Fact]
        public async Task ACentresPlanStillMovesWhenNewsArrivesWhileTheActiveCraftIsDark()
        {
            await using var burned = await ReckonedVantageWorld.StartAsync();
            await using var control = await ReckonedVantageWorld.StartAsync();
            await BothHaveHeardOfTheRelayAsync(burned, control);

            burned.Game.ActiveConnected = false;
            control.Game.ActiveConnected = false;
            burned.Game.BurnRelay(T0);
            await TickBothAsync(burned, control, T0, T0 + 2, T0 + 12, T0 + 599);
            SameAsControl(burned.Home, control.Home, "the home centre, before the burn's light reaches it, with the active craft dark");

            await TickBothAsync(burned, control, T0 + 601, T0 + 602);
            Reckoned.Differs(control.Home.Contacts, burned.Home.Contacts, "the home centre's contact plan, once the burn's light has reached it, with the active craft dark");
        }

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

            await TickBothAsync(world, control, T0 + 601, T0 + 602);
            Reckoned.True(!world.Home.PlansPair(Home, Relay), "the home centre's plan still carries a craft whose silence has reached it");
        }

        /// <summary>
        /// The home centre believes the relay is in sight, and the relay has just
        /// lost its link. The command is accepted and goes as live, because that is
        /// all the centre knows. The light is lost. The centre learns of it when
        /// twice the light time has passed with nothing back, and no sooner, and
        /// sends the command again once it next hears from the relay.
        /// </summary>
        [Fact]
        public async Task ACommandSentOnTheCentresBeliefGoesAsLiveAndTheTruthComesHomeNoSoonerThanLight()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            await HasHeardOfTheRelayAsync(world);
            Assert.True(world.Home.PlansContactAt(Home, Relay, T0), "the scripted relay should be in the home centre's sight at T0");

            world.Game.RelayConnected = false;
            world.Tick(T0);

            double? accepted = null;
            object? result = null;
            FaultCode? refused = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand,
                "x",
                Home,
                r => result = r,
                TestBudgets.Op,
                onRefused: (code, _) => refused = code,
                onAccepted: seconds => accepted = seconds);

            Reckoned.True(accepted != null, "a command to a craft the centre believes it can reach was not accepted: the far end's link decided it at once");
            var light = accepted!.Value;
            Reckoned.True(light > 550.0 && light < 650.0, "the command was accepted at " + light + " s, not the centre's own light-time to the craft");
            var entry = Pending(world).Single(p => p.Command == ScriptedContactUplink.RelayCommand && p.Vantage == Home);
            Reckoned.True(entry.PredictedHeldAt == null, "the pending entry predicts a hold at " + entry.PredictedHeldAt + ": the far end's link decided it");
            Reckoned.True(Math.Abs(entry.PredictedArrivalUt!.Value - (T0 + light)) < 1e-6, "the pending entry does not predict arrival one of the centre's light-times out");
            Reckoned.True(Journey(world).Count == 0, "the centre was told something the instant it sent");

            world.Tick(T0 + light + 5.0);
            Assert.Equal(0, world.Uplink.HandledCount);
            world.Tick(T0 + (2.0 * light) - 5.0);
            Reckoned.True(Journey(world).Count == 0, "the centre heard the command had not arrived before twice its light-time had passed: " + string.Join(",", Journey(world).Select(e => e.Kind)));
            Reckoned.True(result == null && refused == null, "the command settled before twice its light-time had passed");

            world.Tick(T0 + (2.0 * light) + 5.0);
            var held = Assert.Single(Journey(world));
            Assert.Equal(JourneyEventKind.Held, held.Kind);
            Assert.Equal(Home, held.At);
            Assert.Equal(T0 + (2.0 * light), held.AtUt, 3);
            Assert.Single(Pending(world));

            // The relay is back, and dumps what it recorded. That reaches home a
            // light time later, and the command goes again.
            var back = T0 + (2.0 * light) + 100.0;
            world.Tick(back - 1.0);
            world.Game.RelayConnected = true;
            var real = world.Game.RelayFromHomeSeconds;
            foreach (var ut in new[] { back, back + real - 2.0 })
            {
                world.Tick(ut);
            }
            Assert.DoesNotContain(Journey(world), e => e.Kind == JourneyEventKind.Departed);

            foreach (var ut in new[] { back + real + 1.0, back + (2.0 * real) + 2.0 })
            {
                world.Tick(ut);
            }
            Assert.Contains(Journey(world), e => e.Kind == JourneyEventKind.Departed);
            Assert.Equal(1, world.Uplink.HandledCount);
            Assert.Null(result);

            world.Tick(back + (3.0 * real) + 3.0);
            Assert.NotNull(result);
            Assert.Contains(Journey(world), e => e.Kind == JourneyEventKind.Ran);
            Assert.Empty(Pending(world));
        }

        /// <summary>
        /// A game saved while a command's news was still on its way home, and
        /// loaded again, leaves the centre as ignorant as it was: the command is
        /// still held in place with its lane and deadline, and the centre hears
        /// of it no sooner than it would have without the save.
        /// </summary>
        [Fact]
        public async Task ALoadRevealsNoNewsOfAHeldCommandTheCentreHadNotHeardWhenTheGameWasSaved()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            await HasHeardOfTheRelayAsync(world);
            world.Game.RelayConnected = false;
            world.Tick(T0);
            double? accepted = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op, onAccepted: seconds => accepted = seconds);
            var light = accepted!.Value;
            var sent = Pending(world).Single();

            world.Tick(T0 + light + 5.0);
            Assert.Empty(Journey(world));
            var delivery = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(world.Engine.DeliverySnapshotNow()));
            var heard = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!));
            Assert.NotNull(delivery);

            world.Engine.NoteGameLoaded(delivery, heard, savedUt: T0 + light + 5.0);
            world.Tick(T0 + light + 10.0);
            world.Tick(T0 + light + 15.0);

            var kept = Assert.Single(Pending(world));
            Assert.Equal(sent.LaneSeq, kept.LaneSeq);
            Assert.Equal(sent.ExpiresAtUt, kept.ExpiresAtUt);
            Assert.Equal(sent.Command, kept.Command);
            Assert.Empty(Journey(world));

            world.Tick(T0 + (2.0 * light) - 5.0);
            Assert.Empty(Journey(world));
            Assert.Equal(0, world.Uplink.HandledCount);

            world.Tick(T0 + (2.0 * light) + 5.0);
            var held = Journey(world).Single(e => e.Kind == JourneyEventKind.Held);
            Assert.Equal(T0 + (2.0 * light), held.AtUt, 3);
        }

        /// <summary>
        /// Between the hop's light landing and twice its light time, the centre
        /// cannot know whether the command was received. A cancel pressed then is
        /// sent, and says so, and the centre's screen is the same whether the hop
        /// landed or was lost.
        /// </summary>
        [Fact]
        public async Task ACancelPressedInCustodySaysCancelSentAndNeverCancelledUntilAReportComesHome()
        {
            await using var lost = await ReckonedVantageWorld.StartAsync();
            await using var landed = await ReckonedVantageWorld.StartAsync();
            var refused = new Dictionary<ReckonedVantageWorld, FaultCode?> { [lost] = null, [landed] = null };
            var light = 0.0;
            foreach (var world in new[] { lost, landed })
            {
                await HasHeardOfTheRelayAsync(world);
                world.Game.RelayConnected = world != lost;
                world.Tick(T0);
                world.Engine.DispatchCommandAndWait(
                    ScriptedContactUplink.RelayCommand,
                    "x",
                    Home,
                    _ => { },
                    TestBudgets.Op,
                    onRefused: (code, _) => refused[world] = code,
                    onAccepted: seconds => light = seconds!.Value);
            }

            foreach (var world in new[] { lost, landed })
            {
                world.Tick(T0 + (1.5 * light));
                object? reply = null;
                var cancel = new UplinkCancelRequest { Epoch = world.Engine.JourneyAt(Home).Epoch, Craft = Relay, LaneSeq = 1 };
                world.Engine.DispatchCommandAndWait(ChannelEngine.UplinkCancelCommand, cancel, Home, r => reply = r, TestBudgets.Op);
                var sent = Assert.IsType<CommandResult<UplinkActionReply>>(reply);
                Assert.Equal(1, sent.Payload!.ThroughSeq);
                world.Tick(T0 + (2.0 * light) - 5.0);
            }

            Reckoned.Same(Told(landed), Told(lost), "what the centre has been told, before twice the light-time, of a command whose hop was lost");
            Reckoned.True(Journey(lost).Count == 0, "the centre was told the command was stopped before it could know it still had it");
            Reckoned.True(refused[lost] == null && refused[landed] == null, "the request was refused as cancelled before a report came home");

            lost.Tick(T0 + (2.0 * light) + 5.0);
            Assert.Equal(JourneyEventKind.Cancelled, Assert.Single(Journey(lost)).Kind);
            Assert.Equal(FaultCode.CommandCancelled, refused[lost]);
            Assert.Equal(0, lost.Uplink.HandledCount);

            landed.Tick(T0 + (2.0 * landed.Game.RelayFromHomeSeconds) + 5.0);
            Assert.Equal(1, landed.Uplink.HandledCount);
            Assert.Contains(Journey(landed), e => e.Kind == JourneyEventKind.Ran);
            Assert.Null(refused[landed]);
        }

        private static List<PendingUplink> Pending(ReckonedVantageWorld world) =>
            Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending;

        private static List<CommsJourneyEvent> Journey(ReckonedVantageWorld world) => world.Engine.JourneyAt(Home).Events;

        private static string Told(ReckonedVantageWorld world) =>
            string.Join(",", Journey(world).Select(e => e.Kind + "@" + e.At));

        /// <summary>
        /// Runs both worlds past the relay's light-time to the home centre, and
        /// checks they agree: two engines given the same game publish the same
        /// bytes, which is what lets a later difference be blamed on the relay.
        /// </summary>
        private static async Task BothHaveHeardOfTheRelayAsync(ReckonedVantageWorld world, ReckonedVantageWorld control)
        {
            await TickBothAsync(world, control, 1, 2, 700, 702);
            Assert.True(world.Home.PlansPair(Home, Relay), "the home centre should have the relay in its plan by now");
            Assert.NotNull(world.Home.Routes);
            Assert.Equal(control.Home.Contacts, world.Home.Contacts);
            Assert.Equal(control.Home.Routes, world.Home.Routes);
            Assert.Equal(control.Far.Contacts, world.Far.Contacts);
            Assert.Equal(control.Far.Routes, world.Far.Routes);
        }

        private static async Task HasHeardOfTheRelayAsync(ReckonedVantageWorld world)
        {
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
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
