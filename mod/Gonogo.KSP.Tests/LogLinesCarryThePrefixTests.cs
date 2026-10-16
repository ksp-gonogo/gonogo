using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Every line the mod writes to KSP.log starts with "[Gonogo] " so a
    /// player's bug report can be filtered with one grep for that prefix. The
    /// prefix is added in one place, GonogoLog, so the guard is that no other
    /// shipped source calls <c>Debug.Log</c> itself.
    ///
    /// <para>The calls need KSP to compile, so the guard reads their source.</para>
    /// </summary>
    public class LogLinesCarryThePrefixTests
    {
        /// <summary>A floor, not an equality: a scan that finds nothing has checked nothing.</summary>
        private const int MinimumFiles = 50;

        private const string LoggerFile = "GonogoLog.cs";

        private static readonly Regex Call = new Regex(
            @"\bDebug\.Log(?:Warning|Error|Exception|Format|WarningFormat|ErrorFormat)?\s*\(",
            RegexOptions.Compiled);

        private static readonly string[] SkippedFolders =
        {
            "GonogoDevTools", "mod-devtools", "obj", "bin",
        };

        [Fact]
        public void NoSourceOutsideTheLoggerCallsDebugLog()
        {
            var modRoot = FindModRoot();
            var files = 0;
            var offenders = new List<string>();
            foreach (var path in SourceFiles(modRoot))
            {
                files++;
                if (Path.GetFileName(path) == LoggerFile)
                {
                    continue;
                }

                offenders.AddRange(Offenders(File.ReadAllText(path))
                    .Select(o => $"{Path.GetRelativePath(modRoot, path)}: {o}"));
            }

            Assert.True(files >= MinimumFiles, $"found {files} source files under {modRoot}; a scan that finds this few has missed the sources");
            Assert.True(offenders.Count == 0,
                "these calls write to KSP.log without GonogoLog, which owns the prefix (use GonogoLog.Info, Warn or Error with a tag):\n"
                + string.Join("\n", offenders));
        }

        [Fact]
        public void TheLoggerItselfStillCallsDebugLog()
        {
            var logger = SourceFiles(FindModRoot()).Single(p => Path.GetFileName(p) == LoggerFile);

            Assert.NotEmpty(Offenders(File.ReadAllText(logger)));
        }

        [Fact]
        public void TheScanSeesEveryDebugLogForm()
        {
            var planted = "class C { void M() { Debug.Log(\"a\"); Debug.LogWarning(x); Debug.LogError (y); Debug.LogException(e); } }";

            Assert.Equal(4, Offenders(planted).Count());
        }

        private static IEnumerable<string> Offenders(string source)
        {
            foreach (Match call in Call.Matches(source))
            {
                var line = source.Substring(0, call.Index).Count(c => c == '\n') + 1;
                yield return $"line {line}: {call.Value}";
            }
        }

        private static IEnumerable<string> SourceFiles(string modRoot)
        {
            return Directory.EnumerateFiles(modRoot, "*.cs", SearchOption.AllDirectories)
                .Where(p => !Skipped(p));
        }

        private static bool Skipped(string path)
        {
            var parts = path.Split(Path.DirectorySeparatorChar);
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
