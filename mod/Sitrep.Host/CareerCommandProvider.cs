using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling glue for the career-write commands — the
    /// command-side twin of <see cref="CareerViewProvider"/>. Each
    /// <c>Handle*</c> method is the exact delegate
    /// <c>Gonogo.KSP.CareerUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: validate the
    /// already-typed args, call the one matching <see cref="ICareerActuator"/>
    /// method, hand back an already-typed result. No KSP/Unity type appears
    /// anywhere in this file — the only checks done HERE are on the args
    /// themselves (an empty/whitespace id can never resolve to a live entity, so
    /// it fails fast as <see cref="CommandErrorCode.NotFound"/> without ever
    /// reaching the actuator). Every check that needs live game state — whether
    /// the id resolves, whether the action is valid in the current state,
    /// whether the player can afford the spend — is the actuator's job and comes
    /// back as a typed <see cref="CommandResult.ErrorCode"/>, mirroring
    /// <see cref="VesselCommandProvider"/>'s split exactly.
    /// </summary>
    public static class CareerCommandProvider
    {
        // ---- career.* -- all delayed:false (ground-side KSC bookkeeping, not
        // an uplink to a craft; see CareerUplink's command-classification note) ----
        public const string ActivateStrategyCommand = "career.strategy.activate";
        public const string DeactivateStrategyCommand = "career.strategy.deactivate";
        public const string UnlockTechCommand = "career.tech.unlock";
        public const string AcceptContractCommand = "career.contract.accept";
        public const string DeclineContractCommand = "career.contract.decline";
        public const string CancelContractCommand = "career.contract.cancel";
        public const string UpgradeFacilityCommand = "career.facility.upgrade";

        public static CommandResult HandleActivateStrategy(ICareerActuator actuator, ActivateStrategyArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.StrategyId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.ActivateStrategy(args.StrategyId, args.Factor);
        }

        public static CommandResult HandleDeactivateStrategy(ICareerActuator actuator, DeactivateStrategyArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.StrategyId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.DeactivateStrategy(args.StrategyId);
        }

        public static CommandResult HandleUnlockTech(ICareerActuator actuator, UnlockTechArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.TechId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.UnlockTech(args.TechId);
        }

        public static CommandResult HandleAcceptContract(ICareerActuator actuator, ContractActionArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.ContractId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.AcceptContract(args.ContractId);
        }

        public static CommandResult HandleDeclineContract(ICareerActuator actuator, ContractActionArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.ContractId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.DeclineContract(args.ContractId);
        }

        public static CommandResult HandleCancelContract(ICareerActuator actuator, ContractActionArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.ContractId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.CancelContract(args.ContractId);
        }

        public static CommandResult HandleUpgradeFacility(ICareerActuator actuator, UpgradeFacilityArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.FacilityId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.UpgradeFacility(args.FacilityId);
        }
    }
}
