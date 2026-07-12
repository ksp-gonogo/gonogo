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

            /// <summary>
            /// One entry per <see cref="SitrepContractAttribute"/>-marked
            /// ENUM, keyed by full type name, valued as sorted
            /// <c>"MemberName:UnderlyingValue"</c> strings — the enum
            /// analogue of <see cref="Types"/>. A renamed OR renumbered
            /// member changes its entry's key string, so
            /// <see cref="DiffNonAdditive"/>'s existing set-difference logic
            /// (originally written for property members) catches both
            /// without any special-casing: renaming "Fresh" or renumbering
            /// it from 0 to 1 both produce a string absent from the other
            /// side's set.
            /// </summary>
            public Dictionary<string, string[]> Enums { get; set; } = new();
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
        /// Enum analogue of <see cref="GateSelfTest_CatchesNonAdditiveChangeButNotAdditiveOrMajorBump"/>
        /// — proves the gate is no longer blind to enums (the review's
        /// finding #1: "an enum rename or renumber... passes silently").
        /// Covers both non-additive enum breaks (a member RENAMED, and a
        /// member RENUMBERED while keeping its name — the "enum renumbered"
        /// case named explicitly in the review) plus the additive/Major-bump
        /// escape hatches, mirroring the property-side test exactly.
        /// </summary>
        [Fact]
        public void GateSelfTest_CatchesEnumRenameOrRenumberButNotAdditiveOrMajorBump()
        {
            var baseline = new Baseline
            {
                Major = 1,
                Minor = 0,
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:0", "HeldStale:1", "LastBeforeBlackout:2" },
                },
            };

            // Non-additive: "Fresh" renamed to "Current" — must be caught.
            var renamed = new Baseline
            {
                Major = 1,
                Minor = 0,
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Current:0", "HeldStale:1", "LastBeforeBlackout:2" },
                },
            };
            Assert.NotEmpty(DiffNonAdditive(baseline, renamed, currentMajor: 1));

            // Non-additive: "Fresh" keeps its name but is RENUMBERED from 0
            // to 1 (swapped with "HeldStale") — the exact "enum renumbered"
            // wire break the review flagged; must be caught even though no
            // name changed.
            var renumbered = new Baseline
            {
                Major = 1,
                Minor = 0,
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:1", "HeldStale:0", "LastBeforeBlackout:2" },
                },
            };
            Assert.NotEmpty(DiffNonAdditive(baseline, renumbered, currentMajor: 1));

            // Non-additive: whole enum removed — must be caught.
            var enumRemoved = new Baseline { Major = 1, Minor = 0, Enums = new Dictionary<string, string[]>() };
            Assert.NotEmpty(DiffNonAdditive(baseline, enumRemoved, currentMajor: 1));

            // Additive: a brand new member appended, plus a brand new enum
            // — must NOT be caught.
            var additive = new Baseline
            {
                Major = 1,
                Minor = 1,
                Enums = new Dictionary<string, string[]>
                {
                    ["Staleness"] = new[] { "Fresh:0", "HeldStale:1", "LastBeforeBlackout:2", "Quarantined:3" },
                    ["BrandNewEnum"] = new[] { "Only:0" },
                },
            };
            Assert.Empty(DiffNonAdditive(baseline, additive, currentMajor: 1));

            // A Major bump is the sanctioned way to break an enum too — the
            // same rename that failed above must now pass.
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

            var removedEnums = baseline.Enums.Keys.Except(current.Enums.Keys).ToList();
            if (removedEnums.Count > 0)
            {
                violations.Add("removed [SitrepContract] enum(s) without a Major bump: " + string.Join(", ", removedEnums));
            }

            foreach (var (enumName, baselineMembers) in baseline.Enums)
            {
                if (!current.Enums.TryGetValue(enumName, out var currentMembers))
                {
                    continue; // already reported as a removed enum above
                }

                // Set-difference over "Name:Value" strings catches BOTH a
                // rename (the old name's string vanishes) and a renumber
                // (the old value's string vanishes even though the name
                // survives) — see the Enums doc comment on Baseline.
                var removedMembers = baselineMembers.Except(currentMembers).ToList();
                if (removedMembers.Count > 0)
                {
                    violations.Add($"removed/renamed/renumbered member(s) on enum \"{enumName}\" without a Major bump: " + string.Join(", ", removedMembers));
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
                new Baseline { Major = ContractVersion.Major, Minor = ContractVersion.Minor, Types = current.Types, Enums = current.Enums },
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

            return new Baseline
            {
                Major = ContractVersion.Major,
                Minor = ContractVersion.Minor,
                Types = new Dictionary<string, string[]>(sortedTypes),
                Enums = new Dictionary<string, string[]>(new SortedDictionary<string, string[]>(enumShapes, StringComparer.Ordinal)),
            };
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
        /// <summary>
        /// Returns (1) the full names of every type carrying
        /// <c>[SitrepContractAttribute]</c>, same as before, PLUS (2) the
        /// member shape (<c>"Name:Value"</c>, sorted) of every one of those
        /// types that is itself an ENUM — both read via raw ECMA-335
        /// metadata rather than any <see cref="System.Reflection"/> API that
        /// touches the type. See the doc comment below for why enum shape
        /// specifically also needs the raw-metadata treatment, not just the
        /// marker check.
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
