using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;
using Sitrep.Core;

// See Sitrep.Core/Courier.cs for why this alias exists.
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-only tests (no TS reference -- <see cref="Meta.TimelineEpoch"/> and
    /// <see cref="Courier.ResetTimeline"/> are both C#-only additions) for
    /// the M2 finding from <c>local_docs/telemetry-mod/m2-sdk-delay-design.md</c>
    /// §7.6/§10.1: every envelope <see cref="Meta"/> carries the timeline
    /// generation it was recorded/confirmed under, incremented once per
    /// quickload rewind, so a client can tell a rewind apart from a normal
    /// delayed delivery atomically instead of re-deriving it from a
    /// backward <c>validAt</c> jump (which a reordered/coalesced delivery
    /// could mask).
    /// </summary>
    public class CourierTimelineEpochTests
    {
        [Fact]
        public void EveryDeliveredSampleStartsAtEpochZero()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "KSC", delivered.Add);

            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);

            Assert.Single(delivered);
            Assert.Equal(0, delivered[0].Meta.TimelineEpoch);
            Assert.Equal(0, courier.CurrentEpoch);
        }

        [Fact]
        public void ResetTimelineIncrementsCurrentEpochAndStampsItOnEverySubsequentDelivery()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "KSC", delivered.Add);

            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);
            Assert.Equal(0, delivered[0].Meta.TimelineEpoch);

            courier.ResetTimeline(0);
            Assert.Equal(1, courier.CurrentEpoch);

            courier.Record("system", "bodies", "v-after-reset", 0);
            clock.AdvanceTo(0);

            Assert.Equal(2, delivered.Count);
            Assert.Equal(1, delivered[1].Meta.TimelineEpoch);
        }

        /// <summary>
        /// The exact scenario named in the M2 task: 3 quickload rewinds must
        /// produce 4 DISTINCT epochs across delivered samples (0, then 1/2/3
        /// after each reset) -- proving the counter genuinely increments per
        /// rewind rather than saturating or resetting itself.
        /// </summary>
        [Fact]
        public void ThreeRewindsProduceFourDistinctEpochsAcrossDeliveredSamples()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "KSC", delivered.Add);

            courier.Record("system", "bodies", "epoch0", 0);
            clock.AdvanceTo(0);

            courier.ResetTimeline(0); // -> epoch 1
            courier.Record("system", "bodies", "epoch1", 0);
            clock.AdvanceTo(0);

            courier.ResetTimeline(0); // -> epoch 2
            courier.Record("system", "bodies", "epoch2", 0);
            clock.AdvanceTo(0);

            courier.ResetTimeline(0); // -> epoch 3
            courier.Record("system", "bodies", "epoch3", 0);
            clock.AdvanceTo(0);

            Assert.Equal(3, courier.CurrentEpoch); // sanity: CurrentEpoch itself is 3 after 3 resets
            var epochsSeen = new HashSet<int>();
            foreach (var sample in delivered)
            {
                epochsSeen.Add(sample.Meta.TimelineEpoch);
            }
            Assert.Equal(new HashSet<int> { 0, 1, 2, 3 }, epochsSeen);
        }

        /// <summary>
        /// A sample recorded BEFORE a rewind, but only surfaced to a
        /// LATE-JOINING catch-up subscriber AFTER the rewind, must still
        /// report the epoch it was actually recorded under (0), not
        /// whatever epoch is current at catch-up-serve time (1) -- proving
        /// the epoch rides the ARCHIVED point (Archive.Record's epoch
        /// parameter), not just the live delivery path.
        /// </summary>
        [Fact]
        public void ArchivedSampleFromBeforeARewindKeepsItsOriginalEpochOnLateCatchUp()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            // Recorded at epoch 0, predates the rewind below and survives it
            // (ResetTimeline only prunes samples with ValidAt > the rewind
            // target -- this one is well before it).
            courier.Record("system", "bodies", "pre-rewind", 0);
            clock.AdvanceTo(0);

            courier.ResetTimeline(0); // -> epoch 1, no samples pruned (nothing above ValidAt 0)

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "bodies", "MissionControl", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal("pre-rewind", lateJoiner[0].Payload);
            Assert.Equal(0, lateJoiner[0].Meta.TimelineEpoch);
            Assert.Equal(1, courier.CurrentEpoch);
        }

        [Fact]
        public void CommandResponsesAlsoCarryTheCurrentEpoch()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node) => "ok");

            Sitrep.Contract.CommandResponse<object?>? response = null;
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", r => response = r);
            clock.AdvanceTo(0);

            Assert.NotNull(response);
            Assert.Equal(0, response!.Meta.TimelineEpoch);

            courier.ResetTimeline(0);

            Sitrep.Contract.CommandResponse<object?>? response2 = null;
            courier.DispatchCommand("vessel", "r2", "deploy", null, "KSC", r => response2 = r);
            clock.AdvanceTo(0);

            Assert.NotNull(response2);
            Assert.Equal(1, response2!.Meta.TimelineEpoch);
        }
    }
}
