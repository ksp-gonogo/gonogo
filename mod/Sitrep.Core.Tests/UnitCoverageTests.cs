using System;
using System.Collections;
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

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The coverage gate for <see cref="SitrepUnitAttribute"/>: every scalar
    /// property on a <see cref="SitrepContractAttribute"/> type declares a unit,
    /// or sits in a baseline that may only ever shrink.
    ///
    /// <para><b>Why this can exist now and could not before.</b> The attribute
    /// originally said "only annotate what is KNOWN", so an absent annotation
    /// meant "not yet stated". Under that rule a bare property is
    /// indistinguishable from a property that never needed one, and a gate has
    /// nothing to assert: a new unannotated <c>double</c> looks exactly like a
    /// <c>bool</c>. Giving the non-quantities their own tokens
    /// (<see cref="Units.Count"/>, <see cref="Units.Id"/>,
    /// <see cref="Units.Text"/>, <see cref="Units.Flag"/>,
    /// <see cref="Units.Enumeration"/>, <see cref="Units.NotApplicable"/>) is
    /// what makes silence mean "someone forgot" and therefore checkable.</para>
    ///
    /// <para><b>Structural properties are exempt BY TYPE, not by name.</b> A
    /// container has no dimension of its own: a nested contract POCO, or a list
    /// of them, is described entirely by the units on its leaves. Deriving that
    /// from the property type means a payload can gain a sub-object without
    /// anyone editing this file, which is the coupling
    /// <c>WirePayloadCoverageTests.FlattenedByProducer</c> next door demonstrates
    /// the cost of: adding a payload there means editing a core test, and
    /// §6 of the uplink-boundary write-up calls that out as the one coupling
    /// with a real price. This gate deliberately does not repeat the shape.</para>
    ///
    /// <para><b>A declining ratchet, not a cliff.</b> Seeding it hard would have
    /// meant annotating 580 properties in one commit, which is neither
    /// reviewable nor safe: a guessed unit is worse than a bare readout, because
    /// a formatter will confidently mislabel it. The baseline holds what was
    /// already bare, and <see cref="BaselineOnlyShrinks"/> fails if an entry
    /// goes stale, so a batch that annotates properties MUST delete its lines
    /// here. The ratchet cannot quietly stall.</para>
    /// </summary>
    public class UnitCoverageTests
    {
        private const string BaselineFile = "unit-coverage.baseline.json";

        private sealed class Baseline
        {
            [JsonPropertyName("Note")]
            public string Note { get; set; } = string.Empty;

            /// <summary>`TypeName.PropertyName`, sorted.</summary>
            [JsonPropertyName("Pending")]
            public List<string> Pending { get; set; } = new();
        }

        // ---------------------------------------------------------------
        // What needs a unit.
        // ---------------------------------------------------------------

        /// <summary>
        /// True when a property carries a VALUE rather than a structure, and so
        /// is something a unit can describe.
        ///
        /// <para>Scalars are the numerics, strings, booleans and enums, plus a
        /// collection of those: <c>double[] Samples</c> is a series of one
        /// quantity and the unit applies to every element. A collection of
        /// contract POCOs is not, because each element carries its own
        /// annotated properties.</para>
        /// </summary>
        internal static bool RequiresUnit(PropertyInfo prop)
        {
            var element = ElementType(Unwrap(prop.PropertyType));
            return IsScalar(element) || IsVec3(element);
        }

        /// <summary>
        /// A <c>Vec3</c>-typed field is a composite that carries a real unit,
        /// not a structural container to be exempted. The ONE canonical Vec3 is
        /// used at sites carrying three different units, so the unit sits on the
        /// FIELD and codegen propagates it to the three scalar leaves (see
        /// <c>RtConfig.EmitUnitMap</c>). The gate therefore requires an
        /// annotation on the Vec3 field itself, exactly as it does a scalar.
        /// Matched by name so this test needs no reference back to the Vec3
        /// type, the same string-only discipline the metadata scan keeps.
        /// </summary>
        private static bool IsVec3(Type t) => t.FullName == "Sitrep.Contract.Vec3";

        private static Type Unwrap(Type t) => Nullable.GetUnderlyingType(t) ?? t;

        /// <summary>
        /// The type whose dimension is in question: an array's or sequence's
        /// element, or the type itself. <c>string</c> is short-circuited because
        /// it is an <see cref="IEnumerable"/> of <c>char</c> and is emphatically
        /// not a sequence of quantities.
        /// </summary>
        private static Type ElementType(Type t)
        {
            if (t == typeof(string))
            {
                return t;
            }

            if (t.IsArray)
            {
                return Unwrap(t.GetElementType()!);
            }

            if (t.IsGenericType)
            {
                var def = t.GetGenericTypeDefinition();
                if (def == typeof(List<>) || def == typeof(IReadOnlyList<>) ||
                    def == typeof(IList<>) || def == typeof(IEnumerable<>) ||
                    def == typeof(ICollection<>) || def == typeof(IReadOnlyCollection<>))
                {
                    return Unwrap(t.GetGenericArguments()[0]);
                }

                // A dictionary is a bag of heterogeneous values by definition:
                // one unit could not describe all of them, and the honest state
                // is that its shape is not modelled by the contract at all.
                if (def == typeof(Dictionary<,>) || def == typeof(IDictionary<,>) ||
                    def == typeof(IReadOnlyDictionary<,>))
                {
                    return typeof(object);
                }
            }

            return t;
        }

        private static bool IsScalar(Type t) =>
            t.IsEnum
            || t == typeof(string)
            || t == typeof(bool)
            || t == typeof(double) || t == typeof(float) || t == typeof(decimal)
            || t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte)
            || t == typeof(uint) || t == typeof(ulong) || t == typeof(ushort) || t == typeof(sbyte);

        private static IEnumerable<Type> ContractTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // IsDefined only, never GetCustomAttributesData: the sibling
                // Reinforced.Typings attributes are not loadable in this net10.0
                // test, the same constraint WirePayloadCoverageTests works under.
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false));

        /// <summary>
        /// `TypeName.PropertyName` for every property carrying a
        /// <see cref="SitrepUnitAttribute"/>, read straight out of the assembly's
        /// METADATA.
        ///
        /// <para><b>Why not <c>PropertyInfo.IsDefined</c>.</b> It looks equivalent
        /// and passes locally, and it fails on a clean checkout with
        /// <c>FileNotFoundException: Reinforced.Typings</c>. Filtering custom
        /// attributes has to RESOLVE each attribute's type to compare it against
        /// the filter, so one property carrying a <c>[TsProperty]</c> is enough to
        /// throw, and <c>Reinforced.Typings</c> is compile-time-only by explicit
        /// design (see <see cref="SitrepContractAttribute"/>). It passed here only
        /// because a local codegen run leaves that DLL in <c>bin/</c>; CI has no
        /// such run and went red.
        ///
        /// <para>The type-level check above survives because no contract TYPE
        /// carries an attribute that fails to resolve, which is exactly why this
        /// hazard is easy to walk into: the same call is safe one level up.</para>
        ///
        /// <para>A <c>MetadataReader</c> compares attribute names as strings and
        /// resolves nothing, so it cannot be made to fail this way. The
        /// alternative, referencing Reinforced.Typings from this test project,
        /// would fix the symptom by breaking the rule the contract states: nothing
        /// reflecting over it should need an external assembly.</para>
        /// </summary>
        private static HashSet<string> AnnotatedFromMetadata()
        {
            var annotated = new HashSet<string>(StringComparer.Ordinal);
            using var stream = File.OpenRead(typeof(CommsDelay).Assembly.Location);
            using var pe = new PEReader(stream);
            var md = pe.GetMetadataReader();

            // The attribute's own type name, as a string, never resolved. An
                // attribute defined in this assembly reaches us as a
                // MethodDefinition; one from a referenced assembly as a
                // MemberReference. SitrepUnitAttribute is always the former, but
                // both are read so an unrecognised shape returns null rather than
                // throwing, which is the whole point of not resolving.
            string? AttributeTypeName(EntityHandle ctor)
            {
                switch (ctor.Kind)
                {
                    case HandleKind.MethodDefinition:
                        var declaring = md.GetMethodDefinition((MethodDefinitionHandle)ctor).GetDeclaringType();
                        return md.GetString(md.GetTypeDefinition(declaring).Name);
                    case HandleKind.MemberReference:
                        var parent = md.GetMemberReference((MemberReferenceHandle)ctor).Parent;
                        return parent.Kind == HandleKind.TypeReference
                            ? md.GetString(md.GetTypeReference((TypeReferenceHandle)parent).Name)
                            : null;
                    default:
                        return null;
                }
            }

            bool CarriesUnitAttribute(CustomAttributeHandleCollection handles)
            {
                foreach (var handle in handles)
                {
                    if (AttributeTypeName(md.GetCustomAttribute(handle).Constructor)
                        == nameof(SitrepUnitAttribute))
                    {
                        return true;
                    }
                }

                return false;
            }

            foreach (var typeHandle in md.TypeDefinitions)
            {
                var type = md.GetTypeDefinition(typeHandle);
                var typeName = md.GetString(type.Name);
                foreach (var propHandle in type.GetProperties())
                {
                    var prop = md.GetPropertyDefinition(propHandle);
                    if (CarriesUnitAttribute(prop.GetCustomAttributes()))
                    {
                        annotated.Add(typeName + "." + md.GetString(prop.Name));
                    }
                }
            }

            return annotated;
        }

        /// <summary>Every scalar property, annotated or not, as `Type.Property`.</summary>
        private static SortedDictionary<string, bool> Surface()
        {
            var annotated = AnnotatedFromMetadata();
            var surface = new SortedDictionary<string, bool>(StringComparer.Ordinal);
            foreach (var t in ContractTypes())
            {
                foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    // PropertyType is plain reflection and resolves nothing beyond
                    // the contract's own types, so the scalar test is safe here.
                    // Only the ATTRIBUTE lookup had to move to metadata.
                    if (!RequiresUnit(p))
                    {
                        continue;
                    }

                    var key = t.Name + "." + p.Name;
                    surface[key] = annotated.Contains(key);
                }
            }

            return surface;
        }

        // ---------------------------------------------------------------
        // The gate.
        // ---------------------------------------------------------------

        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit()
        {
            var pending = LoadBaseline().Pending.ToHashSet(StringComparer.Ordinal);

            var bare = Surface()
                .Where(kv => !kv.Value && !pending.Contains(kv.Key))
                .Select(kv => kv.Key)
                .ToList();

            Assert.True(
                bare.Count == 0,
                "These wire properties carry no [SitrepUnit], so a client has no way to know what "
                + "they are and every widget reading them has to hard-code a guess:\n  "
                + string.Join("\n  ", bare)
                + "\n\nDeclare one. If it is not a physical quantity there is still a token for it: "
                + "Units.Count, Units.Id, Units.ResourceUnits, Units.Text, Units.Flag, "
                + "Units.Enumeration, or Units.NotApplicable as a last resort. Do NOT guess a "
                + "dimension to clear this gate: a wrong unit is worse than a bare readout, because "
                + "the client will confidently mislabel it.\n\n"
                + "Adding to " + BaselineFile + " is for recording what was already bare, never for new work.");
        }

        [Fact]
        public void BaselineOnlyShrinks()
        {
            var surface = Surface();
            var stale = new List<string>();

            foreach (var entry in LoadBaseline().Pending)
            {
                if (!surface.TryGetValue(entry, out var annotated))
                {
                    stale.Add(entry + "  (no longer a scalar wire property)");
                }
                else if (annotated)
                {
                    stale.Add(entry + "  (now annotated)");
                }
            }

            Assert.True(
                stale.Count == 0,
                "These " + BaselineFile + " entries no longer describe anything bare, so the baseline "
                + "is overstating how much is left:\n  "
                + string.Join("\n  ", stale)
                + "\n\nDelete them. This assertion is the whole reason the baseline is a RATCHET rather "
                + "than a list: without it a batch could annotate properties, leave the entries behind, "
                + "and the count would never move.");
        }

        [Fact]
        public void PendingIsSortedAndFreeOfDuplicates()
        {
            // Not pedantry: a hand-edited list that is not sorted grows
            // duplicate entries, and a duplicate is invisible in a diff while
            // making the remaining count wrong.
            var pending = LoadBaseline().Pending;
            Assert.Equal(pending.Distinct(StringComparer.Ordinal).Count(), pending.Count);
            Assert.Equal(pending.OrderBy(x => x, StringComparer.Ordinal).ToList(), pending);
        }

        /// <summary>
        /// Rewrites the baseline from the current surface. Skipped by default and
        /// run deliberately, the same shape as the contract-shape gate's freeze
        /// utility, because a gate that can regenerate itself on a normal test run
        /// is not a gate.
        ///
        /// <para><c>SITREP_SEED_UNIT_BASELINE=1 dotnet test mod/Sitrep.Core.Tests
        /// --filter FullyQualifiedName~SeedBaseline</c></para>
        ///
        /// <para>Only legitimate use is the initial seed. Re-running it after a
        /// batch would re-add whatever that batch had not got to, silently
        /// reversing the ratchet.</para>
        /// </summary>
        [Fact(Skip = "Utility: see doc comment. Never runs in CI.")]
        public void SeedBaseline()
        {
            Assert.Equal("1", Environment.GetEnvironmentVariable("SITREP_SEED_UNIT_BASELINE"));

            var pending = Surface().Where(kv => !kv.Value).Select(kv => kv.Key).ToList();
            var baseline = new Baseline
            {
                Note =
                    "Scalar wire properties that carried no [SitrepUnit] when the coverage gate landed. "
                    + "This list may only SHRINK: annotate properties and delete their lines. "
                    + "UnitCoverageTests.BaselineOnlyShrinks fails on a stale entry, so a batch cannot "
                    + "leave its lines behind. Never regenerate this file to make a failure go away.",
                Pending = pending,
            };

            File.WriteAllText(
                ResolveBaselineSourcePath(),
                // Trailing newline because the pre-commit hook runs biome over
                // this file and JsonSerializer does not emit one.
                JsonSerializer.Serialize(baseline, new JsonSerializerOptions { WriteIndented = true }) + "\n");

            Console.WriteLine($"Seeded {pending.Count} pending entries.");
        }

        // ---------------------------------------------------------------
        // Paths.
        // ---------------------------------------------------------------

        private static Baseline LoadBaseline()
        {
            var path = Path.Combine(AppContext.BaseDirectory, "golden-fixtures", BaselineFile);
            return JsonSerializer.Deserialize<Baseline>(File.ReadAllText(path)) ?? new Baseline();
        }

        /// <summary>
        /// The repo's source copy. The .csproj links the baseline in as a BUILD
        /// OUTPUT, so writing to the loaded path would land in <c>bin/</c> and be
        /// discarded on the next build. Same walk, and same trap, as
        /// ContractShapeGateTests.ResolveLedgerSourcePath.
        /// </summary>
        private static string ResolveBaselineSourcePath()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract", BaselineFile);
                if (File.Exists(candidate))
                {
                    return candidate;
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/Sitrep.Contract/" + BaselineFile + " walking up from " + AppContext.BaseDirectory);
        }
    }
}
