using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Every line the mod writes to KSP.log starts with "[Gonogo] ", so a
    /// player's bug report can be filtered with one grep for that prefix. A call
    /// whose first argument is not a literal that starts with it, or a constant
    /// that does, writes lines the grep misses.
    ///
    /// <para>The calls need KSP to compile, so the guard reads their source.</para>
    /// </summary>
    public class LogLinesCarryThePrefixTests
    {
        private const string Prefix = "[Gonogo] ";

        /// <summary>A floor, not an equality: a scan that finds nothing has checked nothing.</summary>
        private const int MinimumCalls = 50;

        /// <summary>
        /// Calls that forward a ready-made line. Each names the file and the
        /// argument, and the reason its callers are covered.
        /// </summary>
        private static readonly (string File, string Argument, string Reason)[] Forwarders =
        {
            ("GonogoLog.cs", "text", "Emit is only reached with Prefix already on the line"),
            ("CurrencyEventUplink.cs", "message", "DerivedCurrencyWithholding builds every line with the prefix, checked below"),
        };

        private static readonly Regex Call = new Regex(
            @"\bDebug\.Log(?:Warning|Error|Exception|Format|WarningFormat|ErrorFormat)?\(\s*(?=(?<arg>[^\r\n]{0,60}))",
            RegexOptions.Compiled);

        private static readonly string[] SkippedFolders =
        {
            "GonogoDevTools", "mod-devtools", "obj", "bin",
        };

        [Fact]
        public void EveryDebugLogCallStartsItsLineWithThePrefix()
        {
            var modRoot = FindModRoot();
            var calls = 0;
            var offenders = new List<string>();
            foreach (var path in SourceFiles(modRoot))
            {
                var source = File.ReadAllText(path);
                calls += Call.Matches(source).Count;
                foreach (var offender in Offenders(source, Path.GetFileName(path)))
                {
                    offenders.Add($"{Path.GetRelativePath(modRoot, path)}: {offender}");
                }
            }

            Assert.True(calls >= MinimumCalls, $"found {calls} Debug.Log calls under {modRoot}; a scan that finds this few has missed the sources");
            Assert.True(offenders.Count == 0,
                "these Debug.Log calls do not start their line with \"" + Prefix + "\" (use GonogoLog, or begin the literal with the prefix):\n"
                + string.Join("\n", offenders));
        }

        [Fact]
        public void EveryLineTheDerivedCurrencyWithholdingForwardsStartsWithThePrefix()
        {
            var path = Directory.EnumerateFiles(FindModRoot(), "DerivedCurrencyWithholding.cs", SearchOption.AllDirectories)
                .Single(p => !Skipped(p));
            var source = File.ReadAllText(path);

            var calls = Regex.Matches(source, @"\b(?:Report|Note)\(\s*(?<arg>[^\r\n]*)").Cast<Match>().ToList();
            Assert.True(calls.Count >= 5, "found too few Report and Note calls to have checked the withholding");
            var bad = calls.Where(c => c.Groups["arg"].Value.Length > 0 && !c.Groups["arg"].Value.StartsWith("\"" + Prefix, StringComparison.Ordinal))
                .Select(c => c.Groups["arg"].Value)
                .Where(a => a.StartsWith("\"", StringComparison.Ordinal))
                .ToList();
            Assert.True(bad.Count == 0, "Report and Note lines without the prefix:\n" + string.Join("\n", bad));
        }

        [Fact]
        public void TheScanSeesACallThatLeavesThePrefixOff()
        {
            var planted = "class C { void M() { Debug.LogWarning(\"[Gonogo.SomeUplink] x\"); Debug.Log(\"plain\"); Debug.Log(\"[Gonogo] fine\"); } }";

            var offenders = Offenders(planted, "Planted.cs").ToList();

            Assert.True(offenders.Count == 2, string.Join(" ; ", offenders));
        }

        [Fact]
        public void AConstantCarriesThePrefixOnlyWhenTheFileDeclaresItWithIt()
        {
            var good = "const string LogPrefix = \"[Gonogo] dev: \"; void M() { Debug.Log(LogPrefix + x); }";
            var bad = "const string LogPrefix = \"[Dev] \"; void M() { Debug.Log(LogPrefix + x); }";

            Assert.Empty(Offenders(good, "Good.cs"));
            Assert.Single(Offenders(bad, "Bad.cs"));
        }

        private static IEnumerable<string> Offenders(string source, string fileName)
        {
            foreach (Match call in Call.Matches(source))
            {
                var arg = call.Groups["arg"].Value.Trim();
                if (StartsWithPrefix(arg, source) || IsAllowedForwarder(arg, fileName))
                {
                    continue;
                }

                var line = source.Substring(0, call.Index).Count(c => c == '\n') + 1;
                yield return $"line {line}: {call.Value.Trim()}{arg}";
            }
        }

        private static bool StartsWithPrefix(string arg, string source)
        {
            if (arg.StartsWith("\"" + Prefix, StringComparison.Ordinal)
                || arg.StartsWith("$\"" + Prefix, StringComparison.Ordinal))
            {
                return true;
            }

            if (arg.StartsWith("string.Format(", StringComparison.Ordinal))
            {
                return source.Contains("\"" + Prefix);
            }

            var name = Regex.Match(arg, @"^(?<id>\w*Prefix)\b");
            return name.Success
                && Regex.IsMatch(source, @"const\s+string\s+" + name.Groups["id"].Value + @"\s*=\s*""" + Regex.Escape(Prefix));
        }

        private static bool IsAllowedForwarder(string arg, string fileName)
        {
            return Forwarders.Any(f => f.File == fileName && Regex.IsMatch(arg, @"^" + f.Argument + @"\b"));
        }

        private static IEnumerable<string> SourceFiles(string modRoot)
        {
            return Directory.EnumerateFiles(modRoot, "*.cs", SearchOption.AllDirectories)
                .Where(p => !Skipped(p));
        }

        private static bool Skipped(string path)
        {
            var sep = Path.DirectorySeparatorChar;
            var parts = path.Split(sep);
            return parts.Any(part => SkippedFolders.Contains(part) || part.EndsWith(".Tests", StringComparison.Ordinal));
        }

        private static string FindModRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                if (Directory.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.KSP")))
                {
                    return Path.Combine(dir.FullName, "mod");
                }
                if (Directory.Exists(Path.Combine(dir.FullName, "Gonogo.KSP")))
                {
                    return dir.FullName;
                }
                dir = dir.Parent;
            }

            throw new InvalidOperationException("could not find the mod directory above " + AppContext.BaseDirectory);
        }
    }
}
