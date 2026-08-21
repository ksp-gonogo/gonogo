using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <c>CommandErrorCode.ModeUnavailable</c> is the residue arm, and the residue
    /// is one site.
    ///
    /// <para>It used to be forty, with seven unrelated causes inside it, and every
    /// one of them reached the operator reading the same. The taxonomy that
    /// replaced it is only worth anything while it stays replaced: a new refusal
    /// written as <c>Fail(ModeUnavailable)</c> is free to write, invisible in
    /// review, and puts a cause back in the bucket a commit at a time. This
    /// counts them.</para>
    ///
    /// <para><b>An allowance, not an equality.</b> A genuinely attempt-and-see
    /// refusal is allowed to exist and would be added here by name. Today there
    /// is exactly one: a <c>.craft</c> file is only known to be readable by
    /// reading it, and no query could have said so first. Everything else in
    /// <c>Gonogo.KSP</c> is a precheck against an authority KSP already
    /// publishes.</para>
    ///
    /// <para><b>The scan asserts it found its subject.</b> A source-text gate
    /// whose walk returns nothing reports zero violations, and zero reads as
    /// success. So the discovery is pinned separately, with a floor on both the
    /// files found and the refusals seen in them: this gate going quiet has to
    /// look like a failure, not like a pass.</para>
    /// </summary>
    public class RefusalTaxonomyTests
    {
        /// <summary>
        /// The refusals that may stay <c>ModeUnavailable</c>, by the file they
        /// live in and what makes them genuinely unaskable in advance. Shrink-only
        /// by intent: an entry leaves when the game turns out to have an authority
        /// for it after all.
        /// </summary>
        private static readonly Dictionary<string, string> AttemptAndSeeAllowance =
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["KspFlightOpsActuator.cs"] =
                    "the .craft parse: ConfigNode.Load and VesselCrewManifest.FromConfigNode "
                        + "fail only on read, and no query exists that could have said so first",
            };

        /// <summary>Every actuator this gate is about, so a renamed one fails loudly rather than dropping out of scope.</summary>
        private static readonly string[] Actuators =
        {
            "KspCareerActuator.cs",
            "KspFlightOpsActuator.cs",
            "KspRoboticsActuator.cs",
            "KspVesselActuator.cs",
            "KspScienceActuator.cs",
            "KspPartActionActuator.cs",
        };

        /// <summary>
        /// A refusal, not a mention: <c>CommandResult.Fail(CommandErrorCode.X</c>
        /// and <c>CommandResult&lt;T&gt;.Fail(...)</c>, never a doc comment or a
        /// <c>see cref</c>. Counting textual mentions is how the same forty sites
        /// were first reported as fifty-two.
        /// </summary>
        private static readonly Regex Refusal = new Regex(
            @"Fail\(\s*CommandErrorCode\.(?<code>[A-Za-z]+)",
            RegexOptions.Compiled);

        [Fact]
        public void ModeUnavailableSurvivesOnlyWhereTheGameCannotBeAskedFirst()
        {
            var offenders = new List<string>();

            foreach (var file in ActuatorFiles())
            {
                var name = Path.GetFileName(file);
                var count = Refusal.Matches(File.ReadAllText(file))
                    .Cast<Match>()
                    .Count(m => m.Groups["code"].Value == "ModeUnavailable");
                if (count == 0) continue;

                var allowed = AttemptAndSeeAllowance.ContainsKey(name) ? 1 : 0;
                if (count > allowed)
                {
                    offenders.Add($"{name}: {count} ModeUnavailable refusal(s), {allowed} allowed");
                }
            }

            Assert.True(
                offenders.Count == 0,
                "ModeUnavailable is the residue arm and the residue is the .craft parse. "
                    + "A new refusal belongs on the authority that decided it (CareerModeRequired, "
                    + "WrongScene, WrongState, NotClearToProceed, CapabilityMismatch, NoConnection, "
                    + "NotUnlocked, LimitReached, InsufficientFunds/Science), each of which names a "
                    + "real KSP authority. See local_docs/design/2026-08-21-ksp-refusal-taxonomy.md. "
                    + "Offending files: " + string.Join("; ", offenders));
        }

        /// <summary>
        /// A stale allowance is a lie about the code, so it fails as loudly as a
        /// new breach. An entry whose file has stopped refusing that way has to
        /// go, or the list stops describing anything.
        /// </summary>
        [Fact]
        public void EveryAllowedResidueIsStillThere()
        {
            foreach (var pair in AttemptAndSeeAllowance)
            {
                var file = ActuatorFiles().Single(f => Path.GetFileName(f) == pair.Key);
                var count = Refusal.Matches(File.ReadAllText(file))
                    .Cast<Match>()
                    .Count(m => m.Groups["code"].Value == "ModeUnavailable");
                Assert.True(
                    count == 1,
                    $"{pair.Key} is excused one ModeUnavailable ({pair.Value}) and has {count}. "
                        + "Remove the allowance if the refusal is gone.");
            }
        }

        /// <summary>
        /// The gate can see what it is counting. Without this, a moved directory
        /// or a renamed actuator makes the scan match nothing and report success.
        /// </summary>
        [Fact]
        public void TheScanFindsTheActuatorsAndTheirRefusals()
        {
            var files = ActuatorFiles().ToList();
            Assert.Equal(Actuators.Length, files.Count);

            var refusals = files.Sum(f => Refusal.Matches(File.ReadAllText(f)).Count);
            Assert.True(
                refusals >= 40,
                $"the six actuators between them hold {refusals} typed refusals; the taxonomy pass "
                    + "left more than forty, so a count this low means the regex or the walk has "
                    + "stopped matching rather than the code having got smaller");
        }

        private static IEnumerable<string> ActuatorFiles()
        {
            var kspDir = Path.Combine(ResolveModDir(), "Gonogo.KSP");
            foreach (var name in Actuators)
            {
                var path = Path.Combine(kspDir, name);
                Assert.True(File.Exists(path), $"actuator not found where this gate looks: {path}");
                yield return path;
            }
        }

        /// <summary>Walks up from the test assembly to the checked-out <c>mod/</c> directory, same pattern as <see cref="UplinkIsolationTests"/>.</summary>
        private static string ResolveModDir()
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
