using System;
using System.Collections.Generic;
using System.Collections.Immutable;
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
    /// Locks the P0.5 typing change for <c>career.status</c>: proves the named
    /// <see cref="CareerStatus"/> contract tree (and every nested type) mirrors
    /// — field name for field name, camelCase wire key for camelCase wire key,
    /// type for type — the EXACT serialized shape
    /// <see cref="CareerViewProvider"/> already emits. This is a typing change
    /// only: the wire is written by <c>JsonWriter</c> walking the provider's
    /// dictionary, NOT by serializing these POCOs, so if the two shapes ever
    /// drift (a field renamed, removed, added, re-cased, or retyped on either
    /// side) this test fails — the guarantee that the contract type a widget
    /// codes against is byte-identical to the wire.
    ///
    /// <para>Unlike the flat <c>science.*</c> array channels, <c>career.status</c>
    /// is a nested object tree with a dynamic-key facility map, so the
    /// assertion recurses: contract objects match a dictionary, list-typed
    /// properties match a <c>List&lt;object?&gt;</c> element by element, and the
    /// <see cref="CareerStatus.Facilities"/> <c>Dictionary&lt;string, T&gt;</c>
    /// matches an index-signature map value by value.</para>
    ///
    /// <para><b>Reflection discipline:</b> every wire type also carries the
    /// compile-time-only <c>[TsInterface]</c> attribute, whose declaring
    /// assembly (<c>Reinforced.Typings</c>) is never deployed at runtime. Any
    /// <c>GetCustomAttribute*</c> call on such a type eagerly resolves ALL its
    /// attribute records and throws <c>FileNotFoundException</c> — the same
    /// trap <see cref="ContractShapeGateTests"/> documents. So this test never
    /// reflects attributes on a contract type: nested-object detection uses
    /// assembly identity (property enumeration is safe), and the
    /// <c>[SitrepTopic]</c> tag is read straight from the assembly metadata.</para>
    /// </summary>
    public class CareerContractShapeTests
    {
        private static readonly Assembly ContractAssembly = typeof(CareerStatus).Assembly;

        [Fact]
        public void CareerStatusTypeMirrorsProviderWireShapeRecursively()
        {
            var payload = CareerViewProvider.BuildCareer(FullSyntheticSnapshot());
            AssertObjectMirrors(typeof(CareerStatus), payload);
        }

        [Fact]
        public void CareerStatusIsTaggedWithItsTopicAsAnObjectPayload()
        {
            var tag = ReadTopicTag(nameof(CareerStatus));
            Assert.NotNull(tag);
            Assert.Equal("career.status", tag!.Value.TopicId);
            Assert.False(tag.Value.IsArray, "career.status payload is a single object, not a bare array; IsArray must be false.");
        }

        // --- recursive mirror assertion ------------------------------------

        /// <summary>
        /// A contract OBJECT type must match a <c>Dictionary&lt;string, object?&gt;</c>:
        /// the emitted key set equals the type's camelCase'd public-property
        /// set (no extra, no missing), and each emitted value mirrors the
        /// corresponding property's type.
        /// </summary>
        private static void AssertObjectMirrors(Type contractType, object? emitted)
        {
            var dict = Assert.IsType<Dictionary<string, object?>>(emitted);

            var props = contractType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .ToDictionary(p => CamelCase(p.Name), p => p);

            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                dict.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

            foreach (var (key, value) in dict)
            {
                AssertValueMirrors($"{contractType.Name}.{props[key].Name}", props[key].PropertyType, value);
            }
        }

        private static void AssertValueMirrors(string path, Type propType, object? value)
        {
            // A null on the wire is legitimate for every optional field; its
            // KEY presence is already asserted by the containing object's key-set
            // check, and its inner structure is unverifiable, so stop here.
            if (value is null)
            {
                return;
            }

            var underlying = Nullable.GetUnderlyingType(propType) ?? propType;

            if (underlying.IsGenericType)
            {
                var def = underlying.GetGenericTypeDefinition();

                if (def == typeof(Dictionary<,>))
                {
                    // Dynamic-key map (e.g. CareerStatus.Facilities): each VALUE
                    // mirrors the map's value type.
                    var valueType = underlying.GetGenericArguments()[1];
                    var map = Assert.IsType<Dictionary<string, object?>>(value);
                    foreach (var (mapKey, mapValue) in map)
                    {
                        AssertValueMirrors($"{path}[{mapKey}]", valueType, mapValue);
                    }

                    return;
                }

                if (def == typeof(List<>))
                {
                    var elementType = underlying.GetGenericArguments()[0];
                    var list = Assert.IsType<List<object?>>(value);
                    for (var i = 0; i < list.Count; i++)
                    {
                        AssertValueMirrors($"{path}[{i}]", elementType, list[i]);
                    }

                    return;
                }
            }

            // A nested contract object — detected by assembly identity, NOT by
            // reflecting [SitrepContract] (that would resolve [TsInterface] and
            // throw; see the class doc). Contract types are the classes defined
            // in Sitrep.Contract; primitives/strings live in corelib.
            if (underlying.IsClass && underlying.Assembly == ContractAssembly)
            {
                AssertObjectMirrors(underlying, value);
                return;
            }

            // Scalar: the emitted runtime value must be an instance of the
            // property's (Nullable-unwrapped) type — catches a retype (e.g.
            // double declared where the provider emits int, or vice versa).
            Assert.True(
                underlying.IsInstanceOfType(value),
                $"{path} is {underlying.Name} but the provider emitted {value.GetType().Name}.");
        }

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);

        // --- [SitrepTopic] read via raw metadata ---------------------------
        // GetCustomAttribute would resolve Reinforced.Typings (never deployed)
        // and throw; the metadata reader inspects the blob without loading any
        // attribute's declaring assembly — the exact technique
        // ContractShapeGateTests uses for the [SitrepContract] marker.

        private static (string TopicId, bool IsArray)? ReadTopicTag(string typeSimpleName)
        {
            using var stream = File.OpenRead(ContractAssembly.Location);
            using var peReader = new PEReader(stream);
            var reader = peReader.GetMetadataReader();

            foreach (var typeHandle in reader.TypeDefinitions)
            {
                var typeDef = reader.GetTypeDefinition(typeHandle);
                if (reader.GetString(typeDef.Name) != typeSimpleName)
                {
                    continue;
                }

                foreach (var attrHandle in typeDef.GetCustomAttributes())
                {
                    var attribute = reader.GetCustomAttribute(attrHandle);
                    if (AttributeCtorSimpleName(reader, attribute) != nameof(SitrepTopicAttribute))
                    {
                        continue;
                    }

                    var decoded = attribute.DecodeValue(StringTypeProvider.Instance);
                    var topicId = (string)decoded.FixedArguments[0].Value!;
                    var isArray = decoded.FixedArguments.Length > 1 && decoded.FixedArguments[1].Value is true;
                    return (topicId, isArray);
                }
            }

            return null;
        }

        private static string? AttributeCtorSimpleName(MetadataReader reader, CustomAttribute attribute)
        {
            switch (attribute.Constructor.Kind)
            {
                case HandleKind.MemberReference:
                    var memberRef = reader.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
                    if (memberRef.Parent.Kind != HandleKind.TypeReference)
                    {
                        return null;
                    }

                    var typeRef = reader.GetTypeReference((TypeReferenceHandle)memberRef.Parent);
                    return reader.GetString(typeRef.Name);

                case HandleKind.MethodDefinition:
                    var methodDef = reader.GetMethodDefinition((MethodDefinitionHandle)attribute.Constructor);
                    var declaringType = reader.GetTypeDefinition(methodDef.GetDeclaringType());
                    return reader.GetString(declaringType.Name);

                default:
                    return null;
            }
        }

        /// <summary>
        /// Minimal <see cref="ICustomAttributeTypeProvider{T}"/> for decoding
        /// the <c>[SitrepTopic(string, bool)]</c> blob — only primitive
        /// (string / bool) fixed arguments occur, so the type-shaped members
        /// need only be well-formed, never meaningful.
        /// </summary>
        private sealed class StringTypeProvider : ICustomAttributeTypeProvider<string>
        {
            public static readonly StringTypeProvider Instance = new();

            public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString();

            public string GetSystemType() => "System.Type";

            public string GetSZArrayType(string elementType) => elementType + "[]";

            public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
                reader.GetString(reader.GetTypeDefinition(handle).Name);

            public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
                reader.GetString(reader.GetTypeReference(handle).Name);

            public string GetTypeFromSerializedName(string name) => name;

            public PrimitiveTypeCode GetUnderlyingEnumType(string type) => PrimitiveTypeCode.Int32;

            public bool IsSystemType(string type) => type == "System.Type";
        }

        // --- fully-populated fixture ---------------------------------------
        // Every field of every nested type is present and non-null so the
        // recursion reaches — and type-checks — every branch. Absence / null /
        // sandbox behaviour is covered by CareerViewProviderTests.

        private static KspSnapshot FullSyntheticSnapshot() => new KspSnapshot
        {
            Ut = 12345.0,
            Values = new Dictionary<string, object?>
            {
                ["career"] = new Dictionary<string, object?>
                {
                    ["economy"] = new Dictionary<string, object?>
                    {
                        ["funds"] = 125_000.5,
                        ["reputation"] = 42.0,
                        ["science"] = 310.25,
                    },
                    ["facilities"] = new Dictionary<string, object?>
                    {
                        ["LaunchPad"] = new Dictionary<string, object?>
                        {
                            ["currentTier"] = 1,
                            ["maxTier"] = 2,
                            ["upgradeCost"] = 74_000.0,
                        },
                        ["VehicleAssemblyBuilding"] = new Dictionary<string, object?>
                        {
                            ["currentTier"] = 0,
                            ["maxTier"] = 2,
                            ["upgradeCost"] = 112_000.0,
                        },
                    },
                    ["contracts"] = new Dictionary<string, object?>
                    {
                        ["active"] = new List<object?> { ContractDict("123456789012345", "Active") },
                        ["offered"] = new List<object?> { ContractDict("987654321098765", "Offered") },
                    },
                    ["strategies"] = new Dictionary<string, object?>
                    {
                        ["active"] = new List<object?> { StrategyDict() },
                        ["all"] = new List<object?> { StrategyDict() },
                        ["activeCount"] = 1,
                    },
                    ["tech"] = new Dictionary<string, object?>
                    {
                        ["unlockedCount"] = 2,
                        ["unlockedIds"] = new List<object?> { "start", "basicRocketry" },
                        ["nodes"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["id"] = "basicRocketry",
                                ["title"] = "Basic Rocketry",
                                ["scienceCost"] = 5.0,
                                ["unlocked"] = true,
                                ["parents"] = new List<object?> { "start" },
                            },
                        },
                    },
                },
            },
        };

        private static Dictionary<string, object?> ContractDict(string id, string state) => new Dictionary<string, object?>
        {
            ["id"] = id,
            ["title"] = "Rescue Jebediah Kerman",
            ["agent"] = "Kerbin Rescue Corps",
            ["state"] = state,
            ["fundsAdvance"] = 5000.0,
            ["fundsCompletion"] = 15000.0,
            ["fundsFailure"] = 2500.0,
            ["scienceCompletion"] = 25.0,
            ["reputationCompletion"] = 10.0,
            ["reputationFailure"] = 5.0,
            ["dateAccepted"] = 1000.0,
            ["dateDeadline"] = 500000.0,
            ["dateExpire"] = 600000.0,
            ["parameters"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["title"] = "Rescue Jebediah Kerman from orbit",
                    ["state"] = "Incomplete",
                },
            },
        };

        private static Dictionary<string, object?> StrategyDict() => new Dictionary<string, object?>
        {
            ["id"] = "OutsourceRnDStrategy",
            ["title"] = "Outsourced R&D",
            ["description"] = "Outsource research to third parties.",
            ["department"] = "Science",
            ["isActive"] = true,
            ["factor"] = 0.75,
            ["dateActivated"] = 5000.0,
            ["requiredReputation"] = 0.0,
            ["initialCostFunds"] = 0.0,
            ["initialCostScience"] = 0.0,
            ["initialCostReputation"] = 10.0,
            ["hasFactorSlider"] = true,
            ["factorSliderDefault"] = 0.5,
            ["factorSliderSteps"] = 10,
            ["canActivate"] = false,
            ["activateBlockedReason"] = "Already active",
            ["canDeactivate"] = true,
            ["deactivateBlockedReason"] = "",
            ["effect"] = "Converts science into funds.",
        };
    }
}
