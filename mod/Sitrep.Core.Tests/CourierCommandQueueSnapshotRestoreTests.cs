using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

// See Sitrep.Core/Courier.cs for why this alias exists (Courier's public API
// hard-codes Sitrep.Contract.CommandResponse<object?> under the plain name
// CommandResponse for TResult).
using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The in-flight command queue saved with a game and put back on a load.
    /// A command runs at its ExecuteUt in game time, so whether a restored
    /// command runs again is decided by whether it had run when the save was
    /// written: the save's world already holds the effect of one that had.
    /// </summary>
    public class CourierCommandQueueSnapshotRestoreTests
    {
        [Fact]
        public void ACommandSavedBeforeItRanRunsOnceAndConfirmsAtItsOriginalUts()
        {
            var (clock, courier, runs) = NewCourier(0);
            courier.DispatchCommand("vessel", "r1", "deploy", "args", "KSC", _ => { }, correlation: "client-7");

            // Sent at 0 with a five-second leg: runs at 5, confirms at 10.
            clock.AdvanceTo(2);
            var snapshot = courier.SnapshotCommands();
            var saved = Assert.Single(snapshot.Commands);
            Assert.Equal("r1", saved.RequestId);
            Assert.Equal("vessel", saved.Node);
            Assert.Equal("deploy", saved.Command);
            Assert.Equal("args", saved.Args);
            Assert.Equal("KSC", saved.Vantage);
            Assert.Equal("client-7", saved.Correlation);
            Assert.Equal(5.0, saved.ExecuteUt);
            Assert.Equal(10.0, saved.ConfirmUt);
            Assert.False(saved.Ran);

            var (restoredClock, restored, restoredRuns) = NewCourier(2);
            var answers = new List<(string Correlation, CommandResponse Response)>();
            restored.RestoreCommands(snapshot, state => response => answers.Add((state.Correlation, response)));

            restoredClock.AdvanceTo(4.9);
            Assert.Empty(restoredRuns);
            restoredClock.AdvanceTo(5);
            Assert.Single(restoredRuns);
            Assert.Empty(answers);

            restoredClock.AdvanceTo(10);
            var (correlation, answer) = Assert.Single(answers);
            Assert.Equal("client-7", correlation);
            Assert.Equal("r1", answer.RequestId);
            Assert.Equal("ran:deploy", answer.Result);
            Assert.Equal(5.0, answer.Meta.ValidAt);
            Assert.Equal(10.0, answer.Meta.DeliveredAt);
            Assert.Equal("KSC", answer.Meta.Vantage);
            Assert.Empty(restored.SnapshotCommands().Commands);
            Assert.Empty(runs);
        }

        [Fact]
        public void ACommandSavedAfterItRanDoesNotRunAgainAndConfirmsWithWhatItRanWith()
        {
            var (clock, courier, runs) = NewCourier(0);
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", _ => { });

            clock.AdvanceTo(7);
            Assert.Single(runs);
            var snapshot = courier.SnapshotCommands();
            var saved = Assert.Single(snapshot.Commands);
            Assert.True(saved.Ran);
            Assert.Equal("ran:deploy", saved.Result);

            var (restoredClock, restored, restoredRuns) = NewCourier(7);
            var answers = new List<CommandResponse>();
            restored.RestoreCommands(snapshot, _ => answers.Add);

            restoredClock.AdvanceTo(9.9);
            Assert.Empty(answers);
            restoredClock.AdvanceTo(10);

            Assert.Empty(restoredRuns);
            var answer = Assert.Single(answers);
            Assert.Equal("ran:deploy", answer.Result);
            Assert.Equal(5.0, answer.Meta.ValidAt);
            Assert.Equal(10.0, answer.Meta.DeliveredAt);
        }

        /// <summary>
        /// A quickload in the same game: the Courier rewinds to the save and is
        /// handed back what the save held. The run on the abandoned timeline
        /// does not count on the new one.
        /// </summary>
        [Fact]
        public void AQuickloadToASaveBeforeTheRunRunsItOnceMoreOnTheNewTimeline()
        {
            var (clock, courier, runs) = NewCourier(0);
            var answers = new List<CommandResponse>();
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", answers.Add);

            clock.AdvanceTo(3);
            var snapshot = courier.SnapshotCommands();
            clock.AdvanceTo(8);
            Assert.Single(runs);

            courier.ResetTimeline(3);
            courier.RestoreCommands(snapshot, _ => answers.Add);
            clock.AdvanceTo(30);

            Assert.Equal(2, runs.Count);
            Assert.Single(answers);
        }

        [Fact]
        public void AQuickloadToASaveAfterTheRunDoesNotRunItAgain()
        {
            var (clock, courier, runs) = NewCourier(0);
            var answers = new List<CommandResponse>();
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", answers.Add);

            clock.AdvanceTo(6);
            var snapshot = courier.SnapshotCommands();
            clock.AdvanceTo(8);

            courier.ResetTimeline(6);
            courier.RestoreCommands(snapshot, _ => answers.Add);
            clock.AdvanceTo(30);

            Assert.Single(runs);
            Assert.Single(answers);
        }

        [Fact]
        public void ARewindWithNothingRestoredDropsTheCommand()
        {
            var (clock, courier, runs) = NewCourier(0);
            var answers = new List<CommandResponse>();
            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", answers.Add);
            clock.AdvanceTo(2);

            courier.ResetTimeline(1);
            courier.RestoreCommands(new CommandQueueState(), _ => answers.Add);
            clock.AdvanceTo(30);

            Assert.Empty(runs);
            Assert.Empty(answers);
            Assert.False(courier.Carries("r1"));
        }

        [Fact]
        public void TheQueueIsEmptyWhenNothingIsInFlightAndEmptiesOnceConfirmed()
        {
            var (clock, courier, _) = NewCourier(0);
            Assert.Empty(courier.SnapshotCommands().Commands);

            courier.DispatchCommand("vessel", "r1", "deploy", null, "KSC", _ => { });
            Assert.Single(courier.SnapshotCommands().Commands);
            Assert.True(courier.Carries("r1"));

            clock.AdvanceTo(10);
            Assert.Empty(courier.SnapshotCommands().Commands);
            Assert.False(courier.Carries("r1"));
        }

        private static (ManualClock Clock, Courier Courier, List<string> Runs) NewCourier(double ut)
        {
            var clock = new ManualClock(ut);
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 5);
            var courier = new Courier(clock, network);
            var runs = new List<string>();
            courier.SetCommandHandler((command, _, __, ___) =>
            {
                runs.Add(command);
                return "ran:" + command;
            });
            return (clock, courier, runs);
        }
    }
}
