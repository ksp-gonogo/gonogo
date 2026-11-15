using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host.Comms
{
    /// <summary>Reaches the delivery network's test seams for the test projects, which see this assembly's internals and not the network's.</summary>
    internal static class DeliveryNetworkSeams
    {
        /// <summary>Sets <see cref="DeliveryNetwork.WakesOnDishTurnWaits"/>.</summary>
        public static void WakeOnDishTurnWaits(DeliveryNetwork network, bool wakes) => network.WakesOnDishTurnWaits = wakes;
    }
}
