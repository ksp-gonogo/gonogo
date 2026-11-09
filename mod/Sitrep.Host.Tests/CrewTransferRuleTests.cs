using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class CrewTransferRuleTests
    {
        private static readonly CrewTransferArgs Args = new CrewTransferArgs { KerbalName = "Jeb", FromPartId = "1", ToPartId = "2" };

        private static PartSeats Seats(int capacity = 3) => new PartSeats { Capacity = capacity, TransferAvailable = true };

        private static CrewMoveFacts Clear() => new CrewMoveFacts
        {
            KerbalAboard = true,
            KerbalPartId = "1",
            Source = Seats(),
            DestinationExists = true,
            Destination = Seats(),
            DestinationCrew = 1,
        };

        private static RefusalCode? Code(CrewMoveFacts facts, CrewTransferArgs? args = null) =>
            CrewTransferRule.Refusal(args ?? Args, facts)?.Code;

        [Fact]
        public void AClearMoveGoesAhead() => Assert.Null(Code(Clear()));

        [Fact]
        public void BusyIsCheckedFirst()
        {
            var facts = Clear();
            facts.Busy = "a transfer is open in the game";
            facts.KerbalAboard = false;
            Assert.Equal(CommandErrorCode.WrongState, Code(facts));
        }

        [Fact]
        public void AKerbalNotAboardIsNotFound()
        {
            var facts = Clear();
            facts.KerbalAboard = false;
            Assert.Equal(CommandErrorCode.NotFound, Code(facts));
        }

        [Fact]
        public void AKerbalWhoHasMovedIsWrongState()
        {
            var facts = Clear();
            facts.KerbalPartId = "9";
            Assert.Equal(CommandErrorCode.WrongState, Code(facts));
        }

        [Fact]
        public void AnExternalSeatCannotBeASource()
        {
            var facts = Clear();
            facts.Source = new PartSeats { Capacity = 1, TransferAvailable = true, IsExternalSeat = true };
            Assert.Equal(CommandErrorCode.CapabilityMismatch, Code(facts));
        }

        [Fact]
        public void AMissingDestinationIsNotFound()
        {
            var facts = Clear();
            facts.DestinationExists = false;
            Assert.Equal(CommandErrorCode.NotFound, Code(facts));
        }

        [Fact]
        public void TheSamePartIsWrongState() =>
            Assert.Equal(
                CommandErrorCode.WrongState,
                Code(Clear(), new CrewTransferArgs { KerbalName = "Jeb", FromPartId = "1", ToPartId = "1" }));

        [Theory]
        [InlineData(false, false)]
        [InlineData(true, true)]
        public void APartCrewCannotUseIsACapabilityMismatch(bool transferAvailable, bool external)
        {
            var facts = Clear();
            facts.Destination = new PartSeats { Capacity = 2, TransferAvailable = transferAvailable, IsExternalSeat = external };
            Assert.Equal(CommandErrorCode.CapabilityMismatch, Code(facts));
        }

        [Fact]
        public void APartWithNoSeatsIsACapabilityMismatch()
        {
            var facts = Clear();
            facts.Destination = null;
            Assert.Equal(CommandErrorCode.CapabilityMismatch, Code(facts));
        }

        [Fact]
        public void AFullPartIsLimitReached()
        {
            var facts = Clear();
            facts.Destination = Seats(1);
            Assert.Equal(CommandErrorCode.LimitReached, Code(facts));
        }
    }
}
