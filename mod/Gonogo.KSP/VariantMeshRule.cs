using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which named parts of a part's model a selected variant leaves out of the
    /// part's box. A part carries every variant's meshes under its model and each
    /// variant lists the named transforms it switches on or off.
    /// </summary>
    internal static class VariantMeshRule
    {
        /// <summary>
        /// The names the selected variant hides: those it lists as off, plus those
        /// only another variant lists that stand off on the part itself. A name the
        /// selected variant lists as on is shown whatever another variant says.
        /// </summary>
        public static HashSet<string> Hidden(
            IReadOnlyDictionary<string, bool> selected,
            IEnumerable<IReadOnlyDictionary<string, bool>> others,
            Func<string, bool> standsOnTheModel)
        {
            var hidden = new HashSet<string>(StringComparer.Ordinal);
            foreach (var pair in selected)
            {
                if (!pair.Value)
                {
                    hidden.Add(pair.Key);
                }
            }

            foreach (var variant in others)
            {
                foreach (var name in variant.Keys)
                {
                    if (!selected.ContainsKey(name) && !standsOnTheModel(name))
                    {
                        hidden.Add(name);
                    }
                }
            }

            return hidden;
        }

        /// <summary>
        /// <paramref name="hidden"/> and every non-blank name in
        /// <paramref name="canopies"/>: a parachute's canopy is scaled up by its
        /// deploy animation, so it stays out of the part's box or a deployed
        /// chute is drawn as large as its canopy.
        /// </summary>
        public static HashSet<string>? WithCanopies(HashSet<string>? hidden, IEnumerable<string?> canopies)
        {
            foreach (var name in canopies)
            {
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }
                hidden ??= new HashSet<string>(StringComparer.Ordinal);
                hidden.Add(name!);
            }
            return hidden;
        }
    }
}
