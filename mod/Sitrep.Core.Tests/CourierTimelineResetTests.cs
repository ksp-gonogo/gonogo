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
