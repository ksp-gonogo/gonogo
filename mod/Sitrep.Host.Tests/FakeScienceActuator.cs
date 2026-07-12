using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IScienceActuator"/> — records exactly what
    /// each call was made with (so a test can assert "the typed <c>partId</c>
    /// reached the correct actuator method") and returns a per-method,
    /// test-configurable result (defaulting to success) instead of ever
    /// touching KSP. Mirrors <see cref="FakeVesselActuator"/>'s
    /// "record + configurable" convention.
    /// </summary>
    internal sealed class FakeScienceActuator : IScienceActuator
    {
        // ---- recorded calls (null until the method is invoked) ----
        public string? LastDeployPartId;
        public string? LastTransmitPartId;

        // ---- configurable results (default: success) ----
        public CommandResult DeployResult = CommandResult.Ok();
        public CommandResult TransmitResult = CommandResult.Ok();

        public CommandResult DeployExperiment(string partId)
        {
            LastDeployPartId = partId;
            return DeployResult;
        }

        public CommandResult TransmitExperiment(string partId)
        {
            LastTransmitPartId = partId;
            return TransmitResult;
        }
    }
}
