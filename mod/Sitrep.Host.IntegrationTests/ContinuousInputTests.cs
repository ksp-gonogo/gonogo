using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A continuous input, a throttle or a control axis, is refused when the
    /// sending centre's own plan says it would wait on its way: held and sent on
    /// later it would arrive as a run of stale values. A discrete command over
    /// the same route is held and forwarded.
    ///
    /// <para>The relay starts below the home station's horizon and, by the
    /// plan's geometry, rises into its sight at about UT 1500.</para>
    /// </summary>
    public class ContinuousInputTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.Relay;

        /// <summary>84.5 degrees behind the home station's meridian: six degrees below its horizon, closing at a quarter of a degree a minute.</summary>
        private const double BelowTheHorizon = -84.487 * Math.PI / 180.0;

        private static async Task<ReckonedVantageWorld> RisingAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame(BelowTheHorizon));
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            Assert.True(world.Home.PlansPair(Home, Relay), "the home centre should have the relay in its plan by now");
            Assert.False(world.Home.PlansContactAt(Home, Relay, 1000.0), "the relay should be below the home station's horizon at 1000");
            Assert.True(world.Home.PlansContactAt(Home, Relay, 1600.0), "the relay should have risen by 1600");
            return world;
        }

        private static (FaultCode? Code, string? Reason, double? Accepted) Throttle(ReckonedVantageWorld world)
        {
            FaultCode? code = null;
            string? reason = null;
            double? accepted = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.ThrottleCommand,
                new Dictionary<string, object?> { ["value"] = 0.65 },
                Home,
                _ => { },
                TestBudgets.Op,
                onRefused: (c, r) =>
                {
                    code = c;
                    reason = r;
                },
                onAccepted: seconds => accepted = seconds);
            return (code, reason, accepted);
        }

        [Fact]
        public async Task AContinuousWriteIsRefusedWhenTheCentresPlanSaysItWouldWait()
        {
            await using var world = await RisingAsync();

            var (code, reason, accepted) = Throttle(world);

            Assert.Equal(FaultCode.ContinuousInputWouldWait, code);
            Assert.Contains("wait at " + Home, reason);
            Assert.Contains("pilot", reason);
            Assert.Contains("automation", reason);
            Assert.Null(accepted);
            Assert.Empty(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            world.Tick(3000.0);
            Assert.Equal(0, world.Uplink.ThrottledCount);
        }

        /// <summary>
        /// The relay's real link has nothing to do with it: the plan says the way
        /// is shut, so the write is refused though the link is up, and the refusal
        /// tells the operator nothing the centre had not heard.
        /// </summary>
        [Fact]
        public async Task TheRefusalIsTheSameWhateverTheRelaysLinkIsReallyDoing()
        {
            await using var linked = await RisingAsync();
            await using var dark = await RisingAsync();
            dark.Game.RelayConnected = false;
            dark.Tick(1001.0);
            linked.Tick(1001.0);

            var whenLinked = Throttle(linked);
            var whenDark = Throttle(dark);

            Assert.Equal(FaultCode.ContinuousInputWouldWait, whenLinked.Code);
            Assert.Equal(whenLinked.Code, whenDark.Code);
            Assert.Equal(whenLinked.Reason, whenDark.Reason);
        }

        [Fact]
        public async Task AContinuousWriteGoesAsItAlwaysDidWhenTheCentresPlanSaysTheWayIsLive()
        {
            await using var world = await RisingAsync();
            world.Tick(1600.0);

            var (code, _, accepted) = Throttle(world);

            Assert.Null(code);
            Assert.Equal(world.Game.RelayFromHomeSeconds, accepted);
            world.Tick(1600.0 + world.Game.RelayFromHomeSeconds - 1.0);
            Assert.Equal(0, world.Uplink.ThrottledCount);
            world.Tick(1600.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.ThrottledCount);
        }

        [Fact]
        public async Task ADiscreteCommandOverTheSameRouteIsHeldAndForwarded()
        {
            await using var world = await RisingAsync();

            double? accepted = null;
            object? result = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", Home, r => result = r, TestBudgets.Op, onAccepted: seconds => accepted = seconds);

            Assert.NotNull(accepted);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(Home, entry.PredictedHeldAt);
            Assert.InRange(entry.PredictedHeldUntilUt!.Value, 1400.0, 1600.0);
            var held = Assert.Single(world.Engine.JourneyAt(Home).Events);
            Assert.Equal(JourneyEventKind.Held, held.Kind);
            Assert.Equal(Home, held.At);

            var leaves = entry.PredictedHeldUntilUt.Value;
            world.Tick(leaves - 1.0);
            Assert.DoesNotContain(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Departed);
            world.Tick(leaves + 1.0);
            Assert.Contains(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Departed);
            Assert.Equal(0, world.Uplink.HandledCount);

            world.Tick(leaves + 1.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.HandledCount);
            world.Tick(leaves + 1.0 + (2.0 * world.Game.RelayFromHomeSeconds) + 2.0);
            Assert.NotNull(result);
            Assert.Contains(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Ran);
        }
    }
}
