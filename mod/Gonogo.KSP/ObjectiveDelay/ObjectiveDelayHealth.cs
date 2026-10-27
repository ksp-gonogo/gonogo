using Sitrep.Contract;

namespace Gonogo.KSP.ObjectiveDelay
{
    /// <summary>
    /// Whether contract objectives reach home after their signal delay. Contract
    /// Configurator changes its objectives by a route Gonogo's own hooks do not
    /// see, so its contracts complete without delay unless an Uplink holds them.
    /// </summary>
    public static class ObjectiveDelayHealth
    {
        /// <summary>The name of Contract Configurator's assembly, as KSP loads it.</summary>
        public const string ContractConfiguratorAssembly = "ContractConfigurator";

        /// <param name="hooksFailure">Why Gonogo's own contract hooks could not be installed, or null when they were.</param>
        public static UplinkHealth Of(bool contractConfiguratorLoaded, bool contractConfiguratorBound, string? hooksFailure)
        {
            if (hooksFailure != null)
            {
                return UplinkHealth.Degraded(
                    "Contract objectives reach the home command without signal delay: the contract hooks "
                    + "could not be installed (" + hooksFailure + ").");
            }
            if (contractConfiguratorLoaded && !contractConfiguratorBound)
            {
                return UplinkHealth.Degraded(
                    "Contract Configurator is installed but no Uplink holds its contracts, so their "
                    + "objectives and rewards reach the home command without signal delay. Install the "
                    + "Contract Configurator Uplink.");
            }
            return UplinkHealth.Healthy;
        }
    }
}
