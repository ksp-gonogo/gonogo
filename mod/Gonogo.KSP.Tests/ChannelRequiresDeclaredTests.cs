using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Every channel core declares states what the save must have unlocked for
    /// it, <c>Requirement.None</c> included. Most channels are honestly
    /// ungated, so a default would be right nine times in ten and nobody would
    /// notice the tenth; an explicit None is what shows the question was asked.
    ///
    /// <para>The engine reads an unset <c>Requires</c> as None so an Uplink
    /// built against an older contract still loads, which is why this holds
    /// core's declarations at build time rather than refusing them at load.
    /// The declarations need KSP to compile, so the guard reads their source.</para>
    /// </summary>
    public class ChannelRequiresDeclaredTests
    {
        /// <summary>A floor, not an equality: a scan that finds nothing has checked nothing.</summary>
        private const int MinimumDeclarations = 50;

        private static readonly string[] CoreRoots = { "Gonogo.KSP", "Sitrep.Host" };

        [Fact]
        public void EveryCoreChannelDeclarationStatesItsRequirement()
        {
            var modRoot = FindModRoot();
            var declarations = 0;
            var unstated = new List<string>();
            foreach (var root in CoreRoots)
            {
                foreach (var path in Directory.EnumerateFiles(Path.Combine(modRoot, root), "*.cs", SearchOption.AllDirectories))
                {
                    if (IsBuildOutput(path)) continue;
                    var source = File.ReadAllText(path);
                    foreach (var block in DeclarationBlocks(source))
                    {
                        declarations++;
                        if (!StatesRequires(block.Text))
                        {
                            unstated.Add($"{Path.GetRelativePath(modRoot, path)}:{block.Line}");
                        }
                    }
                }
            }

            Assert.True(declarations >= MinimumDeclarations,
                $"found {declarations} channel declarations under {string.Join(", ", CoreRoots)}; "
                + "the scan has stopped seeing what it checks");
            Assert.True(unstated.Count == 0,
                "these channel declarations do not state Requires; set Requirement.None for a channel "
                + "nothing in the game gates, or the requirement it has:\n  " + string.Join("\n  ", unstated));
        }

        [Fact]
        public void SeesAnUnstatedDeclaration()
        {
            const string planted = @"
                new ChannelDeclaration
                {
                    Topic = ""a.b"",
                    Emission = new EmissionPolicy(1, null),
                },
                new ChannelDeclaration
                {
                    Topic = ""c.d"",
                    Requires = Requirement.None,
                    Emission = new EmissionPolicy(1, null) { Inner = { } },
                },";

            var blocks = DeclarationBlocks(planted).ToList();
            Assert.Equal(2, blocks.Count);
            Assert.False(StatesRequires(blocks[0].Text));
            Assert.True(StatesRequires(blocks[1].Text));
        }

        private static bool StatesRequires(string block) => Regex.IsMatch(block, @"\bRequires\s*=");

        /// <summary>Each <c>new ChannelDeclaration { ... }</c> initializer, braces balanced, with the line it starts on.</summary>
        private static IEnumerable<(string Text, int Line)> DeclarationBlocks(string source)
        {
            foreach (Match match in Regex.Matches(source, @"new\s+ChannelDeclaration\s*\{"))
            {
                var depth = 1;
                var end = match.Index + match.Length;
                while (end < source.Length && depth > 0)
                {
                    switch (source[end])
                    {
                        case '{':
                            depth++;
                            break;
                        case '}':
                            depth--;
                            break;
                    }
                    end++;
                }
                var line = source.Take(match.Index).Count(c => c == '\n') + 1;
                yield return (source.Substring(match.Index, end - match.Index), line);
            }
        }

        private static bool IsBuildOutput(string path)
        {
            var sep = Path.DirectorySeparatorChar;
            return path.Contains($"{sep}obj{sep}") || path.Contains($"{sep}bin{sep}");
        }

        /// <summary>
        /// The <c>mod</c> directory, found by walking up from the test binary.
        /// Fails loudly rather than skipping: a source guard that cannot find
        /// its source has not checked anything.
        /// </summary>
        private static string FindModRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            var searched = new List<string>();
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod");
                if (Directory.Exists(Path.Combine(candidate, "Gonogo.KSP")))
                {
                    return candidate;
                }
                if (Directory.Exists(Path.Combine(dir.FullName, "Gonogo.KSP")))
                {
                    return dir.FullName;
                }
                searched.Add(dir.FullName);
                dir = dir.Parent;
            }
            throw new InvalidOperationException(
                "could not find mod/Gonogo.KSP above the test binary; searched: " + string.Join(", ", searched));
        }
    }
}
