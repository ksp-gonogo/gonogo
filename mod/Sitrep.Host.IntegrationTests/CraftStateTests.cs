using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft's state is recorded on its own node, so each command centre
    /// hears of a change one of its own light-times after it happened: the home
    /// centre ten light-minutes from the relay, the far centre five.
    /// </summary>
    public class CraftStateTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.RelayGuid;

        [Fact]
        public async Task EachCentreHearsOfACraftAtItsOwnLightTime()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();

            Ticks(world, 1, 299);
            Assert.Null(world.Uplink.Heard(Far, Relay));

            Ticks(world, 300, 599);
            Assert.Equal(0.0, world.Uplink.Heard(Far, Relay)!.CapturedUt);
            Assert.Null(world.Uplink.Heard(Home, Relay));

            Ticks(world, 600);
            Assert.Equal(0.0, world.Uplink.Heard(Home, Relay)!.CapturedUt);
        }

        [Fact]
        public async Task ABurnIsHeardAtEachCentreOneLightTimeAfterItHappened()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.BurnRelay(1000);
            Ticks(world, 1000, 1299);
            Assert.Equal(0.0, world.Uplink.Heard(Far, Relay)!.Orbit!.Value.Ecc);

            Ticks(world, 1300, 1599);
            Assert.Equal(0.3, world.Uplink.Heard(Far, Relay)!.Orbit!.Value.Ecc);
            Assert.Equal(0.0, world.Uplink.Heard(Home, Relay)!.Orbit!.Value.Ecc);

            Ticks(world, 1600);
            Assert.Equal(0.3, world.Uplink.Heard(Home, Relay)!.Orbit!.Value.Ecc);
        }

        [Fact]
        public async Task ABurnMadeOutOfContactIsHeardOnlyOnceTheRecordingIsDumpedAndHasCrossed()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.RelayConnected = false;
            Ticks(world, 1000);
            world.Game.BurnRelay(1100);
            Ticks(world, 1100, 1999);
            Assert.Equal(0.0, world.Uplink.Heard(Home, Relay)!.Orbit!.Value.Ecc);

            // The engine dates a reacquisition to the tick before the one that
            // reports it, so the dump left at 1999.
            world.Game.RelayConnected = true;
            Ticks(world, 2000, 2598);
            Assert.Equal(0.0, world.Uplink.Heard(Home, Relay)!.Orbit!.Value.Ecc);

            Ticks(world, 2600);
            Assert.Equal(0.3, world.Uplink.Heard(Home, Relay)!.Orbit!.Value.Ecc);
        }

        /// <summary>
        /// A craft that is gone takes its delay rows with it on the same tick, so
        /// its going is sent under the light-times it was last measured at.
        /// </summary>
        [Fact]
        public async Task ADestroyedCraftsGoingReachesEachCentreWhenItsSilenceWould()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.DestroyRelay();
            Ticks(world, 1000, 1299);
            Assert.True(world.Uplink.Heard(Far, Relay)!.Exists);

            Ticks(world, 1300, 1599);
            Assert.False(world.Uplink.Heard(Far, Relay)!.Exists);
            Assert.True(world.Uplink.Heard(Home, Relay)!.Exists);

            Ticks(world, 1600);
            Assert.False(world.Uplink.Heard(Home, Relay)!.Exists);
        }

        [Fact]
        public async Task ACraftDestroyedWhileOutOfContactSaysNothing()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.RelayConnected = false;
            Ticks(world, 900);
            world.Game.DestroyRelay();
            Ticks(world, 1000, 2000, 5000);

            Assert.True(world.Uplink.Heard(Home, Relay)!.Exists);
            Assert.True(world.Uplink.Heard(Far, Relay)!.Exists);
        }

        /// <summary>
        /// A rewind drops what was recorded ahead of it, so every craft is read
        /// again: on the tick that rewound, and once more on the next, when the
        /// reset has been seen.
        /// </summary>
        [Fact]
        public async Task ARewoundTimelineHasEveryCraftReadAgain()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700, 1000);

            Ticks(world, 400, 401, 999);
            Assert.Equal(0.0, world.Uplink.Heard(Home, Relay)!.CapturedUt);

            Ticks(world, 1000);
            Assert.Equal(400.0, world.Uplink.Heard(Home, Relay)!.CapturedUt);

            Ticks(world, 1001);
            Assert.Equal(401.0, world.Uplink.Heard(Home, Relay)!.CapturedUt);
        }

        [Fact]
        public async Task NoClientCanSubscribeToACraftState()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            await using var client = await TestClient.ConnectAsync(world.Engine.BoundPort, TestBudgets.Op);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Home }));
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = ChannelEngine.CraftStateTopic(Relay) }));

            var error = await ReceiveTypedAsync<ErrorMsg>(client, TestBudgets.Op);
            Assert.Equal(FaultCode.UnknownTopic, error.Code);
            Ticks(world, 701, 702);
            await client.AssertNoMessageArrivesAsync(TestBudgets.Quiet);
            Assert.Null(world.Engine.ReadTopicAtVantage(ChannelEngine.CraftStateTopic(Relay), Home, 702));
        }

        private static void Ticks(ReckonedVantageWorld world, params double[] uts)
        {
            foreach (var ut in uts)
            {
                world.Tick(ut);
            }
        }
    }
}
