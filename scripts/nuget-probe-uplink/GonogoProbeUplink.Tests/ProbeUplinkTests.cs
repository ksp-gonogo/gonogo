using System.Collections.Generic;
using GonogoProbeUplink;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Core;
using Xunit;

namespace GonogoProbeUplink.Tests
{
    public class ProbeUplinkTests
    {
        [Fact]
        public void DeclaresTheClockAsADelayedChannel()
        {
            var channel = Assert.Single(new ProbeUplink(() => null).Manifest.Channels);

            Assert.Equal(ProbeUplink.ClockTopic, channel.Topic);
            Assert.Equal(DelayRole.Delayed, channel.Delay);
        }

        [Fact]
        public void RegisteringTakesThePublisherForItsOwnChannel()
        {
            var host = new ClockedUplinkHost(nowUt: 100);

            new ProbeUplink(() => null).Register(host);

            Assert.Equal(new[] { ProbeUplink.ClockTopic }, host.PublishersTaken);
        }

        [Fact]
        public void EveryWirePropertyDeclaresItsUnit()
        {
            var contract = typeof(ProbeClock).Assembly;

            UnitCoverageAssertion.AssertContractTypesAreExactly(contract, nameof(ProbeClock));
            UnitCoverageAssertion.AssertExhaustive(contract, "Units.UniversalTime");
        }

        [Fact]
        public void ACaptureWithNoUtPublishesNothing()
        {
            var host = new ClockedUplinkHost(nowUt: 100);
            var uplink = new ProbeUplink(() => null);
            uplink.Register(host);

            uplink.Handle(null);

            Assert.Empty(host.Published);
        }

        [Fact]
        public void APublishedReadingReachesAViewerOnlyOnceTheSignalDelayHasPassed()
        {
            var host = new ClockedUplinkHost(nowUt: 100);
            var uplink = new ProbeUplink(() => 100.0);
            uplink.Register(host);
            uplink.Handle(100.0);
            var sample = Assert.Single(host.Published);

            var clock = new ManualClock(startUt: 100);
            var courier = new Courier(clock, new StubNetwork(delay: 5));
            var channel = Assert.Single(uplink.Manifest.Channels);
            courier.Record("vessel-1", sample.Topic, sample.Value, validAtUt: sample.Ut, delivery: channel.Delivery);
            var received = new List<object?>();
            courier.SubscribeStream("vessel-1", sample.Topic, "mission-control", data => received.Add(data.Payload));

            Assert.Empty(received);
            clock.AdvanceTo(105);
            Assert.Same(sample.Value, Assert.Single(received));
        }
    }
}
