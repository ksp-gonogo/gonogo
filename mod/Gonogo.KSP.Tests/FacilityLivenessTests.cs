using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Gonogo.KSP.Career;
using Upgradeables;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The facility-upgrade gate asks the question <c>SetLevel</c> asks before it
    /// will finish an upgrade, read out of the installed build's IL on both
    /// sides.
    ///
    /// <para>The defect this guards is a divergence, not a missing check: the gate
    /// tested "not destroyed" while <c>SetLevel</c> tested "active in the
    /// hierarchy", so a component that existed but was inactive passed the gate
    /// and took the upgrade in half. Any future divergence, on either side, is
    /// the same defect.</para>
    /// </summary>
    public class FacilityLivenessTests
    {
        private static readonly MethodInfo SetLevel = typeof(UpgradeableFacility).GetMethod(
            "SetLevel", BindingFlags.Public | BindingFlags.Instance, new[] { typeof(int) })!;

        private static readonly MethodInfo CanComplete = typeof(FacilityLiveness).GetMethod(
            nameof(FacilityLiveness.CanComplete), BindingFlags.Public | BindingFlags.Static)!;

        /// <summary>
        /// The shape that makes a half-applied upgrade possible at all: the
        /// opening event and the tier change come BEFORE the guard, the finishing
        /// event only through the coroutine after it.
        /// </summary>
        [Fact]
        public void SetLevelStillOpensThePairBeforeItsGuard()
        {
            Assert.Equal(
                new[]
                {
                    "ldsfld GameEvents.OnKSCFacilityUpgrading",
                    "callvirt EventData`2.Fire",
                    "call UpgradeableObject.setLevel",
                    "call Component.get_gameObject",
                    "callvirt GameObject.get_activeInHierarchy",
                    "call UpgradeableFacility.waitForLevelSpawn",
                    "call MonoBehaviour.StartCoroutine",
                },
                IlSteps.Of(SetLevel));
        }

        [Fact]
        public void TheGateAsksExactlyWhatSetLevelAsks()
        {
            var ours = Members(IlSteps.Of(CanComplete));

            // Unity's null overload first, so a destroyed component never reaches
            // gameObject, which would throw on it.
            Assert.Equal("Object.op_Inequality", ours.First());
            Assert.Equal(Guard(), ours.Skip(1).ToList());
        }

        /// <summary>
        /// The gate being right is worth nothing if the command stops using it.
        /// </summary>
        [Fact]
        public void TheUpgradeCommandGatesThroughIt()
        {
            var body = MethodSource("KspCareerActuator.cs", "public CommandResult UpgradeFacility(");

            Assert.Contains("FacilityLiveness.CanComplete(proto.facilityRefs[0])", body, StringComparison.Ordinal);
            Assert.DoesNotContain("facilityRefs[0] != null", body, StringComparison.Ordinal);
        }

        /// <summary>
        /// What <c>SetLevel</c> asks between raising the tier and starting the
        /// coroutine: its completion condition.
        /// </summary>
        private static List<string> Guard()
        {
            var steps = Members(IlSteps.Of(SetLevel));
            var from = steps.IndexOf("UpgradeableObject.setLevel") + 1;
            var to = steps.IndexOf("UpgradeableFacility.waitForLevelSpawn");
            Assert.True(from > 0 && to > from, "SetLevel no longer has a guard between the tier change and the coroutine");
            return steps.GetRange(from, to - from);
        }

        /// <summary>A step without its call-or-callvirt, which differs between <c>base.x</c> and <c>facility.x</c>.</summary>
        private static List<string> Members(IEnumerable<string> steps) =>
            steps.Select(s => s.Substring(s.IndexOf(' ') + 1)).ToList();

        private static string MethodSource(string file, string signature)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.KSP", file)))
            {
                dir = dir.Parent;
            }

            Assert.True(dir != null, "could not locate mod/Gonogo.KSP/" + file);
            var source = File.ReadAllText(Path.Combine(dir!.FullName, "mod", "Gonogo.KSP", file));
            var start = source.IndexOf(signature, StringComparison.Ordinal);
            Assert.True(start >= 0, signature + " is gone from " + file);
            var next = source.IndexOf("\n        public ", start + signature.Length, StringComparison.Ordinal);
            return next < 0 ? source.Substring(start) : source.Substring(start, next - start);
        }
    }
}
