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
    /// The CI contract-shape gate — see
    /// <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>. Reflects
    /// every <see cref="SitrepContractAttribute"/>-marked type in
    /// <c>Sitrep.Contract</c> (applied alongside every real
    /// <c>[TsInterface]</c> usage — see <see cref="SitrepContractAttribute"/>'s
    /// own doc comment for why this gate uses its own same-assembly marker
    /// rather than reflecting <c>[TsInterface]</c> directly: that attribute's
    /// declaring assembly, <c>Reinforced.Typings</c>, is a compile-time-only
    /// dependency by explicit design and must never be resolved at runtime)
    /// and checks it against a checked-in LEDGER
    /// (<c>mod/Sitrep.Contract/contract-shape.baseline.json</c>, wired into
    /// this project the same way the other <c>golden-fixtures/</c> JSON
    /// fixtures are — see this project's .csproj).
    ///
    /// <para><b>Why a ledger and not a single baseline.</b> This gate used to
    /// diff against one baseline blob that mirrored HEAD. That blob was
    /// regenerated in the SAME commit that bumped
    /// <see cref="ContractVersion.Major"/> — which meant the gate compared the
    /// new code against a baseline derived from the new code, and passed
    /// vacuously. A Major bump was a blanket amnesty: <c>DiffNonAdditive</c>
    /// returned early on <c>baseline.Major != currentMajor</c> without ever
    /// inspecting the change. The gate was trivially satisfied by the very act
    /// it existed to scrutinise, and both failure modes below reached
    /// <c>staging</c> in the wild:</para>
    ///
    /// <para>(1) Two branches independently bumped Major 3 -&gt; 4 with
    /// DIFFERENT wire shapes (a <c>CommsDelay</c> nullable retype and a
    /// <c>VesselControl.ActionGroups</c> retype). Merged, v4 would have named
    /// two incompatible shapes. Caught by a human reading a rebase diff, not by
    /// this gate.</para>
    ///
    /// <para>(2) The follow-up collapse landed the action-group retype as
    /// v4.<b>1</b> — an "additive Minor" — on top of a v4.<b>0</b> that had
    /// already published <c>ActionGroups</c> as <c>System.Boolean[]</c>. A
    /// retype is not additive. The gate passed silently because the baseline
    /// had been regenerated and no longer remembered v4.0.</para>
    ///
    /// <para>Both are one root cause: <b>the baseline had no memory</b>. The
    /// ledger fixes exactly that. Each entry records a Major's frozen
    /// <c>Shape</c>, written ONCE when that Major is created and never
    /// rewritten (see <see cref="FreezeCurrentMajor_ManualOnly"/>, which
    /// refuses to overwrite an existing entry). An additive change needs no
    /// regeneration at all — the gate already passes it — so the only thing
    /// that ever appends to the ledger is a Major bump, and that append has to
    /// declare what it broke.</para>
    ///
    /// <para><b>The invariant, stated honestly: a Major names exactly ONE
    /// shape.</b> Enforced by four rules, each its own test:</para>
    /// <list type="number">
    /// <item><see cref="EachMajorAppearsExactlyOnceInTheLedger"/> — two entries
    /// claiming the same Major is the parallel-branch collision itself.</item>
    /// <item><see cref="CurrentMajorIsRecordedInTheLedger"/> — bumping Major
    /// without freezing a shape can no longer skip the diff.</item>
    /// <item><see cref="CurrentShapeIsAdditiveOverTheFrozenMajorFloor"/> — the
    /// old "lying minor" check, but against a floor the commit cannot
    /// rewrite.</item>
    /// <item><see cref="EveryMajorBumpDeclaresExactlyWhatItBroke"/> — a Major
    /// must show its work: its declared <c>Breaks</c> must equal the computed
    /// diff from the previous Major's shape, and be non-empty. A Major that
    /// breaks nothing is not a Major, and a Major cannot claim a break it did
    /// not make (nor omit one it did).</item>
    /// </list>
    ///
    /// <para>Note what is deliberately NOT enforced: this gate never decides
    /// whether a break is <i>allowed</i>. That is a human call (the v4 collapse
    /// was ratified on the grounds that the mod is pre-release with no external
    /// Uplinks). The gate's job is only to guarantee the call is made
    /// explicitly, recorded, and true.</para>
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
        /// the Major is created, and never rewritten — that immutability is the
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
            /// Verified — not trusted — by
            /// <see cref="EveryMajorBumpDeclaresExactlyWhatItBroke"/>.
            /// </summary>
            public string[] Breaks { get; set; } = Array.Empty<string>();

            public Shape Shape { get; set; } = new();
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
        }

        private sealed class Ledger
        {
            public List<MajorEntry> Majors { get; set; } = new();
        }

        // ---------------------------------------------------------------
        // Rule 1 — a Major names exactly one shape, so it appears once.
        // ---------------------------------------------------------------

        /// <summary>
        /// The parallel-branch collision, caught mechanically. Two branches
        /// each bumping 3 -&gt; 4 both append an entry for Major 4; whichever
        /// way a human resolves the merge conflict, something fires — a
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
        // Rule 2 — bumping Major can no longer skip the diff.
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
                $"same commit — run the FreezeCurrentMajor_ManualOnly utility (see its doc comment). " +
                $"Recorded Majors: [{string.Join(", ", ledger.Majors.Select(e => e.Major))}].");
        }

        // ---------------------------------------------------------------
        // Rule 3 — the old "lying minor" gate, against a frozen floor.
        // ---------------------------------------------------------------

        /// <summary>
        /// Every Minor on a Major line must be additive over that Major's
        /// frozen floor. This is the check the old gate meant to perform — the
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
            // cause to one red test — and deliberately avoids SingleOrDefault,
            // which would THROW on the duplicate case and bury the real
            // diagnosis under an InvalidOperationException.
            if (entries.Count != 1)
            {
                return;
            }

            var removals = ComputeRemovals(entries[0].Shape, ComputeShape());

            Assert.True(
                removals.Count == 0,
                $"Non-additive change to the wire shape WITHOUT a Major bump — Major " +
                $"{ContractVersion.Major}'s shape was frozen and these are gone from it:\n  " +
                string.Join("\n  ", removals) +
                "\n\nA removed/renamed/retyped member is breaking by definition. Either make the " +
                "change additive, or bump ContractVersion.Major and freeze the new shape.");
        }

        // ---------------------------------------------------------------
        // Rule 4 — a Major must show its work.
        // ---------------------------------------------------------------

        /// <summary>
        /// A Major bump is the sanctioned way to break the wire — but it is no
        /// longer a blanket amnesty. Each Major's declared <c>Breaks</c> must
        /// EXACTLY equal the diff computed from the previous recorded Major's
        /// shape: non-empty (a Major that breaks nothing is not a Major), with
        /// nothing claimed that did not happen and nothing omitted that did.
        /// So "Major" names a specific, enumerated, verified shape change
        /// rather than a free pass.
        /// </summary>
        [Fact]
        public void EveryMajorBumpDeclaresExactlyWhatItBroke()
        {
            var ledger = LoadLedger();
            var ordered = ledger.Majors.OrderBy(e => e.Major).ToList();

            foreach (var entry in ordered)
            {
                // The earliest recorded Major has no predecessor to diff
                // against — its Breaks are unverifiable, so they are not
                // asserted on. Every LATER Major is fully checked.
                var previous = ordered.LastOrDefault(e => e.Major < entry.Major);
                if (previous is null)
                {
                    continue;
                }

                var actual = ComputeRemovals(previous.Shape, entry.Shape);
                var declared = (entry.Breaks ?? Array.Empty<string>()).OrderBy(x => x, StringComparer.Ordinal).ToList();

                Assert.True(
                    actual.Count > 0,
                    $"Major {entry.Major} breaks nothing relative to Major {previous.Major} — " +
                    "so it should not be a Major. An additive change is a Minor bump.");

                var undeclared = actual.Except(declared, StringComparer.Ordinal).ToList();
                var overdeclared = declared.Except(actual, StringComparer.Ordinal).ToList();

                Assert.True(
                    undeclared.Count == 0,
                    $"Major {entry.Major} broke something it never declared:\n  " +
                    string.Join("\n  ", undeclared) +
                    $"\n\nAdd these to the Major {entry.Major} entry's Breaks list — a Major must " +
                    "name every shape change it makes.");

                Assert.True(
                    overdeclared.Count == 0,
                    $"Major {entry.Major} declares breaks that did not happen:\n  " +
                    string.Join("\n  ", overdeclared) +
                    $"\n\nEither the Breaks list is stale, or Major {entry.Major}'s frozen Shape is " +
                    "not what the declaration describes.");
            }
        }

        // ---------------------------------------------------------------
        // Self-tests for the gate itself.
        // ---------------------------------------------------------------

        /// <summary>
        /// Reproduces the exact collision that reached <c>staging</c>: the
        /// action-group retype landing as an "additive" v4.1 on top of a v4.0
        /// that had already published <c>ActionGroups</c> as
        /// <c>System.Boolean[]</c>. Under the old single-mirror baseline this
        /// passed silently, because the baseline had been regenerated and no
        /// longer remembered v4.0. Against a frozen floor it is caught.
        /// </summary>
        [Fact]
        public void GateSelfTest_CatchesTheRealV40ToV41ActionGroupCollision()
        {
            // Major 4's floor, as commit 57daa136 actually published it.
            var v40Floor = new Shape
            {
                Types = new Dictionary<string, string[]>
                {
                    ["Sitrep.Contract.VesselControl"] = new[] { "ActionGroups:System.Boolean[]" },
                },
            };

            // The shape v4.1 shipped — a RETYPE, dressed as an additive Minor.
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
        /// resolved, a rule fires — take-both trips the duplicate check,
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
            // still in the code — so it shows up as an in-Major removal.
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
        /// Proves <see cref="ComputeRemovals"/> — the single function behind
        /// every rule above — catches removed/retyped members and removed
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

            // Non-additive: "Count" renamed to "Total" — a removal, from the
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

            // Additive: a new member and a brand new type — must NOT be caught.
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
        /// Enum analogue — the gate is not blind to enums. Covers a member
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
            // "HeldStale" — a wire break even though no name changed.
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
        /// <paramref name="from"/> and absent from <paramref name="to"/> —
        /// i.e. everything a consumer built against <paramref name="from"/>
        /// would find missing. Empty means <paramref name="to"/> is a
        /// superset: additive, non-breaking.
        ///
        /// <para>Deliberately ONE function serving all four rules, called with
        /// different arguments: (floor, current) asks "did this Minor break its
        /// Major?", and (previousMajorShape, thisMajorShape) asks "what did
        /// this Major actually break?". Same question, different endpoints —
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

        // ---------------------------------------------------------------
        // The freeze utility.
        // ---------------------------------------------------------------

        /// <summary>
        /// Not part of the gate — a manual utility, always skipped in CI. Run
        /// it ONLY when bumping <see cref="ContractVersion.Major"/>, in the
        /// same commit:
        /// <code>
        /// dotnet test mod/Sitrep.Host.Tests --filter FreezeCurrentMajor_ManualOnly \
        ///   -e SITREP_FREEZE_MAJOR=1
        /// </code>
        ///
        /// <para>Three deliberate differences from the old
        /// <c>RegenerateBaseline_ManualOnly</c> it replaces:</para>
        ///
        /// <para>(1) It <b>refuses to overwrite an existing Major's frozen
        /// Shape</b>. That refusal is the fix: rewriting the floor in the same
        /// commit as the change is precisely how a non-additive diff got
        /// masked. An additive change needs no freeze at all — the gate
        /// already passes it — so there is no legitimate reason to re-freeze a
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
        [Fact(Skip = "Manual Major-freeze utility — see doc comment. Never runs in CI.")]
        public void FreezeCurrentMajor_ManualOnly()
        {
            Assert.True(
                Environment.GetEnvironmentVariable("SITREP_FREEZE_MAJOR") == "1",
                "Refusing to touch the ledger without SITREP_FREEZE_MAJOR=1 — see doc comment.");

            var destination = Environment.GetEnvironmentVariable("SITREP_BASELINE_OUT")
                ?? ResolveLedgerSourcePath();

            var ledger = LoadLedger();
            var existing = ledger.Majors.SingleOrDefault(e => e.Major == ContractVersion.Major);

            Assert.True(
                existing is null,
                $"REFUSING to re-freeze Major {ContractVersion.Major}: it already has a frozen " +
                "Shape in the ledger. Rewriting a floor in the same commit as the change is exactly " +
                "how a breaking change gets masked — it is the bug this ledger exists to prevent.\n\n" +
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
                    ? "No previous Major recorded — Breaks left empty (unverifiable)."
                    : $"Breaks vs Major {previous.Major} ({breaks.Count}) — READ THESE:");
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
        /// <c>mod/Sitrep.Contract/</c> source copy — the .csproj links the
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
                + AppContext.BaseDirectory + " — pass SITREP_BASELINE_OUT explicitly.");
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
            var (contractMarkedTypeNames, enumShapes) = ReadSitrepContractMarkedShapes(assembly.Location);

            var sortedTypes = new SortedDictionary<string, string[]>(StringComparer.Ordinal);
            foreach (var type in assembly.GetTypes())
            {
                var fullName = type.FullName ?? type.Name;
                if (!contractMarkedTypeNames.Contains(fullName) || enumShapes.ContainsKey(fullName))
                {
                    // Enums are handled entirely via raw metadata below
                    // (see ReadSitrepContractMarkedShapes's doc comment for
                    // why: any CLR-level enum reflection — even
                    // Enum.GetNames/Type.IsEnum's underlying machinery — was
                    // observed to eagerly resolve custom attributes on this
                    // type and throw the same FileNotFoundException the
                    // marker check above is designed to avoid).
                    continue;
                }

                // Safe: property enumeration/PropertyType never resolves an
                // attribute's declaring assembly — only GetCustomAttributes*/
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
            };
        }

        /// <summary>
        /// Returns (1) the full names of every type carrying
        /// <c>[SitrepContractAttribute]</c>, PLUS (2) the member shape
        /// (<c>"Name:Value"</c>, sorted) of every one of those types that is
        /// itself an ENUM — both read via raw ECMA-335 metadata
        /// (<see cref="System.Reflection.Metadata"/>/
        /// <see cref="System.Reflection.PortableExecutable"/>), NOT
        /// <c>System.Reflection</c>'s <c>Type.GetCustomAttributesData()</c>/
        /// <c>IsDefined</c>. Both of those eagerly resolve EVERY custom
        /// attribute applied to a type in one shot (verified experimentally
        /// while writing this gate: even wrapping the enumeration call itself
        /// in try/catch wasn't enough — <c>GetCustomAttributesData()</c> throws
        /// building its full record list before a single record is ever
        /// inspected). Since every <c>[SitrepContract]</c> type ALSO carries
        /// <c>[TsInterface]</c>, and <c>[TsInterface]</c>'s declaring assembly
        /// (<c>Reinforced.Typings</c>) is a compile-time-only dependency that is
        /// never runtime-loadable by this project's own explicit design (see
        /// <c>Sitrep.Contract.csproj</c>'s doc comment and
        /// <see cref="SitrepContractAttribute"/>'s), any CLR-level attribute
        /// enumeration on these types always throws
        /// <see cref="System.IO.FileNotFoundException"/> here — regardless of
        /// which specific attribute is being searched for. Reading the PE
        /// metadata directly (a file-parsing operation, not a type-load)
        /// sidesteps that entirely: it only ever needs the attribute
        /// CONSTRUCTOR's simple name, never resolves it to a live
        /// <see cref="Type"/>.
        /// </summary>
        private static (HashSet<string> MarkedTypeNames, Dictionary<string, string[]> EnumShapes) ReadSitrepContractMarkedShapes(string assemblyPath)
        {
            using var stream = File.OpenRead(assemblyPath);
            using var peReader = new System.Reflection.PortableExecutable.PEReader(stream);
            var metadataReader = peReader.GetMetadataReader();

            var marked = new HashSet<string>(StringComparer.Ordinal);
            var enumShapes = new Dictionary<string, string[]>(StringComparer.Ordinal);

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

                if (IsEnumTypeDefinition(metadataReader, typeDef))
                {
                    enumShapes[fullName] = ReadEnumMemberShape(metadataReader, typeDef);
                }
            }

            return (marked, enumShapes);
        }

        /// <summary>
        /// Base-type check done at the metadata level (compares the base
        /// type reference's simple name against <c>"Enum"</c> in namespace
        /// <c>"System"</c>) — deliberately NOT <c>Type.IsEnum</c>. Verified
        /// experimentally while extending this gate: on a
        /// <see cref="SitrepContractAttribute"/>-marked enum whose sibling
        /// types (never this type itself, since attribute enumeration is
        /// never invoked here) carry <c>[TsEnum]</c> from the
        /// compile-time-only <c>Reinforced.Typings</c> package,
        /// <c>Type.IsEnum</c>/<c>Enum.GetNames</c>'s underlying CLR machinery
        /// (<c>RuntimeType.GetEnumNames</c> → <c>Enum.EnumInfo.Create</c>)
        /// itself calls <c>CustomAttribute.IsCustomAttributeDefined</c> and
        /// throws the same <see cref="System.IO.FileNotFoundException"/> the
        /// marker check works around — so enum SHAPE, not just the marker,
        /// must stay off every CLR reflection path for this assembly.
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
        /// and valued by its constant blob (decoded as <see cref="int"/> —
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
            // same module) — SitrepContractAttribute, defined right in this
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
