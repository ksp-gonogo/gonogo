using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Where the Uplinks are on disk, and what <c>Gonogo.sln</c> says they are.
    ///
    /// <para>Shared by the coverage gates that walk Uplink SOURCE rather than
    /// loaded assemblies. No project in this repo may reference every Uplink (see
    /// <c>UplinkIsolationTests</c>), and one loading them from <c>bin/</c> is green
    /// whenever they have not been built, so a walk is the only shape a
    /// cross-Uplink gate can take here. Extracted once a second gate needed the
    /// same discovery: two copies of a walk are two chances for one of them to
    /// stop finding its subjects, and a walk that finds nothing reports a clean
    /// repo.</para>
    /// </summary>
    internal static class UplinkProjects
    {
        /// <summary>Uplink project name -&gt; its source directory. The
        /// <c>.Contract</c> and <c>.Tests</c> siblings are not Uplinks.</summary>
        public static Dictionary<string, string> Discover()
        {
            var modDir = ResolveModDir();
            var uplinks = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var directory in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith("Gonogo", StringComparison.Ordinal) ||
                    !name.EndsWith("Uplink", StringComparison.Ordinal))
                {
                    continue;
                }

                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    uplinks[name] = directory;
                }
            }

            return uplinks;
        }

        /// <summary>
        /// The Uplink projects <c>Gonogo.sln</c> declares: the independent source
        /// a directory walk is checked against, because a floor alone cannot tell
        /// a broken walk from a shrinking repo.
        /// </summary>
        public static HashSet<string> DeclaredInSolution()
        {
            var solution = Path.Combine(ResolveModDir(), "Gonogo.sln");
            var declared = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(solution))
            {
                return declared;
            }

            foreach (Match match in Regex.Matches(File.ReadAllText(solution), @"=\s*""([A-Za-z0-9_.]+Uplink)"""))
            {
                declared.Add(match.Groups[1].Value);
            }

            return declared;
        }

        /// <summary>
        /// Every directory holding one Uplink's C#, as THIS repo lays it out: the
        /// project itself and its <c>.Contract</c> sibling, which is where the
        /// command-name and topic constants usually live. The layout is stated
        /// here rather than inside the walk because the walk is shared with the
        /// repo departed Uplinks live in, which lays them out differently.
        /// </summary>
        public static IReadOnlyList<string> SourceDirectories(string directory) =>
            new[] { directory, directory + ".Contract" };

        public static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract");
                if (Directory.Exists(candidate))
                {
                    return Path.Combine(directory.FullName, "mod");
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
