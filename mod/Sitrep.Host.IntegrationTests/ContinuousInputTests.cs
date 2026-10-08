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

        private static (FaultCode? Code, string? Reason, double? Accepted, string? Warning, bool Told) Throttle(ReckonedVantageWorld world)
        {
            FaultCode? code = null;
            string? reason = null;
            double? accepted = null;
            string? warning = null;
            var told = false;
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
                onAccepted: seconds =>
                {
                    told = true;
                    accepted = seconds;
                },
                onWarned: text => warning = text);
            return (code, reason, accepted, warning, told);
        }

        /// <summary>
        /// The plan says the first hop is shut, so the input would wait at the
        /// centre itself. It is accepted, with a warning that says where it
        /// would wait, and it is dropped there at once: nothing is held, nothing
        /// is sent later, and the loss names the place.
        /// </summary>
        [Fact]
        public async Task AContinuousWriteThePlanSaysWouldWaitIsAcceptedWithAWarningAndDroppedWhereItWouldWait()
        {
            await using var world = await RisingAsync();

            var (code, reason, accepted, warning, told) = Throttle(world);

            Assert.True(told, "a continuous input the plan says would wait was not accepted");
            Assert.Null(accepted);
            Assert.Contains("lost if it has to wait", warning);
            Assert.Contains("wait at Home Station", warning);
            Assert.Contains("pilot", warning);
            Assert.Contains("automation", warning);
            Assert.Equal(FaultCode.ContinuousInputWouldWait, code);
            Assert.Contains("dropped at Home Station", reason);
            Assert.Empty(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            var dropped = Assert.Single(world.Engine.JourneyAt(Home).Events);
            Assert.Equal(JourneyEventKind.Discarded, dropped.Kind);
            Assert.Equal(Home, dropped.At);
            world.Tick(3000.0);
            Assert.Equal(0, world.Uplink.ThrottledCount);
        }

        /// <summary>
        /// The home centre can reach the relay now, and the relay cannot yet see
        /// the active craft, so an axis input for that craft would wait at the
        /// relay. It is accepted with a warning and dropped at the relay when it
        /// gets there. The centre is told when a report from the relay could
        /// have come home, a round trip after the press, and no sooner.
        /// </summary>
        [Fact]
        public async Task AContinuousWriteIsDroppedAtTheRelayItWouldWaitAtAndTheCentreLearnsOfItNoSoonerThanLight()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame(35.0 * Math.PI / 180.0));
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            Assert.True(world.Home.PlansContactAt(Home, Relay, 1000.0), "the relay should be in the home station's sight at 1000");
            Assert.False(world.Home.PlansContactAt(Relay, ScriptedContactGame.Active, 1000.0), "the relay should not yet see the active craft at 1000");

            FaultCode? code = null;
            string? reason = null;
            string? warning = null;
            var told = false;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.AxesCommand,
                new Dictionary<string, object?> { ["pitch"] = 0.5 },
                Home,
                _ => { },
                TestBudgets.Op,
                onRefused: (c, r) =>
                {
                    code = c;
                    reason = r;
                },
                onAccepted: _ => told = true,
                onWarned: text => warning = text);

            Assert.True(told);
            Assert.Contains("wait at Relay", warning);
            Assert.Null(code);
            Assert.Empty(world.Engine.JourneyAt(Home).Events);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(Relay, entry.PredictedHeldAt);
            Assert.Null(entry.OneWaySeconds);
            var known = entry.PredictedReplyUt!.Value;
            var light = (known - 1000.0) / 2.0;
            Assert.InRange(light, 0.9 * world.Game.RelayFromHomeSeconds, 1.1 * world.Game.RelayFromHomeSeconds);

            world.Tick(1000.0 + light + 5.0);
            Assert.Null(code);
            world.Tick(known - 5.0);
            Assert.Null(code);
            Assert.Empty(world.Engine.JourneyAt(Home).Events);

            world.Tick(known + 5.0);
            Assert.Equal(FaultCode.ContinuousInputWouldWait, code);
            Assert.Contains("dropped at Relay", reason);
            var dropped = Assert.Single(world.Engine.JourneyAt(Home).Events);
            Assert.Equal(JourneyEventKind.Discarded, dropped.Kind);
            Assert.Equal(Relay, dropped.At);
            Assert.Equal(1000.0 + light, dropped.AtUt, 6);
            Assert.Empty(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(0, world.Uplink.SteeredCount);
        }

        /// <summary>
        /// The lights are a switch on a control channel, not a continuous input.
        /// With the plan saying the way would wait, the press is accepted, held
        /// at the centre and sent on when the window opens, where a throttle at
        /// the same instant is dropped.
        /// </summary>
        [Fact]
        public async Task ASwitchOnAControlChannelIsHeldAndForwardedWhereAThrottleIsDropped()
        {
            await using var world = await RisingAsync();

            FaultCode? code = null;
            double? accepted = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.LightsCommand,
                new Dictionary<string, object?> { ["enabled"] = true },
                Home,
                _ => { },
                TestBudgets.Op,
                onRefused: (c, _) => code = c,
                onAccepted: seconds => accepted = seconds);

            Assert.Null(code);
            Assert.NotNull(accepted);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(ScriptedContactUplink.LightsCommand, entry.Command);
            Assert.Equal(Home, entry.PredictedHeldAt);
            Assert.Equal(1.0, entry.CommandedValue);
            Assert.NotNull(entry.LaneSeq);
            Assert.Equal(0, world.Uplink.LitCount);
            Assert.Equal(FaultCode.ContinuousInputWouldWait, Throttle(world).Code);

            world.Tick(entry.PredictedHeldUntilUt!.Value + 1.0);
            world.Tick(entry.PredictedArrivalUt!.Value + 5.0);
            Assert.Equal(1, world.Uplink.LitCount);
        }

        /// <summary>
        /// Sent together with a switch, a throttle is part of one message the
        /// operator chose to keep whole, so it is held and forwarded with it
        /// where the same throttle sent alone is dropped.
        /// </summary>
        [Fact]
        public async Task AThrottleSentInAGroupIsHeldAndRunsWithTheRestWhereAloneItWouldBeDropped()
        {
            await using var world = await RisingAsync();
            Assert.Equal(FaultCode.ContinuousInputWouldWait, Throttle(world).Code);

            FaultCode? refused = null;
            world.Engine.DispatchGroupAndWait(
                Home,
                new[]
                {
                    new ChannelEngine.GroupMemberDispatch
                    {
                        Command = ScriptedContactUplink.LightsCommand,
                        Args = new Dictionary<string, object?> { ["enabled"] = true },
                        ClientRequestId = "lights",
                        OnRefused = (c, _) => refused = c,
                    },
                    new ChannelEngine.GroupMemberDispatch
                    {
                        Command = ScriptedContactUplink.ThrottleCommand,
                        Args = new Dictionary<string, object?> { ["value"] = 1.0 },
                        ClientRequestId = "throttle",
                        OnRefused = (c, _) => refused = c,
                    },
                },
                TestBudgets.Op);

            Assert.Null(refused);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(new[] { "lights", "throttle" }, entry.Members);
            Assert.Equal(Home, entry.PredictedHeldAt);

            world.Tick(entry.PredictedHeldUntilUt!.Value + 1.0);
            world.Tick(entry.PredictedArrivalUt!.Value + 5.0);
            Assert.Equal(1, world.Uplink.LitCount);
            Assert.Equal(1, world.Uplink.ThrottledCount);
        }

        [Fact]
        public async Task TheFlyByWireAxesAreAContinuousInputAndAreDroppedAcrossAHold()
        {
            await using var world = await RisingAsync();

            FaultCode? code = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.AxesCommand,
                new Dictionary<string, object?> { ["pitch"] = 0.5 },
                Home,
                _ => { },
                TestBudgets.Op,
                onRefused: (c, _) => code = c);

            Assert.Equal(FaultCode.ContinuousInputWouldWait, code);
            world.Tick(3000.0);
            Assert.Equal(0, world.Uplink.SteeredCount);
        }

        /// <summary>
        /// The relay's real link has nothing to do with it: the plan says the way
        /// is shut, so the write is dropped though the link is up, and what the
        /// operator is told is nothing the centre had not heard.
        /// </summary>
        [Fact]
        public async Task TheDropIsTheSameWhateverTheRelaysLinkIsReallyDoing()
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
            Assert.Equal(whenLinked.Warning, whenDark.Warning);
        }

        [Fact]
        public async Task AContinuousWriteGoesAsItAlwaysDidWhenTheCentresPlanSaysTheWayIsLive()
        {
            await using var world = await RisingAsync();
            world.Tick(1600.0);

            var (code, _, accepted, _, _) = Throttle(world);

            // The press is told the centre's own plan's light-time, which is its
            // reckoning of the geometry; the write itself crosses at the real one.
            Assert.Null(code);
            Assert.InRange(accepted!.Value, 0.9 * world.Game.RelayFromHomeSeconds, 1.1 * world.Game.RelayFromHomeSeconds);
            world.Tick(1600.0 + world.Game.RelayFromHomeSeconds - 1.0);
            Assert.Equal(0, world.Uplink.ThrottledCount);
            world.Tick(1600.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.ThrottledCount);
        }

        /// <summary>
        /// The plan says the way is live and the relay's link has just gone,
        /// which the centre has not heard. The press is accepted exactly as it
        /// is with the link up, the write is lost on the way, and nothing tells
        /// the centre so before the reply it predicted fails to come.
        /// </summary>
        [Fact]
        public async Task APressThePlanLetsThroughLooksTheSameWithTheRealLinkUpOrDownAndTheLossIsLearnedNoSoonerThanLight()
        {
            await using var linked = await RisingAsync();
            await using var dark = await RisingAsync();
            linked.Tick(1600.0);
            dark.Tick(1600.0);
            dark.Game.RelayConnected = false;
            linked.Tick(1601.0);
            dark.Tick(1601.0);

            var whenLinked = Throttle(linked);
            var whenDark = Throttle(dark);

            Assert.Null(whenLinked.Code);
            Assert.Null(whenDark.Code);
            Assert.NotNull(whenLinked.Accepted);
            Assert.Equal(whenLinked.Accepted, whenDark.Accepted);
            Assert.Equal(Shown(linked), Shown(dark));
            Assert.Single(Pending(dark));

            // Until its light could have crossed and come back, the dark press
            // reads as the linked one does.
            var oneWay = whenDark.Accepted!.Value;
            dark.Tick(1601.0 + oneWay - 1.0);
            linked.Tick(1601.0 + oneWay - 1.0);
            Assert.Equal(Shown(linked), Shown(dark));
            Assert.Single(Pending(dark));
            dark.Tick(1601.0 + (2.0 * oneWay) - 1.0);
            Assert.Single(Pending(dark));

            dark.Tick(1601.0 + (2.0 * oneWay) + 1.0);
            linked.Tick(1601.0 + (2.0 * oneWay) + 1.0);
            Assert.Empty(Pending(dark));
            Assert.Equal(0, dark.Uplink.ThrottledCount);
            Assert.Equal(1, linked.Uplink.ThrottledCount);
        }

        private static List<PendingUplink> Pending(ReckonedVantageWorld world) =>
            Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending;

        /// <summary>What the pending list shows the operator for each entry.</summary>
        private static string Shown(ReckonedVantageWorld world) =>
            string.Join(
                ";",
                Pending(world).Select(e => string.Join(
                    "|", e.Command, e.Vantage, e.DispatchedAt, e.OneWaySeconds, e.CommandedValue, e.PredictedArrivalUt, e.PredictedReplyUt, e.PredictedHeldAt)));

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
