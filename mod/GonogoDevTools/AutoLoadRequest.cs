using System;
using System.Collections.Generic;

namespace Gonogo.DevTools
{
    /// <summary>
    /// A save load request read from <c>dev-autoload.cfg</c>, parsed apart from the game.
    /// The first non-empty line is the save name; later lines are the flags
    /// <c>flight</c> and <c>newsandbox</c>, <c>file=&lt;name&gt;</c> and the optional
    /// <c>id=&lt;string&gt;</c>.
    /// </summary>
    internal sealed class AutoLoadRequest
    {
        internal const string DefaultSfsFile = "persistent";

        private AutoLoadRequest(string? saveName, string sfsFile, bool restoreFlight, bool newSandbox, string id)
        {
            SaveName = saveName;
            SfsFile = sfsFile;
            RestoreFlight = restoreFlight;
            NewSandbox = newSandbox;
            Id = id;
        }

        /// <summary>The save folder to load, or null when the file names none.</summary>
        internal string? SaveName { get; }

        /// <summary>The .sfs inside the save folder, without its extension.</summary>
        internal string SfsFile { get; }

        internal bool RestoreFlight { get; }

        internal bool NewSandbox { get; }

        /// <summary>
        /// What tells this request from the one before it: the <c>id</c> line when the file has
        /// one, otherwise the stamp of the file's last write, so rewriting the file asks again.
        /// </summary>
        internal string Id { get; }

        /// <param name="lines">The cfg's lines.</param>
        /// <param name="fileStamp">Identifies the file's current write, used when no <c>id</c> line is present.</param>
        internal static AutoLoadRequest Parse(IEnumerable<string> lines, string fileStamp)
        {
            string? saveName = null;
            var sfsFile = DefaultSfsFile;
            var restoreFlight = false;
            var newSandbox = false;
            string? id = null;

            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (trimmed.Length == 0)
                {
                    continue;
                }

                if (saveName == null)
                {
                    saveName = trimmed;
                    continue;
                }

                if (string.Equals(trimmed, "flight", StringComparison.OrdinalIgnoreCase))
                {
                    restoreFlight = true;
                    continue;
                }

                if (string.Equals(trimmed, "newsandbox", StringComparison.OrdinalIgnoreCase))
                {
                    newSandbox = true;
                    continue;
                }

                if (TryValue(trimmed, "file", out var file))
                {
                    if (file.Length > 0)
                    {
                        sfsFile = file;
                    }

                    continue;
                }

                if (TryValue(trimmed, "id", out var requestId) && requestId.Length > 0)
                {
                    id = requestId;
                }
            }

            return new AutoLoadRequest(saveName, sfsFile, restoreFlight, newSandbox, id ?? fileStamp);
        }

        /// <summary>
        /// Whether a <c>file=</c> value names a sibling of the save's own files: it is pasted
        /// into a path, so no separator, drive prefix or <c>..</c> may be in it.
        /// </summary>
        internal static bool IsSiblingFile(string sfsFile) =>
            sfsFile.IndexOfAny(new[] { '/', '\\', ':' }) < 0 && !sfsFile.Contains("..");

        private static bool TryValue(string line, string key, out string value)
        {
            value = "";
            var eq = line.IndexOf('=');
            if (eq < 0 || !string.Equals(line.Substring(0, eq).Trim(), key, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            value = line.Substring(eq + 1).Trim();
            return true;
        }
    }

    /// <summary>
    /// Remembers the requests already acted on, so a request file left on disk is acted on
    /// once however many polls see it, and a request with a new id is acted on again.
    /// A request that fails is claimed all the same: it is not retried until its id changes.
    /// </summary>
    internal sealed class AutoLoadWatch
    {
        private readonly HashSet<string> _claimed = new HashSet<string>(StringComparer.Ordinal);

        /// <returns>True the first time this id is seen.</returns>
        internal bool TryClaim(string id) => _claimed.Add(id);
    }
}
