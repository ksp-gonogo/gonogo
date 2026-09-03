using System.IO;
using Gonogo.KerbalismUplink;
using Xunit;

namespace Gonogo.KerbalismUplink.Tests
{
    /// <summary>
    /// The "Service" verb the client offers on a <c>service-due</c> row was
    /// unreachable: <c>KerbalismReflection.AttemptRepair</c> collected only
    /// modules whose <c>broken</c> flag was set, so a part that merely needed
    /// maintenance matched nothing and every press came back
    /// <c>no-such-part</c>. Kerbalism's own <c>Repair()</c> event clears
    /// <c>needMaintenance</c> unconditionally and charges kits only in its
    /// broken branch, so the verb was always supported by the game; only our
    /// walk was too narrow.
    /// </summary>
    public class KerbalismRepairScopeTests
    {
        [Theory]
        [InlineData(true, false, true)]   // a malfunction
        [InlineData(false, true, true)]   // service due: the arm that was missing
        [InlineData(true, true, true)]    // both
        [InlineData(false, false, false)] // nothing to do
        public void ARepairActsOnAnythingKerbalismsOwnEventWouldAct(
            bool broken, bool needsMaintenance, bool expected)
        {
            Assert.Equal(expected, KerbalismRepairScope.IsActionable(broken, needsMaintenance));
        }

        /// <summary>
        /// A service costs nothing, so it must never be refused for want of a
        /// kit. Charging one would ask the operator for an item Kerbalism does
        /// not take, and refuse a repair that would have worked.
        /// </summary>
        [Fact]
        public void AServiceConsumesNoKits()
        {
            Assert.Equal(0, KerbalismRepairScope.KitsFor(broken: false, critical: false));
            Assert.Equal(0, KerbalismRepairScope.KitsFor(broken: false, critical: true));
        }

        [Fact]
        public void ABreakageCostsWhatTheWireSaysItCosts()
        {
            Assert.Equal(
                KerbalismReliabilityMap.KitsForRepair(critical: false),
                KerbalismRepairScope.KitsFor(broken: true, critical: false));
            Assert.Equal(
                KerbalismReliabilityMap.KitsForRepair(critical: true),
                KerbalismRepairScope.KitsFor(broken: true, critical: true));
        }

        /// <summary>
        /// Success is read off the flag that was actually being cleared. A
        /// service judged by the <c>broken</c> flag would report success for
        /// every part on the vessel, none of which were broken to begin with.
        /// </summary>
        [Theory]
        [InlineData(true, false, true, true)]    // was broken, no longer: repaired
        [InlineData(true, true, false, false)]   // was broken, still is: crew did not qualify
        [InlineData(false, false, false, true)]  // service done
        [InlineData(false, false, true, false)]  // service refused, clock untouched
        public void SuccessIsObservedFromTheFlagThatWasBeingCleared(
            bool wasBroken, bool brokenAfter, bool needsMaintenanceAfter, bool expected)
        {
            Assert.Equal(
                expected,
                KerbalismRepairScope.Cleared(wasBroken, brokenAfter, needsMaintenanceAfter));
        }

        /// <summary>
        /// Every kit the repair is charged for must come out of somewhere. The
        /// invoke runs with Kerbalism's own kit guard suspended, so a kit we do
        /// not remove ourselves is never removed by anyone, and the outcome still
        /// reports it as spent.
        /// </summary>
        [Theory]
        // Holds enough: the whole charge comes off the kerbal, nothing is fetched.
        // This is the common case, and it used to be free.
        [InlineData(2, 3, 2, 0)]
        [InlineData(2, 2, 2, 0)]
        // Holds some: BOTH halves are taken. Fetching only the shortfall left the
        // carried one uncharged.
        [InlineData(2, 1, 1, 1)]
        // Holds none: the whole charge is fetched.
        [InlineData(2, 0, 0, 2)]
        // A service costs nothing, so nothing is taken from anywhere.
        [InlineData(0, 3, 0, 0)]
        public void EveryChargedKitComesOutOfSomewhere(
            int needed, int carried, int fromCarried, int shortfall)
        {
            Assert.Equal(fromCarried, KerbalismRepairScope.FromCarried(needed, carried));
            Assert.Equal(shortfall, KerbalismRepairScope.Shortfall(needed, carried));
        }

        /// <summary>
        /// The two halves always sum to the charge. A split that lost a kit would
        /// undercharge exactly as the original did, and a split that gained one
        /// would take a kit the provider never asked for.
        /// </summary>
        [Theory]
        [InlineData(2, 0)]
        [InlineData(2, 1)]
        [InlineData(2, 5)]
        [InlineData(1, 0)]
        public void TheSplitSumsToTheCharge(int needed, int carried)
        {
            Assert.Equal(
                needed,
                KerbalismRepairScope.FromCarried(needed, carried)
                    + KerbalismRepairScope.Shortfall(needed, carried));
        }

        /// <summary>
        /// Source text, because the walk this rule was carved out of reaches a
        /// live <c>Vessel</c> and cannot be entered headlessly. Without this a
        /// correct rule could sit beside the narrow walk that made the verb dead,
        /// which is the shape the defect already had.
        /// </summary>
        [Fact]
        public void TheRepairWalkRoutesThroughTheRule()
        {
            var source = File.ReadAllText(ReflectionSourcePath());

            Assert.Contains("KerbalismRepairScope.IsActionable", source);
            Assert.Contains("KerbalismRepairScope.Cleared", source);
            Assert.Contains("needMaintenance", source);
            // The charge is taken from BOTH places, not just the store.
            Assert.Contains("KerbalismRepairScope.FromCarried", source);
            Assert.Contains("KerbalismRepairScope.Shortfall", source);
        }

        private static string ReflectionSourcePath()
        {
            var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.sln")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);
            var path = Path.Combine(
                dir!.FullName, "mod", "GonogoKerbalismUplink", "KerbalismReflection.cs");
            Assert.True(File.Exists(path), "KerbalismReflection.cs not found at " + path);
            return path;
        }
    }
}
