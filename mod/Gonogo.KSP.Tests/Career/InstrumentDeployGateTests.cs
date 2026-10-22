using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Deploy is asked of the actuator's own judge per experiment, by its part and its own id:
    /// the gate publishes the refusal the press would get, and a part's other experiment, which
    /// would run, stays live.
    /// </summary>
    public class InstrumentDeployGateTests
    {
        private static readonly CommandRequirement Requirement = new CommandRequirement
        {
            Kind = KspGateEvaluators.Kinds.InstrumentDeploy,
            Needs = new[] { InstrumentDeployGate.Arguments.PartId, InstrumentDeployGate.Arguments.ExperimentId },
        };

        [Fact]
        public void ADeclaredDeployRequirementNamesThePartAndTheExperiment()
        {
            var declared = GateDeclarations.For("science.experiment.deploy");

            var requirement = Assert.Single(declared);
            Assert.Equal(KspGateEvaluators.Kinds.InstrumentDeploy, requirement.Kind);
            Assert.Equal(new[] { "partId", "experimentId" }, requirement.Needs);
        }

        [Fact]
        public void AnExperimentTheActuatorWouldRefuseCarriesItsOwnCodeAndSentence()
        {
            var gate = new InstrumentDeployGate(new Judge { Refuse = "the experiment has already been run" });

            var verdict = gate.Evaluate(Requirement, Arguments("77", "barometerScan"));

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.WrongState, verdict.ErrorCode);
            Assert.Equal("the experiment has already been run", verdict.Detail);
        }

        [Fact]
        public void ThePartAndTheExperimentAreBothHandedToTheJudge()
        {
            var judge = new Judge();
            var gate = new InstrumentDeployGate(judge);

            var verdict = gate.Evaluate(Requirement, Arguments("77", "barometerScan"));

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
            Assert.Equal(("77", "barometerScan"), judge.Asked.Single());
        }

        [Fact]
        public void ACallThatNamesNoPartIsUnknownRatherThanPassed()
        {
            var gate = new InstrumentDeployGate(new Judge());

            Assert.Equal(GateOutcome.Unknown, gate.Evaluate(Requirement, Arguments(null, "barometerScan")).Outcome);
        }

        [Fact]
        public void EveryExperimentOnTheVesselIsAnItemWrittenWithBothIds()
        {
            var gate = new InstrumentDeployGate(new Judge());

            var asked = gate.Items(Requirement).ToList();

            Assert.Equal(
                new[] { GateItemKey.ValueOf("77", "barometerScan"), GateItemKey.ValueOf("77", "temperatureScan") },
                asked);
        }

        private static IGateArguments Arguments(string? part, string experiment)
        {
            var bag = new Dictionary<string, object> { ["experimentId"] = experiment };
            if (part != null) bag["partId"] = part;
            return new Bag(bag);
        }

        private sealed class Bag : IGateArguments
        {
            private readonly Dictionary<string, object> _values;

            public Bag(Dictionary<string, object> values) => _values = values;

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        private sealed class Judge : IInstrumentJudge
        {
            public string? Refuse { get; set; }

            public List<(string Part, string? Experiment)> Asked { get; } = new List<(string, string?)>();

            public CommandResult JudgeDeploy(string partId, string? experimentId)
            {
                Asked.Add((partId, experimentId));
                return Refuse == null ? CommandResult.Ok() : CommandResult.Fail(CommandErrorCode.WrongState, Refuse);
            }

            public IEnumerable<string> Experiments() => new[]
            {
                GateItemKey.ValueOf("77", "barometerScan"),
                GateItemKey.ValueOf("77", "temperatureScan"),
            };
        }
    }
}
