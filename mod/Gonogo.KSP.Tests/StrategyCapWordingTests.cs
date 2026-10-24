using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// What an operator reads when the limit on running strategies was not
    /// checked in the strategy list.
    /// </summary>
    public class StrategyCapWordingTests
    {
        [Fact]
        public void Each_reason_is_named_and_none_blames_the_Administration_Building()
        {
            var cases = new[]
            {
                (HarmonyPatchProbe.PatchState.Patched, "another mod changes how strategies activate"),
                (HarmonyPatchProbe.PatchState.Unknown, "could not be read"),
                (HarmonyPatchProbe.PatchState.Unpatched, "limit on running strategies could not be read"),
            };

            foreach (var (state, expected) in cases)
            {
                var wording = StrategyActivationRule.CapUnaskedWording(state);

                Assert.Contains(expected, wording);
                Assert.DoesNotContain("Administration Building", wording);
            }
        }
    }
}
