using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Which saves a command declared against <c>HighLogic.CurrentGame.Mode</c>
    /// is live in. A science game has the research tree and science points of a
    /// career and none of its funds, contracts or strategies.
    /// </summary>
    public class GameModeGateTests
    {
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        private static GateVerdict Judge(Game.Modes? mode, CommandRequirement requirement) =>
            new GameModeGate(() => mode).Evaluate(requirement, new NoArguments());

        [Theory]
        [InlineData(Game.Modes.CAREER)]
        [InlineData(Game.Modes.SCIENCE_SANDBOX)]
        public void ResearchingATechNodeIsLiveInACareerAndInAScienceGame(Game.Modes mode)
        {
            var requirements = GateDeclarations.For(CareerCommandProvider.UnlockTechCommand);

            foreach (var requirement in requirements)
            {
                if (requirement.Kind != KspGateEvaluators.Kinds.GameMode) continue;
                Assert.Equal(GateOutcome.Pass, Judge(mode, requirement).Outcome);
            }
            Assert.Contains(requirements, r => r.Kind == KspGateEvaluators.Kinds.GameMode);
        }

        [Fact]
        public void ResearchingATechNodeIsRefusedInASandbox()
        {
            var verdict = Judge(Game.Modes.SANDBOX, CareerGates.ResearchMode);

            Assert.Equal(CommandErrorCode.CareerModeRequired, verdict.ErrorCode);
        }

        [Theory]
        [InlineData(CareerCommandProvider.AcceptContractCommand)]
        [InlineData(CareerCommandProvider.ActivateStrategyCommand)]
        [InlineData(CareerCommandProvider.UpgradeFacilityCommand)]
        public void TheMoneyCommandsStayRefusedInAScienceGame(string command)
        {
            var requirement = System.Linq.Enumerable.First(
                GateDeclarations.For(command),
                r => r.Kind == KspGateEvaluators.Kinds.GameMode);

            var verdict = Judge(Game.Modes.SCIENCE_SANDBOX, requirement);

            Assert.Equal(CommandErrorCode.CareerModeRequired, verdict.ErrorCode);
        }

        [Theory]
        [InlineData(CareerCommandProvider.HireApplicantCommand)]
        [InlineData(CareerCommandProvider.FireCrewCommand)]
        public void HiringAndFiringCrewIsLiveInACareerAndInAScienceGameButNotASandbox(string command)
        {
            var requirement = System.Linq.Enumerable.First(
                GateDeclarations.For(command),
                r => r.Kind == KspGateEvaluators.Kinds.GameMode);

            Assert.Equal(GateOutcome.Pass, Judge(Game.Modes.CAREER, requirement).Outcome);
            Assert.Equal(GateOutcome.Pass, Judge(Game.Modes.SCIENCE_SANDBOX, requirement).Outcome);
            Assert.Equal(CommandErrorCode.CareerModeRequired, Judge(Game.Modes.SANDBOX, requirement).ErrorCode);
        }

        [Theory]
        [InlineData(Game.Modes.CAREER, true)]
        [InlineData(Game.Modes.SCIENCE_SANDBOX, true)]
        [InlineData(Game.Modes.SANDBOX, false)]
        public void OnlyCareerAndScienceGamesHaveAnApplicantPoolToHireFrom(Game.Modes mode, bool expected)
        {
            Assert.Equal(expected, CareerGates.HasCrewHiring(mode));
            Assert.False(CareerGates.HasCrewHiring(null));
        }

        [Fact]
        public void NoLoadedGameIsUnknownRatherThanRefused()
        {
            var verdict = Judge(null, CareerGates.ResearchMode);

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }
    }
}
