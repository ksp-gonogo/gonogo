using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;
using Sitrep.Core;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-only tests (no TS reference) for the server-stampable half of the
    /// M2 staleness model (<c>local_docs/telemetry-mod/m2-sdk-delay-design.md</c>
    /// §4.3): <see cref="Meta.Staleness"/> is <see cref="Staleness.Fresh"/>
    /// on every LIVE delivery unconditionally, and on a CATCH-UP delivery
    /// (the synchronous serve inside <see cref="Courier.SubscribeStream"/>)
    /// UNLESS <see cref="Courier.MarkLinkDown"/> has recorded the link to
    /// this (node, vantage) as down -- the seam a future M3 comms-capability
    /// provider drives (not yet built; this milestone only wires the
    /// mechanism/plumbing, per the task's scope).
    /// </summary>
    public class CourierCatchUpStalenessTests
    {
        [Fact]
        public void CatchUpIsFreshByDefaultEvenThoughItIsAnArchivedNotLiveSample()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "MissionControl", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal(Staleness.Fresh, lateJoiner[0].Meta.Staleness);
        }

        [Fact]
        public void LiveScheduledDeliveryIsAlwaysFreshRegardlessOfLinkState()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "KSC", delivered.Add);
            courier.MarkLinkDown("system", "KSC", sinceUt: 0);

            // A record delivered AFTER subscribe (the live path, not the
            // synchronous subscribe-time catch-up) must stay Fresh -- the
            // staleness override is scoped strictly to the ONE catch-up
            // delivery, per the design's "only on catch-up serves" rule.
            courier.Record("system", "bodies", "v-live", 5);
            clock.AdvanceTo(5);

            Assert.Single(delivered);
            Assert.Equal(Staleness.Fresh, delivered[0].Meta.Staleness);
        }

        [Fact]
        public void CatchUpServedWhileLinkIsMarkedDownIsStampedLastBeforeBlackoutWhenTheSampleIsFromBeforeTheBlackout()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "before-blackout", 0);
            clock.AdvanceTo(10);

            // The link to "MissionControl" has been down since UT 5 -- the
            // served sample (ValidAt 0) predates that, so it's honestly
            // "the last thing that got out before the blackout".
            courier.MarkLinkDown("system", "MissionControl", sinceUt: 5);

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "MissionControl", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal("before-blackout", lateJoiner[0].Payload);
            Assert.Equal(Staleness.LastBeforeBlackout, lateJoiner[0].Meta.Staleness);
        }

        [Fact]
        public void CatchUpServedWhileLinkIsMarkedDownIsHeldStaleWhenTheServedSampleIsAfterTheKnownBlackoutStart()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "after-marked-down", 10);
            clock.AdvanceTo(10);

            // Defensive case: the link is marked down since UT 5, but the
            // served sample's ValidAt (10) is AFTER that -- shouldn't
            // normally happen if the link genuinely dropped every delivery,
            // but the resolver still produces an honest (non-Fresh) answer
            // rather than silently claiming Fresh.
            courier.MarkLinkDown("system", "MissionControl", sinceUt: 5);

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "MissionControl", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal(Staleness.HeldStale, lateJoiner[0].Meta.Staleness);
        }

        [Fact]
        public void MarkLinkUpRestoresFreshCatchUpBehavior()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);

            courier.MarkLinkDown("system", "MissionControl", sinceUt: 0);
            courier.MarkLinkUp("system", "MissionControl");

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "MissionControl", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal(Staleness.Fresh, lateJoiner[0].Meta.Staleness);
        }

        [Fact]
        public void LinkDownIsScopedPerVantageNotGlobalToTheNode()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);

            courier.MarkLinkDown("system", "StationA", sinceUt: 0);

            var stationA = new List<StreamData>();
            var stationB = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "StationA", stationA.Add);
            courier.SubscribeStream("system", "bodies", "StationB", stationB.Add);

            Assert.Equal(Staleness.LastBeforeBlackout, stationA[0].Meta.Staleness);
            Assert.Equal(Staleness.Fresh, stationB[0].Meta.Staleness);
        }
    }
}
