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
    /// Locks the <c>vessel.parts</c> typing: proves the named
    /// <see cref="VesselParts"/>/<see cref="VesselPart"/>/<see cref="PartBounds"/>
    /// contract POCOs mirror — field name for field name, camelCase wire key for
    /// camelCase wire key — the EXACT serialized shape
    /// <see cref="VesselPartsViewProvider.BuildPartsWire"/> emits. This is the
    /// ToWire-completeness guard: add a POCO field, add a wire key, or this goes
    /// RED (an emitted key with no property, or a property with no emitted key).
    /// The wire is written by <c>JsonWriter</c> walking the provider's
    /// dictionary, not by serializing these POCOs, so drift between the two
    /// shapes is exactly what this catches.
    /// </summary>
    public class VesselPartsContractShapeTests
    {
        [Fact]
        public void VesselPartTypeMirrorsProviderWireShape()
        {
            var wire = VesselPartsViewProvider.BuildPartsWire(Snapshot());
            var root = Assert.IsType<Dictionary<string, object?>>(wire);

            // Wrapper object keys == VesselParts' camelCase'd props.
            AssertKeysMatchType(typeof(VesselParts), root);

            var parts = Assert.IsType<List<object?>>(root["parts"]);
            var part = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parts));

            // Per-part dict keys == VesselPart's camelCase'd props (no extra,
            // no missing) — the completeness guard.
            AssertPartMirrors(part);

            // Nested Vec3 / PartBounds sub-objects are themselves dict-shaped.
            var bounds = Assert.IsType<Dictionary<string, object?>>(part["bounds"]);
            AssertKeysMatchType(typeof(PartBounds), bounds);
            AssertVec3(part["position"]);
            AssertVec3(part["up"]);
            AssertVec3(bounds["size"]);
            AssertVec3(bounds["center"]);
        }

        [Fact]
        public void PayloadTypeIsTaggedWithItsTopic()
        {
            AssertTopicTag(typeof(VesselParts), "vessel.parts", expectArray: false);
        }

        private static KspSnapshot Snapshot() => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = "abc" },
                    ["topology"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["id"] = "1",
                            ["parentId"] = null,
                            ["name"] = "mk1pod",
                            ["title"] = "Mk1 Command Pod",
                            ["position"] = new double[] { 0.0, 1.0, 2.0 },
                            ["up"] = new double[] { 0.0, 1.0, 0.0 },
                            ["bounds"] = new Dictionary<string, object?>
                            {
                                ["size"] = new double[] { 1.0, 1.2, 1.0 },
                                ["center"] = new double[] { 0.0, 0.1, 0.0 },
                            },
                            ["dryMass"] = 0.84,
                            ["inverseStage"] = 0,
                            ["maxTemp"] = 2400.0,
                            ["skinMaxTemp"] = 2500.0,
                            ["currentTemp"] = 300.0,
                            ["skinTemp"] = 305.0,
                            ["category"] = "Pods",
                            ["modules"] = new List<object?> { "ModuleCommand" },
                            ["isRobotics"] = false,
                            ["isPowerRelated"] = false,
                            ["fuelLineTargetId"] = null,
                        },
                    },
                },
            },
        };

        /// <summary>
        /// The emitted per-part dict's key set must equal <see cref="VesselPart"/>'s
        /// camelCase'd property set, and every emitted scalar value's runtime type
        /// must match the (Nullable-unwrapped) property type. Nested-object props
        /// (<c>position</c>/<c>up</c>/<c>bounds</c>, whose property types are
        /// <see cref="Vec3"/>/<see cref="PartBounds"/>) are dict-shaped on the
        /// wire, so their runtime type is asserted by the caller instead.
        /// </summary>
        private static void AssertPartMirrors(Dictionary<string, object?> emitted)
        {
            var props = PropsByCamelCaseName(typeof(VesselPart));

            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

            var nestedObjectKeys = new HashSet<string> { "position", "up", "bounds" };

            foreach (var (key, value) in emitted)
            {
                if (nestedObjectKeys.Contains(key) || value is null)
                {
                    continue;
                }

                var prop = props[key];
                var expected = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;

                // List<string> Modules serializes to a List<object?>.
                if (expected == typeof(List<string>))
                {
                    Assert.IsType<List<object?>>(value);
                    continue;
                }

                Assert.True(
                    expected.IsInstanceOfType(value),
                    $"VesselPart.{prop.Name} is {expected.Name} but the provider emitted {value.GetType().Name} for \"{key}\".");
            }
        }

        private static void AssertVec3(object? value)
        {
            if (value is null)
            {
                return;
            }
            var vec = Assert.IsType<Dictionary<string, object?>>(value);
            Assert.Equal(new[] { "x", "y", "z" }, vec.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
        }

        private static void AssertKeysMatchType(Type type, Dictionary<string, object?> emitted)
        {
            var props = PropsByCamelCaseName(type);
            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
        }

        private static Dictionary<string, PropertyInfo> PropsByCamelCaseName(Type type) => type
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .ToDictionary(p => CamelCase(p.Name), p => p);

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);

        // ---- PE-metadata [SitrepTopic] reader — copied from
        // PartsContractShapeTests (see its doc comment for why CLR attribute
        // reflection can't be used on these [TsInterface]-tagged types). ----

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

                return null;
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
