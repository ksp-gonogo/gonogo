using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class DockPairMemoryTests
    {
        private sealed class Port
        {
            public string? State;
            public bool Alive = true;
            public bool Active = true;
        }

        private static (Port Own, Port Target)? Recall(DockPairMemory<Port> memory) =>
            memory.Recall(p => p.State, p => p.Alive && p.Active, p => p.Alive);

        [Theory]
        [InlineData("Acquire")]
        [InlineData("Acquire (dockee)")]
        [InlineData("PreAttached")]
        [InlineData("Docked (docker)")]
        [InlineData("Docked (dockee)")]
        [InlineData("Docked (same vessel)")]
        [InlineData("Disengage")]
        public void ThePairIsStillReportedInEveryStageOfTheDockAfterTheTargetGoesNull(string state)
        {
            var memory = new DockPairMemory<Port>();
            var own = new Port { State = "Ready" };
            var target = new Port { State = "Ready" };
            memory.Seen(own, target);

            own.State = state;

            var pair = Recall(memory);
            Assert.NotNull(pair);
            Assert.Same(own, pair!.Value.Own);
            Assert.Same(target, pair.Value.Target);
        }

        [Fact]
        public void ThePairIsForgottenOnceTheOwnPortIsBackAtRest()
        {
            var memory = new DockPairMemory<Port>();
            var own = new Port { State = "Disengage" };
            memory.Seen(own, new Port { State = "Disengage" });
            Assert.NotNull(Recall(memory));

            own.State = "Ready";

            Assert.Null(Recall(memory));
            own.State = "Docked (docker)";
            Assert.Null(Recall(memory));
        }

        [Fact]
        public void WithNoPairSeenNothingIsReportedNotADefaultState()
        {
            Assert.Null(Recall(new DockPairMemory<Port>()));
        }

        [Fact]
        public void APortThatIsGoneOrNoLongerTheActiveVesselsEndsTheMemory()
        {
            var gone = new DockPairMemory<Port>();
            var target = new Port { State = "Acquire" };
            gone.Seen(new Port { State = "Acquire" }, target);
            target.Alive = false;
            Assert.Null(Recall(gone));

            var switched = new DockPairMemory<Port>();
            var own = new Port { State = "Acquire" };
            switched.Seen(own, new Port { State = "Acquire" });
            own.Active = false;
            Assert.Null(Recall(switched));
        }

        [Fact]
        public void AStateTheContractDoesNotNameEndsTheMemory()
        {
            var memory = new DockPairMemory<Port>();
            var own = new Port { State = "Teleporting" };
            memory.Seen(own, new Port { State = "Acquire" });
            Assert.Null(Recall(memory));
        }
    }
}
