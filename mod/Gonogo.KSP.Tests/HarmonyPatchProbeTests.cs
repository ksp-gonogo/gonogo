using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Reflection;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// What <see cref="HarmonyPatchProbe"/> concludes from a <c>Patches</c>-shaped
    /// object. <c>HarmonyPatchProbeMirrorTests</c> holds the names it looks up
    /// against the installed <c>0Harmony.dll</c>; this pins what it does with
    /// what it finds.
    /// </summary>
    public class HarmonyPatchProbeTests
    {
        [Fact]
        public void NoPatchInfoMeansUnpatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unpatched, HarmonyPatchProbe.Read(null).State);
        }

        [Fact]
        public void PatchInfoWithEveryCollectionEmptyIsUnpatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unpatched, HarmonyPatchProbe.Read(new FakePatches()).State);
        }

        [Theory]
        [InlineData("Prefixes")]
        [InlineData("Postfixes")]
        [InlineData("Transpilers")]
        [InlineData("Finalizers")]
        public void AnyOneKindOfPatchIsPatched(string kind)
        {
            var reading = HarmonyPatchProbe.Read(FakePatches.With(kind, "RP-0"));

            Assert.Equal(HarmonyPatchProbe.PatchState.Patched, reading.State);
            Assert.Equal(new[] { "RP-0" }, reading.Owners);
        }

        /// <summary>
        /// A shape the probe cannot read is not evidence that nothing is patched.
        /// Reading it as unpatched would let a reproduction skip somebody's patch
        /// on the strength of a lookup that missed.
        /// </summary>
        [Fact]
        public void AnObjectMissingACollectionIsUnknownRatherThanUnpatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unknown, HarmonyPatchProbe.Read(new NoFinalizers()).State);
        }

        /// <summary>Harmony's own <c>Patches</c> declares its collections as fields.</summary>
        [Fact]
        public void CollectionsDeclaredAsFieldsAreRead()
        {
            var reading = HarmonyPatchProbe.Read(new FieldPatches());

            Assert.Equal(HarmonyPatchProbe.PatchState.Patched, reading.State);
            Assert.Equal(new[] { "RP-0" }, reading.Owners);
        }

        [Fact]
        public void AnOwnerNamedTwiceIsNamedOnce()
        {
            var patches = FakePatches.With("Prefixes", "RP-0");
            patches.Owners = new ReadOnlyCollection<string>(new List<string> { "RP-0", "RP-0", "Other" });

            Assert.Equal(new[] { "RP-0", "Other" }, HarmonyPatchProbe.Read(patches).Owners);
        }

        [Fact]
        public void WithNoHarmonyLoadedNothingIsPatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unpatched, HarmonyPatchProbe.Of(Original, harmony: null).State);
        }

        [Fact]
        public void ARegistryThatAnswersNullIsUnpatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unpatched, HarmonyPatchProbe.Of(Original, typeof(NullRegistry)).State);
        }

        /// <summary>
        /// What Harmony does on a runtime MonoMod cannot detour on, this test
        /// host among them: its first call throws from a type initialiser.
        /// </summary>
        [Fact]
        public void ARegistryThatThrowsIsUnknownRatherThanUnpatched()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unknown, HarmonyPatchProbe.Of(Original, typeof(ThrowingRegistry)).State);
        }

        [Fact]
        public void ARegistryWithNoGetPatchInfoIsUnknown()
        {
            Assert.Equal(HarmonyPatchProbe.PatchState.Unknown, HarmonyPatchProbe.Of(Original, typeof(FakePatches)).State);
        }

        private static readonly MethodBase Original =
            typeof(HarmonyPatchProbeTests).GetMethod(nameof(WithNoHarmonyLoadedNothingIsPatched))!;

        private static class NullRegistry
        {
            public static object? GetPatchInfo(MethodBase method) => null;
        }

        private static class ThrowingRegistry
        {
            public static object GetPatchInfo(MethodBase method) => throw new TypeInitializationException("HarmonyLib.HarmonySharedState", null);
        }

        private sealed class FakePatches
        {
            private static readonly ReadOnlyCollection<object> None = new ReadOnlyCollection<object>(new List<object>());

            public ReadOnlyCollection<object> Prefixes { get; set; } = None;
            public ReadOnlyCollection<object> Postfixes { get; set; } = None;
            public ReadOnlyCollection<object> Transpilers { get; set; } = None;
            public ReadOnlyCollection<object> Finalizers { get; set; } = None;
            public ReadOnlyCollection<string> Owners { get; set; } = new ReadOnlyCollection<string>(new List<string>());

            public static FakePatches With(string kind, string owner)
            {
                var one = new ReadOnlyCollection<object>(new List<object> { new object() });
                var patches = new FakePatches { Owners = new ReadOnlyCollection<string>(new List<string> { owner }) };
                switch (kind)
                {
                    case "Prefixes": patches.Prefixes = one; break;
                    case "Postfixes": patches.Postfixes = one; break;
                    case "Transpilers": patches.Transpilers = one; break;
                    case "Finalizers": patches.Finalizers = one; break;
                }

                return patches;
            }
        }

        private sealed class FieldPatches
        {
            private static readonly ReadOnlyCollection<object> None = new ReadOnlyCollection<object>(new List<object>());

            public readonly ReadOnlyCollection<object> Prefixes = new ReadOnlyCollection<object>(new List<object> { new object() });
            public readonly ReadOnlyCollection<object> Postfixes = None;
            public readonly ReadOnlyCollection<object> Transpilers = None;
            public readonly ReadOnlyCollection<object> Finalizers = None;

            public ReadOnlyCollection<string> Owners => new ReadOnlyCollection<string>(new List<string> { "RP-0" });
        }

        private sealed class NoFinalizers
        {
            private static readonly ReadOnlyCollection<object> None = new ReadOnlyCollection<object>(new List<object>());

            public ReadOnlyCollection<object> Prefixes => None;
            public ReadOnlyCollection<object> Postfixes => None;
            public ReadOnlyCollection<object> Transpilers => None;
        }
    }
}
