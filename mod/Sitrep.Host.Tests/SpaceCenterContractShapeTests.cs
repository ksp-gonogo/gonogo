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
    /// Locks the typing for <c>spaceCenter.*</c>: proves the named
    /// <c>Sitrep.Contract</c> payload types (<see cref="LaunchSiteEntry"/>,
    /// <see cref="SpaceCenterScene"/>) mirror — field name for field name,
    /// camelCase wire key for camelCase wire key, type for type — the EXACT
    /// serialized shape <see cref="SpaceCenterViewProvider"/> already emits.
    /// This is the ToWire-completeness guard for this provider: it hand-builds
    /// dicts (no separate <c>ToWire</c> method), so binding the POCO field set
    /// to the emitted dict keys at run time is what catches a drift (a field
    /// renamed/removed/added/retyped on either side).
    ///
    /// <para><c>spaceCenter.launchSites</c> is a BARE ARRAY of
    /// <see cref="LaunchSiteEntry"/> (tagged <c>isArray: true</c>), like the
    /// <c>science.*</c> channels; <c>spaceCenter.scene</c> is a single WRAPPER
    /// OBJECT (<c>isArray: false</c>).</para>
    /// </summary>
    public class SpaceCenterContractShapeTests
    {
        [Fact]
        public void LaunchSiteEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                    },
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["launchSites"] = new List<object?>
                        {
                            // Fully-populated stock pad entry: exercises every
                            // field's non-null runtime type against the POCO.
                            new Dictionary<string, object?>
                            {
                                ["name"] = "LaunchPad",
                                ["displayName"] = "Launch Pad",
                                ["editorFacility"] = "VAB",
                                ["body"] = "Kerbin",
                                ["isStock"] = true,
                                ["padOccupied"] = true,
                                ["padVesselTitle"] = "Kerbal X",
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildLaunchSites(snapshot));
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            AssertEntryMirrors(typeof(LaunchSiteEntry), entry);
        }

        [Fact]
        public void SpaceCenterSceneTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["scene"] = "FLIGHT" },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildScene(snapshot));

            AssertKeysMatchType(typeof(SpaceCenterScene), root);
            Assert.IsType<string>(root["scene"]);
        }

        [Fact]
        public void CrewRosterEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Jebediah Kerman",
                                ["trait"] = "Pilot",
                                ["experienceLevel"] = 3,
                                ["rosterStatus"] = "Available",
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(snapshot));
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            AssertEntryMirrors(typeof(CrewRosterEntry), entry);
        }

        [Fact]
        public void SavedShipEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["savedShips"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Kerbal X",
                                ["partCount"] = 42,
                                ["totalMass"] = 18.5,
                                ["facility"] = "VAB",
                                ["requiresFunds"] = 12345.0,
                                ["missingParts"] = new List<object?> { "someMissingPart" },
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildSavedShips(snapshot));
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            AssertEntryMirrors(typeof(SavedShipEntry), entry);
        }

        [Fact]
        public void PartsAvailableTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?> { ["partsAvailable"] = 137 },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildPartsAvailable(snapshot));

            AssertKeysMatchType(typeof(SpaceCenterPartsAvailable), root);
            Assert.IsType<int>(root["count"]);
        }

        [Fact]
        public void SpaceCenterPoiEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                    },
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["launchSites"] = new List<object?>
                        {
                            // ksc/launchSite kind: exercises id/kind/bodyIndex/
                            // latitude/longitude/label with the contract-only
                            // fields (status/contractAgent/...) null.
                            new Dictionary<string, object?>
                            {
                                ["name"] = "LaunchPad",
                                ["displayName"] = "Launch Pad",
                                ["editorFacility"] = "VAB",
                                ["body"] = "Kerbin",
                                ["isStock"] = true,
                                ["padOccupied"] = true,
                                ["padVesselTitle"] = "Kerbal X",
                                ["latitude"] = -0.5,
                                ["longitude"] = 74.7,
                            },
                        },
                        ["contractTargets"] = new List<object?>
                        {
                            // contractTarget kind: exercises status/
                            // contractAgent/contractFundsAdvance/
                            // contractFundsCompletion/contractDateDeadline —
                            // fields the launch-site entry above leaves null.
                            new Dictionary<string, object?>
                            {
                                ["navigationId"] = "wp-1",
                                ["celestialName"] = "Kerbin",
                                ["latitude"] = 12.3,
                                ["longitude"] = 45.6,
                                ["isOnSurface"] = true,
                                ["contractState"] = "Active",
                                ["contractTitle"] = "Survey the flats",
                                ["contractAgent"] = "Kerbin Survey Corps",
                                ["contractFundsAdvance"] = 1000.0,
                                ["contractFundsCompletion"] = 5000.0,
                                ["contractDateDeadline"] = 12345.0,
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildPois(snapshot));
            Assert.Equal(2, list.Count);
            foreach (var rawEntry in list)
            {
                var entry = Assert.IsType<Dictionary<string, object?>>(rawEntry);
                AssertEntryMirrors(typeof(SpaceCenterPoiEntry), entry);
            }
        }

        [Fact]
        public void PayloadTypesAreTaggedWithTheirTopics()
        {
            AssertTopicTag(typeof(LaunchSiteEntry), "spaceCenter.launchSites", expectArray: true);
            AssertTopicTag(typeof(SpaceCenterScene), "spaceCenter.scene", expectArray: false);
            AssertTopicTag(typeof(CrewRosterEntry), "spaceCenter.crewRoster", expectArray: true);
            AssertTopicTag(typeof(SavedShipEntry), "spaceCenter.savedShips", expectArray: true);
            AssertTopicTag(typeof(SpaceCenterPartsAvailable), "spaceCenter.partsAvailable", expectArray: false);
            AssertTopicTag(typeof(SpaceCenterPoiEntry), "spaceCenter.pois", expectArray: true);
        }

        // ----------------------------------------------------------------
        // Helpers — copied from PartsContractShapeTests (the PE-metadata
        // reader + camelCase mirror), which documents why raw ECMA-335
        // metadata is read instead of CLR attribute reflection (the payload
        // types also carry the compile-time-only [TsInterface] attribute,
        // whose assembly isn't loadable at test runtime).
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
                    // A collection-typed POCO field (e.g. string[] MissingParts)
                    // mirrors a List<object?> the provider hand-builds — the
                    // element type is object? on the wire, so assert the shape is
                    // enumerable rather than an exact generic-type match.
                    if (expected.IsArray || (expected.IsGenericType && typeof(System.Collections.IEnumerable).IsAssignableFrom(expected) && expected != typeof(string)))
                    {
                        Assert.True(
                            value is System.Collections.IEnumerable,
                            $"{entryType.Name}.{prop.Name} is a collection but the provider emitted a non-enumerable {value.GetType().Name} for \"{key}\".");
                        continue;
                    }

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
