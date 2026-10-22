using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>The live game behind <see cref="InstrumentDeployGate"/>. MAIN-THREAD only, like every gate evaluation.</summary>
    internal sealed class KspInstrumentJudge : IInstrumentJudge
    {
        public CommandResult JudgeDeploy(string partId, string? experimentId) =>
            KspScienceActuator.JudgeDeploy(partId, experimentId);

        public CommandResult JudgeTransmitter() => KspScienceActuator.JudgeTransmitter();

        public IEnumerable<string> Experiments()
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null) yield break;
            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null) continue;
                foreach (var experiment in part.Modules.GetModules<ModuleScienceExperiment>())
                {
                    if (experiment == null || string.IsNullOrEmpty(experiment.experimentID)) continue;
                    yield return GateItemKey.ValueOf(part.flightID.ToString(), experiment.experimentID);
                }
            }
        }
    }
}
