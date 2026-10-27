using System;
using System.Linq;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// A vessel command is refused when it is sent, with one reason, while a kerbal is the craft.
    /// </summary>
    public class KerbalCraftGateTests
    {
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        private static GateVerdict Judge(Func<bool> craftIsKerbal) =>
            new KerbalIsTheCraftGate(craftIsKerbal).Evaluate(CareerGates.KerbalIsNotTheCraft, new NoArguments());

        [Fact]
        public void AKerbalThatIsTheCraftIsRefusedWithTheOneReason()
        {
            var verdict = Judge(() => true);

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.NoVessel, verdict.ErrorCode);
            Assert.Equal(KerbalIsTheCraftGate.Reason, verdict.Detail);
        }

        [Fact]
        public void AnyOtherCraftPasses()
        {
            Assert.Equal(GateOutcome.Pass, Judge(() => false).Outcome);
        }

        [Fact]
        public void AReadThatThrowsIsUnknownNotAPass()
        {
            var verdict = Judge(() => throw new InvalidOperationException("no flight"));

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        [Fact]
        public void EveryCommandThatNeedsACraftDeclaresTheGate()
        {
            Assert.NotEmpty(GateDeclarations.KerbalGated);
            foreach (var command in GateDeclarations.KerbalGated)
            {
                Assert.Contains(
                    GateDeclarations.For(command),
                    r => r.Kind == KspGateEvaluators.Kinds.KerbalIsTheCraft);
            }
        }

        [Fact]
        public void TheGateIsAddedBesideTheGatesACommandAlreadyHas()
        {
            var requirements = GateDeclarations.For(RoboticsCommandProvider.ServoSetAngleCommand);

            Assert.Contains(requirements, r => r.Kind == KspGateEvaluators.Kinds.PartModuleResearched);
            Assert.Contains(requirements, r => r.Kind == KspGateEvaluators.Kinds.KerbalIsTheCraft);
        }

        [Fact]
        public void TheLampCommandIsNotRefusedForAKerbalBeingTheCraft()
        {
            Assert.DoesNotContain(
                GateDeclarations.For(EvaKerbalCommandProvider.SetLampCommand),
                r => r.Kind == KspGateEvaluators.Kinds.KerbalIsTheCraft);
            Assert.DoesNotContain(VesselCommandProvider.SetWarpIndexCommand, GateDeclarations.KerbalGated);
            Assert.DoesNotContain(VesselCommandProvider.SetPausedCommand, GateDeclarations.KerbalGated);
        }
    }
}
