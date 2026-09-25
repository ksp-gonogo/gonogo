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
    /// A facility upgrade fires every event <c>SetLevel</c> would have fired on a
    /// live, active component, read out of the installed build's IL on both
    /// sides.
    ///
    /// <para><c>SetLevel</c> skips <c>OnKSCFacilityUpgraded</c> on an inactive
    /// component after the tier and model have already changed.
    /// <see cref="FacilityLiveness.Upgrade"/> fires it in that case, so what it
    /// tests and what <c>SetLevel</c> tests have to be the same question: a
    /// divergence either drops the event or fires it twice.</para>
    /// </summary>
    public class FacilityLivenessTests
    {
        private static readonly MethodInfo SetLevel = typeof(UpgradeableFacility).GetMethod(
            "SetLevel", BindingFlags.Public | BindingFlags.Instance, new[] { typeof(int) })!;

        private static readonly MethodInfo SetLevelFinishes = typeof(FacilityLiveness).GetMethod(
            nameof(FacilityLiveness.SetLevelFinishes), BindingFlags.Public | BindingFlags.Static)!;

        private static readonly MethodInfo Upgrade = typeof(FacilityLiveness).GetMethod(
            nameof(FacilityLiveness.Upgrade), BindingFlags.Public | BindingFlags.Static)!;

        /// <summary>
        /// The shape that makes the skipped event possible at all: the opening
        /// event and the tier change come BEFORE the guard, the finishing event
        /// only through the coroutine after it.
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
        public void SetLevelFinishesAsksExactlyWhatSetLevelAsks()
        {
            var ours = Members(IlSteps.Of(SetLevelFinishes));

            // Unity's null overload first, so a destroyed component never reaches
            // gameObject, which would throw on it.
            Assert.Equal("Object.op_Inequality", ours.First());
            Assert.Equal(Guard(), ours.Skip(1).ToList());
        }

        /// <summary>
        /// The tier is raised first and the finishing event fired only after
        /// asking, in that order, as <c>SetLevel</c> does.
        /// </summary>
        [Fact]
        public void UpgradeFiresTheFinishingEventOnlyWhereSetLevelSkipsIt()
        {
            Assert.Equal(
                new[]
                {
                    "callvirt UpgradeableObject.SetLevel",
                    "call FacilityLiveness.SetLevelFinishes",
                    "ldsfld GameEvents.OnKSCFacilityUpgraded",
                    "callvirt EventData`2.Fire",
                },
                IlSteps.Of(Upgrade));
        }

        /// <summary>
        /// A component that exists but is inactive is upgraded, not refused, and
        /// the upgrade goes through the path that fires every event.
        /// </summary>
        [Fact]
        public void TheUpgradeCommandGatesOnBuiltAndUpgradesThroughIt()
        {
            var body = MethodSource("KspCareerActuator.cs", "public CommandResult UpgradeFacility(");

            Assert.Contains("FacilityLiveness.IsBuilt(proto.facilityRefs[0])", body, StringComparison.Ordinal);
            Assert.Contains("FacilityLiveness.Upgrade(live, ", body, StringComparison.Ordinal);
            Assert.DoesNotContain("SetLevelFinishes", body, StringComparison.Ordinal);
            Assert.DoesNotContain(".SetLevel(", body, StringComparison.Ordinal);
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
