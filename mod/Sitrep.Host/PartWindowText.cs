using System;

namespace Sitrep.Host
{
    /// <summary>
    /// The text of a part window row, worked out from what the game's field holds
    /// and what it prints. KSP-free so the cases a mod's own labels produce (a
    /// module with several fields under one name, a value that is empty until the
    /// mod's first update) are tested without the game.
    /// </summary>
    public static class PartWindowText
    {
        /// <summary>
        /// The value a label row shows. A field that holds a string is that string,
        /// so its value cannot be lost to however the game joins it to the label;
        /// any other field is the game's printed form without its leading label.
        /// </summary>
        public static string LabelValue(string? heldText, string printed, params string?[] labels)
        {
            return heldText != null ? heldText.Trim() : WithoutLabel(printed, labels);
        }

        /// <summary>
        /// The name a window group is drawn under: its display name, localised, else its
        /// code name, localised, else none. Buttons and fields go through this one rule, so a
        /// group's name cannot reach the wire as a bare localisation key
        /// (<c>#autoLOC_8003391</c>) because one of the two paths skipped it.
        /// <paramref name="clean"/> localises one name and returns null for one it cannot read.
        /// </summary>
        public static string? Group(Func<string?, string?> clean, string? displayName, string? name) =>
            clean(displayName) ?? clean(name);

        /// <summary>
        /// <paramref name="printed"/> without a leading label and its colon, in
        /// whatever spacing and case the label was printed, or unchanged when it
        /// does not start with one of the labels.
        /// </summary>
        public static string WithoutLabel(string printed, params string?[] labels)
        {
            foreach (var label in labels)
            {
                if (string.IsNullOrWhiteSpace(label))
                {
                    continue;
                }

                var name = label!.Trim().TrimEnd(':').TrimEnd();
                if (!printed.StartsWith(name, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var rest = printed.Substring(name.Length).TrimStart();
                if (rest.StartsWith(":", StringComparison.Ordinal))
                {
                    return rest.Substring(1).Trim();
                }
            }

            return printed;
        }
    }
}
