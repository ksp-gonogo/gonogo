using System;
using Contracts;
using Sitrep.Contract;
using Sitrep.Host;
using Strategies;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="ICareerActuator"/> — the career-write actuation seam,
    /// wired to <c>StrategySystem</c>/<c>ResearchAndDevelopment</c>/
    /// <c>ContractSystem</c>/<c>ScenarioUpgradeableFacilities</c>/<c>Funding</c>,
    /// each call confirmed against this KSP version's actual API shapes via
    /// decompile (see each method's own comment for the specific call). Every
    /// entity is resolved by the SAME stable id the READ side
    /// (<see cref="KspHost"/>'s career capture) already emits, so a client acts
    /// on exactly what it read.
    ///
    /// <para>Like <see cref="KspVesselActuator"/>, this touches KSP/Unity APIs
    /// directly and runs on the Unity main thread — <see cref="ChannelEngine"/>
    /// is constructed with <c>executeCommandsOnMainThread: true</c>
    /// (<c>GonogoAddon.Awake</c>), so every command handler is marshaled onto the
    /// main-thread pump before it reaches here; no KSP/Unity API below is ever
    /// touched from the Courier thread.</para>
    ///
    /// <para>These are SPEND actions. The two paid paths that KSP does NOT bundle
    /// into a single self-deducting call — tech unlock and facility upgrade —
    /// reproduce the stock spend sequence explicitly (check affordability, deduct
    /// the currency, then apply), returning before any spend on an unaffordable
    /// request. The paths KSP DOES bundle — <c>Strategy.Activate</c>/
    /// <c>Deactivate</c> and <c>Contract.Accept</c>/<c>Decline</c>/<c>Cancel</c>
    /// — are self-gating and self-deducting, so a <c>false</c> return from them
    /// means "not valid in the current state" with no partial spend, surfaced as
    /// <see cref="CommandErrorCode.ModeUnavailable"/>.</para>
    /// </summary>
    public sealed class KspCareerActuator : ICareerActuator
    {
        /// <summary>
        /// <c>Strategy.Activate()</c> is self-gating (<c>CanBeActivated</c> —
        /// administration-level cap, conflicting-strategy groups, funds on hand)
        /// and self-deducting (its up-front funds/science/reputation cost, each
        /// scaled by <c>Factor</c>), so a <c>false</c> return is a clean
        /// "not eligible" with no partial spend. <c>Factor</c> is set BEFORE
        /// activation because the cost scales with it, and only for strategies
        /// that actually expose a slider (<c>HasFactorSlider</c>) — best-effort,
        /// per the command's contract; others activate at their fixed factor.
        /// </summary>
        public CommandResult ActivateStrategy(string strategyId, double factor)
        {
            var system = StrategySystem.Instance;
            if (system == null || system.Strategies == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var strategy = FindStrategy(system, strategyId);
            if (strategy == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (strategy.IsActive)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            if (strategy.HasFactorSlider && factor > 0.0)
            {
                strategy.Factor = Mathf.Clamp01((float)factor);
            }

            return strategy.Activate()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        /// <summary><c>Strategy.Deactivate()</c> is self-gating (<c>CanBeDeactivated</c>) — a <c>false</c> return means it wasn't deactivatable right now.</summary>
        public CommandResult DeactivateStrategy(string strategyId)
        {
            var system = StrategySystem.Instance;
            if (system == null || system.Strategies == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var strategy = FindStrategy(system, strategyId);
            if (strategy == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (!strategy.IsActive)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            return strategy.Deactivate()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        /// <summary>
        /// Reproduces the stock research spend. The node's science cost lives on
        /// the STATIC tech tree — <c>ResearchAndDevelopment.GetTechState</c> only
        /// returns a node once it's already been researched/started, so it can't
        /// price a not-yet-unlocked tech; the cost is read off
        /// <c>AssetBase.RnDTechTree.GetTreeTechs()</c>'s <c>ProtoTechNode[]</c>
        /// (the same proto shape <c>UnlockProtoTechNode</c> consumes). Science is
        /// deducted here because <c>UnlockProtoTechNode</c> itself does not — the
        /// free progress-reward path in stock KSP calls it directly with no
        /// deduction — so on an unaffordable request this returns before any
        /// spend. Already-unlocked techs are rejected up front.
        /// </summary>
        public CommandResult UnlockTech(string techId)
        {
            var rnd = ResearchAndDevelopment.Instance;
            var tree = AssetBase.RnDTechTree;
            if (rnd == null || tree == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            if (ResearchAndDevelopment.GetTechnologyState(techId) == RDTech.State.Available)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            ProtoTechNode? node = null;
            var treeTechs = tree.GetTreeTechs();
            if (treeTechs != null)
            {
                foreach (var candidate in treeTechs)
                {
                    if (candidate != null && string.Equals(candidate.techID, techId, StringComparison.Ordinal))
                    {
                        node = candidate;
                        break;
                    }
                }
            }
            if (node == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            if (!ResearchAndDevelopment.CanAfford((float)node.scienceCost))
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }

            rnd.AddScience(-(float)node.scienceCost, TransactionReasons.RnDTechResearch);
            rnd.UnlockProtoTechNode(node);
            ResearchAndDevelopment.RefreshTechTreeUI();
            return CommandResult.Ok();
        }

        /// <summary><c>Contract.Accept()</c> is self-gating on state (valid only when Offered) and applies its own funds advance — a <c>false</c> return means the contract wasn't in an acceptable state.</summary>
        public CommandResult AcceptContract(string contractId) =>
            WithContract(contractId, contract => contract.Accept()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable));

        /// <summary><c>Contract.Decline()</c> is self-gating on state (valid only when Offered) and applies its own reputation penalty — a <c>false</c> return means it wasn't declinable.</summary>
        public CommandResult DeclineContract(string contractId) =>
            WithContract(contractId, contract => contract.Decline()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable));

        /// <summary><c>Contract.Cancel()</c> is self-gating on state (valid only when Active) and applies its own penalty — a <c>false</c> return means it wasn't cancellable.</summary>
        public CommandResult CancelContract(string contractId) =>
            WithContract(contractId, contract => contract.Cancel()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable));

        /// <summary>
        /// Reproduces the stock <c>UpgradeFacilityDialog</c> spend: resolve the
        /// live facility exactly as the read side does
        /// (<c>ScenarioUpgradeableFacilities.protoUpgradeables[SlashSanitize(id)]</c>
        /// → <c>facilityRefs[0]</c>), guard against already-max, read
        /// <c>GetUpgradeCost()</c> (the cost to the next tier), check funds,
        /// deduct, then raise the level. <c>SetLevel</c> fires the upgrade
        /// GameEvents but does NOT deduct — the level increment and the fund
        /// deduction are separate steps — so an unaffordable request returns
        /// before any spend.
        /// </summary>
        public CommandResult UpgradeFacility(string facilityId)
        {
            if (ScenarioUpgradeableFacilities.Instance == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var sanitizedId = ScenarioUpgradeableFacilities.SlashSanitize(facilityId);
            if (!ScenarioUpgradeableFacilities.protoUpgradeables.TryGetValue(sanitizedId, out var proto) ||
                proto?.facilityRefs == null || proto.facilityRefs.Count == 0 || proto.facilityRefs[0] == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var live = proto.facilityRefs[0];
            if (live.FacilityLevel >= live.MaxLevel)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var funding = Funding.Instance;
            if (funding == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var cost = live.GetUpgradeCost();
            if (funding.Funds < cost)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }

            funding.AddFunds(-cost, TransactionReasons.StructureConstruction);
            live.SetLevel(live.FacilityLevel + 1);
            return CommandResult.Ok();
        }

        /// <summary>Resolve a strategy by its stable <c>StrategyConfig.Name</c> (the read-side id) against the live roster.</summary>
        private static Strategy? FindStrategy(StrategySystem system, string strategyId)
        {
            foreach (var strategy in system.Strategies)
            {
                if (strategy?.Config != null && string.Equals(strategy.Config.Name, strategyId, StringComparison.Ordinal))
                {
                    return strategy;
                }
            }
            return null;
        }

        /// <summary>
        /// Resolve a contract by its stringified <c>ContractID</c> (the read-side
        /// id — <c>ContractID</c>, not <c>ContractGuid</c>) against the live
        /// not-yet-finished list (<c>ContractSystem.Instance.Contracts</c>, which
        /// holds both Offered and Active), then run <paramref name="action"/> on
        /// it. Fails <see cref="CommandErrorCode.NotFound"/> when nothing carries
        /// the id, <see cref="CommandErrorCode.ModeUnavailable"/> when there's no
        /// live contract system at all.
        /// </summary>
        private static CommandResult WithContract(string contractId, Func<Contract, CommandResult> action)
        {
            var system = ContractSystem.Instance;
            if (system == null || system.Contracts == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            foreach (var contract in system.Contracts)
            {
                if (contract != null && string.Equals(contract.ContractID.ToString(), contractId, StringComparison.Ordinal))
                {
                    return action(contract);
                }
            }
            return CommandResult.Fail(CommandErrorCode.NotFound);
        }
    }
}
