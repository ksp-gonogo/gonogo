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
    /// Locks the P0.5 typing change for <c>parts.*</c>: proves the named
    /// <c>Sitrep.Contract</c> payload types (<see cref="PartsPower"/> and its
    /// nested <see cref="SolarPanelEntry"/>/<see cref="BatteryEntry"/>/
    /// <see cref="FuelCellEntry"/>/<see cref="AlternatorEntry"/>, plus
    /// <see cref="ServoEntry"/>) mirror — field name for field name, camelCase
    /// wire key for camelCase wire key, type for type — the EXACT serialized
    /// shape <see cref="PartsViewProvider"/> already emits. This is a typing
    /// change only: the wire is written by <c>JsonWriter</c> walking the
    /// provider's dictionary, not by serializing these POCOs, so if the two
    /// shapes ever drift (a field renamed, removed, added, or retyped on either
    /// side) this test fails.
    ///
    /// <para><c>parts.power</c> is a single WRAPPER OBJECT (tagged
    /// <c>IsArray = false</c>) whose four arrays hold the nested entry types;
    /// <c>parts.robotics</c> is a BARE ARRAY of <see cref="ServoEntry"/>
    /// (tagged <c>isArray: true</c>), like the <c>science.*</c> channels.</para>
    /// </summary>
    public class PartsContractShapeTests
    {
        [Fact]
        public void PartsPowerTypeMirrorsProviderWireShape()
        {
            var snapshot = PartsSnapshot(power: new Dictionary<string, object?>
            {
                ["solarPanels"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["partName"] = "OX-STAT Photovoltaic Panels",
                        ["partId"] = "1001",
                        ["deployState"] = "EXTENDED",
                        ["flowRate"] = 1.6,
                        ["chargeRate"] = 2.0,
                        ["sunAOA"] = 0.95,
                    },
                },
                ["batteries"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["partName"] = "Z-200 Battery Pack",
                        ["partId"] = "1002",
                        ["current"] = 150.0,
                        ["max"] = 200.0,
                    },
                },
                ["fuelCells"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["partName"] = "Fuel Cell",
                        ["partId"] = "1003",
                        ["active"] = true,
                        ["status"] = "Nominal",
                    },
                },
                ["alternators"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["partName"] = "LV-909 \"Terrier\" Liquid Fuel Engine",
                        ["partId"] = "1004",
                        ["outputRate"] = 4.0,
                    },
                },
                ["totalProductionEc"] = 5.6,
            });

            var root = Assert.IsType<Dictionary<string, object?>>(PartsViewProvider.BuildPower(snapshot));

            // Top-level object keys must equal PartsPower's camelCase'd props.
            AssertKeysMatchType(typeof(PartsPower), root);

            // Each array key resolves to its element type; every emitted entry
            // must mirror that element type field-for-field.
            AssertArrayEntriesMirror(typeof(SolarPanelEntry), root["solarPanels"]);
            AssertArrayEntriesMirror(typeof(BatteryEntry), root["batteries"]);
            AssertArrayEntriesMirror(typeof(FuelCellEntry), root["fuelCells"]);
            AssertArrayEntriesMirror(typeof(AlternatorEntry), root["alternators"]);

            // The scalar total is a double on the wire, mirrored as double?.
            Assert.IsType<double>(root["totalProductionEc"]);
        }

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

            AssertArrayEntriesMirror(typeof(ServoEntry), PartsViewProvider.BuildRobotics(snapshot));
        }

        [Fact]
        public void PayloadTypesAreTaggedWithTheirTopics()
        {
            AssertTopicTag(typeof(PartsPower), "parts.power", expectArray: false);
            AssertTopicTag(typeof(ServoEntry), "parts.robotics", expectArray: true);
        }

        private static void AssertTopicTag(Type type, string expectedTopic, bool expectArray)
        {
            // Read the [SitrepTopic] tag via raw ECMA-335 metadata rather than
            // CLR attribute reflection: these payload types ALSO carry the
            // compile-time-only [TsInterface] attribute, and any managed
            // GetCustomAttribute*/CustomAttributeData call eagerly resolves
            // EVERY attribute on the type (throwing FileNotFoundException for
            // Reinforced.Typings, which is never a runtime dependency) — the
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
                    // arguments in declared order — a SerString and a 1-byte
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

        private static KspSnapshot PartsSnapshot(
            Dictionary<string, object?>? power = null,
            List<object?>? robotics = null)
        {
            var parts = new Dictionary<string, object?>();
            if (power != null)
            {
                parts["power"] = power;
            }
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
