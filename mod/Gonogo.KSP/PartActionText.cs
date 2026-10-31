using System;
using System.Text;
using KSP.Localization;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part action's label or group heading as the player reads it in the Part
    /// Action Window: a localisation tag resolved through <c>Localizer</c>, rich
    /// text markup (<c>&lt;b&gt;</c>, <c>&lt;color=...&gt;</c>) removed, and
    /// nothing returned for a string that carries no letters or digits. A part mod
    /// may store a tag as the group name and markup in the label, which the
    /// game's own window renders but a plain-text client cannot.
    /// </summary>
    public static class PartActionText
    {
        /// <summary>
        /// The readable text of <paramref name="stored"/>, or <c>null</c> when it
        /// is blank, carries no letter or digit (a lone hyphen, en dash, em dash or
        /// minus is a placeholder row), or a tag the Localizer has
        /// no entry for.
        /// </summary>
        public static string? Clean(string? stored)
        {
            if (string.IsNullOrWhiteSpace(stored))
            {
                return null;
            }

            var text = stored!;
            if (text.IndexOf('#') >= 0)
            {
                try
                {
                    text = Localizer.Format(text);
                }
                catch (Exception)
                {
                    return null;
                }
            }

            text = StripMarkup(text).Trim();
            if (!HasLetterOrDigit(text) || text.StartsWith("#", StringComparison.Ordinal))
            {
                return null;
            }
            return text;
        }

        private static bool HasLetterOrDigit(string text)
        {
            foreach (var c in text)
            {
                if (char.IsLetterOrDigit(c))
                {
                    return true;
                }
            }
            return false;
        }

        private static string StripMarkup(string text)
        {
            if (text.IndexOf('<') < 0)
            {
                return text;
            }

            var result = new StringBuilder(text.Length);
            var depth = 0;
            foreach (var c in text)
            {
                if (c == '<')
                {
                    depth++;
                    continue;
                }
                if (c == '>' && depth > 0)
                {
                    depth--;
                    continue;
                }
                if (depth == 0)
                {
                    result.Append(c);
                }
            }
            return depth == 0 ? result.ToString() : text;
        }
    }
}
