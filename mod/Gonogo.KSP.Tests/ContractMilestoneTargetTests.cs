using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// An objective that is a progress milestone carries the milestone, its body and, for reaching
    /// space, the top of that body's atmosphere. Read as source for the same reason
    /// <c>SandboxRecoveryIsWiredTests</c> is: the parameters are live contract objects.
    /// </summary>
    public class ContractMilestoneTargetTests
    {
        [Fact]
        public void a_milestone_objective_publishes_its_goal_and_only_reaching_space_has_an_altitude()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var parameters = CurrencyDelaySourceText.MethodBody(source, "private static Dictionary<string, object?> BuildContractParameter(ContractParameter parameter)");
            var altitude = CurrencyDelaySourceText.MethodBody(source, "private static double? MilestoneTargetAltitude(FinePrint.Utilities.ProgressMilestone milestone)");

            foreach (var key in new[] { "[\"milestone\"]", "[\"milestoneBody\"]", "[\"targetAltitude\"]" })
            {
                Assert.Contains(key, parameters, StringComparison.Ordinal);
            }

            Assert.Contains("ProgressType.REACHSPACE", altitude, StringComparison.Ordinal);
            Assert.Contains("body.atmosphereDepth", altitude, StringComparison.Ordinal);
        }
    }
}
