using System.Collections;
using System.Reflection;
using HarmonyLib;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Every name <see cref="HarmonyPatchProbe"/> looks up, against the
    /// installed <c>0Harmony.dll</c>.
    ///
    /// <para>The probe reaches Harmony by string so that the mod does not depend
    /// on it, which means a Harmony release that renames any of these breaks no
    /// compile. The probe would then answer <c>Unknown</c> and every off-screen
    /// strategy activation would refuse as unreadable. That is the safe side, but
    /// it is a feature lost with no signal, so the names are held here.</para>
    /// </summary>
    public class HarmonyPatchProbeMirrorTests
    {
        [Fact]
        public void TheHarmonyTypeIsWhereTheProbeLooks()
        {
            Assert.Equal(HarmonyPatchProbe.HarmonyTypeName, typeof(Harmony).FullName);
        }

        [Fact]
        public void GetPatchInfoResolvesAndReturnsPatches()
        {
            var method = HarmonyPatchProbe.ResolveGetPatchInfo(typeof(Harmony));

            Assert.NotNull(method);
            Assert.Equal(typeof(Patches), method!.ReturnType);
        }

        [Fact]
        public void EveryMemberTheProbeReadsIsOnPatches()
        {
            foreach (var name in HarmonyPatchProbe.PatchCollections)
            {
                var type = MemberType(name);
                Assert.True(type != null, "Patches no longer has " + name);
                Assert.True(typeof(ICollection).IsAssignableFrom(type), name + " is no longer a collection");
            }

            var owners = MemberType(HarmonyPatchProbe.OwnersProperty);
            Assert.NotNull(owners);
            Assert.True(typeof(IEnumerable).IsAssignableFrom(owners));
        }

        /// <summary>
        /// A real <c>Patches</c> carrying one prefix, which is what
        /// <c>GetPatchInfo</c> hands back for a method RP-1 has patched.
        /// </summary>
        [Fact]
        public void ARealPatchesWithAPrefixReadsAsPatchedByItsOwner()
        {
            var prefix = typeof(HarmonyPatchProbeMirrorTests).GetMethod(
                nameof(Prefix), BindingFlags.NonPublic | BindingFlags.Static)!;
            var patch = new Patch(prefix, 0, "RP-0", Priority.Normal, new string[0], new string[0], false);
            var patches = new Patches(new[] { patch }, new Patch[0], new Patch[0], new Patch[0]);

            var reading = HarmonyPatchProbe.Read(patches);

            Assert.Equal(HarmonyPatchProbe.PatchState.Patched, reading.State);
            Assert.Equal(new[] { "RP-0" }, reading.Owners);
        }

        [Fact]
        public void ARealPatchesWithNothingInItReadsAsUnpatched()
        {
            var patches = new Patches(new Patch[0], new Patch[0], new Patch[0], new Patch[0]);

            Assert.Equal(HarmonyPatchProbe.PatchState.Unpatched, HarmonyPatchProbe.Read(patches).State);
        }

        private static System.Type? MemberType(string name) =>
            typeof(Patches).GetField(name)?.FieldType ?? typeof(Patches).GetProperty(name)?.PropertyType;

        private static void Prefix()
        {
        }
    }
}
