using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// The science actuator's own checks, asked without running anything. It answers what the
    /// deploy command would answer for an experiment, as a CommandResult, so a gate restates no rule.
    /// </summary>
    internal interface IInstrumentJudge
    {
        CommandResult JudgeDeploy(string partId, string? experimentId);

        /// <summary>What a transmit would answer for the active vessel's transmitters: refused when none can carry a result.</summary>
        CommandResult JudgeTransmitter();

        /// <summary>Every experiment on the active vessel, written with <see cref="GateItemKey"/> as its part and its own id.</summary>
        IEnumerable<string> Experiments();
    }

    /// <summary>
    /// Whether this experiment can be run now, by the answer the deploy command itself would
    /// give: already run and holding its result, spent, cooling down, shielded or short of a
    /// condition. It asks the actuator's own judge, so it restates none of those rules.
    /// An experiment is named by its part and its own id, because a part can carry several.
    /// </summary>
    internal sealed class InstrumentDeployGate : ICommandGateEvaluator, ICommandGateItems
    {
        public static class Arguments
        {
            public const string PartId = "partId";
            public const string ExperimentId = "experimentId";
        }

        private readonly IInstrumentJudge _judge;

        public InstrumentDeployGate(IInstrumentJudge judge) => _judge = judge;

        public string Kind => KspGateEvaluators.Kinds.InstrumentDeploy;

        /// <summary>Every experiment on the active vessel, since any of them could be offered a Deploy control.</summary>
        public IEnumerable<string> Items(CommandRequirement requirement) => _judge.Experiments();

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var partId = ItemGates.Item(arguments, Arguments.PartId);
            if (string.IsNullOrEmpty(partId)) return GateVerdict.Unknown("no part was named");
            var experimentId = ItemGates.Item(arguments, Arguments.ExperimentId);
            return ItemGates.Judge(() => _judge.JudgeDeploy(partId!, experimentId), "the run");
        }
    }

    /// <summary>
    /// Whether anything aboard can carry a result home now, by the answer the transmit command
    /// itself would give. It needs no argument, so a refusal darkens every Transmit control with
    /// the game's reason rather than letting each one be pressed to find out.
    /// </summary>
    internal sealed class TransmitterAvailableGate : ICommandGateEvaluator
    {
        private readonly IInstrumentJudge _judge;

        public TransmitterAvailableGate(IInstrumentJudge judge) => _judge = judge;

        public string Kind => KspGateEvaluators.Kinds.TransmitterAvailable;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
            ItemGates.Judge(_judge.JudgeTransmitter, "the transmission");
    }
}
