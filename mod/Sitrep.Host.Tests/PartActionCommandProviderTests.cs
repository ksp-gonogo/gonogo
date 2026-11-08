using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless tests for <see cref="PartActionCommandProvider"/>: the args-only
    /// validation tier and the pass-through to <see cref="IPartActionActuator"/>,
    /// against <see cref="FakePartActionActuator"/>. The sibling of
    /// <c>RoboticsCommandProviderTests</c>, and deliberately the same shape.
    /// </summary>
    public class PartActionCommandProviderTests
    {
        [Fact]
        public void InvokePassesBothArgsThroughUnscrambled()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "1234567", EventName = "ToggleSolarPanel" });

            Assert.True(result.Success);
            Assert.Equal("1234567", actuator.LastInvokePartId);
            Assert.Equal("ToggleSolarPanel", actuator.LastInvokeEventName);
        }

        [Fact]
        public void InvokeWithEmptyPartIdFailsNotFoundWithoutCallingTheActuator()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "", EventName = "ToggleSolarPanel" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastInvokePartId);
        }

        /// <summary>
        /// A missing event name is ModeUnavailable, not NotFound: the part may well
        /// exist, the request just names no button on it. Keeping the two codes
        /// distinct is what lets an operator tell "wrong id" from "wrong action".
        /// </summary>
        [Fact]
        public void InvokeWithEmptyEventNameFailsModeUnavailableWithoutCallingTheActuator()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "1234567", EventName = "" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Null(actuator.LastInvokePartId);
        }

        /// <summary>
        /// Fired from a console, these open a window on the game's screen that
        /// locks the craft's controls until someone there finishes it.
        /// </summary>
        [Theory]
        [InlineData("SpawnTransferDialog")]
        [InlineData("TransferDataEvent")]
        [InlineData("RenameVessel")]
        [InlineData("RenameAsteroidEvent")]
        [InlineData("RenameCometEvent")]
        [InlineData("SetVesselNaming")]
        [InlineData("ShowUpgradeStats")]
        public void InvokeRefusesAButtonOnlySomeoneAtTheGameCanFinishWithoutCallingTheActuator(string eventName)
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "1234567", EventName = eventName });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, result.ErrorCode);
            Assert.Null(actuator.LastInvokePartId);
        }

        [Fact]
        public void InvokeSurfacesTheActuatorsTypedFailureUnchanged()
        {
            var actuator = new FakePartActionActuator
            {
                // What the real actuator returns for an id that no longer resolves
                // (part staged away / undocked): the failure a client holding a
                // stale flightID must see instead of a silent no-op.
                InvokeResult = CommandResult.Fail(CommandErrorCode.NotFound),
            };

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "999", EventName = "Deploy" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }

        [Fact]
        public void CommandNameIsTheDeclaredVesselTopic()
        {
            // The mod-side constant the client's map-command table mirrors; a
            // rename on either side without the other is a silent dead command.
            Assert.Equal("vessel.invokePartAction", PartActionCommandProvider.InvokePartActionCommand);
        }
    }
}
