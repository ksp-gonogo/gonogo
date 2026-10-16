using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Sitrep.Host
{
    /// <summary>
    /// Takes the install and home folders out of text bound for a log that a
    /// player pastes into a bug report: those folders name the player's account.
    /// Folders registered with <see cref="AddRoot"/> become their label
    /// ("&lt;KSP&gt;"), and any other absolute path keeps only its last segment.
    /// </summary>
    public static class PathRedactor
    {
        private static readonly object Gate = new object();
        private static readonly List<KeyValuePair<string, string>> Roots = new List<KeyValuePair<string, string>>();

        private static readonly Regex WindowsPath = new Regex(
            @"(?<![\w])[A-Za-z]:[\\/](?:[^\s""'<>|*?\\/]+[\\/])*(?<last>[^\s""'<>|*?\\/]*)",
            RegexOptions.Compiled);

        private static readonly Regex UnixPath = new Regex(
            @"(?<![\w.:/>])/(?:[^\s""'<>|*?/]+/)+(?<last>[^\s""'<>|*?/]*)",
            RegexOptions.Compiled);

        /// <summary>
        /// Replaces <paramref name="root"/>, in either separator style and
        /// without regard to case, with <paramref name="label"/> from now on.
        /// A root that is empty is ignored.
        /// </summary>
        public static void AddRoot(string root, string label)
        {
            if (string.IsNullOrWhiteSpace(root))
            {
                return;
            }

            var trimmed = root.TrimEnd('/', '\\');
            if (trimmed.Length == 0)
            {
                return;
            }

            lock (Gate)
            {
                Roots.Add(new KeyValuePair<string, string>(trimmed, label));
                Roots.Add(new KeyValuePair<string, string>(trimmed.Replace('/', '\\'), label));
                Roots.Add(new KeyValuePair<string, string>(trimmed.Replace('\\', '/'), label));
                // Longest first, so a root inside another is not left half replaced.
                Roots.Sort((a, b) => b.Key.Length.CompareTo(a.Key.Length));
            }
        }

        /// <summary>Forgets every root added by <see cref="AddRoot"/>.</summary>
        public static void ClearRoots()
        {
            lock (Gate)
            {
                Roots.Clear();
            }
        }

        /// <summary>
        /// <paramref name="text"/> with every registered root replaced by its
        /// label and every other absolute path cut down to its last segment
        /// behind ".../". Text with no path in it comes back unchanged.
        /// </summary>
        public static string Redact(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return text;
            }

            KeyValuePair<string, string>[] roots;
            lock (Gate)
            {
                roots = Roots.ToArray();
            }

            foreach (var root in roots)
            {
                text = ReplaceIgnoreCase(text, root.Key, root.Value);
            }

            text = WindowsPath.Replace(text, m => ".../" + m.Groups["last"].Value);
            return UnixPath.Replace(text, m => ".../" + m.Groups["last"].Value);
        }

        private static string ReplaceIgnoreCase(string text, string find, string with)
        {
            int at = text.IndexOf(find, StringComparison.OrdinalIgnoreCase);
            if (at < 0)
            {
                return text;
            }

            var result = new StringBuilder(text.Length);
            int from = 0;
            while (at >= 0)
            {
                result.Append(text, from, at - from).Append(with);
                from = at + find.Length;
                at = text.IndexOf(find, from, StringComparison.OrdinalIgnoreCase);
            }

            return result.Append(text, from, text.Length - from).ToString();
        }
    }
}
