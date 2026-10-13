using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Only a command centre in a game that models a comms network has a plan
    /// to send on. Anything else is sent as it always was.
    /// </summary>
    public class ReckoningScopeTests
    {
        private const string Home = ScriptedContactGame.Home;

        /// <summary>
        /// With the comms network switched off in the save there is nothing to
        /// plan and no craft is ever heard of, so a centre that waited for its
        /// plan would wait for ever.
        /// </summary>
        [Fact]
        public async Task WithNoCommsNetworkModelledACommandGoesAtOnceThoughItsCentreHasHeardNothing()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Uplink.Inputs.SetNetworkModelled(false);
            world.Tick(10.0);

            double? accepted = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op, onAccepted: seconds => accepted = seconds);

            Assert.Equal(world.Game.RelayFromHomeSeconds, accepted);
            Assert.DoesNotContain(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Held);
            world.Tick(10.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.HandledCount);
        }

        /// <summary>The same command from the home centre, which has not heard of the relay yet, waits: that is the difference being a centre makes.</summary>
        [Fact]
        public async Task ACentreThatHasNotHeardOfTheCraftHoldsItsCommandUntilItHas()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Tick(10.0);

            var told = false;
            double? accepted = 0.0;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op,
                onAccepted: seconds =>
                {
                    told = true;
                    accepted = seconds;
                });

            // The centre knows no route, so it has no light-time to quote: absent, never zero.
            Assert.True(told);
            Assert.Null(accepted);
            var held = Assert.Single(world.Engine.JourneyAt(Home).Events);
            Assert.Equal(JourneyEventKind.Held, held.Kind);
            Assert.Equal(Home, held.At);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Equal(Home, entry.PredictedHeldAt);
            Assert.Null(entry.PredictedArrivalUt);
            Assert.Null(entry.OneWaySeconds);

            // It hears of the relay at 600, plans it, and sends.
            foreach (var ut in new[] { 599.0, 601.0, 602.0, 603.0 })
            {
                world.Tick(ut);
            }
            Assert.Contains(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Departed);
            world.Tick(603.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.HandledCount);
        }

        /// <summary>
        /// A centre holding a command because it has not yet heard of the craft
        /// hears at once when the delay is switched off: the word that was still
        /// crossing is delivered at the switch, the centre plans, and the command
        /// leaves, instead of waiting out the rest of the journey the word was on.
        /// </summary>
        [Fact]
        public async Task SwitchingDelayOffLetsACentreHearTheCraftAtOnceAndSendTheCommandItWasHolding()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Tick(10.0);
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op, onAccepted: _ => { });
            Assert.Equal(JourneyEventKind.Held, Assert.Single(world.Engine.JourneyAt(Home).Events).Kind);
            world.Tick(300.0);
            Assert.DoesNotContain(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Departed);

            world.Game.RelayFromHomeSeconds = 0.0;
            using var off = world.Engine.DelayModifiers.Register(0.0, "test: switched off");
            foreach (var ut in new[] { 301.0, 302.0, 303.0, 304.0 })
            {
                world.Tick(ut);
            }

            Assert.Contains(world.Engine.JourneyAt(Home).Events, e => e.Kind == JourneyEventKind.Departed);
            Assert.Equal(1, world.Uplink.HandledCount);
        }

        /// <summary>A vantage that is no command centre holds no plan, and its command takes the path a command always took.</summary>
        [Fact]
        public async Task ADispatchFromAVantageThatIsNoCentreIsSentAsItAlwaysWas()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Tick(10.0);

            double? accepted = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.RelayCommand, "x", "ground:Nowhere", _ => { }, TestBudgets.Op, onAccepted: seconds => accepted = seconds);

            Assert.Equal(world.Game.RelayFromHomeSeconds, accepted);
            var entry = Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending.Single();
            Assert.Null(entry.LaneSeq);
            world.Tick(10.0 + world.Game.RelayFromHomeSeconds + 1.0);
            Assert.Equal(1, world.Uplink.HandledCount);
        }
    }
}
