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

        /// <summary>A dialog the dashboard reads as a form is a button a console may press.</summary>
        [Theory]
        [InlineData("RenameVessel")]
        [InlineData("RenameAsteroidEvent")]
        [InlineData("RenameCometEvent")]
        [InlineData("SetVesselNaming")]
        [InlineData("ShowUpgradeStats")]
        public void InvokePassesAMirroredDialogButtonToTheActuator(string eventName)
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleInvoke(
                actuator,
                new InvokePartActionArgs { PartId = "1234567", EventName = eventName });

            Assert.True(result.Success);
            Assert.Equal("1234567", actuator.LastInvokePartId);
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

        [Fact]
        public void SetFieldPassesEveryArgThroughUnscrambled()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleSetField(
                actuator,
                new SetPartFieldArgs { PartId = "1234567", Module = "ModuleEnginesFX", Field = "thrustPercentage", Value = 73.5 });

            Assert.True(result.Success);
            Assert.Equal("1234567", actuator.LastSetFieldPartId);
            Assert.Equal("ModuleEnginesFX", actuator.LastSetFieldModule);
            Assert.Equal("thrustPercentage", actuator.LastSetFieldName);
            Assert.Equal(73.5, actuator.LastSetFieldValue);
        }

        [Fact]
        public void SetFieldWithEmptyPartIdFailsNotFoundWithoutCallingTheActuator()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleSetField(
                actuator, new SetPartFieldArgs { PartId = "", Field = "thrustPercentage", Value = 1 });

            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetFieldPartId);
        }

        [Fact]
        public void SetFieldWithNoFieldNameFailsCapabilityMismatchWithoutCallingTheActuator()
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleSetField(
                actuator, new SetPartFieldArgs { PartId = "1234567", Field = "", Value = 1 });

            Assert.Equal(CommandErrorCode.CapabilityMismatch, result.ErrorCode);
            Assert.Equal("the command names no field to set", result.Detail);
            Assert.Null(actuator.LastSetFieldPartId);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        public void SetFieldRefusesAValueThatIsNotAFiniteNumberWithoutCallingTheActuator(double value)
        {
            var actuator = new FakePartActionActuator();

            var result = PartActionCommandProvider.HandleSetField(
                actuator, new SetPartFieldArgs { PartId = "1234567", Field = "thrustPercentage", Value = value });

            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastSetFieldPartId);
        }

        [Fact]
        public void SetFieldMeansTheOwnPartWhenNoModuleIsNamed()
        {
            var actuator = new FakePartActionActuator();

            PartActionCommandProvider.HandleSetField(
                actuator, new SetPartFieldArgs { PartId = "1234567", Field = "someField", Value = 1 });

            Assert.Equal("", actuator.LastSetFieldModule);
        }

        [Theory]
        [InlineData("notFound")]
        [InlineData("range")]
        [InlineData("capabilityMismatch")]
        public void SetFieldSurfacesTheActuatorsTypedFailureUnchanged(string code)
        {
            var refusal = code == "notFound" ? CommandErrorCode.NotFound
                : code == "range" ? CommandErrorCode.Range
                : CommandErrorCode.CapabilityMismatch;
            var actuator = new FakePartActionActuator { SetFieldResult = CommandResult.Fail(refusal, "x") };

            var result = PartActionCommandProvider.HandleSetField(
                actuator, new SetPartFieldArgs { PartId = "9", Module = "M", Field = "f", Value = 1 });

            Assert.False(result.Success);
            Assert.Equal(refusal, result.ErrorCode);
            Assert.Equal("x", result.Detail);
        }

        [Fact]
        public void SetFieldCommandNameIsTheDeclaredVesselCommand()
        {
            Assert.Equal("vessel.setPartField", PartActionCommandProvider.SetPartFieldCommand);
        }

        /// <summary>
        /// The commanded value is what lets a slider draw the value the operator
        /// sent beside the reported one, so the command must name it.
        /// </summary>
        [Fact]
        public void SetFieldDeclaresItsValueAsTheCommandedValue()
        {
            var attribute = (SitrepCommandAttribute)System.Attribute.GetCustomAttribute(
                typeof(SetPartFieldArgs), typeof(SitrepCommandAttribute))!;

            Assert.Equal(PartActionCommandProvider.SetPartFieldCommand, attribute.CommandId);
            Assert.Equal(nameof(SetPartFieldArgs.Value), attribute.SetsValue);
        }
    }
}
