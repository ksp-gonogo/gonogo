using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Science
{
    /// <summary>
    /// A start on a converter whose part has not unfolded: the game's
    /// <c>StartResourceConverter()</c> returns with only a screen message and
    /// <c>IsActivated</c> still false, so a bare call reports a start that did
    /// not happen. The plan asks the animation first.
    /// </summary>
    public class ConverterRunRuleTests
    {
        private const string NeedsDeploy = "the part must be deployed before it can start";

        [Fact]
        public void AStartBeforeTheAnimationIsDeployedIsRefusedRatherThanReportedAsStarted()
        {
            var plan = Plan(activated: false, wantOn: true, hasAnimationGroup: true, animationDeployed: false);

            Assert.Equal(ConverterMove.Refuse, plan.Move);
            Assert.Equal(CommandErrorCode.WrongState, plan.Refusal!.Value.Code);
            Assert.Equal(NeedsDeploy, plan.Refusal.Value.Detail);
        }

        [Fact]
        public void AStartOnAnUnfoldedPartSwitchesTheConverter()
        {
            Assert.Equal(
                ConverterMove.Switch,
                Plan(activated: false, wantOn: true, hasAnimationGroup: true, animationDeployed: true).Move);
        }

        [Fact]
        public void AStartOnAPartWithNoAnimationGroupSwitchesTheConverter()
        {
            Assert.Equal(
                ConverterMove.Switch,
                Plan(activated: false, wantOn: true, hasAnimationGroup: false, animationDeployed: false).Move);
        }

        [Fact]
        public void AStartOnARunningConverterChangesNothing()
        {
            Assert.Equal(
                ConverterMove.AlreadyThere,
                Plan(activated: true, wantOn: true, hasAnimationGroup: true, animationDeployed: true).Move);
        }

        [Fact]
        public void AStopOnAStoppedConverterChangesNothing()
        {
            Assert.Equal(
                ConverterMove.AlreadyThere,
                Plan(activated: false, wantOn: false, hasAnimationGroup: true, animationDeployed: false).Move);
        }

        [Fact]
        public void AStopOnARunningConverterSwitchesItEvenWithTheAnimationRetracted()
        {
            Assert.Equal(
                ConverterMove.Switch,
                Plan(activated: true, wantOn: false, hasAnimationGroup: true, animationDeployed: false).Move);
        }

        private static ConverterPlan Plan(bool activated, bool wantOn, bool hasAnimationGroup, bool animationDeployed) =>
            ConverterRunRule.Plan(activated, wantOn, hasAnimationGroup, animationDeployed, NeedsDeploy);
    }
}
