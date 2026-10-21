using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// <c>deployed.bases</c> lists every Breaking Ground base in the save. It is captured
    /// in every game scene, not with the craft being flown, and a base whose vessel is not
    /// loaded is read from Breaking Ground's own cluster registry.
    ///
    /// <para>Source text, not behaviour: the capture reads live KSP and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class DeployedScienceIsTheWholeSaveTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void the_roster_is_captured_outside_the_active_vessel()
        {
            var science = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?> BuildScience(Vessel vessel)");

            Assert.DoesNotContain("BuildDeployedScience", science, StringComparison.Ordinal);
            Assert.Contains("TryBuildGroup(values, \"deployedScience\", () => BuildDeployedScience());", Source, StringComparison.Ordinal);
        }

        [Fact]
        public void an_unloaded_base_is_read_from_the_registry()
        {
            var walk = CurrencyDelaySourceText.MethodBody(Source, "private static List<object?>? BuildDeployedScience()");

            Assert.Contains("DeployedScienceRegistry.Instance", walk, StringComparison.Ordinal);
            Assert.Contains("AddUnloadedDeployedScience(registry, list!)", walk, StringComparison.Ordinal);
            Assert.Contains("if (vessel == null || !vessel.loaded)", walk, StringComparison.Ordinal);
        }
    }
}
