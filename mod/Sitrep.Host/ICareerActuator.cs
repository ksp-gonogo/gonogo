using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The KSP-actuation seam for the career-write commands — one method per
    /// command, taking already-parsed typed args and returning an already-typed
    /// <see cref="CommandResult"/>. The command-side twin of
    /// <see cref="IVesselActuator"/> for the ground-side KSC bookkeeping surface
    /// (strategies / tech tree / contracts / facility upgrades) rather than the
    /// vessel. <see cref="CareerCommandProvider"/> (KSP-free, this assembly)
    /// does the arg-level validation and glue; it never touches KSP itself, only
    /// this interface. <c>Gonogo.KSP.KspCareerActuator</c> is the real
    /// implementation (StrategySystem / ResearchAndDevelopment / ContractSystem
    /// / ScenarioUpgradeableFacilities / Funding — see its own doc comment); a
    /// FAKE implementation (<c>Sitrep.Host.Tests.FakeCareerActuator</c>) is what
    /// <see cref="CareerCommandProvider"/>'s unit tests exercise instead.
    ///
    /// <para>These are SPEND actions (funds/science) resolved by id against live
    /// KSC systems. Every method returns a typed failure rather than throwing
    /// when the referenced entity doesn't resolve
    /// (<see cref="CommandErrorCode.NotFound"/>), the action isn't valid in the
    /// current state (<see cref="CommandErrorCode.ModeUnavailable"/> — e.g. a
    /// contract in the wrong state, a strategy the administration cap blocks), or
    /// the player can't afford it (<see cref="CommandErrorCode.Range"/>) — the
    /// spend never proceeds on an unaffordable request.</para>
    /// </summary>
    public interface ICareerActuator
    {
        CommandResult ActivateStrategy(string strategyId, double factor);

        CommandResult DeactivateStrategy(string strategyId);

        CommandResult UnlockTech(string techId);

        CommandResult AcceptContract(string contractId);

        CommandResult DeclineContract(string contractId);

        CommandResult CancelContract(string contractId);

        CommandResult UpgradeFacility(string facilityId);
    }
}
