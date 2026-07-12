using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="ICareerActuator"/> — records exactly what each
    /// call was made with (so a test can assert "typed args produced the correct
    /// actuator call with the correct values") and returns a per-method,
    /// test-configurable result (defaulting to success) instead of ever touching
    /// KSP. Mirrors <see cref="FakeVesselActuator"/>'s "record + configurable"
    /// convention.
    /// </summary>
    internal sealed class FakeCareerActuator : ICareerActuator
    {
        // ---- recorded calls (null until the method is invoked) ----
        public string? LastActivateStrategyId;
        public double? LastActivateStrategyFactor;
        public string? LastDeactivateStrategyId;
        public string? LastUnlockTechId;
        public string? LastAcceptContractId;
        public string? LastDeclineContractId;
        public string? LastCancelContractId;
        public string? LastUpgradeFacilityId;

        // ---- configurable results (default: success) ----
        public CommandResult ActivateStrategyResult = CommandResult.Ok();
        public CommandResult DeactivateStrategyResult = CommandResult.Ok();
        public CommandResult UnlockTechResult = CommandResult.Ok();
        public CommandResult AcceptContractResult = CommandResult.Ok();
        public CommandResult DeclineContractResult = CommandResult.Ok();
        public CommandResult CancelContractResult = CommandResult.Ok();
        public CommandResult UpgradeFacilityResult = CommandResult.Ok();

        public CommandResult ActivateStrategy(string strategyId, double factor)
        {
            LastActivateStrategyId = strategyId;
            LastActivateStrategyFactor = factor;
            return ActivateStrategyResult;
        }

        public CommandResult DeactivateStrategy(string strategyId)
        {
            LastDeactivateStrategyId = strategyId;
            return DeactivateStrategyResult;
        }

        public CommandResult UnlockTech(string techId)
        {
            LastUnlockTechId = techId;
            return UnlockTechResult;
        }

        public CommandResult AcceptContract(string contractId)
        {
            LastAcceptContractId = contractId;
            return AcceptContractResult;
        }

        public CommandResult DeclineContract(string contractId)
        {
            LastDeclineContractId = contractId;
            return DeclineContractResult;
        }

        public CommandResult CancelContract(string contractId)
        {
            LastCancelContractId = contractId;
            return CancelContractResult;
        }

        public CommandResult UpgradeFacility(string facilityId)
        {
            LastUpgradeFacilityId = facilityId;
            return UpgradeFacilityResult;
        }
    }
}
