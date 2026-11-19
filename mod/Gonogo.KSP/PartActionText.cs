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

            if (_cleaned.TryGetValue(stored!, out var known))
            {
                return known;
            }

            var cleaned = CleanUncached(stored!);
            // A tag the Localizer could not resolve yet may resolve once it has loaded, so only an answer is kept.
            if (cleaned != null)
            {
                if (_cleaned.Count >= CacheLimit)
                {
                    _cleaned.Clear();
                }

                _cleaned[stored!] = cleaned;
            }

            return cleaned;
        }

        /* A label or event name is read for every part on every sweep and is the same string each time, so the localisation and markup work is done once. Main thread only. */
        private const int CacheLimit = 4096;
        private static readonly System.Collections.Generic.Dictionary<string, string?> _cleaned =
            new System.Collections.Generic.Dictionary<string, string?>(StringComparer.Ordinal);
        private static readonly System.Collections.Generic.Dictionary<string, string> _resolved =
            new System.Collections.Generic.Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary><see cref="Resolve"/> for a string that is the same every read, such as an option name.</summary>
        public static string ResolveCached(string? stored)
        {
            if (string.IsNullOrEmpty(stored))
            {
                return "";
            }

            if (_resolved.TryGetValue(stored!, out var known))
            {
                return known;
            }

            var resolved = Resolve(stored);
            if (!resolved.StartsWith("#", StringComparison.Ordinal))
            {
                if (_resolved.Count >= CacheLimit)
                {
                    _resolved.Clear();
                }

                _resolved[stored!] = resolved;
            }

            return resolved;
        }

        private static string? CleanUncached(string stored)
        {
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

        /// <summary>
        /// The text the game would print for a stored string such as an option
        /// name: a localisation tag resolved, markup removed. A string the
        /// Localizer has no entry for is returned as stored rather than dropped,
        /// since an option list with a hole in it cannot be stepped.
        /// </summary>
        public static string Resolve(string? stored)
        {
            if (string.IsNullOrEmpty(stored))
            {
                return "";
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
                    return stored!;
                }
            }

            return StripMarkup(text).Trim();
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
