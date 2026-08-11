using Sitrep.Contract;

namespace Sitrep.Host.Science
{
    /// <summary>
    /// The always-present Vanilla science backend: stock KSP science, which is
    /// what a plain install (and any install whose science mod ships no
    /// provider) resolves to. The reliability analogue is
    /// <see cref="Reliability.NoneReliabilityBackend"/>, with one difference
    /// worth stating: reliability's vanilla is a "not modelled" stub because
    /// stock KSP has no reliability model at all, whereas stock KSP DOES model
    /// science, so science's vanilla is the real thing.
    ///
    /// <para>Every method here is a straight delegation to the code that
    /// already served these channels before the capability existed
    /// (<see cref="ScienceViewProvider"/> for the reads,
    /// <see cref="ScienceCommandProvider"/> plus the injected
    /// <see cref="IScienceActuator"/> for the commands). That is the whole
    /// design: the election seam is indirection ONLY, so the vanilla wire is
    /// byte-identical to the pre-election wire by construction rather than by
    /// inspection. <c>Sitrep.Host.Tests.ScienceElectionWireTests</c> pins that
    /// as bytes through the real codec.</para>
    ///
    /// <para>KSP-free, like everything else in this assembly: the reads map the
    /// snapshot <c>Gonogo.KSP.KspHost.BuildScience</c> already captured, and
    /// the commands go through the actuator interface whose real implementation
    /// (<c>Gonogo.KSP.KspScienceActuator</c>) is the only KSP-touching half.</para>
    /// </summary>
    public sealed class StockScienceBackend : IScienceBackend
    {
        private readonly IScienceActuator _actuator;

        public StockScienceBackend(IScienceActuator actuator)
        {
            _actuator = actuator;
        }

        public string BackendId => "stock";

        public object? Experiments(KspSnapshot? snapshot) => ScienceViewProvider.BuildExperiments(snapshot);

        public object? Instruments(KspSnapshot? snapshot) => ScienceViewProvider.BuildInstruments(snapshot);

        public object? Sensors(KspSnapshot? snapshot) => ScienceViewProvider.BuildSensors(snapshot);

        public object? Lab(KspSnapshot? snapshot) => ScienceViewProvider.BuildLab(snapshot);

        public object? ExperimentBreakdown(KspSnapshot? snapshot) => ScienceViewProvider.BuildExperimentBreakdown(snapshot);

        public CommandResult DeployExperiment(ExperimentActionArgs args) =>
            ScienceCommandProvider.HandleDeploy(_actuator, args);

        public CommandResult TransmitExperiment(ExperimentActionArgs args) =>
            ScienceCommandProvider.HandleTransmit(_actuator, args);
    }
}
