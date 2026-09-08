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

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The coverage gate for <see cref="SitrepFrameAttribute"/>: every
    /// <see cref="Vec3"/>-valued property on a <see cref="SitrepContractAttribute"/>
    /// type names the frame it is expressed in, from a closed catalog, or sits in a
    /// baseline that may only ever shrink.
    ///
    /// <para><b>Why a gate and not a habit.</b> <see cref="Vec3"/> is deliberately
    /// minimal and its own doc comment says so: units are documented on the FIELD
    /// that holds one, never implied by the shape. Frame was in the same category
    /// and got neither the attribute nor the sentence, which left it a per-payload
    /// convention that nothing checked. Its failure mode is silent in a way a
    /// missing unit's is not: subtracting two well-formed vectors from different
    /// frames produces a well-formed nonsense vector, with no null, no exception
    /// and no obviously wrong number until someone plots it. A convention that
    /// cannot be enforced is a convention that drifts, so the rule and its
    /// enforcement land together.</para>
    ///
    /// <para><b>The baseline was seeded EMPTY, and that was measured rather than
    /// hoped for.</b> The whole surface was ten properties across five types and
    /// every one already stated its frame in prose, so annotating them was
    /// transcription, not a research project. That is the opposite of
    /// <see cref="UnitCoverageTests"/>' situation next door, where seeding hard
    /// would have meant guessing 580 dimensions in one commit. Where this gate
    /// does borrow from that one is the shape of the ratchet and the metadata
    /// scan, for the reason recorded there.</para>
    ///
    /// <para><b>A baseline entry carries a REASON, and there is no seed
    /// utility.</b> A debt list is a gate that permits violations, so each entry
    /// has to say what could not be established: not "this one is pending" but
    /// which fact about the producer was unavailable. A machine cannot write that
    /// sentence, which is exactly why the seeding utility that
    /// <see cref="UnitCoverageTests.SeedBaseline"/> provides has no twin here.
    /// Entries are added by hand or not at all.</para>
    /// </summary>
    public class FrameCoverageTests
    {
        private const string BaselineFile = "frame-coverage.baseline.json";

        /// <summary>One recorded debt, and why it is debt rather than an omission.</summary>
        private sealed class PendingEntry
        {
            [JsonPropertyName("Property")]
            public string Property { get; set; } = string.Empty;

            [JsonPropertyName("Reason")]
            public string Reason { get; set; } = string.Empty;
        }

        private sealed class Baseline
        {
            [JsonPropertyName("Note")]
            public string Note { get; set; } = string.Empty;

            /// <summary>`TypeName.PropertyName` plus a reason, sorted by property.</summary>
            [JsonPropertyName("Pending")]
            public List<PendingEntry> Pending { get; set; } = new();
        }

        /// <summary>What a property's <c>[SitrepFrame]</c> actually says.</summary>
        private sealed class Declared
        {
            public string Frame { get; set; } = string.Empty;

            public string? WhenSet { get; set; }

            public string? SelectedBy { get; set; }
        }

        // What needs a frame.

        /// <summary>
        /// True when a property carries a <see cref="Vec3"/>, directly or as the
        /// element of a collection. A vector is the only thing a frame describes:
        /// a scalar altitude or a speed has a datum and a unit but no axes, and
        /// stamping frames on those would make the annotation noise rather than a
        /// claim.
        /// </summary>
        internal static bool RequiresFrame(PropertyInfo prop) => IsVec3(ElementType(Unwrap(prop.PropertyType)));

        /// <summary>
        /// Matched by full name so this gate needs no compile-time dependency on
        /// the type it is describing, the same string-only discipline the metadata
        /// scan below keeps.
        /// </summary>
        private static bool IsVec3(Type t) => t.FullName == "Sitrep.Contract.Vec3";

        private static Type Unwrap(Type t) => Nullable.GetUnderlyingType(t) ?? t;

        /// <summary>
        /// The type whose frame is in question: a collection's element, or the type
        /// itself.
        ///
        /// <para><b>A DICTIONARY's value type is unwrapped here and is not by
        /// <see cref="UnitCoverageTests"/>, deliberately.</b> That gate exempts
        /// dictionaries because a bag of heterogeneous values has no one dimension.
        /// A <c>Dictionary&lt;string, Vec3&gt;</c> is not heterogeneous, it is a
        /// named set of vectors, and letting the unit gate's exemption carry over
        /// would leave a hole in this one exactly the shape of the map a future
        /// multi-vantage payload would reach for.</para>
        /// </summary>
        private static Type ElementType(Type t)
        {
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

                if (def == typeof(Dictionary<,>) || def == typeof(IDictionary<,>) ||
                    def == typeof(IReadOnlyDictionary<,>))
                {
                    return Unwrap(t.GetGenericArguments()[1]);
                }
            }

            return t;
        }

        private static IEnumerable<Type> ContractTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract)
                // IsDefined only, never GetCustomAttributesData: see
                // UnitCoverageTests.ContractTypes for the incident behind that.
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false));

        // What is declared, read out of metadata.

        /// <summary>
        /// `TypeName.PropertyName` -&gt; the frame it declares, for every property
        /// carrying <see cref="SitrepFrameAttribute"/>, read from the assembly's
        /// METADATA rather than through <c>PropertyInfo.GetCustomAttribute</c>.
        ///
        /// <para>The reason is recorded in full on
        /// <see cref="UnitCoverageTests.AnnotatedFromMetadata"/> and is not
        /// repeated: filtering custom attributes has to RESOLVE each one to compare
        /// it against the filter, a <c>MetadataReader</c> compares names as strings
        /// and resolves nothing, and a gate whose job is to describe an assembly
        /// should not be breakable by what that assembly happens to reference.</para>
        ///
        /// <para>The attribute's blob is decoded by hand because this gate needs the
        /// VALUES, not merely the presence: the catalog check and the discriminant
        /// check both read arguments. The layout is ECMA-335 II.23.3 and fixed by
        /// the attribute's own signature (one string constructor argument, then
        /// named string properties), so the walk below is exhaustive for it and
        /// would throw rather than guess on anything else.</para>
        /// </summary>
        private static Dictionary<string, Declared> DeclaredFromMetadata()
        {
            var declared = new Dictionary<string, Declared>(StringComparer.Ordinal);
            using var stream = File.OpenRead(typeof(CommsDelay).Assembly.Location);
            using var pe = new PEReader(stream);
            var md = pe.GetMetadataReader();

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

            foreach (var typeHandle in md.TypeDefinitions)
            {
                var type = md.GetTypeDefinition(typeHandle);
                var typeName = md.GetString(type.Name);
                foreach (var propHandle in type.GetProperties())
                {
                    var prop = md.GetPropertyDefinition(propHandle);
                    foreach (var attrHandle in prop.GetCustomAttributes())
                    {
                        var attribute = md.GetCustomAttribute(attrHandle);
                        if (AttributeTypeName(attribute.Constructor) != nameof(SitrepFrameAttribute))
                        {
                            continue;
                        }

                        declared[typeName + "." + md.GetString(prop.Name)] =
                            DecodeFrameAttribute(md.GetBlobReader(attribute.Value));
                    }
                }
            }

            return declared;
        }

        /// <summary>
        /// ECMA-335 II.23.3: a <c>0x0001</c> prolog, the constructor's fixed
        /// arguments, then a count of named arguments each introduced by a
        /// field/property marker and an element type. Every argument of this
        /// attribute is a string, so one reader call handles all of them.
        /// </summary>
        private static Declared DecodeFrameAttribute(BlobReader blob)
        {
            const byte PropertyMarker = 0x54;
            const byte ElementTypeString = 0x0E;

            blob.ReadUInt16();
            var result = new Declared { Frame = blob.ReadSerializedString() ?? string.Empty };

            var namedCount = blob.ReadUInt16();
            for (var i = 0; i < namedCount; i++)
            {
                var marker = blob.ReadByte();
                var elementType = blob.ReadByte();
                var name = blob.ReadSerializedString();
                var value = blob.ReadSerializedString();

                if (marker != PropertyMarker || elementType != ElementTypeString)
                {
                    throw new InvalidOperationException(
                        $"[SitrepFrame] named argument '{name}' is not a string property (marker 0x{marker:x2}, "
                        + $"element type 0x{elementType:x2}). This decoder covers the attribute's declared shape "
                        + "exactly; widen it in step with the attribute rather than letting it guess.");
                }

                switch (name)
                {
                    case nameof(SitrepFrameAttribute.WhenSet):
                        result.WhenSet = value;
                        break;
                    case nameof(SitrepFrameAttribute.SelectedBy):
                        result.SelectedBy = value;
                        break;
                    default:
                        throw new InvalidOperationException(
                            $"[SitrepFrame] carries an unrecognised named argument '{name}'. Teach this decoder "
                            + "about it, or the gate will silently ignore whatever it was meant to say.");
                }
            }

            return result;
        }

        /// <summary>The closed catalog, read off <see cref="Frames"/> so a new token needs no edit here.</summary>
        private static HashSet<string> Catalog() =>
            typeof(Frames)
                .GetFields(BindingFlags.Public | BindingFlags.Static)
                .Where(f => f.IsLiteral && f.FieldType == typeof(string))
                .Select(f => (string)f.GetRawConstantValue()!)
                .ToHashSet(StringComparer.Ordinal);

        /// <summary>
        /// Every <see cref="Vec3"/>-valued wire property, mapped to what it
        /// declares or to null when it declares nothing.
        /// </summary>
        private static SortedDictionary<string, Declared?> Surface()
        {
            var declared = DeclaredFromMetadata();
            var surface = new SortedDictionary<string, Declared?>(StringComparer.Ordinal);
            foreach (var t in ContractTypes())
            {
                foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (!RequiresFrame(p))
                    {
                        continue;
                    }

                    // Keyed on the DECLARING type so an inherited property is
                    // attributed where its attribute lives and matches what the
                    // metadata scan produces, the same key UnitCoverageTests uses
                    // and for the same reason.
                    var key = (p.DeclaringType ?? t).Name + "." + p.Name;
                    surface[key] = declared.TryGetValue(key, out var d) ? d : null;
                }
            }

            return surface;
        }

        /// <summary>
        /// The camelCased names of every boolean property on each contract type, so
        /// a declared <see cref="SitrepFrameAttribute.SelectedBy"/> can be resolved
        /// against a real sibling. camelCased because the attribute names the WIRE
        /// field a client reads, which is what the generated TS calls it.
        /// </summary>
        private static Dictionary<string, HashSet<string>> BoolPropertiesByType()
        {
            var byType = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var t in ContractTypes())
            {
                var flags = new HashSet<string>(StringComparer.Ordinal);
                foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (Unwrap(p.PropertyType) == typeof(bool))
                    {
                        flags.Add(CamelCase(p.Name));
                    }
                }

                byType[t.Name] = flags;
            }

            return byType;
        }

        /// <summary>Lowercases the leading character and changes nothing else, matching <c>RtConfig.CamelCaseForProperties</c>.</summary>
        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name.Substring(1);

        // The gate.

        [Fact]
        public void EveryVec3WirePropertyDeclaresAFrame()
        {
            var pending = LoadBaseline().Pending.Select(e => e.Property).ToHashSet(StringComparer.Ordinal);

            var bare = Surface()
                .Where(kv => kv.Value is null && !pending.Contains(kv.Key))
                .Select(kv => kv.Key)
                .ToList();

            Assert.True(
                bare.Count == 0,
                "These wire properties carry a Vec3 and no [SitrepFrame], so a consumer has no way to know "
                + "what the three numbers are measured against and nothing stops it subtracting them from a "
                + "vector in another frame:\n  "
                + string.Join("\n  ", bare)
                + "\n\nDeclare one from the Frames catalog: Frames.BodyCentredInertial, "
                + "Frames.BodyCentredRotating, Frames.SubjectRelative, Frames.VesselLocal or "
                + "Frames.PartLocal. There is deliberately no not-applicable token: establish what the "
                + "producer actually computes rather than picking the closest-looking one, because a wrong "
                + "frame is worse than a bare vector.\n\n"
                + "Adding to " + BaselineFile + " records a frame nobody could establish, WITH the reason, "
                + "and is never a way to land new work without one.");
        }

        [Fact]
        public void EveryDeclaredFrameIsInTheCatalog()
        {
            var catalog = Catalog();
            var offenders = new List<string>();

            foreach (var (key, declared) in Surface())
            {
                if (declared is null)
                {
                    continue;
                }

                if (!catalog.Contains(declared.Frame))
                {
                    offenders.Add($"{key}: \"{declared.Frame}\"");
                }

                if (declared.WhenSet is not null && !catalog.Contains(declared.WhenSet))
                {
                    offenders.Add($"{key} (WhenSet): \"{declared.WhenSet}\"");
                }
            }

            Assert.True(
                offenders.Count == 0,
                "These [SitrepFrame] tokens are not in the Sitrep.Contract.Frames catalog, so they are a "
                + "second spelling of a frame rather than a frame:\n  "
                + string.Join("\n  ", offenders)
                + "\n\nUse an existing const, or add one to Frames if this really is a frame the contract has "
                + "never expressed. The catalog is closed for first-party payloads precisely so a typo cannot "
                + "quietly become a vocabulary.");
        }

        /// <summary>
        /// A per-tick frame is declared by naming the flag that decides it, and that
        /// name has to resolve. Checking it HERE, at build time, against a sibling on
        /// the same payload is the whole reason the discriminant is a property name and
        /// not a reference into a central frame table: a table turns a missing frame
        /// into a dangling reference that fails at read time in a client, which is
        /// strictly worse when the point is catching it early.
        /// </summary>
        [Fact]
        public void ADiscriminantNamesARealSiblingFlag()
        {
            var flagsByType = BoolPropertiesByType();
            var offenders = new List<string>();

            foreach (var (key, declared) in Surface())
            {
                if (declared is null)
                {
                    continue;
                }

                var hasAlternate = declared.WhenSet is not null;
                var hasSelector = declared.SelectedBy is not null;

                if (hasAlternate != hasSelector)
                {
                    offenders.Add(
                        $"{key}: declares {(hasAlternate ? "WhenSet" : "SelectedBy")} without the other. "
                        + "An alternate frame nobody can select is unreachable, and a selector with nothing "
                        + "to select is a no-op.");
                    continue;
                }

                if (!hasSelector)
                {
                    continue;
                }

                if (declared.WhenSet == declared.Frame)
                {
                    offenders.Add(
                        $"{key}: WhenSet repeats the base frame \"{declared.Frame}\", so the flag reads as a "
                        + "real distinction and makes none.");
                }

                var owner = key.Substring(0, key.IndexOf('.'));
                if (!flagsByType.TryGetValue(owner, out var flags) || !flags.Contains(declared.SelectedBy!))
                {
                    offenders.Add(
                        $"{key}: SelectedBy names \"{declared.SelectedBy}\", which is not a boolean property "
                        + $"on {owner}. Known flags there: "
                        + (flags is null || flags.Count == 0 ? "(none)" : string.Join(", ", flags.OrderBy(x => x, StringComparer.Ordinal))));
                }
            }

            Assert.True(
                offenders.Count == 0,
                "These [SitrepFrame] discriminants do not resolve:\n  " + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The discovery reaches the Vec3 surface, so a clean gate means something.
        ///
        /// <para>Every assertion above finds nothing wrong when the surface is EMPTY,
        /// and three separate edits empty it: <c>[SitrepContract]</c> renamed or moved,
        /// <see cref="Vec3"/> renamed (this gate matches it by full name, on purpose),
        /// or <see cref="ElementType"/> losing a container shape. The baseline cannot
        /// cover the hole either, since it is empty and iterates nothing. Same guard,
        /// and same reasoning, as <see cref="UnitCoverageTests.DiscoveryReachesTheContractSurface"/>.</para>
        /// </summary>
        [Fact]
        public void DiscoveryReachesTheVec3Surface()
        {
            var surface = Surface();
            Assert.True(
                surface.Count >= 10,
                "The Vec3 wire surface collapsed to " + surface.Count
                    + " properties. A gate over an empty surface reports the same zero bare properties as a "
                    + "fully annotated one. Found: "
                    + string.Join(", ", surface.Keys));

            // Named because each is reached by a different container shape: a plain
            // Vec3, a nullable one, and one behind a nested payload. A change that
            // drops any of those routes is red here rather than a quiet loss.
            foreach (var name in new[]
                     {
                         "VesselOrbitTruth.Position", "DockAlignment.RelativeVelocity",
                         "VesselTarget.RelativePosition", "VesselPart.Up", "PartBounds.Size",
                     })
            {
                Assert.Contains(name, surface.Keys);
            }
        }

        [Fact]
        public void BaselineOnlyShrinks()
        {
            var surface = Surface();
            var stale = new List<string>();

            foreach (var entry in LoadBaseline().Pending)
            {
                if (!surface.TryGetValue(entry.Property, out var declared))
                {
                    stale.Add(entry.Property + "  (no longer a Vec3 wire property)");
                }
                else if (declared is not null)
                {
                    stale.Add(entry.Property + "  (now declares " + declared.Frame + ")");
                }
            }

            Assert.True(
                stale.Count == 0,
                "These " + BaselineFile + " entries no longer describe anything bare, so the baseline is "
                + "overstating how much is left:\n  "
                + string.Join("\n  ", stale)
                + "\n\nDelete them. This assertion is what makes the baseline a RATCHET rather than a list: "
                + "without it a batch could annotate properties, leave the entries behind, and the count "
                + "would never move.");
        }

        [Fact]
        public void PendingEntriesAreSortedUniqueAndGiveAReason()
        {
            var pending = LoadBaseline().Pending;
            var properties = pending.Select(e => e.Property).ToList();

            // A hand-edited list that is not sorted grows duplicates, and a duplicate
            // is invisible in a diff while making the remaining count wrong.
            Assert.Equal(properties.Distinct(StringComparer.Ordinal).Count(), properties.Count);
            Assert.Equal(properties.OrderBy(x => x, StringComparer.Ordinal).ToList(), properties);

            var unexplained = pending
                .Where(e => string.IsNullOrWhiteSpace(e.Reason))
                .Select(e => e.Property)
                .ToList();

            Assert.True(
                unexplained.Count == 0,
                "These " + BaselineFile + " entries record debt without saying what it is:\n  "
                + string.Join("\n  ", unexplained)
                + "\n\nEvery entry states which fact about the producer could not be established. A list of "
                + "bare names is a list of properties somebody skipped, and nobody can tell later which ones "
                + "were hard and which were forgotten.");
        }

        private static Baseline LoadBaseline()
        {
            var path = Path.Combine(AppContext.BaseDirectory, "golden-fixtures", BaselineFile);
            return JsonSerializer.Deserialize<Baseline>(File.ReadAllText(path)) ?? new Baseline();
        }
    }
}
