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
    /// Locks the P0.5 typing change for the Breaking Ground uplink's
    /// <c>robotics.*</c>/<c>deployed.*</c> channels: proves the named
    /// <c>Sitrep.Contract</c> payload types (<see cref="ServoEntry"/>,
    /// <see cref="RoboticsAvailability"/>, <see cref="DeployedEntry"/>) mirror,
    /// field name for field name, camelCase wire key for camelCase wire key,
    /// type for type, the EXACT serialized shape
    /// <see cref="BreakingGroundViewProvider"/> already emits. This is a
    /// typing change only: the wire is written by <c>JsonWriter</c> walking
    /// the provider's dictionary, not by serializing these POCOs, so if the
    /// two shapes ever drift (a field renamed, removed, added, or retyped on
    /// either side) this test fails.
    ///
    /// <para>Split out of <c>PartsContractShapeTests</c> (<see cref="ServoEntry"/>/
    /// <see cref="RoboticsAvailability"/>) and <c>ScienceContractShapeTests</c>
    /// (<see cref="DeployedEntry"/>) alongside the Breaking Ground uplink
    /// extraction: all three are BARE ARRAYS (or, for
    /// <see cref="RoboticsAvailability"/>, a single wrapper object), tagged
    /// via <c>[SitrepTopic]</c> as documented on each type.</para>
    /// </summary>
    public class BreakingGroundContractShapeTests
    {
        [Fact]
        public void ServoEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = PartsSnapshot(robotics: new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["partName"] = "Rotation Servo Rotor M",
                    ["partId"] = "2001",
                    ["type"] = "rotor",
                    ["servoIsLocked"] = false,
                    ["servoIsMotorized"] = true,
                    ["servoMotorIsEngaged"] = true,
                    ["servoMotorLimit"] = 100.0,
                    ["motorState"] = "Moving",
                    ["currentAngle"] = 12.0,
                    ["targetAngle"] = 90.0,
                    ["traverseVelocity"] = 15.0,
                    ["currentRPM"] = 12.5,
                    ["rpmLimit"] = 60.0,
                    ["normalizedOutput"] = 0.2,
                    ["brakePercentage"] = 100.0,
                    ["currentExtension"] = 0.5,
                    ["targetExtension"] = 1.0,
                },
            });

            AssertArrayEntriesMirror(typeof(ServoEntry), BreakingGroundViewProvider.BuildRobotics(snapshot));
        }

        [Fact]
        public void RoboticsAvailabilityTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?> { ["roboticsAvailable"] = true },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));

            // Wrapper object: its key set must equal RoboticsAvailability's
            // camelCase'd props, and the emitted value's runtime type must
            // match the (Nullable-unwrapped) property type.
            AssertKeysMatchType(typeof(RoboticsAvailability), root);
            Assert.IsType<bool>(root["available"]);
        }

        [Fact]
        public void DeployedEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["deployed"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["vesselName"] = "Probodobodyne Experiment Control Station",
                                ["partName"] = "Atmospheric Fluid Spectro-Variometer",
                                ["body"] = "Mun",
                                ["situation"] = "LANDED",
                                ["biome"] = "Highlands",
                                ["experimentId"] = "surfaceExperimentAtmosphericFluidSpectroVariometer",
                                ["scienceCompletedPercentage"] = 42.5,
                                ["scienceTransmittedPercentage"] = 10.0,
                                ["scienceValue"] = 8.0,
                                ["scienceLimit"] = 20.0,
                                ["powerState"] = "Powered",
                                ["connectionState"] = "Connected",
                                ["deployedOnGround"] = true,
                            },
                        },
                    },
                },
            };

            AssertArrayEntriesMirror(typeof(DeployedEntry), BreakingGroundViewProvider.BuildDeployed(snapshot));
        }

        [Fact]
        public void PayloadTypesAreTaggedWithTheirTopics()
        {
            AssertTopicTag(typeof(ServoEntry), "robotics.servos", expectArray: true);
            AssertTopicTag(typeof(RoboticsAvailability), "robotics.available", expectArray: false);
            AssertTopicTag(typeof(DeployedEntry), "deployed.bases", expectArray: true);
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

        private static KspSnapshot PartsSnapshot(List<object?>? robotics = null)
        {
            var parts = new Dictionary<string, object?>();
            if (robotics != null)
            {
                parts["robotics"] = robotics;
            }

            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["parts"] = parts },
            };
        }

        /// <summary>
        /// The emitted array's single entry must mirror <paramref name="entryType"/>
        /// field-for-field: its key set equals the type's camelCase'd
        /// property-name set (no extra, no missing), and every emitted non-null
        /// value's runtime type matches the corresponding property's
        /// (Nullable-unwrapped) type. Also asserts every value-typed property is
        /// nullable, mirroring <c>SnapshotDict.Get*</c>'s null-on-absence rule.
        /// </summary>
        private static void AssertArrayEntriesMirror(Type entryType, object? payload)
        {
            var list = Assert.IsType<List<object?>>(payload);
            var emitted = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            AssertEntryMirrors(entryType, emitted);
        }

        private static void AssertKeysMatchType(Type type, Dictionary<string, object?> emitted)
        {
            var props = PropsByCamelCaseName(type);
            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
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
                    Assert.True(
                        expected.IsInstanceOfType(value),
                        $"{entryType.Name}.{prop.Name} is {expected.Name} but the provider emitted {value.GetType().Name} for \"{key}\".");
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
    }
}
