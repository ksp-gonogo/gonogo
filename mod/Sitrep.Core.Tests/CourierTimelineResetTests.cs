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
    /// <see cref="Courier.ResetTimeline"/> -- capabilities with NO TS
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
        /// above passes even pre-fix because its rewind happens BEFORE the
        /// vantage's cursor is ever pushed past the rewind target (its
        /// delivery only ever reached scene 0) — see that test's own
        /// wording. This test ticks PAST a HIGH peak first (delay=0, the
        /// production shape), so <see cref="Archive.ReadAtVantage"/>'s
        /// monotonic "never rewinds" cursor clamp is genuinely engaged
        /// before the rewind, reproducing the real defect: a live
        /// quickload's timeline-reset used to clear ONLY
        /// <see cref="Courier"/>'s own pending-command/clock state, never
        /// the per-node <see cref="Archive"/> — so the archive's samples
        /// above the new UT, and every (topic, vantage) cursor's clamped
        /// high-watermark, survived the reset intact. Two distinct
        /// observable failures result, both asserted here:
        ///
        /// <list type="number">
        /// <item><description>An ALREADY-SUBSCRIBED vantage
        /// ("KSC") whose cursor was pinned to the peak keeps re-delivering
        /// the STALE peak sample after the rewind instead of the genuinely
        /// new one, because <c>Math.Max(rawScene, lastScene)</c> clamps
        /// every post-reset scene straight back up to the old peak.</description></item>
        /// <item><description>A subscriber joining AFTER the rewind
        /// ("MissionControl") gets the abandoned pre-rewind timeline
        /// REPLAYED to it later, because <see cref="Courier.SubscribeStream"/>'s
        /// "still in flight" reschedule loop walks whatever the archive
        /// happens to contain at subscribe time — which, unpruned, still
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

            // KSC's cursor was pinned to 100 by the pre-rewind peak. Pre-fix,
            // ReadAtVantage's Math.Max(rawScene=20, lastScene=100) clamps
            // straight back up to 100, and the archive still holds "v100" at
            // ValidAt=100 <= 100 -- delivering the STALE GHOST "v100" a
            // second time instead of the genuinely new "v20". Post-fix, the
            // cursor was cleared and "v100" was pruned, so this must be
            // exactly "v20".
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v50", 50.0), ("v100", 100.0), ("v20", 20.0) },
                ksc);
            Assert.Equal(
                new List<(object?, double)> { ("v0", 0.0), ("v20", 20.0) },
                missionControl);

            // Push well past the abandoned peak's own UTs (50, 100) WITHOUT
            // recording anything new there. Pre-fix, SubscribeStream's
            // "still in flight" reschedule loop (run when MissionControl
            // subscribed, above) saw the unpruned archive's "v50"/"v100" and
            // scheduled their delivery for exactly this moment -- the
            // abandoned pre-quickload timeline getting replayed to a
            // subscriber that joined AFTER the reset and never should see
            // it. Post-fix, the archive was already pruned to just "v0" by
            // the time MissionControl subscribed, so nothing was ever
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
        public void ResetTimelineDropsInFlightCommands()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 5);
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node) => "result");

            CommandResponse? response = null;
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", msg => response = msg);
            Assert.Single(courier.SnapshotCommands().Commands);

            // Quickload before the command's executeUt (5) is reached.
            clock.AdvanceTo(2);
            courier.ResetTimeline(1);

            Assert.Empty(courier.SnapshotCommands().Commands);
            Assert.Equal(1.0, clock.Now());

            // Advancing well past the original executeUt/confirmUt (5/10)
            // must not resurrect the dropped command.
            clock.AdvanceTo(20);
            Assert.Null(response);
        }
    }
}
