using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IScienceActuator"/>: records exactly what
    /// each call was made with (so a test can assert "the typed <c>partId</c>
    /// reached the correct actuator method") and returns a per-method,
    /// test-configurable result (defaulting to success) instead of ever
    /// touching KSP. Mirrors <see cref="FakeVesselActuator"/>'s
    /// "record + configurable" convention.
    /// </summary>
    internal sealed class FakeScienceActuator : IScienceActuator
    {
        public string? LastDeployPartId;
        public string? LastDeployExperimentId;
        public string? LastTransmitPartId;
        public string? LastTransmitExperimentId;
        public string? LastStartLabPartId;
        public string? LastStopLabPartId;

        public CommandResult DeployResult = CommandResult.Ok();
        public CommandResult TransmitResult = CommandResult.Ok();
        public CommandResult StartLabResult = CommandResult<RunStateChange>.Ok(new RunStateChange { Changed = true, Running = true });
        public CommandResult StopLabResult = CommandResult<RunStateChange>.Ok(new RunStateChange { Changed = true, Running = false });

        public CommandResult DeployExperiment(string partId, string? experimentId)
        {
            LastDeployPartId = partId;
            LastDeployExperimentId = experimentId;
            return DeployResult;
        }

        public CommandResult TransmitExperiment(string partId, string? experimentId)
        {
            LastTransmitPartId = partId;
            LastTransmitExperimentId = experimentId;
            return TransmitResult;
        }

        public CommandResult StartLab(string partId)
        {
            LastStartLabPartId = partId;
            return StartLabResult;
        }

        public CommandResult StopLab(string partId)
        {
            LastStopLabPartId = partId;
            return StopLabResult;
        }
    }
}
