using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="ScienceCommandProvider"/>'s <c>Handle*</c>
    /// glue against a <see cref="FakeScienceActuator"/> — proves the typed
    /// <c>partId</c> reaches the correct actuator method, that an empty
    /// <c>partId</c> fail-fasts as <see cref="CommandErrorCode.NotFound"/>
    /// before the actuator is ever called, and that the actuator's typed
    /// failure codes (<see cref="CommandErrorCode.ModeUnavailable"/> for an
    /// already-deployed experiment / no data / no transmitter,
    /// <see cref="CommandErrorCode.NotFound"/> for an unknown part,
    /// <see cref="CommandErrorCode.NoVessel"/>) surface unchanged. The
    /// engine-level <c>delayed</c> disposition is proven separately in the
    /// integration project (this project doesn't reference
    /// <c>ChannelEngine</c>).
    /// </summary>
    public class ScienceCommandProviderTests
    {
        [Fact]
        public void HandleDeployPassesPartIdThroughToTheDeployActuator()
        {
            var actuator = new FakeScienceActuator();

            var result = ScienceCommandProvider.HandleDeploy(actuator, new ExperimentActionArgs { PartId = "12345" });

            Assert.Equal("12345", actuator.LastDeployPartId);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleTransmitPassesPartIdThroughToTheTransmitActuator()
        {
            var actuator = new FakeScienceActuator();

            var result = ScienceCommandProvider.HandleTransmit(actuator, new ExperimentActionArgs { PartId = "67890" });

            Assert.Equal("67890", actuator.LastTransmitPartId);
            Assert.True(result.Success);
            // deploy must not have been touched by a transmit call
            Assert.Null(actuator.LastDeployPartId);
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void HandleDeployRejectsAnEmptyPartIdWithoutEverCallingTheActuator(string? partId)
        {
            var actuator = new FakeScienceActuator();

            var result = ScienceCommandProvider.HandleDeploy(actuator, new ExperimentActionArgs { PartId = partId! });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDeployPartId);
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void HandleTransmitRejectsAnEmptyPartIdWithoutEverCallingTheActuator(string? partId)
        {
            var actuator = new FakeScienceActuator();

            var result = ScienceCommandProvider.HandleTransmit(actuator, new ExperimentActionArgs { PartId = partId! });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastTransmitPartId);
        }

        [Fact]
        public void HandleDeploySurfacesTheActuatorsModeUnavailableForAnAlreadyDeployedExperiment()
        {
            var actuator = new FakeScienceActuator { DeployResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = ScienceCommandProvider.HandleDeploy(actuator, new ExperimentActionArgs { PartId = "12345" });

            Assert.Equal("12345", actuator.LastDeployPartId);
            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void HandleDeploySurfacesTheActuatorsNotFoundForAnUnknownPart()
        {
            var actuator = new FakeScienceActuator { DeployResult = CommandResult.Fail(CommandErrorCode.NotFound) };

            var result = ScienceCommandProvider.HandleDeploy(actuator, new ExperimentActionArgs { PartId = "99999" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }

        [Fact]
        public void HandleDeploySurfacesTheActuatorsNoVessel()
        {
            var actuator = new FakeScienceActuator { DeployResult = CommandResult.Fail(CommandErrorCode.NoVessel) };

            var result = ScienceCommandProvider.HandleDeploy(actuator, new ExperimentActionArgs { PartId = "12345" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
        }

        [Fact]
        public void HandleTransmitSurfacesTheActuatorsModeUnavailableForNoDataOrNoTransmitter()
        {
            var actuator = new FakeScienceActuator { TransmitResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = ScienceCommandProvider.HandleTransmit(actuator, new ExperimentActionArgs { PartId = "12345" });

            Assert.Equal("12345", actuator.LastTransmitPartId);
            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void HandleTransmitSurfacesTheActuatorsNotFoundForAnUnknownPart()
        {
            var actuator = new FakeScienceActuator { TransmitResult = CommandResult.Fail(CommandErrorCode.NotFound) };

            var result = ScienceCommandProvider.HandleTransmit(actuator, new ExperimentActionArgs { PartId = "99999" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }

        [Fact]
        public void HandleTransmitSurfacesTheActuatorsNoVessel()
        {
            var actuator = new FakeScienceActuator { TransmitResult = CommandResult.Fail(CommandErrorCode.NoVessel) };

            var result = ScienceCommandProvider.HandleTransmit(actuator, new ExperimentActionArgs { PartId = "12345" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
        }
    }
}
