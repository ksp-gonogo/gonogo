using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

using CommandResponse = Sitrep.Contract.CommandResponse<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Commands on their way brought forward when the delay is shortened: what is
    /// left of each leg shrinks by the same factor, in the order sent, and a
    /// command that has run is confirmed sooner but never run again.
    /// </summary>
    public class CourierBringForwardTests
    {
        [Fact]
        public void AFactorOfZeroRunsEveryCommandOnItsWayInTheOrderSentAndConfirmsAtOnce()
        {
            var (clock, courier, runs, answers) = NewCourier();
            courier.DispatchCommand("vessel", "r1", "first", null, "KSC", answers.Add);
            clock.AdvanceTo(1);
            courier.DispatchCommand("vessel", "r2", "second", null, "KSC", answers.Add);
            clock.AdvanceTo(2);

            var moved = courier.BringForward(0.0, 2);

            Assert.Equal(2, moved.Count);
            clock.AdvanceTo(2);
            Assert.Equal(new[] { "first", "second" }, runs);
            Assert.Equal(new[] { "r1", "r2" }, answers.ConvertAll(a => a.RequestId));
            Assert.All(answers, a => Assert.Equal(2.0, a.Meta.DeliveredAt));
            Assert.Empty(courier.SnapshotCommands().Commands);
        }

        [Fact]
        public void AFactorOfAHalfHalvesWhatIsLeftOfEachLegAndKeepsTheOrder()
        {
            var (clock, courier, runs, answers) = NewCourier();
            courier.DispatchCommand("vessel", "r1", "first", null, "KSC", answers.Add);
            clock.AdvanceTo(4);

            // Run was due at 10, confirmation at 20: from 4, six seconds left to run and ten after.
            courier.BringForward(0.5, 4);

            var saved = Assert.Single(courier.SnapshotCommands().Commands);
            Assert.Equal(7.0, saved.ExecuteUt);
            Assert.Equal(12.0, saved.ConfirmUt);
            clock.AdvanceTo(7);
            Assert.Equal(new[] { "first" }, runs);
            clock.AdvanceTo(12);
            Assert.Single(answers);
        }

        [Fact]
        public void ACommandThatHasRunIsConfirmedSoonerButNotRunAgain()
        {
            var (clock, courier, runs, answers) = NewCourier();
            courier.DispatchCommand("vessel", "r1", "first", null, "KSC", answers.Add);
            clock.AdvanceTo(12);
            Assert.Single(runs);

            courier.BringForward(0.0, 12);
            clock.AdvanceTo(12);

            Assert.Single(runs);
            Assert.Single(answers);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(2.0)]
        public void AFactorOfOneOrMoreChangesNothingAlreadySent(double factor)
        {
            var (clock, courier, runs, _) = NewCourier();
            courier.DispatchCommand("vessel", "r1", "first", null, "KSC", _ => { });
            clock.AdvanceTo(4);

            var moved = courier.BringForward(factor, 4);

            Assert.Empty(moved);
            var saved = Assert.Single(courier.SnapshotCommands().Commands);
            Assert.Equal(10.0, saved.ExecuteUt);
            Assert.Equal(20.0, saved.ConfirmUt);
            clock.AdvanceTo(9.9);
            Assert.Empty(runs);
        }

        private static (ManualClock Clock, Courier Courier, List<string> Runs, List<CommandResponse> Answers) NewCourier()
        {
            var clock = new ManualClock(0);
            var network = new StubNetwork();
            network.SetDelay("KSC", "vessel", 10);
            var courier = new Courier(clock, network);
            var runs = new List<string>();
            courier.SetCommandHandler((command, _, __, ___, ____) =>
            {
                runs.Add(command);
                return "ran:" + command;
            });
            return (clock, courier, runs, new List<CommandResponse>());
        }
    }
}
