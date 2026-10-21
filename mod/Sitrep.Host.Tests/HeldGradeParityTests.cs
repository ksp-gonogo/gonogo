using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The contract's <see cref="HeldGrade"/> and the SDK's <c>HeldGrade</c>
    /// union in <c>mod/sitrep-sdk/src/reading.ts</c> name the same grades in the
    /// same order, so an Uplink that labels a held craft from one and a held
    /// figure from the other says the same word for the same reason.
    /// </summary>
    public class HeldGradeParityTests
    {
        [Fact]
        public void TheContractEnumNamesEveryGradeTheSdkUnionDoesInTheSameOrder()
        {
            var sdk = SdkGrades(File.ReadAllText(ReadingTs()));
            var contract = Enum.GetValues(typeof(HeldGrade)).Cast<HeldGrade>()
                .OrderBy(grade => (int)grade)
                .Select(grade => Kebab(grade.ToString()))
                .ToArray();

            Assert.Equal(sdk, contract);
        }

        [Fact]
        public void TheParseSeesAPlantedGrade()
        {
            var planted = SdkGrades("export type HeldGrade =\n  | \"held\"\n  | \"planted-grade\";\n");

            Assert.Equal(new[] { "held", "planted-grade" }, planted);
        }

        private static string[] SdkGrades(string source)
        {
            var declaration = Regex.Match(source, @"export type HeldGrade =([^;]*);");
            Assert.True(declaration.Success, "reading.ts no longer declares `export type HeldGrade = ...;`, so the parity check cannot see it.");
            var grades = Regex.Matches(declaration.Groups[1].Value, "\"([a-z-]+)\"").Select(m => m.Groups[1].Value).ToArray();
            Assert.NotEmpty(grades);
            return grades;
        }

        private static string Kebab(string name) => Regex.Replace(name, "(?<!^)([A-Z])", "-$1").ToLowerInvariant();

        private static string ReadingTs()
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "sitrep-sdk", "src", "reading.ts");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            throw new InvalidOperationException("could not locate mod/sitrep-sdk/src/reading.ts walking up from " + AppContext.BaseDirectory);
        }
    }
}
