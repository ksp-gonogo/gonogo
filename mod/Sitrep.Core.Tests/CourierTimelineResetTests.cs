using System.Linq;
using System.Collections.Generic;
using Xunit;
using Sitrep.Core;

// See Sitrep.Core/Courier.cs for why this alias exists (Courier's public API
// hard-codes Sitrep.Contract.StreamData<object?>/CommandResponse<object?>
// under the plain names below).
using StreamData = Sitrep.Contract.StreamData<object?>;
using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-side tests for <see cref="ManualClock.Reset"/> /
    /// <see cref="Courier.ResetTimeline"/> -- capabilities with no TS
    /// reference, added for the M5b final-review fix (a live quickload's
    /// backward UT tick used to wedge the courier on the abandoned
    /// pre-quickload timeline; see the doc comments on those two methods,
    /// and <c>Gonogo.KSP.GonogoBodiesServer.CourierLoop</c> /
    /// <c>Sitrep.Host.IntegrationTests.ReplayBodiesServer.CourierLoop</c> for
    /// the call sites). Unlike <see cref="ClockGoldenFixtureTests"/> /
    /// <see cref="CourierGoldenFixtureTests"/>, there is no golden fixture
    /// here -- same rationale as <see cref="CourierCommandQueueSnapshotRestoreTests"/>.
    /// The wire-level (timeline-reset event emitted, WS subscription
    /// survives) behavior is covered separately by
    /// <c>Sitrep.Host.IntegrationTests.ReplayToWebSocketEndToEndTests.ServerClockRewindResetsCourierAndResumesDeliveryWithoutStalling</c>;
    /// these tests pin the plain Sitrep.Core mechanics underneath it.
    /// </summary>
    public class CourierTimelineResetTests
    {
        [Fact]
        public void ResetClearsPendingCallbacksWithoutFiringThemAndAcceptsGoingBackward()
        {
            var clock = new ManualClock();
            var fired = new List<string>();
            clock.Schedule(10, () => fired.Add("late"));

            clock.AdvanceTo(5);
            Assert.Empty(fired); // not due yet (10 > 5)

            // Unlike AdvanceTo(2), which would no-op because 2 < 5 (the
            // current UT), Reset(2) unconditionally jumps backward.
            clock.Reset(2);
            Assert.Equal(2.0, clock.Now());

            // Advancing all the way past the original atUt=10 must NOT fire
            // the callback -- Reset dropped it, it doesn't just move it.
            clock.AdvanceTo(20);
            Assert.Empty(fired);
        }

        [Fact]
        public void ResetTimelineDropsAbandonedStreamDeliveryButKeepsSubscriptionAlive()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "system", 2);
            var courier = new Courier(clock, network);

            var delivered = new List<object?>();
            courier.SubscribeStream("system", "bodies", "KSC", data => delivered.Add(data.Payload));

            // Peak: UT 0 -> 5. "A" (fireUt=2) fires on the way; "B" (fireUt=7)
            // is left in flight, pending against the soon-to-be-abandoned
            // pre-quickload timeline.
            courier.Record("system", "bodies", "A", 0);
            clock.AdvanceTo(5);
            courier.Record("system", "bodies", "B", 5);
            Assert.Equal(new List<object?> { "A" }, delivered);

            // THE QUICKLOAD: backward to UT 1.
            courier.ResetTimeline(1);
            Assert.Equal(1.0, clock.Now());

            // Resume on the new timeline: "C" recorded at UT 1 delivers at
            // fireUt=3.
            courier.Record("system", "bodies", "C", 1);
            clock.AdvanceTo(3);
            Assert.Equal(new List<object?> { "A", "C" }, delivered);

            // Push well past "B"'s original fireUt=7: if ResetTimeline had
            // not dropped it, AdvanceTo(9) would fire it here. It must not --
            // proving the abandoned delivery was truly dropped, not merely
            // delayed. The subscription itself is untouched throughout: "C"
            // above arrived on the SAME SubscribeStream call from the top of
            // this test, with no re-subscribe.
            clock.AdvanceTo(9);
            Assert.Equal(new List<object?> { "A", "C" }, delivered);
        }

        /// <summary>
        /// CRITICAL-1 (concurrency red-team + task-review, probe-verified):
        /// <see cref="ResetTimelineDropsAbandonedStreamDeliveryButKeepsSubscriptionAlive"/>
        /// above passes even pre-fix because its rewind happens before the
        /// vantage's cursor is ever pushed past the rewind target (its
        /// delivery only ever reached scene 0): see that test's own
        /// wording. This test ticks past a high peak first (delay=0, the
        /// production shape), so <see cref="Archive.ReadAtVantage"/>'s
        /// monotonic "never rewinds" cursor clamp is genuinely engaged
        /// before the rewind, reproducing the real defect: a live
        /// quickload's timeline-reset used to clear only
        /// <see cref="Courier"/>'s own pending-command/clock state, never
        /// the per-node <see cref="Archive"/>: so the archive's samples
        /// above the new UT, and every (topic, vantage) cursor's clamped
        /// high-watermark, survived the reset intact. Two distinct
        /// observable failures result, both asserted here:
        ///
        /// <list type="number">
        /// <item><description>An ALREADY-SUBSCRIBED vantage
        /// ("KSC") whose cursor was pinned to the peak keeps re-delivering
        /// the stale peak sample after the rewind instead of the genuinely
        /// new one, because <c>Math.Max(rawScene, lastScene)</c> clamps
        /// every post-reset scene straight back up to the old peak.</description></item>
        /// <item><description>A subscriber joining after the rewind
        /// ("MissionControl") gets the abandoned pre-rewind timeline
        /// replayed to it later, because <see cref="Courier.SubscribeStream"/>'s
        /// "still in flight" reschedule loop walks whatever the archive
        /// happens to contain at subscribe time, which, unpruned, still
        /// includes samples from a timeline that no longer exists.</description></item>
        /// </list>
        /// </summary>
        [Fact]
        public void ResetTimelineAlsoResetsTheArchiveSoStaleHighWatermarkCursorsAndAbandonedSamplesNeverReachSubscribers()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(); // production shape: delay 0 for every pair (the default)
            var courier = new Courier(clock, network);

            var ksc = new List<(object? Value, double ValidAt)>();
            courier.SubscribeStream("system", "bodies", "KSC", data => ksc.Add((data.Payload, data.Meta.ValidAt)));

            // Play forward through a HIGH peak. With delay=0 every delivery
            // fires immediately at its own recorded UT, pinning KSC's
            // (topic, vantage) cursor progressively higher -- exactly the
            // shape that engages ReadAtVantage's monotonic clamp.
            courier.Record("system", "bodies", "v0", 0);
            clock.AdvanceTo(0);
            courier.Record("system", "bodies", "v50", 50);
            clock.AdvanceTo(50);
            courier.Record("system", "bodies", "v100", 100);
            clock.AdvanceTo(100);
            Assert.Equal(new List<(object?, double)> { ("v0", 0.0), ("v50", 50.0), ("v100", 100.0) }, ksc);

            // THE QUICKLOAD: rewind to UT 20, well below the peak.
            courier.ResetTimeline(20);
            Assert.Equal(20.0, clock.Now());

            // A brand-new subscriber joining AFTER the rewind, before any
            // new sample is recorded on the new timeline.
            var missionControl = new List<(object? Value, double ValidAt)>();
            courier.SubscribeStream("system", "bodies", "MissionControl", data => missionControl.Add((data.Payload, data.Meta.ValidAt)));
            // Catch-up must only ever return "v0" (ValidAt=0 predates BOTH
            // timelines, so it's legitimately still-valid history) -- never
            // the abandoned "v50"/"v100".
            Assert.Equal(new List<(object?, double)> { ("v0", 0.0) }, missionControl);

            // Resume forward on the NEW timeline.
            courier.Record("system", "bodies", "v20", 20);
            clock.AdvanceTo(20);

            // KSC's cursor was pinned to 100 by the pre-rewind peak. Without
            // clearing it, ReadAtVantage's Math.Max(rawScene=20, lastScene=100)
            // would clamp straight back up to 100, and if the archive still
            // held "v100" at ValidAt=100 <= 100, that would deliver the STALE
            // GHOST "v100" a second time instead of the genuinely new "v20".
            // The cursor is cleared and "v100" pruned, so this must be
            // exactly "v20".
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v50", 50.0), ("v100", 100.0), ("v20", 20.0) },
                ksc);
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v20", 20.0) },
                missionControl);

            // Push well past the abandoned peak's own UTs (50, 100) WITHOUT
            // recording anything new there. Without pruning, SubscribeStream's
            // "still in flight" reschedule loop (run when MissionControl
            // subscribed, above) would see the unpruned archive's "v50"/"v100"
            // and schedule their delivery for exactly this moment -- the
            // abandoned pre-quickload timeline getting replayed to a
            // subscriber that joined AFTER the reset and never should see
            // it. The archive is already pruned to just "v0" by
            // the time MissionControl subscribed, so nothing is ever
            // scheduled here.
            clock.AdvanceTo(60);
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v20", 20.0) },
                missionControl);
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v50", 50.0), ("v100", 100.0), ("v20", 20.0) },
                ksc);
        }

        [Fact]
        public void ASubscriberIsSentTheValueThatSurvivedTheResetUnderTheNewEpoch()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "crash.lastCrash", "KSC", data => delivered.Add(data));

            courier.Record("system", "crash.lastCrash", "old crash", 5);
            clock.AdvanceTo(10);
            courier.Record("system", "crash.lastCrash", "abandoned crash", 10);
            delivered.Clear();

            courier.ResetTimeline(8);
            courier.ReissueRetainedAfterReset();

            var reissued = Assert.Single(delivered);
            Assert.Equal("old crash", reissued.Payload);
            Assert.Equal(courier.CurrentEpoch, reissued.Meta.TimelineEpoch);
        }

        [Fact]
        public void ATopicTheCallerLeavesOutIsNotReissued()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "crash.lastCrash", "KSC", data => delivered.Add(data));
            courier.Record("system", "crash.lastCrash", "old crash", 5);
            clock.AdvanceTo(10);
            delivered.Clear();

            courier.ResetTimeline(8);
            courier.ReissueRetainedAfterReset(topic => topic != "crash.lastCrash");

            Assert.Empty(delivered);
        }

        [Fact]
        public void NothingIsReissuedForATopicWhoseValuesAllBelongedToTheAbandonedTimeline()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "crash.lastCrash", "KSC", data => delivered.Add(data));

            clock.AdvanceTo(10);
            courier.Record("system", "crash.lastCrash", "abandoned crash", 10);
            delivered.Clear();

            courier.ResetTimeline(8);
            courier.ReissueRetainedAfterReset();

            Assert.Empty(delivered);
        }

        [Fact]
        public void AfterAReloadTheHomeCommandGetsWhatItHadHeardThenTheRestAsItArrives()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "system", 5);
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            courier.Record("system", "vessel.flight", "heard", 1);
            courier.Record("system", "vessel.flight", "in flight", 6);
            clock.AdvanceTo(20);
            courier.Record("system", "vessel.flight", "undone", 20);
            delivered.Clear();

            courier.ResetTimeline(8);
            courier.ReissueRetainedAfterReset();

            var first = Assert.Single(delivered);
            Assert.Equal("heard", first.Payload);
            Assert.Equal(courier.CurrentEpoch, first.Meta.TimelineEpoch);

            clock.AdvanceTo(11);
            Assert.Equal(2, delivered.Count);
            Assert.Equal("in flight", delivered[1].Payload);
            Assert.Equal(courier.CurrentEpoch, delivered[1].Meta.TimelineEpoch);

            clock.AdvanceTo(30);
            Assert.DoesNotContain(delivered, d => (string?)d.Payload == "undone");
        }

        [Fact]
        public void ASaveOlderThanTheKeptHistoryServesNothingRatherThanTheFirstValueEver()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            for (var ut = 1; ut <= 4; ut++)
            {
                courier.Record("system", "vessel.flight", "v" + ut, ut);
            }
            clock.AdvanceTo(5);
            courier.TrimTopic("system", "vessel.flight", 4);
            delivered.Clear();

            courier.ResetTimeline(2.5);
            courier.ReissueRetainedAfterReset();

            Assert.Empty(delivered);
        }

        /// <summary>A real flight records every second, so retention has pruned to the cursor long before the quickload.</summary>
        [Fact]
        public void AReloadToASaveTheCursorHasMovedPastStillServesWhatWasHeardAtTheSave()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "system", 9);
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            for (var ut = 0; ut <= 130; ut++)
            {
                clock.AdvanceTo(ut);
                courier.Record("system", "vessel.flight", "at " + ut, ut);
                if (ut == 100)
                {
                    courier.RetainHistoryFrom(100);
                }
            }
            delivered.Clear();

            // The save was written at UT 100; the quickload comes at UT 130, after two prunes.
            courier.ResetTimeline(100);
            courier.ReissueRetainedAfterReset();

            var first = Assert.Single(delivered);
            Assert.Equal("at 91", first.Payload);
            Assert.Equal(courier.CurrentEpoch, first.Meta.TimelineEpoch);
        }

        /// <summary>The wire order of a real quickload: the loaded world's first reading is recorded before the re-serve and is itself a delay away.</summary>
        [Fact]
        public void WithADelayAboveZeroTheLoadedWorldsFirstReadingInFlightDoesNotStopWhatWasHeardAtTheSaveBeingServed()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "system", 9);
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            for (var ut = 0; ut <= 100; ut++)
            {
                clock.AdvanceTo(ut);
                courier.Record("system", "vessel.flight", "at " + ut, ut);
            }
            delivered.Clear();

            courier.ResetTimeline(100);
            clock.AdvanceTo(101);
            courier.Record("system", "vessel.flight", "loaded world", 101);
            courier.ReissueRetainedAfterReset();

            Assert.Equal("at 92", Assert.Single(delivered).Payload);
            clock.AdvanceTo(110);
            // The readings still crossing at the save follow, then the loaded world's own.
            Assert.Equal("at 100", (string?)delivered[delivered.Count - 2].Payload);
            Assert.Equal("loaded world", (string?)delivered[delivered.Count - 1].Payload);
            Assert.All(delivered, d => Assert.Equal(courier.CurrentEpoch, d.Meta.TimelineEpoch));
        }

        [Fact]
        public void WithADelayAboveZeroASaveOlderThanTheRetentionFloorServesNothingAndBlanksUntilTheLoadedWorldsFrame()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "system", 9);
            var courier = new Courier(clock, network);

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            for (var ut = 0; ut <= 1200; ut++)
            {
                clock.AdvanceTo(ut);
                courier.Record("system", "vessel.flight", "at " + ut, ut);
                if (ut == 100)
                {
                    courier.RetainHistoryFrom(100);
                }
            }
            delivered.Clear();

            // The save is 1100 UT old and the floor reaches back 900, so its history is gone.
            courier.ResetTimeline(100);
            clock.AdvanceTo(101);
            courier.Record("system", "vessel.flight", "loaded world", 101);
            courier.ReissueRetainedAfterReset();

            Assert.Empty(delivered);
            clock.AdvanceTo(110);
            Assert.Equal("loaded world", Assert.Single(delivered).Payload);
        }

        [Fact]
        public void WithNoDelayTheLoadedWorldsFirstReadingIsNotPrecededByWhatWasKept()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());

            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.flight", "KSC", data => delivered.Add(data));
            courier.Record("system", "vessel.flight", "before the save", 1);
            clock.AdvanceTo(2);
            delivered.Clear();

            courier.ResetTimeline(2);
            courier.Record("system", "vessel.flight", "loaded world", 2);
            clock.AdvanceTo(2);
            courier.ReissueRetainedAfterReset();

            Assert.Equal("loaded world", Assert.Single(delivered).Payload);
        }

        [Fact]
        public void ResetTimelineDropsInFlightCommands()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 5);
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node, _vantage, _craft) => "result");

            CommandResponse? response = null;
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", msg => response = msg);
            Assert.Equal(1, courier.PendingCommandCount);

            // Quickload before the command's executeUt (5) is reached.
            clock.AdvanceTo(2);
            courier.ResetTimeline(1);

            Assert.Equal(0, courier.PendingCommandCount);
            Assert.Equal(1.0, clock.Now());

            // Advancing well past the original executeUt/confirmUt (5/10)
            // must not resurrect the dropped command.
            clock.AdvanceTo(20);
            Assert.Null(response);
        }
    }
}
