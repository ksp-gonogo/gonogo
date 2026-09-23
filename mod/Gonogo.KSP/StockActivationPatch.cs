using System;
using System.Reflection;
using Strategies;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether another mod has patched either half of stock's
    /// <c>Strategy.Activate()</c> through Harmony: the method itself, or the
    /// <c>CanBeActivated</c> gate it runs first.
    ///
    /// <para>One read for two consumers. The off-screen activation refuses on it,
    /// because a reproduced body would skip the patch; the strategy roster
    /// publishes it, so a client does not offer a control that the command will
    /// refuse. Both must see the same answer, so neither asks Harmony for
    /// itself.</para>
    /// </summary>
    internal static class StockActivationPatch
    {
        /// <summary><c>public bool Activate()</c>.</summary>
        public static readonly MethodBase? Activate = Resolve(nameof(Strategy.Activate), Type.EmptyTypes);

        /// <summary><c>public bool CanBeActivated(out string reason)</c>.</summary>
        public static readonly MethodBase? CanBeActivated =
            Resolve(nameof(Strategy.CanBeActivated), new[] { typeof(string).MakeByRefType() });

        /// <summary>
        /// Both halves asked. A half that did not resolve is
        /// <see cref="HarmonyPatchProbe.PatchState.Unknown"/>: a method that
        /// cannot be named cannot be shown to be unpatched.
        /// </summary>
        public static HarmonyPatchProbe.Reading Read()
        {
            if (Activate == null || CanBeActivated == null) return HarmonyPatchProbe.Reading.Unknown;

            return HarmonyPatchProbe.Combine(HarmonyPatchProbe.Of(Activate), HarmonyPatchProbe.Of(CanBeActivated));
        }

        private static MethodBase? Resolve(string name, Type[] parameters)
        {
            try
            {
                return typeof(Strategy).GetMethod(
                    name,
                    BindingFlags.Public | BindingFlags.Instance,
                    binder: null,
                    types: parameters,
                    modifiers: null);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
