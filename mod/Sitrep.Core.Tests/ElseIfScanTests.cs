using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// No C# under <c>mod/</c> chains an <c>else if</c>.
    ///
    /// <para>A chain of cases reads as a guard clause that returns, a small method
    /// that returns once per case, a <c>continue</c> per case inside a loop, or a
    /// switch where the branches are data. Each of those states its case and is
    /// done with it, where a chain makes the reader carry every earlier condition
    /// to understand the last one. The whole tree is held to zero, with no debt
    /// list.</para>
    ///
    /// <para>The walk is every TRACKED <c>*.cs</c> file, test projects included,
    /// read through <see cref="ProducerFlattenScan.Mask"/> so a comment or a string
    /// that mentions the construct is not a use of it.</para>
    /// </summary>
    public class ElseIfScanTests
    {
        /// <summary>
        /// Vendored third-party source (Fleck, the WebSocket server) kept as close
        /// to upstream as it can be, so that a re-vendor is a diff against the
        /// original rather than against our restyling of it.
        /// </summary>
        private const string VendoredPrefix = "Sitrep.Transport/Vendor/";

        private static readonly Regex ElseIf = new Regex(@"\belse\s+if\b", RegexOptions.Compiled);

        [Fact]
        public void NoTrackedSourceUnderModChainsAnElseIf()
        {
            var offenders = Offenders(TrackedSources());

            Assert.True(
                offenders.Count == 0,
                "An else-if chain carries every earlier condition into the next case. Return early "
                    + "(a guard clause, a small method returning per case, a continue per case in a "
                    + "loop), or use a switch where the branches are data:\n  "
                    + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The scan can SEE the thing it forbids, in both spellings, and leaves a
        /// mention in a comment or a string alone. A pattern that stopped matching
        /// would report the zero this tree is held at, and zero reads as success.
        /// </summary>
        [Fact]
        public void TheScanCanSeeAnElseIfAndIgnoresAMentionOfOne()
        {
            var planted = new[]
            {
                ("same-line.cs", "if (a) { x(); } else if (b) { y(); }"),
                ("split.cs", "if (a)\n{\n    x();\n}\nelse\n    if (b)\n    {\n        y();\n    }"),
                ("mention.cs", "// else if in a comment\nvar s = \"else if\";\nvar v = @\"else if\";\n/* else if */"),
            };

            var offenders = Offenders(planted);

            Assert.Equal(new[] { "same-line.cs:1", "split.cs:5" }, offenders);
        }

        /// <summary>
        /// The walk is reading the real tree. It must reach this file, which proves
        /// test projects are walked and not just production ones, and the vendored
        /// exclusion must still name tracked files, so a moved or renamed vendor
        /// directory fails here rather than leaving a dead exclusion behind.
        /// </summary>
        [Fact]
        public void TheWalkReadsTheTreeAndTheVendoredExclusionIsLive()
        {
            var tracked = TrackedFiles();

            Assert.True(
                tracked.Count > 0,
                "BLIND: git ls-files found no *.cs under " + ModDir() + ", so the ban read nothing and "
                    + "its zero means nothing.");
            Assert.Contains("Sitrep.Core.Tests/ElseIfScanTests.cs", tracked);
            Assert.Contains(tracked, path => path.StartsWith(VendoredPrefix, StringComparison.Ordinal));
        }

        private static List<string> Offenders(IEnumerable<(string Path, string Text)> sources)
        {
            var offenders = new List<string>();
            foreach (var (path, text) in sources)
            {
                var masked = ProducerFlattenScan.Mask(text, blankStrings: true);
                foreach (Match match in ElseIf.Matches(masked))
                {
                    var line = text.Take(match.Index).Count(c => c == '\n') + 1;
                    offenders.Add(path + ":" + line);
                }
            }

            return offenders;
        }

        private static IEnumerable<(string Path, string Text)> TrackedSources()
        {
            var modDir = ModDir();
            return TrackedFiles()
                .Where(path => !path.StartsWith(VendoredPrefix, StringComparison.Ordinal))
                .Select(path => (path, File.ReadAllText(Path.Combine(modDir, path))));
        }

        /// <summary>Every tracked <c>*.cs</c> under <c>mod/</c>, as a <c>/</c>-separated path relative to it.</summary>
        private static List<string> TrackedFiles()
        {
            var start = new ProcessStartInfo("git")
            {
                WorkingDirectory = ModDir(),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var arg in new[] { "ls-files", "-z", "--", "*.cs" })
            {
                start.ArgumentList.Add(arg);
            }

            using var git = Process.Start(start)
                ?? throw new InvalidOperationException("Could not start git in " + ModDir());
            var output = git.StandardOutput.ReadToEnd();
            var error = git.StandardError.ReadToEnd();
            git.WaitForExit();
            if (git.ExitCode != 0)
            {
                throw new InvalidOperationException("git ls-files failed in " + ModDir() + ": " + error);
            }

            return output.Split('\0', StringSplitOptions.RemoveEmptyEntries).ToList();
        }

        private static string ModDir() => ProducerFieldParityTests.ResolveModDir();
    }
}
