using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The CI "lying minor" gate — promoted from nothing (no such check
    /// existed before this foundation) to a build-failing test, per
    /// <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>'s
    /// recommendation. Reflects every <see cref="SitrepContractAttribute"/>-
    /// marked type in <c>Sitrep.Contract</c> (applied alongside every real
    /// <c>[TsInterface]</c> usage — see <see cref="SitrepContractAttribute"/>'s
    /// own doc comment for why this gate uses its own same-assembly marker
    /// rather than reflecting <c>[TsInterface]</c> directly: that attribute's
    /// declaring assembly, <c>Reinforced.Typings</c>, is a compile-time-only
    /// dependency by explicit design and must never be resolved at runtime)
    /// and diffs it against a checked-in baseline (<c>mod/Sitrep.Contract/contract-shape.baseline.json</c>,
    /// wired into this project the same way the other <c>golden-fixtures/</c>
    /// JSON fixtures are — see this project's .csproj).
    ///
    /// PASS: no change, or an ADDITIVE-only change (a brand new type, or a
    /// brand new property on an existing type).
    /// FAIL: a REMOVED or RETYPED property, or a REMOVED type, UNLESS
    /// <see cref="ContractVersion.Major"/> has moved past the baseline's
    /// recorded <c>major</c> — a genuine Major bump is the sanctioned way to
    /// break the wire shape, and this gate's job is only to catch a
    /// breaking change smuggled in as a lying Minor/patch. Regenerate the
    /// baseline (<see cref="RegenerateBaseline_ManualOnly"/>, skipped by
    /// default) as part of the SAME commit that bumps
    /// <see cref="ContractVersion.Major"/>.
    /// </summary>
    public class ContractShapeGateTests
    {
        private static readonly string BaselinePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "contract-shape.baseline.json");

        private sealed class Baseline
        {
            public int Major { get; set; }
            public int Minor { get; set; }
            public Dictionary<string, string[]> Types { get; set; } = new();
        }

        [Fact]
        public void NoNonAdditiveChangeToTsInterfaceTypesWithoutAMajorBump()
        {
            var baseline = LoadBaseline();
            var current = ComputeShape();

            var violations = DiffNonAdditive(baseline, current, ContractVersion.Major);
            Assert.True(violations.Count == 0, string.Join("; ", violations));
        }

        /// <summary>
        /// Self-test for the gate ITSELF (required alongside the real gate —
        /// see the task's "self-test" requirement): proves
        /// <see cref="DiffNonAdditive"/> actually catches a non-additive
        /// change (removed/retyped member, removed type) when the Major is
        /// unchanged, catches nothing for a purely additive change, and
        /// skips the diff entirely across a genuine Major bump. Exercises
        /// the exact same static method <see cref="NoNonAdditiveChangeToTsInterfaceTypesWithoutAMajorBump"/>
        /// calls against real reflected data — this test just supplies
        /// synthetic <see cref="Baseline"/> values so it never has to
        /// mutate-then-revert real <c>Sitrep.Contract</c> source (which
        /// would otherwise ripple into every downstream consumer of the
        /// mutated type, as manually verified while writing this gate).
        /// </summary>
        [Fact]
        public void GateSelfTest_CatchesNonAdditiveChangeButNotAdditiveOrMajorBump()
        {
            var baseline = new Baseline
            {
                Major = 1,
                Minor = 0,
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Count:System.Int32" },
                },
            };

            // Non-additive: "Count" renamed to "Total" (a removal, from the
            // baseline's point of view) — must be caught.
            var renamed = new Baseline
            {
                Major = 1,
                Minor = 0,
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Total:System.Int32" },
                },
            };
            var renameViolations = DiffNonAdditive(baseline, renamed, currentMajor: 1);
            Assert.NotEmpty(renameViolations);

            // Non-additive: a whole type removed — must be caught.
            var typeRemoved = new Baseline { Major = 1, Minor = 0, Types = new Dictionary<string, string[]>() };
            var removalViolations = DiffNonAdditive(baseline, typeRemoved, currentMajor: 1);
            Assert.NotEmpty(removalViolations);

            // Additive: a new member and a new type — must NOT be caught.
            var additive = new Baseline
            {
                Major = 1,
                Minor = 1,
                Types = new Dictionary<string, string[]>
                {
                    ["Widget"] = new[] { "Name:System.String", "Count:System.Int32", "NewField:System.Boolean" },
                    ["BrandNewType"] = new[] { "Whatever:System.String" },
                },
            };
            Assert.Empty(DiffNonAdditive(baseline, additive, currentMajor: 1));

            // A Major bump license-to-break: the SAME rename that failed
            // above must now pass, because the caller's currentMajor moved
            // past the baseline's recorded Major.
            Assert.Empty(DiffNonAdditive(baseline, renamed, currentMajor: 2));
        }

        /// <summary>
        /// The gate's core comparison, extracted so it is unit-testable
        /// in-memory (see <see cref="GateSelfTest_CatchesNonAdditiveChangeButNotAdditiveOrMajorBump"/>)
        /// without needing a real reflected assembly. Returns one violation
        /// string per non-additive change found; empty means the gate
        /// passes. Never flags anything when <paramref name="currentMajor"/>
        /// has moved past <paramref name="baseline"/>'s recorded Major — see
        /// this class's own doc comment for why a genuine Major bump is the
        /// sanctioned way to break the wire shape.
        /// </summary>
        private static List<string> DiffNonAdditive(Baseline baseline, Baseline current, int currentMajor)
        {
            var violations = new List<string>();

            if (baseline.Major != currentMajor)
            {
                return violations;
            }

            var removedTypes = baseline.Types.Keys.Except(current.Types.Keys).ToList();
            if (removedTypes.Count > 0)
            {
                violations.Add("removed [TsInterface] type(s) without a Major bump: " + string.Join(", ", removedTypes));
            }

            foreach (var (typeName, baselineMembers) in baseline.Types)
            {
                if (!current.Types.TryGetValue(typeName, out var currentMembers))
                {
                    continue; // already reported as a removed type above
                }

                var removedMembers = baselineMembers.Except(currentMembers).ToList();
                if (removedMembers.Count > 0)
                {
                    violations.Add($"removed/retyped member(s) on \"{typeName}\" without a Major bump: " + string.Join(", ", removedMembers));
                }
            }

            return violations;
        }

        /// <summary>
        /// Not part of the gate — a manual, always-skipped utility. Run with
        /// <c>dotnet test --filter RegenerateBaseline_ManualOnly</c> after
        /// deleting the <c>Skip</c> attribute locally, copy the printed JSON
        /// into <c>mod/Sitrep.Contract/contract-shape.baseline.json</c>, then
        /// restore the <c>Skip</c> attribute before committing.
        /// </summary>
        [Fact(Skip = "Manual baseline-regeneration utility — see doc comment.")]
        public void RegenerateBaseline_ManualOnly()
        {
            var current = ComputeShape();
            var json = JsonSerializer.Serialize(
                new Baseline { Major = ContractVersion.Major, Minor = ContractVersion.Minor, Types = current.Types },
                new JsonSerializerOptions { WriteIndented = true });
            Console.WriteLine(json);
        }

        private static Baseline LoadBaseline()
        {
            var json = File.ReadAllText(BaselinePath);
            return JsonSerializer.Deserialize<Baseline>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? new Baseline();
        }

        private static Baseline ComputeShape()
        {
            var assembly = typeof(StreamData<object>).Assembly;
            var contractMarkedTypeNames = ReadSitrepContractMarkedTypeNames(assembly.Location);

            var sorted = new SortedDictionary<string, string[]>(StringComparer.Ordinal);
            foreach (var type in assembly.GetTypes())
            {
                if (!contractMarkedTypeNames.Contains(type.FullName ?? type.Name))
                {
                    continue;
                }

                // Safe: property enumeration/PropertyType never resolves an
                // attribute's declaring assembly — only GetCustomAttributes*
                // does, which is why the marker check above goes through
                // raw metadata instead (see ReadSitrepContractMarkedTypeNames's
                // doc comment).
                var members = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Select(p => p.Name + ":" + p.PropertyType)
                    .OrderBy(x => x, StringComparer.Ordinal)
                    .ToArray();
                sorted[type.FullName ?? type.Name] = members;
            }

            return new Baseline { Major = ContractVersion.Major, Minor = ContractVersion.Minor, Types = new Dictionary<string, string[]>(sorted) };
        }

        /// <summary>
        /// Returns the full names of every type in <paramref name="assemblyPath"/>
        /// carrying <c>[SitrepContractAttribute]</c> — read via raw ECMA-335
        /// metadata (<see cref="System.Reflection.Metadata"/>/
        /// <see cref="System.Reflection.PortableExecutable"/>), NOT
        /// <c>System.Reflection</c>'s <c>Type.GetCustomAttributesData()</c>/
        /// <c>IsDefined</c>. Both of those eagerly resolve EVERY custom
        /// attribute applied to a type in one shot (verified experimentally
        /// while writing this gate: even wrapping the enumeration call
        /// itself in try/catch wasn't enough — <c>GetCustomAttributesData()</c>
        /// throws building its full record list before a single record is
        /// ever inspected). Since every <c>[SitrepContract]</c> type ALSO
        /// carries <c>[TsInterface]</c>, and <c>[TsInterface]</c>'s declaring
        /// assembly (<c>Reinforced.Typings</c>) is a compile-time-only
        /// dependency that is never runtime-loadable by this project's own
        /// explicit design (see <c>Sitrep.Contract.csproj</c>'s doc comment
        /// and <see cref="SitrepContractAttribute"/>'s), any CLR-level
        /// attribute enumeration on these types always throws
        /// <see cref="System.IO.FileNotFoundException"/> here — regardless
        /// of which specific attribute is being searched for. Reading the
        /// PE metadata directly (a file-parsing operation, not a type-load)
        /// sidesteps that entirely: it only ever needs the attribute
        /// CONSTRUCTOR's simple name, never resolves it to a live
        /// <see cref="Type"/>.
        /// </summary>
        private static HashSet<string> ReadSitrepContractMarkedTypeNames(string assemblyPath)
        {
            using var stream = File.OpenRead(assemblyPath);
            using var peReader = new System.Reflection.PortableExecutable.PEReader(stream);
            var metadataReader = peReader.GetMetadataReader();

            var marked = new HashSet<string>(StringComparer.Ordinal);
            foreach (var typeHandle in metadataReader.TypeDefinitions)
            {
                var typeDef = metadataReader.GetTypeDefinition(typeHandle);
                foreach (var attrHandle in typeDef.GetCustomAttributes())
                {
                    var attribute = metadataReader.GetCustomAttribute(attrHandle);
                    var ctorName = GetAttributeConstructorSimpleName(metadataReader, attribute);
                    if (ctorName != nameof(SitrepContractAttribute))
                    {
                        continue;
                    }

                    var ns = metadataReader.GetString(typeDef.Namespace);
                    var name = metadataReader.GetString(typeDef.Name);
                    marked.Add(string.IsNullOrEmpty(ns) ? name : ns + "." + name);
                    break;
                }
            }

            return marked;
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
