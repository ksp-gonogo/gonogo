using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A held command's pending entry predicts from its centre's plan as it
    /// stands, not as it stood when the command was sent: when the plan changes
    /// the way on from where the command is held, the entry's hold, arrival and
    /// reply follow.
    ///
    /// <para>The relay is in the home station's sight and cannot yet see the
    /// active craft, so a command for that craft is held at the relay.</para>
    /// </summary>
    public class PendingReplanTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.Relay;

        private static List<PendingUplink> Pending(ReckonedVantageWorld world) =>
            Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending;

        private static async Task<(ReckonedVantageWorld World, PendingUplink Sent)> HeldAtTheRelayAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame(35.0 * Math.PI / 180.0));
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.ActiveCommand, "x", Home, _ => { }, TestBudgets.Op);
            var sent = Pending(world).Single();
            Assert.Equal(Relay, sent.PredictedHeldAt);
            return (world, Copy(sent));
        }

        private static PendingUplink Copy(PendingUplink entry) => new PendingUplink
        {
            PredictedHeldAt = entry.PredictedHeldAt,
            PredictedHeldUntilUt = entry.PredictedHeldUntilUt,
            PredictedArrivalUt = entry.PredictedArrivalUt,
            PredictedReplyUt = entry.PredictedReplyUt,
            CancelDeadlineUt = entry.CancelDeadlineUt,
        };

        [Fact]
        public async Task AHeldCommandsPredictionFollowsThePlanOnceTheRelaysBurnIsHeard()
        {
            var (world, sent) = await HeldAtTheRelayAsync();
            await using var _ = world;
            world.Game.BurnRelay(1000.0);

            for (var ut = 1010.0; ut <= 2400.0; ut += 10.0)
            {
                world.Tick(ut);
            }

            // Planned again with the burn, the relay passes the command on without waiting.
            var now = Pending(world).Single();
            Reckoned.True(
                now.PredictedHeldAt == null && now.PredictedHeldUntilUt == null,
                "the command is still predicted to wait at " + now.PredictedHeldAt + " until " + now.PredictedHeldUntilUt + ", by the plan from before the relay's burn was heard");
            Reckoned.True(
                now.PredictedArrivalUt != null && Math.Abs(now.PredictedArrivalUt.Value - sent.PredictedArrivalUt!.Value) > 1.0,
                "the arrival still reads as predicted before the burn: " + now.PredictedArrivalUt);
            Reckoned.True(
                now.PredictedReplyUt != null && now.PredictedReplyUt > now.PredictedArrivalUt,
                "the reply is not predicted after the arrival planned again: " + now.PredictedReplyUt);
        }

        [Fact]
        public async Task APlanThatHasNotChangedLeavesThePredictionAsItWasSent()
        {
            var (world, sent) = await HeldAtTheRelayAsync();
            await using var _ = world;

            for (var ut = 1010.0; ut <= 1620.0; ut += 10.0)
            {
                world.Tick(ut);
            }

            var now = Pending(world).Single();
            Assert.Equal(sent.PredictedHeldAt, now.PredictedHeldAt);
            Assert.Equal(sent.PredictedHeldUntilUt!.Value, now.PredictedHeldUntilUt!.Value, 6);
            Assert.Equal(sent.PredictedArrivalUt!.Value, now.PredictedArrivalUt!.Value, 6);
            Assert.Equal(sent.PredictedReplyUt!.Value, now.PredictedReplyUt!.Value, 6);
            Assert.Equal(sent.CancelDeadlineUt!.Value, now.CancelDeadlineUt!.Value, 6);
        }
    }
}
