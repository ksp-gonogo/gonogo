using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The files this process currently has mapped, which is how the conformance gate
    /// learns which Principia build the game actually loaded.
    ///
    /// <para>Read from THIS process, deliberately. The question is what the game has
    /// open, and a reading taken anywhere else answers a different one: on the rig,
    /// KSP runs inside a pressure-vessel mount namespace, so a shell alongside it sees
    /// a different filesystem and would report different files with no error.</para>
    ///
    /// <para>Parsing is separated from reading so the parse is testable without a
    /// process to inspect. The two shapes below are real: the Linux <c>maps</c> line
    /// format, and the flat path list every other source hands back.</para>
    /// </summary>
    public static class MappedModules
    {
        private const string ProcSelfMaps = "/proc/self/maps";

        /// <summary>
        /// Every distinct file path in a Linux <c>/proc/self/maps</c> body.
        ///
        /// <para>A maps line is <c>address perms offset dev inode  path</c>, and the
        /// path is optional: anonymous mappings have none, and pseudo-paths like
        /// <c>[heap]</c> and <c>[stack]</c> are not files. One file appears once per
        /// segment, so the same path arrives repeatedly and only the set matters.</para>
        /// </summary>
        public static IReadOnlyList<string> ParseProcMaps(string? body)
        {
            var paths = new List<string>();
            if (string.IsNullOrEmpty(body))
            {
                return paths;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var line in body!.Split('\n'))
            {
                if (line.Length == 0)
                {
                    continue;
                }

                // The path starts at the first '/' AFTER the five leading fields. A
                // path containing spaces (KSP's own directory has one) then survives,
                // where splitting on whitespace and taking the last field truncates
                // it to the final word.
                // No slash means no file. That covers anonymous mappings, which have
                // no path at all, and the kernel's pseudo-entries (`[heap]`,
                // `[stack]`, `[vdso]`), which are bracketed names rather than paths.
                // There is deliberately no separate bracket check: `path` starts AT
                // the slash, so it can never begin with one, and a guard that cannot
                // fire reads as though a case is handled somewhere it is not.
                var slash = line.IndexOf('/');
                if (slash < 0)
                {
                    continue;
                }
                var path = line.Substring(slash).Trim();
                if (path.Length == 0)
                {
                    continue;
                }
                // A deleted file stays mapped and the kernel marks it. It is not the
                // file on disk any more, so the gate must not open that path and
                // report on something else.
                if (path.EndsWith(" (deleted)", StringComparison.Ordinal))
                {
                    continue;
                }
                if (seen.Add(path))
                {
                    paths.Add(path);
                }
            }
            return paths;
        }

        /// <summary>
        /// What this process has mapped, or an empty list when it cannot be
        /// established.
        ///
        /// <para>Empty is NOT "Principia is absent". The conformance gate treats a
        /// missing native build as `NotEstablished` rather than a refusal for exactly
        /// this reason, and because a read taken while the game is still starting
        /// legitimately sees nothing.</para>
        /// </summary>
        public static IReadOnlyList<string> OfThisProcess()
        {
            try
            {
                if (File.Exists(ProcSelfMaps))
                {
                    return ParseProcMaps(File.ReadAllText(ProcSelfMaps));
                }
            }
            catch (Exception)
            {
                // Fall through to the portable route rather than failing: an
                // unreadable maps file is a reason to try the other reader, not a
                // reason to tell an operator their install is broken.
            }

            try
            {
                var paths = new List<string>();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (ProcessModule module in Process.GetCurrentProcess().Modules)
                {
                    var name = module?.FileName;
                    if (!string.IsNullOrEmpty(name) && seen.Add(name!))
                    {
                        paths.Add(name!);
                    }
                }
                return paths;
            }
            catch (Exception)
            {
                return new string[0];
            }
        }
    }
}
