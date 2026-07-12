using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Locks the P1b slice 2 typing for the <c>dv.*</c> channels: proves the
    /// named <c>Sitrep.Contract</c> payload types (<see cref="StageDeltaVEntry"/>,
    /// <see cref="StageDeltaVSummary"/>) mirror — field name for field name,
    /// camelCase wire key for camelCase wire key, type for type — the EXACT
    /// serialized shape <see cref="StageDeltaVViewProvider"/> already emits.
    /// This is a typing change only: the wire is written by <c>JsonWriter</c>
    /// walking the provider's dictionary/list tree, not by serializing these
    /// POCOs, so if the two shapes ever drift (a field renamed, removed, added,
    /// or retyped on either side) this test fails.
    ///
    /// <para><c>dv.stages</c> is a BARE ARRAY of <see cref="StageDeltaVEntry"/>
    /// (tagged <c>isArray: true</c>), like the <c>science.*</c> channels;
    /// <c>dv.summary</c> is a single WRAPPER OBJECT (tagged
    /// <c>IsArray = false</c>). Mirrors <c>PartsContractShapeTests</c>'
    /// PE-metadata topic reader for the same reason: these types also carry the
    /// compile-time-only <c>[TsInterface]</c> attribute, so any managed
    /// attribute reflection would eagerly resolve Reinforced.Typings (never a
    /// runtime dependency) and throw.</para>
    /// </summary>
    public class StageDeltaVContractShapeTests
    {
        [Fact]
        public void StageDeltaVEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?>
                {
                    StageDict(0),
                    StageDict(1),
                },
                summary: SummaryDict());

            AssertArrayEntriesMirror(typeof(StageDeltaVEntry), StageDeltaVViewProvider.BuildStages(snapshot));
        }

        [Fact]
        public void StageDeltaVSummaryTypeMirrorsProviderWireShape()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?> { StageDict(0) },
                summary: SummaryDict());

            var root = Assert.IsType<Dictionary<string, object?>>(StageDeltaVViewProvider.BuildSummary(snapshot));

            // Wrapper object: its key set must equal StageDeltaVSummary's
            // camelCase'd props, and every emitted value's runtime type must
            // match the (Nullable-unwrapped) property type.
            AssertEntryMirrors(typeof(StageDeltaVSummary), root);
        }

        [Fact]
        public void PayloadTypesAreTaggedWithTheirTopics()
        {
            AssertTopicTag(typeof(StageDeltaVEntry), "dv.stages", expectArray: true);
            AssertTopicTag(typeof(StageDeltaVSummary), "dv.summary", expectArray: false);
        }

        // ----------------------------------------------------------------
        // Synthetic raw snapshot builders — the exact
        // Values["vessel"]["deltaV"] encoding KspHost.BuildDeltaV populates.
        // ----------------------------------------------------------------

        private static Dictionary<string, object?> StageDict(int stage) => new Dictionary<string, object?>
        {
            ["stage"] = stage,
            ["dvVac"] = 3200.0,
            ["dvAsl"] = 2800.0,
            ["dvActual"] = 3100.0,
            ["burnTime"] = 120.0,
            ["twrVac"] = 1.8,
            ["twrAsl"] = 1.5,
            ["twrActual"] = 1.7,
            ["thrustVac"] = 215.0,
            ["thrustAsl"] = 167.0,
            ["thrustActual"] = 205.0,
            ["startMass"] = 18.0,
            ["endMass"] = 9.0,
            ["dryMass"] = 6.5,
            ["fuelMass"] = 9.0,
            ["resources"] = new Dictionary<string, object?>
            {
                ["LiquidFuel"] = new Dictionary<string, object?> { ["current"] = 800.0, ["max"] = 1000.0 },
            },
        };

        private static Dictionary<string, object?> SummaryDict() => new Dictionary<string, object?>
        {
            ["stageCount"] = 2,
            ["totalDvVac"] = 6400.0,
            ["totalDvAsl"] = 5600.0,
            ["totalDvActual"] = 6200.0,
            ["totalBurnTime"] = 240.0,
        };

        private static KspSnapshot DeltaVSnapshot(List<object?> stages, Dictionary<string, object?> summary)
        {
            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["deltaV"] = new Dictionary<string, object?>
                        {
                            ["stages"] = stages,
                            ["summary"] = summary,
                        },
                    },
                },
            };
        }

        // ----------------------------------------------------------------
        // Shape helpers — mirror PartsContractShapeTests (per-test-file
        // duplication, matching that convention).
        // ----------------------------------------------------------------

        private static void AssertArrayEntriesMirror(Type entryType, object? payload)
        {
            var list = Assert.IsType<List<object?>>(payload);
            Assert.NotEmpty(list);
            foreach (var entry in list)
            {
                AssertEntryMirrors(entryType, Assert.IsType<Dictionary<string, object?>>(entry));
            }
        }

        private static void AssertEntryMirrors(Type entryType, Dictionary<string, object?> emitted)
        {
            var props = PropsByCamelCaseName(entryType);

            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

            foreach (var (key, value) in emitted)
            {
                var prop = props[key];
                var expected = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;

                if (prop.PropertyType.IsValueType)
                {
                    Assert.True(
                        Nullable.GetUnderlyingType(prop.PropertyType) != null,
                        $"{entryType.Name}.{prop.Name} must be nullable to mirror SnapshotDict's null-on-absence rule.");
                }

                if (value is not null)
                {
                    // Dictionary-shaped fields (e.g. StageDeltaVEntry.Resources,
                    // a per-resource-name map) are hand-built by the provider as
                    // an untyped Dictionary<string, object?> — the same tree
                    // shape JsonWriter walks for EVERY nested object, regardless
                    // of the strongly-typed nested contract type (ResourceAmount
                    // here) the mirror POCO declares. An exact IsInstanceOfType
                    // match is the wrong check for this case (it would require
                    // the provider to hand-construct ResourceAmount instances,
                    // which the hand-dict convention deliberately never does) —
                    // assert dictionary-SHAPE instead, matching how every other
                    // nested-record field in this class of provider is emitted.
                    if (expected.IsGenericType && expected.GetGenericTypeDefinition() == typeof(Dictionary<,>))
                    {
                        Assert.True(
                            value is System.Collections.IDictionary,
                            $"{entryType.Name}.{prop.Name} is a Dictionary but the provider emitted {value.GetType().Name} for \"{key}\".");
                    }
                    else
                    {
                        Assert.True(
                            expected.IsInstanceOfType(value),
                            $"{entryType.Name}.{prop.Name} is {expected.Name} but the provider emitted {value.GetType().Name} for \"{key}\".");
                    }
                }
            }
        }

        private static Dictionary<string, PropertyInfo> PropsByCamelCaseName(Type type) => type
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .ToDictionary(p => CamelCase(p.Name), p => p);

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);

        // ----------------------------------------------------------------
        // [SitrepTopic] tag reader — raw ECMA-335 metadata, NOT CLR attribute
        // reflection (the [TsInterface] hazard PartsContractShapeTests documents).
        // ----------------------------------------------------------------

        private static void AssertTopicTag(Type type, string expectedTopic, bool expectArray)
        {
            var tag = ReadTopicTag(type);
            Assert.True(tag.HasValue, $"{type.Name} is missing a [SitrepTopic] tag.");
            Assert.Equal(expectedTopic, tag!.Value.TopicId);
            Assert.Equal(expectArray, tag.Value.IsArray);
        }

        private static (string TopicId, bool IsArray)? ReadTopicTag(Type type)
        {
            using var stream = File.OpenRead(type.Assembly.Location);
            using var peReader = new PEReader(stream);
            var mr = peReader.GetMetadataReader();

            foreach (var typeHandle in mr.TypeDefinitions)
            {
                var typeDef = mr.GetTypeDefinition(typeHandle);
                var ns = mr.GetString(typeDef.Namespace);
                var name = mr.GetString(typeDef.Name);
                var fullName = string.IsNullOrEmpty(ns) ? name : ns + "." + name;
                if (fullName != type.FullName)
                {
                    continue;
                }

                foreach (var attrHandle in typeDef.GetCustomAttributes())
                {
                    var attribute = mr.GetCustomAttribute(attrHandle);
                    if (GetAttributeConstructorSimpleName(mr, attribute) != nameof(SitrepTopicAttribute))
                    {
                        continue;
                    }

                    var blob = mr.GetBlobReader(attribute.Value);
                    blob.ReadUInt16(); // prolog
                    var topicId = blob.ReadSerializedString();
                    var isArray = blob.ReadBoolean();
                    return (topicId ?? string.Empty, isArray);
                }

                return null; // matched the type, but it has no [SitrepTopic]
            }

            return null;
        }

        private static string? GetAttributeConstructorSimpleName(MetadataReader mr, CustomAttribute attribute)
        {
            if (attribute.Constructor.Kind == HandleKind.MethodDefinition)
            {
                var methodDef = mr.GetMethodDefinition((MethodDefinitionHandle)attribute.Constructor);
                var declaringType = mr.GetTypeDefinition(methodDef.GetDeclaringType());
                return mr.GetString(declaringType.Name);
            }

            if (attribute.Constructor.Kind == HandleKind.MemberReference)
            {
                var memberRef = mr.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
                if (memberRef.Parent.Kind != HandleKind.TypeReference)
                {
                    return null;
                }
                var typeRef = mr.GetTypeReference((TypeReferenceHandle)memberRef.Parent);
                return mr.GetString(typeRef.Name);
            }

            return null;
        }
    }
}
