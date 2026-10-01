using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Strategies;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// The career gates whose answer depends on which item a call names: which
    /// facility is upgraded, which node is researched, which strategy is begun
    /// or ended.
    ///
    /// <para>Each one asks the actuator's own judge, which runs the command's
    /// checks in the command's order and stops short of spending, so the verdict
    /// published before the press is the refusal the press would get. None of
    /// them restates a rule of its own.</para>
    /// </summary>
    internal static class ItemGates
    {
        public static class Kinds
        {
            public const string FacilityUpgrade = "facility-upgrade";
            public const string TechUnlock = "tech-unlock";
            public const string StrategyActivate = "strategy-activate";
            public const string StrategyDeactivate = "strategy-deactivate";
        }

        /// <summary>The argument each command names its item by, as the client sends it.</summary>
        public static class Arguments
        {
            public const string FacilityId = "facilityId";
            public const string TechId = "techId";
            public const string StrategyId = "strategyId";
        }

        public static IEnumerable<ICommandGateEvaluator> All(ICareerItemJudge judge)
        {
            yield return new FacilityUpgradeGate(judge);
            yield return new TechUnlockGate(judge);
            yield return new StrategyActivateGate(judge);
            yield return new StrategyDeactivateGate(judge);
        }

        public static CommandRequirement For(string kind, string argument) => new CommandRequirement
        {
            Kind = kind,
            Needs = new[] { argument },
        };

        /// <summary>A judge's answer as a gate verdict: an <c>Ok</c> passes, a refusal fails with its own code and evidence.</summary>
        public static GateVerdict ToVerdict(CommandResult judged)
        {
            if (judged.Success) return GateVerdict.Pass();
            var code = judged.ErrorCode ?? CommandErrorCode.ModeUnavailable;
            if (code.Root == CommandErrorCode.Unreadable) return GateVerdict.Unknown(judged.Detail ?? "");
            return new GateVerdict
            {
                Outcome = GateOutcome.Fail,
                ErrorCode = code,
                Breach = judged.Breach,
                Detail = judged.Detail ?? "",
            };
        }

        /// <summary>The item the call names, or null; the host has already established that it is present.</summary>
        public static string? Item(IGateArguments arguments, string path) =>
            arguments.TryGet(path, out var value) ? value as string : null;

        public static GateVerdict Judge(Func<CommandResult> judge, string what)
        {
            try
            {
                return ToVerdict(judge());
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not judge " + what + ": " + ex.Message);
            }
        }
    }

    /// <summary>Whether this facility can be upgraded now: its tier, what stands on it, and the price of the next tier against the career's funds.</summary>
    internal sealed class FacilityUpgradeGate : ICommandGateEvaluator, ICommandGateItems
    {
        private readonly ICareerItemJudge _actuator;

        public FacilityUpgradeGate(ICareerItemJudge actuator) => _actuator = actuator;

        public string Kind => ItemGates.Kinds.FacilityUpgrade;

        public IEnumerable<string> Items(CommandRequirement requirement) =>
            Enum.GetNames(typeof(SpaceCenterFacility));

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var facilityId = ItemGates.Item(arguments, ItemGates.Arguments.FacilityId);
            if (string.IsNullOrEmpty(facilityId)) return GateVerdict.Unknown("no facility was named");
            return ItemGates.Judge(() => _actuator.JudgeUpgradeFacility(facilityId!), "the upgrade");
        }
    }

    /// <summary>Whether this node can be researched now: the science it costs against the career's science, and the R&amp;D tier's ceiling on a node's cost.</summary>
    internal sealed class TechUnlockGate : ICommandGateEvaluator, ICommandGateItems
    {
        private readonly ICareerItemJudge _actuator;

        public TechUnlockGate(ICareerItemJudge actuator) => _actuator = actuator;

        public string Kind => ItemGates.Kinds.TechUnlock;

        /// <summary>
        /// The nodes still to be researched whose prerequisites allow it, which
        /// is every node a tree can offer a control for. Each costs a currency
        /// query on the main thread, so the rest of the tree is not asked.
        /// </summary>
        public IEnumerable<string> Items(CommandRequirement requirement)
        {
            var tree = AssetBase.RnDTechTree;
            var nodes = tree != null ? tree.GetTreeNodes() : null;
            if (nodes == null || ResearchAndDevelopment.Instance == null) yield break;
            foreach (var node in nodes)
            {
                var techId = node?.tech?.techID;
                if (string.IsNullOrEmpty(techId) || Researched(techId!)) continue;
                if (PrerequisitesMet(node!)) yield return techId!;
            }
        }

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var techId = ItemGates.Item(arguments, ItemGates.Arguments.TechId);
            if (string.IsNullOrEmpty(techId)) return GateVerdict.Unknown("no node was named");
            return ItemGates.Judge(() => _actuator.JudgeUnlockTech(techId!), "the research");
        }

        private static bool Researched(string techId) =>
            ResearchAndDevelopment.GetTechnologyState(techId) == RDTech.State.Available;

        private static bool PrerequisitesMet(ProtoRDNode node)
        {
            if (node.parents == null || node.parents.Count == 0) return true;
            var any = false;
            var all = true;
            foreach (var parent in node.parents)
            {
                var parentId = parent?.tech?.techID;
                var met = !string.IsNullOrEmpty(parentId) && Researched(parentId!);
                any |= met;
                all &= met;
            }
            return node.AnyParentToUnlock ? any : all;
        }
    }

    /// <summary>
    /// Whether this strategy can be begun now, by the route the command itself
    /// would take: KSP's own check while the Administration Building is open,
    /// the arms one at a time while it is shut.
    /// </summary>
    internal sealed class StrategyActivateGate : ICommandGateEvaluator, ICommandGateItems
    {
        private readonly ICareerItemJudge _actuator;

        public StrategyActivateGate(ICareerItemJudge actuator) => _actuator = actuator;

        public string Kind => ItemGates.Kinds.StrategyActivate;

        public IEnumerable<string> Items(CommandRequirement requirement) => StrategyItems.Ids(active: false);

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var strategyId = ItemGates.Item(arguments, ItemGates.Arguments.StrategyId);
            if (string.IsNullOrEmpty(strategyId)) return GateVerdict.Unknown("no strategy was named");
            return ItemGates.Judge(() => _actuator.JudgeActivateStrategy(strategyId!), "the activation");
        }
    }

    /// <summary>Whether this running strategy can be ended now: KSP's own <c>CanBeDeactivated</c>, which includes the minimum commitment.</summary>
    internal sealed class StrategyDeactivateGate : ICommandGateEvaluator, ICommandGateItems
    {
        private readonly ICareerItemJudge _actuator;

        public StrategyDeactivateGate(ICareerItemJudge actuator) => _actuator = actuator;

        public string Kind => ItemGates.Kinds.StrategyDeactivate;

        public IEnumerable<string> Items(CommandRequirement requirement) => StrategyItems.Ids(active: true);

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var strategyId = ItemGates.Item(arguments, ItemGates.Arguments.StrategyId);
            if (string.IsNullOrEmpty(strategyId)) return GateVerdict.Unknown("no strategy was named");
            return ItemGates.Judge(() => _actuator.JudgeDeactivateStrategy(strategyId!), "the deactivation");
        }
    }

    /**
     * The career actuator's own checks, asked without spending. Each answers
     * what the command would answer for that item, as a CommandResult, so a
     * gate restates no rule of its own.
     */
    internal interface ICareerItemJudge
    {
        CommandResult JudgeUpgradeFacility(string facilityId);

        CommandResult JudgeUnlockTech(string techId);

        /// <summary>At the factor the strategy already carries; a refusal that turns on the factor is left to the dispatch, which has the operator's.</summary>
        CommandResult JudgeActivateStrategy(string strategyId);

        CommandResult JudgeDeactivateStrategy(string strategyId);
    }

    internal static class StrategyItems
    {
        /// <summary>The ids of the strategies that are, or are not, running: the ones a control could offer to end, or to begin.</summary>
        public static IEnumerable<string> Ids(bool active)
        {
            var strategies = StrategySystem.Instance?.Strategies;
            if (strategies == null) yield break;
            foreach (var strategy in strategies)
            {
                var id = strategy?.Config?.Name;
                if (!string.IsNullOrEmpty(id) && strategy!.IsActive == active) yield return id!;
            }
        }
    }
}
