using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="FlightOpsCommandProvider"/>'s <c>Handle*</c>
    /// glue against a <see cref="FakeFlightOpsActuator"/>: proves the no-arg
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

            var result = Launch(actuator, new LaunchArgs
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

            var result = Launch(actuator, new LaunchArgs
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

            var result = Launch(actuator, new LaunchArgs
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

            Launch(actuator, new LaunchArgs
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

            Launch(actuator, new LaunchArgs
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

            var result = Launch(actuator, new LaunchArgs
            {
                ShipName = "Kerbal X",
                Facility = "VAB",
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        private static readonly Func<string, string, LaunchSiteReach> Beside =
            (_, _) => LaunchSiteReach.Measured("KSC", "Launch Pad", 0.02);

        private static CommandResult Launch(FakeFlightOpsActuator actuator, LaunchArgs args) =>
            FlightOpsCommandProvider.HandleLaunch(actuator, args, "ground:KSC", Beside);

        private static LaunchArgs PadLaunch() => new LaunchArgs { ShipName = "Kestrel", Facility = "VAB", Site = "LaunchPad" };

        private static CommandResult LaunchFrom(FakeFlightOpsActuator actuator, LaunchSiteReach reach) =>
            FlightOpsCommandProvider.HandleLaunch(actuator, PadLaunch(), "vessel:far", (_, _) => reach);

        [Fact]
        public void ALaunchFromAVantageFurtherThanTheProximityLimitIsRefusedNamingBothByDisplayName()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.Measured("KSC-2", "Launch Pad A", 14.0));

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotAtSite, result.ErrorCode);
            Assert.Equal("KSC-2 is 14 light-seconds from Launch Pad A", result.Detail);
            Assert.Null(actuator.LastLaunchShipName);
        }

        [Theory]
        [InlineData(0.02)]
        [InlineData(FlightOpsCommandProvider.LaunchProximitySeconds)]
        public void ALaunchFromAVantageWithinTheProximityLimitGoesAhead(double seconds)
        {
            var actuator = new FakeFlightOpsActuator();
            string? askedVantage = null;
            string? askedSite = null;

            var result = FlightOpsCommandProvider.HandleLaunch(actuator, PadLaunch(), "ground:KSC", (vantage, site) =>
            {
                askedVantage = vantage;
                askedSite = site;
                return LaunchSiteReach.Measured("KSC", "Launch Pad", seconds);
            });

            Assert.True(result.Success);
            Assert.Equal("Kestrel", actuator.LastLaunchShipName);
            Assert.Equal("ground:KSC", askedVantage);
            Assert.Equal("LaunchPad", askedSite);
        }

        /// <summary>The meta vantage, or any vantage that is not a centre, stands nowhere and so is near nothing.</summary>
        [Fact]
        public void ALaunchFromAVantageThatIsNoPlaceIsRefused()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.NoPlace("meta", "Launch Pad"));

            Assert.Equal(CommandErrorCode.NotAtSite, result.ErrorCode);
            Assert.Equal("meta is not a command centre, so it is not near Launch Pad", result.Detail);
            Assert.Null(actuator.LastLaunchShipName);
        }

        [Fact]
        public void ALaunchToASiteWithNoPlacedSpawnPointIsRefusedAsUnread()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.SiteUnplaced("KSC", "Island Airfield"));

            Assert.Equal(CommandErrorCode.Unreadable, result.ErrorCode);
            Assert.Null(actuator.LastLaunchShipName);
        }

        [Fact]
        public void ALaunchToNoSuchSiteIsRefusedAsNotFound()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.NoSuchSite("KSC", "Nowhere"));

            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastLaunchShipName);
        }

        [Fact]
        public void AReadThatFailedRefusesRatherThanLaunching()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.Unread("vessel:far", "LaunchPad"));

            Assert.Equal(CommandErrorCode.Unreadable, result.ErrorCode);
            Assert.Null(actuator.LastLaunchShipName);
        }

        /// <summary>With no comms network there is no light-time between any two places to hold a launch to.</summary>
        [Fact]
        public void ASaveWithNoCommsNetworkLaunchesFromAnywhere()
        {
            var actuator = new FakeFlightOpsActuator();

            var result = LaunchFrom(actuator, LaunchSiteReach.Unconstrained());

            Assert.True(result.Success);
            Assert.Equal("Kestrel", actuator.LastLaunchShipName);
        }

        [Fact]
        public void AMalformedLaunchIsRefusedForItsArgumentsBeforeProximityIsAsked()
        {
            var actuator = new FakeFlightOpsActuator();
            var asked = false;

            var result = FlightOpsCommandProvider.HandleLaunch(
                actuator, new LaunchArgs { ShipName = "", Facility = "VAB" }, "vessel:far", (_, _) =>
                {
                    asked = true;
                    return LaunchSiteReach.Measured("far", "Launch Pad", 1000.0);
                });

            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.False(asked);
        }
    }
}
