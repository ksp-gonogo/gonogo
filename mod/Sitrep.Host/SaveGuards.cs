using System;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>What the Uplinks registered under <see cref="SaveGuardCapability"/> say about saving now.</summary>
    public static class SaveGuards
    {
        /// <summary>Whether any guard forbids a quicksave. A guard that cannot answer forbids it, since a save written where one must not be cannot be taken back.</summary>
        public static bool AnyForbids(Kernel kernel)
        {
            foreach (var active in kernel.Active(SaveGuardCapability.Id))
            {
                try
                {
                    if (active is ISaveGuard guard && guard.ForbidsSaving)
                    {
                        return true;
                    }
                }
                catch (Exception)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
