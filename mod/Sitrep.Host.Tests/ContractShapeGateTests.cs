using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using System.Text.Json.Serialization;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The CI contract-shape gate. Reflects
    /// every <see cref="SitrepContractAttribute"/>-marked type in
    /// <c>Sitrep.Contract</c> (applied alongside every real
    /// <c>[TsInterface]</c> usage: see <see cref="SitrepContractAttribute"/>'s
    /// own doc comment for why this gate uses its own same-assembly marker
    /// rather than reflecting <c>[TsInterface]</c> directly: that attribute's
    /// declaring assembly, <c>Reinforced.Typings</c>, is codegen-only by
    /// explicit design and must never be resolved at runtime. Those attributes
    /// are no longer compiled into the shipped contract at all, they exist only
    /// in <c>Sitrep.Contract.Codegen</c>, so reflecting them here would find
    /// nothing)
    /// and checks it against a checked-in LEDGER
    /// (<c>mod/Sitrep.Contract/contract-shape.baseline.json</c>, wired into
    /// this project the same way the other <c>golden-fixtures/</c> JSON
    /// fixtures are; see this project's .csproj).
    ///
    /// <para><b>Why a ledger and not a single baseline.</b> <b>The baseline had
    /// no memory.</b> The
    /// ledger fixes exactly that. Each entry records a Major's frozen
    /// <c>Shape</c>, written ONCE when that Major is created and never
    /// rewritten (see <see cref="FreezeCurrentMajor_ManualOnly"/>, which
    /// refuses to overwrite an existing entry). An additive change needs no
    /// regeneration at all (the gate already passes it) so the only thing
    /// that ever appends to the ledger is a Major bump, and that append has to
    /// declare what it broke.</para>
    ///
    /// <para><b>The invariant, stated honestly: a Major names exactly ONE
    /// shape.</b> Enforced by four rules, each its own test:</para>
    /// <list type="number">
    /// <item><see cref="EachMajorAppearsExactlyOnceInTheLedger"/>: two entries
    /// claiming the same Major is the parallel-branch collision itself.</item>
    /// <item><see cref="CurrentMajorIsRecordedInTheLedger"/>: bumping Major
    /// without freezing a shape can no longer skip the diff.</item>
    /// <item><see cref="CurrentShapeIsAdditiveOverTheFrozenMajorFloor"/>: the
    /// old "lying minor" check, but against a floor the commit cannot
    /// rewrite.</item>
    /// <item><see cref="EveryMajorBumpDeclaresExactlyWhatItBroke"/>: a Major
    /// must show its work: its declared <c>Breaks</c> must equal the computed
    /// diff from the previous Major's shape. A Major that breaks nothing, on
    /// the wire or on a declared C# seam, is not a Major, and a Major cannot
    /// claim a wire break it did not make (nor omit one it did).</item>
    /// </list>
    ///
    /// <para>Note what is deliberately NOT enforced: this gate never decides
    /// whether a break is <i>allowed</i>. That is a human call. The gate's job
    /// is only to guarantee the call is made explicitly, recorded, and
    /// true.</para>
    /// </summary>
    public class ContractShapeGateTests
    {
        private static readonly string LedgerPath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "contract-shape.baseline.json");

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };

        /// <summary>
        /// One Major's frozen record. <see cref="Shape"/> is written once, when
        /// the Major is created, and never rewritten, that immutability is the
        /// entire point of the ledger (see the class doc comment).
        /// </summary>
        private sealed class MajorEntry
        {
            public int Major { get; set; }

            /// <summary>Free-form provenance for a human reader. Never asserted on.</summary>
            public string Note { get; set; } = string.Empty;

            /// <summary>
            /// The canonical removal strings (see <see cref="ComputeRemovals"/>)
            /// this Major inflicted relative to the previous recorded Major.
            /// Verified (not trusted) by
            /// <see cref="EveryMajorBumpDeclaresExactlyWhatItBroke"/>.
            /// </summary>
            public string[] Breaks { get; set; } = Array.Empty<string>();

            /// <summary>
            /// Breaks on a shipped C# seam rather than on the wire: an interface
            /// or abstract member an Uplink implements. The shape is reflected
            /// from wire types only, so nothing here can be computed and each one
            /// is DECLARED, with the members it changed and why.
            /// </summary>
            public SeamBreak[] SeamBreaks { get; set; } = Array.Empty<SeamBreak>();

            public Shape Shape { get; set; } = new();
        }

        /// <summary>One declared break on a shipped C# seam.</summary>
        private sealed class SeamBreak
        {
            /// <summary>The type an Uplink implements, by full name.</summary>
            public string Seam { get; set; } = string.Empty;

            /// <summary>Each member whose signature an existing implementer no longer compiles against.</summary>
            public string[] Members { get; set; } = Array.Empty<string>();

            /// <summary>Why the break was worth taking.</summary>
            public string Reason { get; set; } = string.Empty;
        }

        /// <summary>
        /// A reflected contract shape: wire types keyed by full name, valued as
        /// sorted <c>"MemberName:MemberType"</c> strings, plus the enum
        /// analogue keyed by full name and valued as sorted
        /// <c>"MemberName:UnderlyingValue"</c> strings. A renamed OR renumbered
        /// enum member changes its entry's string, so
        /// <see cref="ComputeRemovals"/>'s plain set-difference catches both
        /// without special-casing.
        /// </summary>
        private sealed class Shape
        {
            public Dictionary<string, string[]> Types { get; set; } = new();
            public Dictionary<string, string[]> Enums { get; set; } = new();

            /// <summary>
            /// Every <c>[SitrepTopic]</c> id, mapped to the tag's own contents
            /// (<c>"type:&lt;FullName&gt;"</c>, <c>"array:&lt;bool&gt;"</c>).
            ///
            /// <para>The id is what a CLIENT binds to. The CLR type name is
            /// invisible to it, so a rename that touches only the tag breaks
            /// every subscriber while leaving <see cref="Types"/> identical:
            /// planted and confirmed green before this was added.</para>
            ///
            /// <para>NULLABLE on purpose, and the null is not "no topics". It
            /// means the dimension was never recorded, which is true of every
            /// Major before 17. <see cref="ComputeRemovals"/> skips the
            /// comparison entirely in that case, so backfilling this could not
            /// retroactively add entries to a frozen <c>Breaks</c> list.</para>
            /// </summary>
            public Dictionary<string, string[]>? Topics { get; set; }
        }

        private sealed class Ledger
        {
            public List<MajorEntry> Majors { get; set; } = new();
        }

        // ---------------------------------------------------------------
        // Rule 1: a Major names exactly one shape, so it appears once.
        // ---------------------------------------------------------------

        /// <summary>
        /// The parallel-branch collision, caught mechanically. Two branches
        /// each bumping 3 -&gt; 4 both append an entry for Major 4; whichever
        /// way a human resolves the merge conflict, something fires, a
        /// take-both resolve trips THIS rule, and a take-one resolve trips
        /// <see cref="CurrentShapeIsAdditiveOverTheFrozenMajorFloor"/> against
        /// the losing branch's code.
        /// </summary>
        [Fact]
        public void EachMajorAppearsExactlyOnceInTheLedger()
        {
            var ledger = LoadLedger();
            var duplicates = ledger.Majors
                .GroupBy(e => e.Major)
                .Where(g => g.Count() > 1)
                .Select(g => $"Major {g.Key} has {g.Count()} ledger entries")
                .ToList();

            Assert.True(
                duplicates.Count == 0,
                "A Major must name exactly ONE wire shape. " + string.Join("; ", duplicates) +
                ". This is what two branches independently bumping to the same Major looks like: " +
                "pick ONE shape for this Major, or give the second one its own Major.");
        }

        // ---------------------------------------------------------------
        // Rule 2: bumping Major can no longer skip the diff.
        // ---------------------------------------------------------------

        [Fact]
        public void CurrentMajorIsRecordedInTheLedger()
        {
            var ledger = LoadLedger();
            var matching = ledger.Majors.Count(e => e.Major == ContractVersion.Major);

            Assert.True(
                matching == 1,
                $"ContractVersion.Major is {ContractVersion.Major} but the ledger has {matching} " +
                $"entries for it (expected exactly 1). A Major bump must freeze its shape in the " +
                $"same commit: run the FreezeCurrentMajor_ManualOnly utility (see its doc comment). " +
                $"Recorded Majors: [{string.Join(", ", ledger.Majors.Select(e => e.Major))}].");
        }

        // ---------------------------------------------------------------
        // Rule 3: the old "lying minor" gate, against a frozen floor.
        // ---------------------------------------------------------------

        /// <summary>
        /// Every Minor on a Major line must be additive over that Major's
        /// frozen floor. This is the check the old gate meant to perform, the
        /// difference is that the floor now predates the commit under test, so
        /// the commit cannot regenerate its way to green.
        /// </summary>
        [Fact]
        public void CurrentShapeIsAdditiveOverTheFrozenMajorFloor()
        {
            var ledger = LoadLedger();
            var entries = ledger.Majors.Where(e => e.Major == ContractVersion.Major).ToList();

            // Rules 1 and 2 own the "no entry"/"duplicate entry" failures and
            // report them with actionable messages. Bailing here keeps one root
            // cause to one red test: and deliberately avoids SingleOrDefault,
            // which would THROW on the duplicate case and bury the real
            // diagnosis under an InvalidOperationException.
            if (entries.Count != 1)
            {
                return;
            }

            var removals = ComputeRemovals(entries[0].Shape, ComputeShape());

            Assert.True(
                removals.Count == 0,
                $"Non-additive change to the wire shape WITHOUT a Major bump, Major " +
                $"{ContractVersion.Major}'s shape was frozen and these are gone from it:\n  " +
                string.Join("\n  ", removals) +
                "\n\nA removed/renamed/retyped member is breaking by definition. Either make the " +
                "change additive, or bump ContractVersion.Major and freeze the new shape.");
        }

        // ---------------------------------------------------------------
        // Rule 4: a Major must show its work.
        // ---------------------------------------------------------------

        /// <summary>
        /// A Major bump is the sanctioned way to break the wire, but it is no
        /// longer a blanket amnesty. Each Major's declared <c>Breaks</c> must
        /// EXACTLY equal the diff computed from the previous recorded Major's
        /// shape, with nothing claimed that did not happen and nothing omitted
        /// that did. So "Major" names a specific, enumerated, verified shape
        /// change rather than a free pass.
        ///
        /// <para>A Major must break SOMETHING: a computed wire break, or a
        /// declared <see cref="MajorEntry.SeamBreaks"/> entry for a shipped C#
        /// seam, which the wire shape cannot see. A seam break is trusted as
        /// declared, so it must name the seam, the members and the reason; it
        /// never excuses a wire break, which still has to be declared in
        /// <c>Breaks</c> and match the computed diff.</para>
        /// </summary>
        [Fact]
        public void EveryMajorBumpDeclaresExactlyWhatItBroke()
        {
            var ledger = LoadLedger();
            var ordered = ledger.Majors.OrderBy(e => e.Major).ToList();

            foreach (var entry in ordered)
            {
                // The earliest recorded Major has no predecessor to diff
                // against: its Breaks are unverifiable, so they are not
                // asserted on. Every LATER Major is fully checked.
                var previous = ordered.LastOrDefault(e => e.Major < entry.Major);
                if (previous is null)
                {
                    continue;
                }

                var failures = MajorBreakFailures(previous, entry);
                Assert.True(failures.Count == 0, string.Join("\n\n", failures));
            }
        }

        /// <summary>What is wrong with <paramref name="entry"/>'s declared breaks against <paramref name="previous"/>; empty when nothing is.</summary>
        private static List<string> MajorBreakFailures(MajorEntry previous, MajorEntry entry)
        {
            var failures = new List<string>();
            var actual = ComputeRemovals(previous.Shape, entry.Shape);
            var declared = (entry.Breaks ?? Array.Empty<string>()).OrderBy(x => x, StringComparer.Ordinal).ToList();
            var seamBreaks = entry.SeamBreaks ?? Array.Empty<SeamBreak>();

            if (actual.Count == 0 && seamBreaks.Length == 0)
            {
                failures.Add(
                    $"Major {entry.Major} breaks nothing relative to Major {previous.Major}, " +
                    "so it should not be a Major. An additive change is a Minor bump.");
            }

            foreach (var seam in seamBreaks)
            {
                if (string.IsNullOrWhiteSpace(seam.Seam)
                    || seam.Members == null
                    || seam.Members.Length == 0
                    || seam.Members.Any(string.IsNullOrWhiteSpace)
                    || string.IsNullOrWhiteSpace(seam.Reason))
                {
                    failures.Add(
                        $"Major {entry.Major} declares a seam break without its seam, its members or " +
                        $"its reason (seam \"{seam.Seam}\"). Nothing computes a seam break, so the " +
                        "declaration is the whole record and has to be complete.");
                }
            }

            var undeclared = actual.Except(declared, StringComparer.Ordinal).ToList();
            if (undeclared.Count > 0)
            {
                failures.Add(
                    $"Major {entry.Major} broke something it never declared:\n  " +
                    string.Join("\n  ", undeclared) +
                    $"\n\nAdd these to the Major {entry.Major} entry's Breaks list, a Major must " +
                    "name every shape change it makes.");
            }

            var overdeclared = declared.Except(actual, StringComparer.Ordinal).ToList();
            if (overdeclared.Count > 0)
            {
                failures.Add(
                    $"Major {entry.Major} declares breaks that did not happen:\n  " +
                    string.Join("\n  ", overdeclared) +
                    $"\n\nEither the Breaks list is stale, or Major {entry.Major}'s frozen Shape is " +
                    "not what the declaration describes.");
            }

            return failures;
        }

        // ---------------------------------------------------------------
        // Self-tests for the gate itself.
        // ---------------------------------------------------------------

        /// <summary>
        /// Reproduces the exact collision that reached <c>staging</c>: the
        /// action-group retype landing as an "additive" v4.1 on top of a v4.0
        /// that had already published <c>ActionGroups</c> as
        /// <c>System.Boolean[]</c>. Under a single-mirror baseline this passes
        /// silently, because the baseline is regenerated and no longer
        /// remembers v4.0. Against a frozen floor it is caught.
        /// </summary>
        [Fact]
        public void GateSelfTest_CatchesTheRealV40ToV41ActionGroupCollision()
        {
            // Major 4's floor: the real published shape before the retype.
            var v40Floor = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Sitrep.Contract.VesselControl"] = new[] { "ActionGroups:System.Boolean[]" },
                },
            };

            // The shape v4.1 shipped: a RETYPE, dressed as an additive Minor.
            var v41Shape = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Sitrep.Contract.VesselControl"] = new[] { "ActionGroups:Sitrep.Contract.ActionGroupState[]" },
                },
            };

            var removals = ComputeRemovals(v40Floor, v41Shape);

            Assert.Equal(
                new[] { "member-removed:Sitrep.Contract.VesselControl.ActionGroups:System.Boolean[]" },
                removals);
        }

        /// <summary>
        /// The other half of today's incident: two branches each bumping
        /// 3 -&gt; 4 with different shapes. Whichever way the merge is
        /// resolved, a rule fires: take-both trips the duplicate check,
        /// take-one leaves the loser's break undeclared.
        /// </summary>
        [Fact]
        public void GateSelfTest_CatchesTwoBranchesClaimingTheSameMajor()
        {
            // Take-both resolve: the union of two branches' ledger appends.
            var takeBoth = new Ledger
            {
                Majors =
                {
                    new MajorEntry { Major = 4, Breaks = new[] { "member-removed:A.B:System.Double" } },
                    new MajorEntry { Major = 4, Breaks = new[] { "member-removed:C.D:System.Boolean[]" } },
                },
            };

            var duplicates = takeBoth.Majors.GroupBy(e => e.Major).Where(g => g.Count() > 1).ToList();
            Assert.NotEmpty(duplicates);

            // Take-one resolve: branch A's floor wins, but branch B's retype is
            // still in the code: so it shows up as an in-Major removal.
            var branchAFloor = new Shape
            {
                Types = new Dictionary<string, string[]> { ["C"] = new[] { "D:System.Boolean[]" } },
            };
            var branchBCode = new Shape
            {
                Types = new Dictionary<string, string[]> { ["C"] = new[] { "D:C.DState[]" } },
            };
            Assert.NotEmpty(ComputeRemovals(branchAFloor, branchBCode));
        }

        /// <summary>
        /// A Major whose only break is on a shipped C# seam is accepted when the
        /// seam break is declared in full, and refused when it is not. The wire
        /// shapes are identical, so the seam declaration is the only thing that
        /// can make this a Major.
        /// </summary>
        [Fact]
        public void GateSelfTest_ASeamOnlyMajorPassesDeclaredAndFailsIncomplete()
        {
            var shape = new Shape
            {
                Types = new Dictionary<string, string[]> { ["Widget"] = new[] { "Name:System.String" } },
            };
            var previous = new MajorEntry { Major = 1, Shape = shape };
            var declared = new MajorEntry
            {
                Major = 2,
                Shape = shape,
                SeamBreaks = new[]
                {
                    new SeamBreak
                    {
                        Seam = "Sitrep.Contract.IWidgetSource",
                        Members = new[] { "Read(object?)" },
                        Reason = "the source reads for a named widget rather than assuming one",
                    },
                },
            };
            Assert.Empty(MajorBreakFailures(previous, declared));

            var unreasoned = new MajorEntry
            {
                Major = 2,
                Shape = shape,
                SeamBreaks = new[] { new SeamBreak { Seam = "Sitrep.Contract.IWidgetSource", Members = new[] { "Read(object?)" } } },
            };
            Assert.Contains(MajorBreakFailures(previous, unreasoned), f => f.Contains("seam break without"));

            Assert.Contains(
                MajorBreakFailures(previous, new MajorEntry { Major = 2, Shape = shape }),
                f => f.Contains("breaks nothing"));
        }

        /// <summary>
        /// A declared seam break does not excuse a wire break: the wire half is
        /// still computed and still has to appear in <c>Breaks</c>.
        /// </summary>
        [Fact]
        public void GateSelfTest_ASeamBreakDoesNotCoverAnUndeclaredWireBreak()
        {
            var previous = new MajorEntry
            {
                Major = 1,
                Shape = new Shape
                {
                    Types = new Dictionary<string, string[]> { ["Widget"] = new[] { "Name:System.String", "Count:System.Int32" } },
                },
            };
            var entry = new MajorEntry
            {
                Major = 2,
                Shape = new Shape
                {
                    Types = new Dictionary<string, string[]> { ["Widget"] = new[] { "Name:System.String" } },
                },
                SeamBreaks = new[]
                {
                    new SeamBreak
                    {
                        Seam = "Sitrep.Contract.IWidgetSource",
                        Members = new[] { "Read(object?)" },
                        Reason = "the source reads for a named widget rather than assuming one",
                    },
                },
            };

            var failures = MajorBreakFailures(previous, entry);
            Assert.Contains(failures, f => f.Contains("never declared") && f.Contains("member-removed:Widget.Count:System.Int32"));
        }

        /// <summary>
        /// Proves <see cref="ComputeRemovals"/> (the single function behind
        /// every rule above) catches removed/retyped members and removed
        /// types, and stays silent for genuinely additive change. Supplies
        /// synthetic shapes so it never has to mutate-then-revert real
        /// <c>Sitrep.Contract</c> source (which would ripple into every
        /// downstream consumer of the mutated type).
        /// </summary>
        [Fact]
        public void GateSelfTest_ComputeRemovalsCatchesNonAdditiveButNotAdditive()
        {
            var floor = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Count:System.Int32" },
                },
            };

            // Non-additive: "Count" renamed to "Total": a removal, from the
            // floor's point of view.
            var renamed = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Total:System.Int32" },
                },
            };
            Assert.Equal(new[] { "member-removed:Widget.Count:System.Int32" }, ComputeRemovals(floor, renamed));

            // Non-additive: a whole type removed.
            Assert.Equal(new[] { "type-removed:Widget" }, ComputeRemovals(floor, new Shape()));

            // Additive: a new member and a brand new type, must NOT be caught.
            var additive = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Count:System.Int32", "NewField:System.Boolean" },
                    ["BrandNewType"] = new[] { "Whatever:System.String" },
                },
            };
            Assert.Empty(ComputeRemovals(floor, additive));
        }

        /// <summary>
        /// Enum analogue: the gate is not blind to enums. Covers a member
        /// RENAMED and a member RENUMBERED while keeping its name (both real
        /// wire breaks), a whole enum removed, and the additive escape hatch.
        /// </summary>
        [Fact]
        public void GateSelfTest_ComputeRemovalsCatchesEnumRenameOrRenumber()
        {
            var floor = new Shape
            {
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:0", "HeldStale:1", "LastBeforeBlackout:2" },
                },
            };

            // Renamed.
            var renamed = new Shape
            {
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Current:0", "HeldStale:1", "LastBeforeBlackout:2" },
                },
            };
            Assert.Equal(new[] { "enum-member-removed:Staleness.Fresh:0" }, ComputeRemovals(floor, renamed));

            // Renumbered: "Fresh" keeps its name but swaps value with
            // "HeldStale": a wire break even though no name changed.
            var renumbered = new Shape
            {
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:1", "HeldStale:0", "LastBeforeBlackout:2" },
                },
            };
            Assert.Equal(
                new[] { "enum-member-removed:Staleness.Fresh:0", "enum-member-removed:Staleness.HeldStale:1" },
                ComputeRemovals(floor, renumbered));

            // Whole enum removed.
            Assert.Equal(new[] { "enum-removed:Staleness" }, ComputeRemovals(floor, new Shape()));

            // Additive: a new member appended, plus a brand new enum.
            var additive = new Shape
            {
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:0", "HeldStale:1", "LastBeforeBlackout:2", "Quarantined:3" },
                    ["BrandNewEnum"] = new[] { "Only:0" },
                },
            };
            Assert.Empty(ComputeRemovals(floor, additive));
        }

        // ---------------------------------------------------------------
        // The one comparison behind every rule.
        // ---------------------------------------------------------------

        /// <summary>
        /// Returns one canonical string per fact present in
        /// <paramref name="from"/> and absent from <paramref name="to"/>,
        /// i.e. everything a consumer built against <paramref name="from"/>
        /// would find missing. Empty means <paramref name="to"/> is a
        /// superset: additive, non-breaking.
        ///
        /// <para>Deliberately ONE function serving all four rules, called with
        /// different arguments: (floor, current) asks "did this Minor break its
        /// Major?", and (previousMajorShape, thisMajorShape) asks "what did
        /// this Major actually break?". Same question, different endpoints,
        /// which is why the declared Breaks list can be verified against a
        /// computation rather than trusted.</para>
        /// </summary>
        private static List<string> ComputeRemovals(Shape from, Shape to)
        {
            var removals = new List<string>();

            foreach (var typeName in from.Types.Keys.Except(to.Types.Keys))
            {
                removals.Add("type-removed:" + typeName);
            }

            foreach (var (typeName, fromMembers) in from.Types)
            {
                if (!to.Types.TryGetValue(typeName, out var toMembers))
                {
                    continue; // already reported as a removed type
                }

                foreach (var member in fromMembers.Except(toMembers, StringComparer.Ordinal))
                {
                    removals.Add($"member-removed:{typeName}.{member}");
                }
            }

            // A floor that never recorded topics cannot be diffed on them.
            // Skipping rather than treating absent as empty is what keeps this
            // dimension from inventing removals against Majors 3 to 16.
            if (from.Topics is not null && to.Topics is not null)
            {
                foreach (var topicId in from.Topics.Keys.Except(to.Topics.Keys))
                {
                    removals.Add("topic-removed:" + topicId);
                }

                foreach (var (topicId, fromTag) in from.Topics)
                {
                    if (!to.Topics.TryGetValue(topicId, out var toTag))
                    {
                        continue; // already reported as a removed topic
                    }

                    foreach (var part in fromTag.Except(toTag, StringComparer.Ordinal))
                    {
                        removals.Add($"topic-changed:{topicId}.{part}");
                    }
                }
            }

            foreach (var enumName in from.Enums.Keys.Except(to.Enums.Keys))
            {
                removals.Add("enum-removed:" + enumName);
            }

            foreach (var (enumName, fromMembers) in from.Enums)
            {
                if (!to.Enums.TryGetValue(enumName, out var toMembers))
                {
                    continue; // already reported as a removed enum
                }

                // Set-difference over "Name:Value" catches BOTH a rename (the
                // old name's string vanishes) and a renumber (the old value's
                // string vanishes even though the name survives).
                foreach (var member in fromMembers.Except(toMembers, StringComparer.Ordinal))
                {
                    removals.Add($"enum-member-removed:{enumName}.{member}");
                }
            }

            removals.Sort(StringComparer.Ordinal);
            return removals;
        }

        /// <summary>
        /// Proves the topic dimension does what the type and enum dimensions
        /// already do: catches an id renamed while the class and its members
        /// stay identical.
        ///
        /// <para>A client binds to the id string, so every subscriber would
        /// break on a rename that the type and enum dimensions cannot see,
        /// because nothing about the class or its members changed.</para>
        ///
        /// <para>The absent-floor case is asserted here too, because it is the
        /// one that decides whether backfilling this dimension could rewrite
        /// history. It cannot: a floor with no topics recorded yields no topic
        /// removals at all.</para>
        /// </summary>
        [Fact]
        public void GateSelfTest_ComputeRemovalsCatchesTopicIdRenameAndRetag()
        {
            var floor = new Shape
            {
                Topics = new Dictionary<string, string[]>
                {
                    ["career.mode"] = new[] { "type:Sitrep.Contract.CareerModeStatus", "array:False" },
                },
            };

            // The defect: the id moves, the CLR type does not.
            var renamedId = new Shape
            {
                Topics = new Dictionary<string, string[]>
                {
                    ["career.modeRENAMED"] = new[] { "type:Sitrep.Contract.CareerModeStatus", "array:False" },
                },
            };
            Assert.Equal(new[] { "topic-removed:career.mode" }, ComputeRemovals(floor, renamedId));

            // The id survives but now names a different payload type.
            var movedType = new Shape
            {
                Topics = new Dictionary<string, string[]>
                {
                    ["career.mode"] = new[] { "type:Sitrep.Contract.SomethingElse", "array:False" },
                },
            };
            Assert.Equal(
                new[] { "topic-changed:career.mode.type:Sitrep.Contract.CareerModeStatus" },
                ComputeRemovals(floor, movedType));

            // An object topic becoming an array topic is a wire change too.
            var nowArray = new Shape
            {
                Topics = new Dictionary<string, string[]>
                {
                    ["career.mode"] = new[] { "type:Sitrep.Contract.CareerModeStatus", "array:True" },
                },
            };
            Assert.Equal(
                new[] { "topic-changed:career.mode.array:False" },
                ComputeRemovals(floor, nowArray));

            // Adding a topic breaks nobody.
            var additive = new Shape
            {
                Topics = new Dictionary<string, string[]>
                {
                    ["career.mode"] = new[] { "type:Sitrep.Contract.CareerModeStatus", "array:False" },
                    ["career.newThing"] = new[] { "type:Sitrep.Contract.NewThing", "array:False" },
                },
            };
            Assert.Empty(ComputeRemovals(floor, additive));

            // A floor that never recorded topics yields nothing, in either
            // direction. This is what makes Majors 3 to 16 safe.
            Assert.Empty(ComputeRemovals(new Shape { Topics = null }, renamedId));
            Assert.Empty(ComputeRemovals(floor, new Shape { Topics = null }));
        }

        /// <summary>
        /// Every <c>[SitrepTopic]</c> type is also <c>[SitrepContract]</c>
        /// marked, so no topic can sit outside the shape the gate walks.
        ///
        /// <para><see cref="ComputeShape"/> only reaches a type it has already
        /// accepted as contract-marked, so an unmarked topic type would be
        /// skipped along with its tag: monitored by nothing, silently. This is
        /// the same class of hole as the one this dimension was added for, and
        /// it costs one assertion to close.</para>
        /// </summary>
        [Fact]
        public void EveryTopicTypeIsInTheShape()
        {
            var assembly = typeof(StreamData<object>).Assembly;
            var (_, _, topicShapes) = ReadSitrepContractMarkedShapes(assembly.Location);

            var taggedButUnmarked = ReadEveryTopicTag(assembly.Location)
                .Where(t => !topicShapes.ContainsKey(t.TopicId))
                .Select(t => $"{t.TopicId} ({t.DeclaringType})")
                .OrderBy(x => x, StringComparer.Ordinal)
                .ToArray();

            Assert.True(
                taggedButUnmarked.Length == 0,
                "These types carry [SitrepTopic] but not [SitrepContract], so the shape gate "
                + "cannot see them and a rename of their id would go unreported:\n  "
                + string.Join("\n  ", taggedButUnmarked));

            // And the walk found topics at all, rather than reporting a clean
            // zero because the marker check stopped matching.
            Assert.NotEmpty(topicShapes);
        }

        /// <summary>
        /// Every <c>[SitrepTopic]</c> tag in the assembly, marked or not: the
        /// second opinion <see cref="EveryTopicTypeIsInTheShape"/> grades the
        /// shape's own topic list against.
        /// </summary>
        private static List<(string TopicId, string DeclaringType)> ReadEveryTopicTag(string assemblyPath)
        {
            using var stream = File.OpenRead(assemblyPath);
            using var peReader = new PEReader(stream);
            var metadataReader = peReader.GetMetadataReader();

            var found = new List<(string, string)>();
            foreach (var typeHandle in metadataReader.TypeDefinitions)
            {
                var typeDef = metadataReader.GetTypeDefinition(typeHandle);
                var tag = ReadTopicTag(metadataReader, typeDef);
                if (tag is null)
                {
                    continue;
                }

                var ns = metadataReader.GetString(typeDef.Namespace);
                var name = metadataReader.GetString(typeDef.Name);
                found.Add((tag.Value.TopicId, string.IsNullOrEmpty(ns) ? name : ns + "." + name));
            }

            return found;
        }

        // ---------------------------------------------------------------
        // The freeze utility.
        // ---------------------------------------------------------------

        /// <summary>
        /// Not part of the gate: a manual utility, always skipped in CI. Run
        /// it ONLY when bumping <see cref="ContractVersion.Major"/>, in the
        /// same commit:
        /// <code>
        /// # 1. temporarily drop the Skip on the [Fact] below
        /// # 2. SITREP_FREEZE_MAJOR=1 dotnet test mod/Sitrep.Host.Tests \
        /// #      --filter FreezeCurrentMajor_ManualOnly
        /// # 3. put the Skip back
        /// </code>
        ///
        /// <para>Step 1 and 3 are not ceremony. xUnit 2's <c>Skip</c> is
        /// UNCONDITIONAL: no <c>--filter</c> and no environment variable can
        /// run a skipped fact. Filtering for this test without dropping the
        /// Skip reports <c>Skipped! 1</c> and writes nothing, which reads
        /// exactly like a freeze that had no work to do. The env var below is
        /// still the guard that matters, and it is what makes dropping the
        /// Skip safe.</para>
        ///
        /// <para>Three deliberate choices in how this utility works:</para>
        ///
        /// <para>(1) It <b>refuses to overwrite an existing Major's frozen
        /// Shape</b>. That refusal is the fix: rewriting the floor in the same
        /// commit as the change is precisely how a non-additive diff got
        /// masked. An additive change needs no freeze at all, the gate
        /// already passes it: so there is no legitimate reason to re-freeze a
        /// Major that already exists.</para>
        ///
        /// <para>(2) It <b>writes the ledger to its source file</b> and prints
        /// the path, rather than <c>Console.WriteLine</c>-ing JSON that
        /// interleaves with xunit's own output and cannot be piped cleanly.
        /// Override the destination with <c>SITREP_BASELINE_OUT</c>.</para>
        ///
        /// <para>(3) It <b>computes and prints the Breaks list</b> it is about
        /// to record, so the human bumping the Major has to read what they
        /// broke. <see cref="EveryMajorBumpDeclaresExactlyWhatItBroke"/> then
        /// re-verifies that list independently on every CI run.</para>
        ///
        /// <para>Gated behind <c>SITREP_FREEZE_MAJOR=1</c> as well as [Skip] so
        /// that a stray <c>--filter</c> can never silently rewrite the ledger.</para>
        /// </summary>
        [Fact(Skip = "Manual Major-freeze utility: see doc comment. Never runs in CI.")]
        public void FreezeCurrentMajor_ManualOnly()
        {
            Assert.True(
                Environment.GetEnvironmentVariable("SITREP_FREEZE_MAJOR") == "1",
                "Refusing to touch the ledger without SITREP_FREEZE_MAJOR=1; see doc comment.");

            var destination = Environment.GetEnvironmentVariable("SITREP_BASELINE_OUT")
                ?? ResolveLedgerSourcePath();

            var ledger = LoadLedger();
            var existing = ledger.Majors.SingleOrDefault(e => e.Major == ContractVersion.Major);

            Assert.True(
                existing is null,
                $"REFUSING to re-freeze Major {ContractVersion.Major}: it already has a frozen " +
                "Shape in the ledger. Rewriting a floor in the same commit as the change is exactly " +
                "how a breaking change gets masked, it is the bug this ledger exists to prevent.\n\n" +
                "If your change is ADDITIVE, you need no freeze: bump ContractVersion.Minor and the " +
                "gate will pass on its own.\n" +
                "If your change is BREAKING, bump ContractVersion.Major first, then re-run this.");

            var current = ComputeShape();
            var previous = ledger.Majors.OrderBy(e => e.Major).LastOrDefault(e => e.Major < ContractVersion.Major);
            var breaks = previous is null ? new List<string>() : ComputeRemovals(previous.Shape, current);

            ledger.Majors.Add(new MajorEntry
            {
                Major = ContractVersion.Major,
                Note = $"Frozen at v{ContractVersion.Major}.{ContractVersion.Minor}. "
                       + "REPLACE THIS NOTE: say why this break was worth a Major.",
                Breaks = breaks.ToArray(),
                Shape = current,
            });
            ledger.Majors = ledger.Majors.OrderBy(e => e.Major).ToList();

            File.WriteAllText(destination, JsonSerializer.Serialize(ledger, JsonOptions) + "\n");

            Console.WriteLine($"Froze Major {ContractVersion.Major} into: {destination}");
            Console.WriteLine(
                previous is null
                    ? "No previous Major recorded: Breaks left empty (unverifiable)."
                    : $"Breaks vs Major {previous.Major} ({breaks.Count}); READ THESE:");
            foreach (var b in breaks)
            {
                Console.WriteLine("  " + b);
            }

            // System.Text.Json's WriteIndented does not match the repo's biome
            // formatting, and the pre-commit hook runs biome over this file.
            Console.WriteLine(
                $"\nNow run: pnpm exec biome check --write {destination}"
                + "\nThen replace the placeholder Note above with why this break was worth a Major.");
        }

        /// <summary>
        /// Walks up from the test assembly to the repo's
        /// <c>mod/Sitrep.Contract/</c> source copy: the .csproj links the
        /// ledger into <c>golden-fixtures/</c> as a BUILD OUTPUT, so writing to
        /// <see cref="LedgerPath"/> would land in <c>bin/</c> and be silently
        /// discarded on the next build.
        /// </summary>
        private static string ResolveLedgerSourcePath()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract", "contract-shape.baseline.json");
                if (File.Exists(candidate))
                {
                    return candidate;
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/Sitrep.Contract/contract-shape.baseline.json walking up from "
                + AppContext.BaseDirectory + ": pass SITREP_BASELINE_OUT explicitly.");
        }

        // ---------------------------------------------------------------
        // Reflection.
        // ---------------------------------------------------------------

        private static Ledger LoadLedger()
        {
            return JsonSerializer.Deserialize<Ledger>(File.ReadAllText(LedgerPath), JsonOptions) ?? new Ledger();
        }

        private static Shape ComputeShape()
        {
            var assembly = typeof(StreamData<object>).Assembly;
            var (contractMarkedTypeNames, enumShapes, topicShapes) =
                ReadSitrepContractMarkedShapes(assembly.Location);

            var sortedTypes = new SortedDictionary<string, string[]>(StringComparer.Ordinal);
            foreach (var type in assembly.GetTypes())
            {
                var fullName = type.FullName ?? type.Name;
                if (!contractMarkedTypeNames.Contains(fullName) || enumShapes.ContainsKey(fullName))
                {
                    // Enums are handled entirely via raw metadata below
                    // (see ReadSitrepContractMarkedShapes's doc comment for
                    // why: any CLR-level enum reflection, even
                    // Enum.GetNames/Type.IsEnum's underlying machinery: was
                    // observed to eagerly resolve custom attributes on this
                    // type and throw the same FileNotFoundException the
                    // marker check above is designed to avoid).
                    continue;
                }

                // Safe: property enumeration/PropertyType never resolves an
                // attribute's declaring assembly: only GetCustomAttributes*/
                // enum-specific reflection does, which is why both the
                // marker check and the enum-shape read go through raw
                // metadata instead (see ReadSitrepContractMarkedShapes's
                // doc comment).
                var properties = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Select(p => p.Name + ":" + p.PropertyType)
                    .OrderBy(x => x, StringComparer.Ordinal)
                    .ToArray();
                sortedTypes[fullName] = properties;
            }

            return new Shape
            {
                Types = new Dictionary<string, string[]>(sortedTypes),
                Enums = new Dictionary<string, string[]>(new SortedDictionary<string, string[]>(enumShapes, StringComparer.Ordinal)),
                Topics = new Dictionary<string, string[]>(new SortedDictionary<string, string[]>(topicShapes, StringComparer.Ordinal)),
            };
        }

        /// <summary>
        /// Returns (1) the full names of every type carrying
        /// <c>[SitrepContractAttribute]</c>, PLUS (2) the member shape
        /// (<c>"Name:Value"</c>, sorted) of every one of those types that is
        /// itself an ENUM: both read via raw ECMA-335 metadata
        /// (<see cref="System.Reflection.Metadata"/>/
        /// <see cref="System.Reflection.PortableExecutable"/>), NOT
        /// <c>System.Reflection</c>'s <c>Type.GetCustomAttributesData()</c>/
        /// <c>IsDefined</c>. Both of those eagerly resolve EVERY custom
        /// attribute applied to a type in one shot: even wrapping the
        /// enumeration call itself in try/catch is not enough, because
        /// <c>GetCustomAttributesData()</c> throws building its full record
        /// list before a single record is ever inspected.
        ///
        /// <para>The PE-metadata read stays regardless. It only ever needs the
        /// attribute CONSTRUCTOR's simple name and never resolves it to a live
        /// <see cref="Type"/>, so a gate whose whole job is to describe an
        /// assembly's shape cannot be broken by anything that assembly happens
        /// to reference. That is the right property for this check to have on
        /// its own merits, rather than as a workaround.</para>
        /// </summary>
        private static (HashSet<string> MarkedTypeNames, Dictionary<string, string[]> EnumShapes, Dictionary<string, string[]> TopicShapes) ReadSitrepContractMarkedShapes(string assemblyPath)
        {
            using var stream = File.OpenRead(assemblyPath);
            using var peReader = new System.Reflection.PortableExecutable.PEReader(stream);
            var metadataReader = peReader.GetMetadataReader();

            var marked = new HashSet<string>(StringComparer.Ordinal);
            var enumShapes = new Dictionary<string, string[]>(StringComparer.Ordinal);
            var topicShapes = new Dictionary<string, string[]>(StringComparer.Ordinal);

            foreach (var typeHandle in metadataReader.TypeDefinitions)
            {
                var typeDef = metadataReader.GetTypeDefinition(typeHandle);

                var isMarked = false;
                foreach (var attrHandle in typeDef.GetCustomAttributes())
                {
                    var attribute = metadataReader.GetCustomAttribute(attrHandle);
                    var ctorName = GetAttributeConstructorSimpleName(metadataReader, attribute);
                    if (ctorName == nameof(SitrepContractAttribute))
                    {
                        isMarked = true;
                        break;
                    }
                }

                if (!isMarked)
                {
                    continue;
                }

                var ns = metadataReader.GetString(typeDef.Namespace);
                var name = metadataReader.GetString(typeDef.Name);
                var fullName = string.IsNullOrEmpty(ns) ? name : ns + "." + name;
                marked.Add(fullName);

                var topic = ReadTopicTag(metadataReader, typeDef);
                if (topic is not null)
                {
                    topicShapes[topic.Value.TopicId] = new[]
                    {
                        "type:" + fullName,
                        "array:" + topic.Value.IsArray,
                    };
                }

                if (IsEnumTypeDefinition(metadataReader, typeDef))
                {
                    enumShapes[fullName] = ReadEnumMemberShape(metadataReader, typeDef);
                }
            }

            return (marked, enumShapes, topicShapes);
        }

        /// <summary>
        /// The <c>[SitrepTopic]</c> tag on a type, decoded from its attribute
        /// blob, or null if it carries none.
        ///
        /// <para>Read through the same raw metadata as everything else here,
        /// for the reason in
        /// <see cref="ReadSitrepContractMarkedShapes"/>'s doc comment: a gate
        /// whose job is to describe an assembly's shape must not be breakable
        /// by what that assembly happens to reference.</para>
        /// </summary>
        private static (string TopicId, bool IsArray)? ReadTopicTag(
            MetadataReader metadataReader,
            TypeDefinition typeDef)
        {
            foreach (var attrHandle in typeDef.GetCustomAttributes())
            {
                var attribute = metadataReader.GetCustomAttribute(attrHandle);
                if (GetAttributeConstructorSimpleName(metadataReader, attribute)
                    != nameof(SitrepTopicAttribute))
                {
                    continue;
                }

                var decoded = attribute.DecodeValue(AttributeBlobTypeProvider.Instance);
                var topicId = (string)decoded.FixedArguments[0].Value!;
                var isArray = decoded.FixedArguments.Length > 1
                    && decoded.FixedArguments[1].Value is true;
                return (topicId, isArray);
            }

            return null;
        }

        /// <summary>
        /// Base-type check done at the metadata level (compares the base
        /// type reference's simple name against <c>"Enum"</c> in namespace
        /// <c>"System"</c>): deliberately NOT <c>Type.IsEnum</c>, and kept that
        /// way so this gate reads an assembly's shape without depending on
        /// anything that assembly references.
        ///
        /// <para>The metadata read remains the better instrument regardless:
        /// it does not depend on the CLR's own enum-reflection machinery
        /// (<c>Type.IsEnum</c>/<c>Enum.GetNames</c>), which resolves custom
        /// attributes as a side effect of asking the question at all.</para>
        /// </summary>
        private static bool IsEnumTypeDefinition(
            System.Reflection.Metadata.MetadataReader metadataReader,
            System.Reflection.Metadata.TypeDefinition typeDef)
        {
            if (typeDef.BaseType.IsNil)
            {
                return false;
            }

            string? baseName = typeDef.BaseType.Kind switch
            {
                System.Reflection.Metadata.HandleKind.TypeReference =>
                    metadataReader.GetString(metadataReader.GetTypeReference((System.Reflection.Metadata.TypeReferenceHandle)typeDef.BaseType).Name),
                System.Reflection.Metadata.HandleKind.TypeDefinition =>
                    metadataReader.GetString(metadataReader.GetTypeDefinition((System.Reflection.Metadata.TypeDefinitionHandle)typeDef.BaseType).Name),
                _ => null,
            };

            return baseName == "Enum";
        }

        /// <summary>
        /// Reads an enum type's members straight from its field table: every
        /// non-<c>special-name "value__"</c> literal (const) field is one
        /// member, named by <see cref="System.Reflection.Metadata.FieldDefinition.Name"/>
        /// and valued by its constant blob (decoded as <see cref="int"/>,
        /// every wire enum in this contract is a plain <c>int</c>-backed
        /// enum with no explicit underlying-type override). Sorted so the
        /// result is stable regardless of declaration order.
        /// </summary>
        private static string[] ReadEnumMemberShape(
            System.Reflection.Metadata.MetadataReader metadataReader,
            System.Reflection.Metadata.TypeDefinition typeDef)
        {
            var members = new List<string>();
            foreach (var fieldHandle in typeDef.GetFields())
            {
                var field = metadataReader.GetFieldDefinition(fieldHandle);
                if ((field.Attributes & System.Reflection.FieldAttributes.Literal) == 0)
                {
                    continue; // skip the compiler-generated "value__" backing field
                }

                var constantHandle = field.GetDefaultValue();
                if (constantHandle.IsNil)
                {
                    continue;
                }

                var constant = metadataReader.GetConstant(constantHandle);
                var blobReader = metadataReader.GetBlobReader(constant.Value);
                var value = constant.TypeCode switch
                {
                    System.Reflection.Metadata.ConstantTypeCode.Int32 => blobReader.ReadInt32(),
                    System.Reflection.Metadata.ConstantTypeCode.Int64 => (int)blobReader.ReadInt64(),
                    System.Reflection.Metadata.ConstantTypeCode.Int16 => blobReader.ReadInt16(),
                    System.Reflection.Metadata.ConstantTypeCode.Byte => blobReader.ReadByte(),
                    _ => throw new NotSupportedException($"Unsupported enum underlying constant type code: {constant.TypeCode}"),
                };

                members.Add(metadataReader.GetString(field.Name) + ":" + value);
            }

            members.Sort(StringComparer.Ordinal);
            return members.ToArray();
        }

        private static string? GetAttributeConstructorSimpleName(
            System.Reflection.Metadata.MetadataReader metadataReader,
            System.Reflection.Metadata.CustomAttribute attribute)
        {
            // The attribute's constructor token is either a MemberReference
            // (the common case: the attribute type lives outside this
            // module) or a MethodDefinition (attribute type defined in this
            // same module): SitrepContractAttribute, defined right in this
            // assembly, is the latter.
            if (attribute.Constructor.Kind == System.Reflection.Metadata.HandleKind.MemberReference)
            {
                var memberRef = metadataReader.GetMemberReference((System.Reflection.Metadata.MemberReferenceHandle)attribute.Constructor);
                if (memberRef.Parent.Kind != System.Reflection.Metadata.HandleKind.TypeReference)
                {
                    return null;
                }
                var typeRef = metadataReader.GetTypeReference((System.Reflection.Metadata.TypeReferenceHandle)memberRef.Parent);
                return metadataReader.GetString(typeRef.Name);
            }

            if (attribute.Constructor.Kind == System.Reflection.Metadata.HandleKind.MethodDefinition)
            {
                var methodDef = metadataReader.GetMethodDefinition((System.Reflection.Metadata.MethodDefinitionHandle)attribute.Constructor);
                var declaringType = metadataReader.GetTypeDefinition(methodDef.GetDeclaringType());
                return metadataReader.GetString(declaringType.Name);
            }

            return null;
        }
    }
}
