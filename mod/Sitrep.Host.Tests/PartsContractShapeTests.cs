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
    /// Locks the P0.5 typing change for <c>parts.power</c>: proves the named
    /// <c>Sitrep.Contract</c> payload type (<see cref="PartsPower"/>) mirrors:
    /// field name for field name, camelCase wire key for camelCase wire key,
    /// type for type, the EXACT serialized shape <see cref="PartsViewProvider"/>
    /// already emits. This is a typing change only: the wire is written by
    /// <c>JsonWriter</c> walking the provider's dictionary, not by serializing
    /// these POCOs, so if the two shapes ever drift (a field renamed, removed,
    /// added, or retyped on either side) this test fails.
    ///
    /// <para><c>parts.power</c> is a single object (tagged
    /// <c>IsArray = false</c>). The sibling <see cref="ServoEntry"/>/<see cref="RoboticsAvailability"/>
    /// shape tests that used to live here moved to
    /// <c>BreakingGroundContractShapeTests</c> alongside the split-out
    /// <see cref="BreakingGroundViewProvider"/>.</para>
    /// </summary>
    public class PartsContractShapeTests
    {
        [Fact]
        public void PartsPowerTypeMirrorsProviderWireShape()
        {
            var snapshot = PartsSnapshot(power: new Dictionary<string, object?>
            {
                ["totalProductionEc"] = 5.6,
            });

            var root = Assert.IsType<Dictionary<string, object?>>(PartsViewProvider.BuildPower(snapshot));

            // Top-level object keys must equal PartsPower's camelCase'd props.
            AssertKeysMatchType(typeof(PartsPower), root);

            // The scalar total is a double on the wire, mirrored as double?.
            Assert.IsType<double>(root["totalProductionEc"]);
        }

        [Fact]
        public void PayloadTypesAreTaggedWithTheirTopics()
        {
            AssertTopicTag(typeof(PartsPower), "parts.power", expectArray: false);
        }

        private static void AssertTopicTag(Type type, string expectedTopic, bool expectArray)
        {
            // Read the [SitrepTopic] tag via raw ECMA-335 metadata rather than
            // CLR attribute reflection: these payload types ALSO carry the
            // compile-time-only [TsInterface] attribute, and any managed
            // GetCustomAttribute*/CustomAttributeData call eagerly resolves
            // EVERY attribute on the type (throwing FileNotFoundException for
            // Reinforced.Typings, which is never a runtime dependency), the
            // exact hazard ContractShapeGateTests documents and works around
            // the same way. Reading the PE metadata only ever needs the
            // attribute constructor's simple name and its blob bytes; it never
            // resolves the attribute to a live Type.
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

                    // Blob layout for [SitrepTopic(string topicId, bool isArray = false)]:
                    // a 2-byte prolog (0x0001), then the two fixed constructor
                    // arguments in declared order: a SerString and a 1-byte
                    // bool. The C# compiler bakes the defaulted optional arg
                    // into the blob as a fixed argument, so both usages
                    // ([SitrepTopic("x")] and [SitrepTopic("x", isArray: true)])
                    // carry both fixed args.
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
            // SitrepTopicAttribute is defined in Sitrep.Contract itself (same
            // module as the tagged types), so its constructor token is a
            // MethodDefinition; a MemberReference is handled too for safety.
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

        private static KspSnapshot PartsSnapshot(Dictionary<string, object?>? power = null)
        {
            var parts = new Dictionary<string, object?>();
            if (power != null)
            {
                parts["power"] = power;
            }

            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["parts"] = parts },
            };
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
    }
}
