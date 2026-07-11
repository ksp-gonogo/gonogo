using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="FlightOpsCommandProvider"/>'s <c>Handle*</c>
    /// glue against a <see cref="FakeFlightOpsActuator"/> — proves the no-arg
    /// commands call the actuator exactly once, that the <c>"vab"</c>/<c>"sph"</c>
    /// string bridges to the correct <see cref="EditorFacilityKind"/> (and an
    /// unrecognised facility fails before the actuator is ever called), that the
    /// switch-vessel id is threaded through (and an empty id fails fast), and
    /// that actuator failure codes surface unchanged. Same KSP-free provider vs
    /// fake actuator shape as <see cref="VesselCommandProviderTests"/>.
    /// </summary>
    public class FlightOpsCommandProviderTests
    {
        [Fact]
        public void HandleRevertToLaunchCallsTheActuatorExactlyOnce()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleRevertToLaunch(actuator, null);

            Assert.Equal(1, actuator.RevertToLaunchCallCount);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleRevertToLaunchSurfacesTheActuatorsUnavailableError()
        {
            var actuator = new FakeFlightOpsActuator { RevertToLaunchResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = FlightOpsCommandProvider.HandleRevertToLaunch(actuator, null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Theory]
        [InlineData("vab", EditorFacilityKind.Vab)]
        [InlineData("sph", EditorFacilityKind.Sph)]
        [InlineData("VAB", EditorFacilityKind.Vab)]
        [InlineData("Sph", EditorFacilityKind.Sph)]
        [InlineData("  vab  ", EditorFacilityKind.Vab)]
        public void HandleRevertToEditorBridgesTheFacilityStringToTheCorrectKind(string editor, EditorFacilityKind expected)
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleRevertToEditor(actuator, new RevertToEditorArgs { Editor = editor });

            Assert.Equal(expected, actuator.LastRevertToEditorFacility);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData("")]
        [InlineData("hangar")]
        [InlineData("editor")]
        public void HandleRevertToEditorRejectsAnUnrecognisedFacilityBeforeEverCallingTheActuator(string editor)
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleRevertToEditor(actuator, new RevertToEditorArgs { Editor = editor });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastRevertToEditorFacility);
        }

        [Fact]
        public void HandleToTrackingStationCallsTheActuatorExactlyOnce()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleToTrackingStation(actuator, null);

            Assert.Equal(1, actuator.ToTrackingStationCallCount);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleSwitchVesselPassesTheVesselIdThrough()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleSwitchVessel(actuator, new SwitchVesselArgs { VesselId = "guid-42" });

            Assert.Equal("guid-42", actuator.LastSwitchVesselId);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleSwitchVesselRejectsAnEmptyIdBeforeEverCallingTheActuator()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleSwitchVessel(actuator, new SwitchVesselArgs { VesselId = "" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSwitchVesselId);
        }

        [Fact]
        public void HandleSwitchVesselSurfacesTheActuatorsNotFoundError()
        {
            var actuator = new FakeFlightOpsActuator { SwitchVesselResult = CommandResult.Fail(CommandErrorCode.NotFound) };

            var result = FlightOpsCommandProvider.HandleSwitchVessel(actuator, new SwitchVesselArgs { VesselId = "no-such-vessel" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }

        [Fact]
        public void HandleRecoverCallsTheActuatorExactlyOnce()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleRecover(actuator, null);

            Assert.Equal(1, actuator.RecoverCallCount);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleRecoverSurfacesTheActuatorsNoVesselError()
        {
            var actuator = new FakeFlightOpsActuator { RecoverResult = CommandResult.Fail(CommandErrorCode.NoVessel) };

            var result = FlightOpsCommandProvider.HandleRecover(actuator, null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
        }

        [Fact]
        public void HandleLaunchThreadsTheParsedArgsToTheActuator()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = "VAB",
                Site = "LaunchPad",
                Crew = new List<string> { "Jebediah Kerman", "Bill Kerman" },
            });

            Assert.True(result.Success);
            Assert.Equal("Kerbal X", actuator.LastLaunchShipName);
            Assert.Equal(EditorFacilityKind.Vab, actuator.LastLaunchFacility);
            Assert.Equal("LaunchPad", actuator.LastLaunchSite);
            Assert.Equal(new[] { "Jebediah Kerman", "Bill Kerman" }, actuator.LastLaunchCrew);
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void HandleLaunchRejectsAnEmptyShipNameBeforeEverCallingTheActuator(string? shipName)
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = shipName!,
                Facility = "VAB",
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastLaunchShipName);
        }

        [Theory]
        [InlineData("")]
        [InlineData("hangar")]
        [InlineData("launchpad")]
        public void HandleLaunchRejectsAnUnrecognisedFacilityBeforeEverCallingTheActuator(string facility)
        {
            var actuator = new FakeFlightOpsActuator();

            var result = FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = facility,
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastLaunchFacility);
        }

        [Theory]
        [InlineData("sph", EditorFacilityKind.Sph)]
        [InlineData("VAB", EditorFacilityKind.Vab)]
        public void HandleLaunchBridgesTheFacilityStringCaseInsensitively(string facility, EditorFacilityKind expected)
        {
            var actuator = new FakeFlightOpsActuator();

            FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = facility,
            });

            Assert.Equal(expected, actuator.LastLaunchFacility);
        }

        [Fact]
        public void HandleLaunchNormalisesANullCrewToAnEmptyList()
        {
            var actuator = new FakeFlightOpsActuator();

            FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = "VAB",
                Crew = null!,
            });

            Assert.NotNull(actuator.LastLaunchCrew);
            Assert.Empty(actuator.LastLaunchCrew!);
        }

        [Fact]
        public void HandleLaunchSurfacesTheActuatorsUnavailableError()
        {
            var actuator = new FakeFlightOpsActuator { LaunchResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = FlightOpsCommandProvider.HandleLaunch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = "VAB",
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }
    }
}
