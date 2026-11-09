using System;
using System.IO;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class SaveFilesTests
    {
        [Fact]
        public void TheUtComesFromTheFlightStateBlockNotFromAnEarlierUt()
        {
            var save = "GAME\n{\n\tUT = 1\n\tFLIGHTSTATE\n\t{\n\t\tversion = 1.12\n\t\tUT = 4242.5\n\t}\n}\n";
            Assert.Equal(4242.5, SaveFiles.ReadFlightStateUt(new StringReader(save)));
        }

        [Fact]
        public void AFileWithNoFlightStateHasNoUt()
        {
            Assert.Null(SaveFiles.ReadFlightStateUt(new StringReader("GAME\n{\n\tUT = 1\n}\n")));
        }

        [Fact]
        public void TheReadStopsAtTheFirstVesselRatherThanScanningTheWholeSave()
        {
            var save = "FLIGHTSTATE\n{\n\tVESSEL\n\t{\n\t\tUT = 99\n\t}\n}\n";
            Assert.Null(SaveFiles.ReadFlightStateUt(new StringReader(save)));
        }

        [Fact]
        public void AnIdChangesWithTheFileAndIsStableForTheSameFile()
        {
            var written = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
            var id = SaveFiles.IdOf("career", "quicksave", 100, written);
            Assert.Equal(id, SaveFiles.IdOf("career", "quicksave", 100, written));
            Assert.NotEqual(id, SaveFiles.IdOf("career", "quicksave", 101, written));
            Assert.NotEqual(id, SaveFiles.IdOf("career", "quicksave", 100, written.AddSeconds(1)));
            Assert.NotEqual(id, SaveFiles.IdOf("other", "quicksave", 100, written));
        }
    }
}

namespace Sitrep.Host.Tests
{
    public class QuickloadHandlerTests
    {
        [Fact]
        public void ANamedSaveAndItsRequesterReachTheActuator()
        {
            var actuator = new FakeFlightOpsActuator();
            var result = FlightOpsCommandProvider.HandleQuickload(actuator, new Sitrep.Contract.QuickloadArgs { SaveId = "abc", RequestedBy = "Station 3" });
            Assert.True(result.Success);
            Assert.Equal("abc", actuator.LastQuickloadSaveId);
            Assert.Equal("Station 3", actuator.LastQuickloadRequestedBy);
        }

        [Fact]
        public void NoSaveNamedIsOutOfRangeAndTouchesNothing()
        {
            var actuator = new FakeFlightOpsActuator();
            var result = FlightOpsCommandProvider.HandleQuickload(actuator, new Sitrep.Contract.QuickloadArgs { SaveId = "" });
            Assert.False(result.Success);
            Assert.Equal(Sitrep.Contract.CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastQuickloadSaveId);
        }

        [Fact]
        public void AScheduledLoadRefusesEveryOtherSceneOperation()
        {
            var actuator = new FakeFlightOpsActuator { LoadScheduled = true };
            var result = FlightOpsCommandProvider.UnlessLoadScheduled(actuator, () => actuator.RevertToLaunch());
            Assert.False(result.Success);
            Assert.Equal(Sitrep.Contract.CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Equal(0, actuator.RevertToLaunchCallCount);
        }
    }
}
