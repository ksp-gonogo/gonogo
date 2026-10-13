using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Readings still on their way when the delay is shortened or switched off:
    /// each is delivered sooner, in the order recorded, as the sample it was. A
    /// reading that never left for want of a path is not delivered by that.
    /// </summary>
    public class CourierBringForwardDeliveriesTests
    {
        private static (ManualClock Clock, Courier Courier, StubNetwork Network, List<StreamData> Got) NewCourier(double delay)
        {
            var clock = new ManualClock(0);
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", delay);
            var courier = new Courier(clock, network);
            var got = new List<StreamData>();
            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            got.Clear();
            return (clock, courier, network, got);
        }

        [Theory]
        [InlineData(Delivery.LossyLatest)]
        [InlineData(Delivery.ReliableOrdered)]
        public void SwitchingDelayOffDeliversEveryReadingOnItsWayAtOnceInTheOrderRecorded(Delivery lane)
        {
            var (clock, courier, _, got) = NewCourier(90);
            courier.Record("vessel", "alt", 100.0, 0, lane);
            courier.Record("vessel", "alt", 200.0, 10, lane);
            clock.AdvanceTo(30);
            Assert.Empty(got);

            courier.BringForwardDeliveries(0.0, 30);
            clock.AdvanceTo(30);

            Assert.Equal(new object?[] { 100.0, 200.0 }, got.Select(g => g.Payload));
            Assert.All(got, g => Assert.Equal(30.0, g.Meta.DeliveredAt));
            Assert.Equal(new[] { 0.0, 10.0 }, got.Select(g => g.Meta.ValidAt));
            clock.AdvanceTo(200);
            Assert.Equal(2, got.Count);
        }

        [Fact]
        public void RaisingLightSpeedScalesWhatIsLeftOfEachReadingAndKeepsTheOrder()
        {
            var (clock, courier, _, got) = NewCourier(90);
            courier.Record("vessel", "alt", 100.0, 0);
            courier.Record("vessel", "alt", 200.0, 10);
            clock.AdvanceTo(30);

            // 60 and 70 seconds left; at half the delay, 30 and 35.
            courier.BringForwardDeliveries(0.5, 30);
            clock.AdvanceTo(59.9);
            Assert.Empty(got);
            clock.AdvanceTo(60);
            Assert.Equal(new object?[] { 100.0 }, got.Select(g => g.Payload));
            clock.AdvanceTo(65);
            Assert.Equal(new object?[] { 100.0, 200.0 }, got.Select(g => g.Payload));
        }

        [Fact]
        public void AGrowingDelayLeavesReadingsOnTheirWayAsTheyWere()
        {
            var (clock, courier, _, got) = NewCourier(90);
            courier.Record("vessel", "alt", 100.0, 0);
            clock.AdvanceTo(30);

            courier.BringForwardDeliveries(2.0, 30);
            clock.AdvanceTo(89.9);
            Assert.Empty(got);
            clock.AdvanceTo(90);

            Assert.Single(got);
        }

        [Fact]
        public void AReadingThatHadNoPathWhenItWasRecordedIsNotDeliveredWhenTheDelayIsSwitchedOff()
        {
            var (clock, courier, network, got) = NewCourier(90);
            network.SetDelay("KSC", "vessel", double.PositiveInfinity);
            courier.Record("vessel", "alt", 100.0, 0);
            clock.AdvanceTo(30);

            courier.BringForwardDeliveries(0.0, 30);
            clock.AdvanceTo(60);

            Assert.Empty(got);
        }

        private static (ManualClock Clock, Courier Courier, List<StreamData> Got) NewCourierWithTwoReadingsOnTheirWay()
        {
            var clock = new ManualClock(0);
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 90);
            var courier = new Courier(clock, network);
            courier.Record("vessel", "alt", 100.0, 0);
            courier.Record("vessel", "alt", 200.0, 10);
            return (clock, courier, new List<StreamData>());
        }

        private static void Tick(ManualClock clock, double from, double to)
        {
            for (var ut = from + 1; ut <= to; ut++)
            {
                clock.AdvanceTo(ut);
            }
        }

        [Fact]
        public void AScreenOpenedAfterTheDelayWasSwitchedOffIsNotOwedReadingsAtTheirOldTimes()
        {
            var (clock, courier, got) = NewCourierWithTwoReadingsOnTheirWay();
            Tick(clock, 0, 30);
            courier.BringForwardDeliveries(0.0, 30);
            Tick(clock, 30, 40);

            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            Tick(clock, 40, 200);

            // What it heard at the switch, and nothing at 90 or 100.
            Assert.Equal(new object?[] { 200.0 }, got.Select(g => g.Payload));
            Assert.Equal(40.0, got.Single().Meta.DeliveredAt);
        }

        [Fact]
        public void AScreenOpenedAfterLightSpeedWasRaisedIsOwedReadingsAtTheScaledTimes()
        {
            var (clock, courier, got) = NewCourierWithTwoReadingsOnTheirWay();
            Tick(clock, 0, 30);
            courier.BringForwardDeliveries(0.5, 30);
            Tick(clock, 30, 40);

            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            got.Clear();
            Tick(clock, 40, 59);
            Assert.Empty(got);
            Tick(clock, 59, 60);
            Assert.Equal(new object?[] { 100.0 }, got.Select(g => g.Payload));
            Tick(clock, 60, 64);
            Assert.Single(got);
            Tick(clock, 64, 65);
            Assert.Equal(new object?[] { 100.0, 200.0 }, got.Select(g => g.Payload));
            Assert.Equal(new[] { 60.0, 65.0 }, got.Select(g => g.Meta.DeliveredAt));
            Tick(clock, 65, 200);
            Assert.Equal(2, got.Count);
        }

        [Fact]
        public void AScreenOpenedAfterTwoChangesBeforeTheFirstSetDrainedIsOwedThemScaledByBoth()
        {
            var (clock, courier, got) = NewCourierWithTwoReadingsOnTheirWay();
            Tick(clock, 0, 30);
            courier.BringForwardDeliveries(0.5, 30);
            Tick(clock, 30, 40);
            courier.BringForwardDeliveries(0.5, 40);
            Tick(clock, 40, 45);

            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            got.Clear();
            Tick(clock, 45, 49);
            Assert.Empty(got);
            Tick(clock, 49, 50);
            Assert.Equal(new object?[] { 100.0 }, got.Select(g => g.Payload));
            Tick(clock, 50, 52);
            Assert.Single(got);
            clock.AdvanceTo(52.5);
            Assert.Equal(new object?[] { 100.0, 200.0 }, got.Select(g => g.Payload));
            Tick(clock, 53, 200);
            Assert.Equal(2, got.Count);
        }

        [Fact]
        public void AChangeThenALaterSwitchOffLeavesALateScreenNothingOwed()
        {
            var (clock, courier, got) = NewCourierWithTwoReadingsOnTheirWay();
            Tick(clock, 0, 30);
            courier.BringForwardDeliveries(0.5, 30);
            Tick(clock, 30, 40);
            courier.BringForwardDeliveries(0.0, 40);
            Tick(clock, 40, 45);

            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            var heardOnJoining = got.Count;
            Tick(clock, 45, 200);

            Assert.Equal(heardOnJoining, got.Count);
        }

        [Fact]
        public void AReadingTakenAfterTheChangeIsNotScaledForALateScreen()
        {
            var clock = new ManualClock(0);
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 90);
            var courier = new Courier(clock, network);
            Tick(clock, 0, 30);
            courier.BringForwardDeliveries(0.0, 30);
            network.SetDelay("KSC", "vessel", 20);
            courier.Record("vessel", "alt", 300.0, 31);
            Tick(clock, 31, 35);

            var got = new List<StreamData>();
            courier.SubscribeStream("vessel", "alt", "KSC", got.Add);
            got.Clear();
            Tick(clock, 35, 50);
            Assert.Empty(got);
            Tick(clock, 50, 51);
            Assert.Equal(new object?[] { 300.0 }, got.Select(g => g.Payload));
        }
    }
}
