using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// How a part read from a save stands, where a loaded part's modules would
    /// have set it at run time: the variant it is drawn in, and whether each
    /// structure a <c>ModuleStructuralNode</c> owns is shown.
    /// </summary>
    internal static class SavedPartRules
    {
        /// <summary>
        /// The variant a part is drawn in: the saved one, or the prefab's selected
        /// variant when the save names none, which is the one the game gives it.
        /// </summary>
        public static string? VariantName(string? saved, string? prefabSelected) =>
            !string.IsNullOrEmpty(saved) ? saved : prefabSelected;

        /// <summary>
        /// Whether a <c>ModuleStructuralNode</c> shows its structure, as its
        /// <c>CheckDisplay</c> decides: nothing while <paramref name="visibilityState"/>
        /// is off; otherwise its saved <paramref name="spawnState"/> when it spawns
        /// by hand, or else whether any node in <paramref name="nodeNames"/> (a
        /// comma-separated list) has a part attached; and the opposite of that
        /// when <paramref name="reverseVisibility"/> is set.
        /// </summary>
        public static bool StructureShown(
            bool visibilityState,
            bool spawnManually,
            bool spawnState,
            bool reverseVisibility,
            string? nodeNames,
            ICollection<string> attachedNodes)
        {
            if (!visibilityState)
            {
                return false;
            }

            var shown = spawnManually ? spawnState : AnyAttached(nodeNames, attachedNodes);
            return reverseVisibility ? !shown : shown;
        }

        /// <summary>
        /// The nodes with a part attached, from a craft file part's <c>attN</c>
        /// lines (<c>node,partKey...</c>). A line naming no part, or <c>Null</c>,
        /// attaches nothing.
        /// </summary>
        public static HashSet<string> AttachedFromCraftFile(IEnumerable<string>? attN)
        {
            var attached = new HashSet<string>(StringComparer.Ordinal);
            if (attN == null)
            {
                return attached;
            }
            foreach (var line in attN)
            {
                var parts = (line ?? "").Split(new[] { ',' }, 2);
                if (parts.Length < 2)
                {
                    continue;
                }
                var node = parts[0].Trim();
                var target = parts[1].Trim();
                if (node.Length == 0 || target.Length == 0 || target.StartsWith("Null", StringComparison.Ordinal))
                {
                    continue;
                }
                attached.Add(node);
            }
            return attached;
        }

        /// <summary>The nodes with a part attached, from a saved vessel part's attach node snapshots (node id and part index, -1 for none).</summary>
        public static HashSet<string> AttachedFromSnapshots(IEnumerable<KeyValuePair<string, int>>? nodes)
        {
            var attached = new HashSet<string>(StringComparer.Ordinal);
            if (nodes == null)
            {
                return attached;
            }
            foreach (var node in nodes)
            {
                if (!string.IsNullOrEmpty(node.Key) && node.Value >= 0)
                {
                    attached.Add(node.Key.Trim());
                }
            }
            return attached;
        }

        /// <summary>A saved <c>True</c> or <c>False</c>, or <paramref name="fallback"/> when the save holds neither.</summary>
        public static bool SavedFlag(string? saved, bool fallback) =>
            bool.TryParse(saved, out var value) ? value : fallback;

        private static bool AnyAttached(string? nodeNames, ICollection<string> attachedNodes)
        {
            foreach (var name in (nodeNames ?? "").Split(','))
            {
                if (attachedNodes.Contains(name.Trim()))
                {
                    return true;
                }
            }
            return false;
        }
    }
}
