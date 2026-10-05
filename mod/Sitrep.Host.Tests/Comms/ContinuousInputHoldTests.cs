using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class ContinuousInputHoldTests
    {
        [Fact]
        public void ARouteThatLeavesEachNodeAsItArrivesHasNoHold()
        {
            var route = new[] { new PlannedHop("vessel:relay", 100.0, 110.0), new PlannedHop("vessel:probe", 110.0, 125.0) };

            Assert.Null(ContinuousInput.FirstHold(route, "ground:ksc", 100.0));
        }

        [Fact]
        public void AWaitAtTheSenderIsAHoldThere()
        {
            var route = new[] { new PlannedHop("vessel:probe", 400.0, 410.0) };

            var hold = ContinuousInput.FirstHold(route, "ground:ksc", 100.0)!.Value;

            Assert.Equal("ground:ksc", hold.At);
            Assert.Equal(100.0, hold.ArrivesUt);
        }

        [Fact]
        public void AWaitAtARelayIsAHoldThereFromWhenTheInputReachesIt()
        {
            var route = new[] { new PlannedHop("vessel:relay", 100.0, 110.0), new PlannedHop("vessel:probe", 900.0, 915.0) };

            var hold = ContinuousInput.FirstHold(route, "ground:ksc", 100.0)!.Value;

            Assert.Equal("vessel:relay", hold.At);
            Assert.Equal(110.0, hold.ArrivesUt);
        }

        /// <summary>A relay turning a dish to send the input on takes a second or so, which is not a hold.</summary>
        [Fact]
        public void AWaitNoLongerThanADishTakesToTurnIsNotAHold()
        {
            var turning = new[] { new PlannedHop("vessel:relay", 100.0, 110.0), new PlannedHop("vessel:probe", 111.9, 126.9) };
            var waiting = new[] { new PlannedHop("vessel:relay", 100.0, 110.0), new PlannedHop("vessel:probe", 112.1, 127.1) };

            Assert.Null(ContinuousInput.FirstHold(turning, "ground:ksc", 100.0));
            Assert.Equal("vessel:relay", ContinuousInput.FirstHold(waiting, "ground:ksc", 100.0)!.Value.At);
        }

        [Fact]
        public void NoRouteAtAllWaitsAtTheSender()
        {
            Assert.Equal("ground:ksc", ContinuousInput.FirstHold(null, "ground:ksc", 100.0)!.Value.At);
            Assert.Equal("ground:ksc", ContinuousInput.FirstHold(new PlannedHop[0], "ground:ksc", 100.0)!.Value.At);
        }
    }
}
