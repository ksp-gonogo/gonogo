using Gonogo.KSP.ObjectiveDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.ObjectiveDelay
{
    public class ObjectiveDelayHealthTests
    {
        [Fact]
        public void WithoutContractConfiguratorTheLineIsHealthy()
        {
            Assert.Equal(UplinkHealthState.Healthy, ObjectiveDelayHealth.Of(false, false, null).State);
        }

        [Fact]
        public void ContractConfiguratorWithNoUplinkHoldingItsObjectivesIsDegraded()
        {
            var health = ObjectiveDelayHealth.Of(contractConfiguratorLoaded: true, contractConfiguratorBound: false, hooksFailure: null);

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Contains("Contract Configurator", health.Detail);
        }

        [Fact]
        public void ContractConfiguratorWithAnUplinkHoldingItsObjectivesIsHealthy()
        {
            Assert.Equal(UplinkHealthState.Healthy, ObjectiveDelayHealth.Of(true, true, null).State);
        }

        [Fact]
        public void HooksThatCouldNotBeInstalledAreDegraded()
        {
            var health = ObjectiveDelayHealth.Of(false, false, "SetComplete was not found");

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Contains("SetComplete was not found", health.Detail);
        }

        [Fact]
        public void TheOwnerIdTheHealthCheckReadsIsTheOneTheSeamPublishes()
        {
            Assert.Equal("contractConfigurator", ObjectiveDelayCapability.ContractConfiguratorOwner);
            Assert.Equal("ContractConfigurator", ObjectiveDelayHealth.ContractConfiguratorAssembly);
        }
    }
}
