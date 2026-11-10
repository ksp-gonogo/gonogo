using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// No assembly KSP loads may use a ConditionalWeakTable. Unity's Mono runs the
    /// Boehm collector, which has no ephemerons, so such a table holds its keys and
    /// values strongly: it is a map that is never emptied. One keyed by contact plan
    /// kept every plan made, tens of megabytes a minute in flight. Hold the state on its
    /// owner, or bound it explicitly (IdentityRecencyMap, PrunedCache).
    /// </summary>
    public class NoConditionalWeakTableInKspCodeTests
    {
        private static readonly Regex Use = new Regex(@"\bConditionalWeakTable\s*<", RegexOptions.Compiled);

        private static readonly Regex KspTarget = new Regex(@"<TargetFrameworks?>[^<]*\bnet472\b", RegexOptions.Compiled);

        [Fact]
        public void NoAssemblyKspLoadsUsesAConditionalWeakTable()
        {
            var projects = KspLoadedProjects(ResolveModDir());

            // Blind if the projects that matter were not found: an empty walk reports a clean tree.
            Assert.Contains("Gonogo.KSP", projects.Select(Path.GetFileName));
            Assert.Contains("Sitrep.Host", projects.Select(Path.GetFileName));
            Assert.Contains("Sitrep.Propagation", projects.Select(Path.GetFileName));

            var hits = projects.SelectMany(Hits).ToList();

            Assert.True(hits.Count == 0, "ConditionalWeakTable in KSP-loaded code:\n" + string.Join("\n", hits));
        }

        [Fact]
        public void TheScanSeesAUseAndIgnoresAMention()
        {
            Assert.Matches(Use, "private readonly ConditionalWeakTable<object, string> _ids = new();");
            Assert.Matches(Use, "System.Runtime.CompilerServices.ConditionalWeakTable <Mesh, Vector3[]>");
            Assert.DoesNotMatch(Use, "// a ConditionalWeakTable's keys are held strongly");
        }

        private static IEnumerable<string> Hits(string project)
        {
            foreach (var file in Directory.EnumerateFiles(project, "*.cs", SearchOption.AllDirectories))
            {
                if (IsBuildOutput(file))
                {
                    continue;
                }
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (Use.IsMatch(lines[i]))
                    {
                        yield return Path.GetFileName(project) + "/" + Path.GetFileName(file) + ":" + (i + 1);
                    }
                }
            }
        }

        /// <summary>Every project under mod/ that builds for net472, the framework a KSP plugin loads as.</summary>
        private static List<string> KspLoadedProjects(string modDir)
        {
            var projects = new List<string>();
            foreach (var project in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(project);
                if (name.EndsWith(".Tests", StringComparison.Ordinal))
                {
                    continue;
                }
                var csproj = Path.Combine(project, name + ".csproj");
                if (File.Exists(csproj) && KspTarget.IsMatch(File.ReadAllText(csproj)))
                {
                    projects.Add(project);
                }
            }
            return projects;
        }

        private static bool IsBuildOutput(string file) =>
            file.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            || file.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar, StringComparison.Ordinal);

        private static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                if (Directory.Exists(Path.Combine(directory.FullName, "mod", "Sitrep.Contract")))
                {
                    return Path.Combine(directory.FullName, "mod");
                }
                directory = directory.Parent;
            }
            throw new InvalidOperationException("Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
