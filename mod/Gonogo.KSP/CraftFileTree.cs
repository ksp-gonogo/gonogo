using System;
using System.Collections.Generic;
using System.Globalization;

namespace Gonogo.KSP
{
    /// <summary>
    /// The parts of reading a craft file that name no KSP type: which part sits
    /// under which, a part's name out of its key, and a saved vector.
    /// </summary>
    internal static class CraftFileTree
    {
        /// <summary>
        /// For each part, the index of the part it hangs from, or -1 for the root
        /// and for a part nothing links to. A part's <c>link</c> values name its
        /// children by their keys, so a parent is whoever links to a key; the first
        /// to claim a part keeps it.
        /// </summary>
        public static int[] ParentIndices(IReadOnlyList<string> keys, IReadOnlyList<IReadOnlyList<string>> links)
        {
            var indexOf = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var i = 0; i < keys.Count; i++)
            {
                if (!string.IsNullOrEmpty(keys[i]) && !indexOf.ContainsKey(keys[i]))
                {
                    indexOf[keys[i]] = i;
                }
            }

            var parents = new int[keys.Count];
            for (var i = 0; i < parents.Length; i++)
            {
                parents[i] = -1;
            }

            for (var parent = 0; parent < links.Count; parent++)
            {
                foreach (var link in links[parent])
                {
                    if (indexOf.TryGetValue(link, out var child) && child != parent && parents[child] < 0)
                    {
                        parents[child] = parent;
                    }
                }
            }

            return parents;
        }

        /// <summary>
        /// The part name inside a part key, <c>&lt;partName&gt;_&lt;craftId&gt;</c>.
        /// The id is the digits after the last underscore, so a part whose own name
        /// holds one keeps it; a key without that suffix is taken whole.
        /// </summary>
        public static string PartName(string? partKey)
        {
            if (string.IsNullOrEmpty(partKey))
            {
                return "";
            }

            var separator = partKey!.LastIndexOf('_');
            if (separator <= 0 || separator == partKey.Length - 1)
            {
                return partKey;
            }

            for (var i = separator + 1; i < partKey.Length; i++)
            {
                if (!char.IsDigit(partKey[i]))
                {
                    return partKey;
                }
            }

            return partKey.Substring(0, separator);
        }

        /// <summary>A saved vector, <c>x,y,z</c> or <c>x,y,z,w</c>, or null when it is not <paramref name="length"/> numbers.</summary>
        public static double[]? ParseVector(string? text, int length)
        {
            if (string.IsNullOrEmpty(text))
            {
                return null;
            }

            var fields = text!.Split(',');
            if (fields.Length != length)
            {
                return null;
            }

            var result = new double[length];
            for (var i = 0; i < length; i++)
            {
                if (!double.TryParse(fields[i], NumberStyles.Float, CultureInfo.InvariantCulture, out result[i])
                    || double.IsNaN(result[i]) || double.IsInfinity(result[i]))
                {
                    return null;
                }
            }

            return result;
        }
    }
}
