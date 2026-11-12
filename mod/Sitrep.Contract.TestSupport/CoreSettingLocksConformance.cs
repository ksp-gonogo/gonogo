using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICoreSettingLocks"/> promises, for a host that offers
    /// setting locks to run against its own implementation.
    /// </summary>
    public static class CoreSettingLocksConformance
    {
        /// <summary>
        /// Asks for every lock the contract says is ignored: a setting no Uplink
        /// may lock, a lock with no reason, and a lock from outside any Uplink's
        /// registration, which is where this assertion calls from.
        ///
        /// <para>Fails when any of them throws. An Uplink takes its locks inside
        /// its Register, where a throw marks the whole Uplink unavailable, so a
        /// lock the host will not hold must be logged and dropped, never
        /// thrown.</para>
        /// </summary>
        /// <param name="locks">The host under test.</param>
        public static void AssertIgnoresWhatItCannotHold(ICoreSettingLocks locks)
        {
            Assert.NotNull(locks);
            var name = locks.GetType().Name;

            var asks = new (string Setting, string Reason, string What)[]
            {
                ("not-a-core-setting", "a reason", "a setting no Uplink may lock"),
                (CoreSettings.TelemetryRequiresCharge, "", "a lock with no reason"),
                (CoreSettings.TelemetryRequiresCharge, null!, "a lock with a null reason"),
                (CoreSettings.TelemetryRequiresCharge, "a reason", "a lock from outside an Uplink's registration"),
            };
            foreach (var ask in asks)
            {
                Exception? thrown = null;
                try
                {
                    locks.Lock(ask.Setting, true, ask.Reason);
                }
                catch (Exception ex)
                {
                    thrown = ex;
                }
                Assert.True(
                    thrown == null,
                    name + ".Lock threw " + (thrown?.GetType().Name ?? "") + " for " + ask.What + ": "
                    + (thrown?.Message ?? "") + ". Inside an Uplink's Register a throw takes the whole Uplink down.");
            }
        }
    }
}
