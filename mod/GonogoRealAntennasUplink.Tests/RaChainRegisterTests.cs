using System.Collections.Generic;
using System.Linq;
using Gonogo.RealAntennasUplink;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// What the craft is holding: the store's two ways in, which differ on
    /// purpose, and the one thing it will not do.
    /// </summary>
    public class RaChainRegisterTests
    {
        private static List<RealAntennasTargetStepArgs> Steps(params string[] modes) =>
            modes.Select(mode => new RealAntennasTargetStepArgs { Mode = mode }).ToList();

        [Fact]
        public void AChainIsFoundByTheAddressItWasSetAgainst()
        {
            var register = new RaChainRegister();

            register.Set("1234/0", Steps("BodyCenter", "Vessel"), null);

            var entry = register.Find("1234/0");
            Assert.NotNull(entry);
            Assert.Equal(2, entry!.Steps.Count);
            Assert.Null(register.Find("1234/1"));
        }

        /// <summary>
        /// An empty list is the only way a walk stops, so it must actually remove
        /// the chain rather than store a chain of nothing: a zero-entry row would
        /// keep being described on the wire as a fallback that exists.
        /// </summary>
        [Fact]
        public void AnEmptyListClearsTheChain()
        {
            var register = new RaChainRegister();
            register.Set("1234/0", Steps("BodyCenter"), null);

            register.Set("1234/0", new List<RealAntennasTargetStepArgs>(), null);

            Assert.Null(register.Find("1234/0"));
            Assert.Equal(0, register.Count);
        }

        /// <summary>
        /// Setting a chain REWINDS the walk. An index into the list the operator
        /// has just replaced says nothing about the new one, and the first entry
        /// of a freshly sent chain is the one they mean to be tried first.
        /// </summary>
        [Fact]
        public void SettingAChainRewindsTheWalk()
        {
            var register = new RaChainRegister();
            register.Set("1234/0", Steps("BodyCenter", "Vessel"), null);
            var entry = register.Find("1234/0")!;
            RaChainPolicy.RecordApplied(entry.Walk, 1, 2, 500.0);

            register.Set("1234/0", Steps("Vessel", "BodyCenter"), null);

            var replaced = register.Find("1234/0")!;
            Assert.Null(replaced.Walk.ActiveStep);
            Assert.Null(replaced.Walk.LastAppliedUt);
            Assert.Equal(0, replaced.Walk.Laps);
        }

        /// <summary>
        /// Restoring does NOT rewind, and that is the difference between the two
        /// ways in. A reload mid-outage must not send the craft back to a target
        /// it has already tried, and must not slew it off the entry that is
        /// currently working.
        /// </summary>
        [Fact]
        public void RestoringKeepsTheWalkWhereTheSaveLeftIt()
        {
            var register = new RaChainRegister();

            register.Restore("1234/0", Steps("BodyCenter", "Vessel", "AzEl"), 45.0, 2, 900.0, 3);

            var entry = register.Find("1234/0")!;
            Assert.Equal(2, entry.Walk.ActiveStep);
            Assert.Equal(900.0, entry.Walk.LastAppliedUt);
            Assert.Equal(3, entry.Walk.Laps);
            Assert.Equal(45.0, entry.SettleSeconds);
        }

        /// <summary>
        /// A saved position the restored list cannot hold is DROPPED, never
        /// clamped. It means the chain was edited between the save and the load,
        /// and clamping would aim at whatever happened to be last.
        /// </summary>
        [Fact]
        public void ARestoredPositionOutsideTheRestoredListIsDropped()
        {
            var register = new RaChainRegister();

            register.Restore("1234/0", Steps("BodyCenter"), null, 4, 900.0, 0);

            Assert.Null(register.Find("1234/0")!.Walk.ActiveStep);
        }

        [Fact]
        public void RestoringAnEmptyChainStoresNothing()
        {
            var register = new RaChainRegister();

            register.Restore("1234/0", new List<RealAntennasTargetStepArgs>(), null, null, null, 0);

            Assert.Equal(0, register.Count);
        }

        /// <summary>
        /// The settle in force is what the read-back reports, so the register has
        /// to apply the same default and the same clamp the walk is judged
        /// against rather than echoing the request.
        /// </summary>
        [Fact]
        public void TheSettleInForceIsTheOneTheWalkWillUse()
        {
            var register = new RaChainRegister();

            register.Set("a/0", Steps("BodyCenter"), null);
            register.Set("b/0", Steps("BodyCenter"), 0.0);

            Assert.Equal(RaChainPolicy.DefaultSettleSeconds, register.Find("a/0")!.SettleSeconds);
            Assert.Equal(RaChainPolicy.MinimumSettleSeconds, register.Find("b/0")!.SettleSeconds);
        }
    }
}
