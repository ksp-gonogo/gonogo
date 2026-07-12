using Sitrep.Core;
using Xunit;

// See Sitrep.Core/Courier.cs for why this alias exists (Courier's public API
// hard-codes Sitrep.Contract.CommandResponse<object?> under the plain name
// CommandResponse for TResult).
using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-side test for <see cref="Courier.SnapshotCommands"/> /
    /// <see cref="Courier.RestoreCommands"/> — a capability with NO TS
    /// reference (added for M5b quicksave, scoped to the IN-FLIGHT COMMAND
    /// QUEUE only; see the doc comments on those methods for why the
    /// archive and telemetry subscriptions are deliberately out of scope
    /// here). Unlike <see cref="CourierGoldenFixtureTests"/>, there is no
    /// golden fixture: this test dispatches a command against one
    /// <c>Courier</c>, advances partway through its uplink (still
    /// in-flight, well before the execute UT), snapshots the command queue,
    /// then builds a FRESH <c>Courier</c> on a FRESH <c>ManualClock</c>
    /// started at the snapshot UT, restores the command queue onto it, and
    /// proves the command still executes and confirms at its ORIGINAL
    /// execute/confirm UTs with the same requestId and result — exactly as
    /// if the save/load round trip never happened.
    /// </summary>
    public class CourierCommandQueueSnapshotRestoreTests
    {
        [Fact]
        public void RestoredCommandQueueConfirmsAtOriginalUtsWithSameRequestIdAndResult()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 5);
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node) => new { ok = command, node });

            CommandResponse? response = null;
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", msg => response = msg);

            // t0 = 0, up = down = 5 -> executeUt = 5, confirmUt = 10.
            // Advance partway through uplink: still in flight, well before
            // the execute UT.
            clock.AdvanceTo(2);
            Assert.Null(response);

            var snapshot = courier.SnapshotCommands();
            Assert.Single(snapshot.Commands);
            var snapshotted = snapshot.Commands[0];
            Assert.Equal("r1", snapshotted.RequestId);
            Assert.Equal("vessel", snapshotted.Node);
            Assert.Equal("deploy", snapshotted.Command);
            Assert.Equal("KSC", snapshotted.Vantage);
            Assert.Equal(5.0, snapshotted.ExecuteUt);
            Assert.Equal(10.0, snapshotted.ConfirmUt);

            // Fresh Courier on a fresh Clock, as if the game had just been
            // quickloaded at UT 2 — no memory of the original dispatch's
            // closures or handler.
            var restoredClock = new ManualClock(2);
            var restoredNetwork = new StubNetwork();
            restoredNetwork.SetDelay("KSC", "vessel", 5);
            var restoredCourier = new Courier(restoredClock, restoredNetwork);
            restoredCourier.SetCommandHandler((command, args, node) => new { ok = command, node });

            CommandResponse? restoredResponse = null;
            restoredCourier.RestoreCommands(snapshot, msg => restoredResponse = msg);

            // Still nothing at UT 4 (before the original executeUt of 5).
            restoredClock.AdvanceTo(4);
            Assert.Null(restoredResponse);

            // Execute UT reached: handler runs, but confirmation is still
            // in flight downlink.
            restoredClock.AdvanceTo(5);
            Assert.Null(restoredResponse);

            // Confirm UT reached: the response arrives, with the SAME
            // requestId and result the original dispatch would have
            // produced, at the SAME validAt/deliveredAt.
            restoredClock.AdvanceTo(10);
            Assert.NotNull(restoredResponse);
            Assert.Equal("r1", restoredResponse!.RequestId);
            Assert.Equal(5.0, restoredResponse.Meta.ValidAt);
            Assert.Equal(10.0, restoredResponse.Meta.DeliveredAt);
            Assert.Equal("vessel", restoredResponse.Meta.Source);
            Assert.Equal("KSC", restoredResponse.Meta.Vantage);

            // The command queue is empty again once confirmed.
            Assert.Empty(restoredCourier.SnapshotCommands().Commands);
        }

        [Fact]
        public void SnapshotIsEmptyWhenNoCommandsAreInFlight()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            Assert.Empty(courier.SnapshotCommands().Commands);
        }

        [Fact]
        public void ConfirmedCommandIsRemovedFromTheSnapshottableQueue()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 1);
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node) => "done");

            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", _ => { });
            Assert.Single(courier.SnapshotCommands().Commands);

            // Execute (t=1) then confirm (t=2).
            clock.AdvanceTo(2);

            Assert.Empty(courier.SnapshotCommands().Commands);
        }
    }
}
