using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The POCO-to-wire PARITY gate for every contract type that is published
    /// RAW: a property declared on the type but never written by that type's
    /// hand-written <c>JsonWriter.Append&lt;Type&gt;</c> flattener reaches the
    /// generated TS SDK (which is produced from the C# shape) and never reaches
    /// the wire. A widget then codes against a field that is permanently
    /// undefined, with nothing red anywhere.
    ///
    /// <para>This is the sibling of, and does not overlap,
    /// <see cref="WirePayloadCoverageTests"/>: that one asks "does this type
    /// serialize AT ALL" (is there a case, or does the wire boundary throw and
    /// silently drop the frame). This one asks "does it serialize
    /// COMPLETELY". The two bug classes are independent, a type can have a
    /// perfectly working flattener that is missing its newest field.</para>
    ///
    /// <para>It also does not overlap the producer-side parity gates, which
    /// cover the OTHER half of the contract, the types whose producer
    /// hand-flattens them to a <c>Dictionary&lt;string, object?&gt;</c> before
    /// Publish (so JsonWriter only ever sees the dictionary):
    /// <c>Sitrep.Host.Tests.VesselViewProviderTests.ToWireIncludesAKeyForEveryPublicReadablePropertyOfThePoco</c>
    /// for <c>vessel.*</c>, <c>ScienceContractShapeTests</c> for
    /// <c>science.*</c>, <c>BreakingGroundContractShapeTests</c> for
    /// <c>deployed.bases</c>/<c>robotics.*</c>. Between them and this file, both
    /// halves of "declared in the contract, absent from the wire" are now
    /// covered.</para>
    ///
    /// <para><b>Polarity: everything IN by default.</b> The universe is
    /// discovered, not listed: every <see cref="SitrepContractAttribute"/> type
    /// in the contract assembly that survives the real wire path without
    /// throwing IS a raw-published type, which is exactly the set with a
    /// hand-written flattener. Add a new <c>Append&lt;Type&gt;</c> and its type
    /// enrols itself here; add a field to an existing one and forget the
    /// flattener line and this goes red. Nothing has to be remembered.</para>
    ///
    /// <para>The two contract types the discovery cannot reach are
    /// <see cref="Meta"/> and <see cref="PayloadMeta"/>: neither is a payload,
    /// both are written field-by-field by <see cref="EnvelopeCodec"/> itself
    /// rather than through the payload switch, and their wire shape is pinned
    /// directly by <c>VesselViewProviderTests</c>'s payload-meta tests.</para>
    /// </summary>
    public class JsonWriterFlattenerParityTests
    {
        /// <summary>
        /// Properties that are DELIBERATELY absent from the wire, as
        /// <c>"TypeName.PropertyName"</c>. Same polarity and same rule as
        /// <see cref="WirePayloadCoverageTests"/>'s <c>FlattenedByProducer</c>:
        /// everything is in by default and every exclusion carries its reason
        /// here, in one line, so an entry can be argued with later.
        ///
        /// <para>An entry is NOT a licence to leave a field off the wire. It
        /// records a field that is knowingly declared ahead of its producer, or
        /// one whose absence is itself pinned as bytes elsewhere. A genuine
        /// omission gets the missing flattener line, not an entry.</para>
        /// </summary>
        private static readonly HashSet<string> DeliberatelyNotOnTheWire = new()
        {
            // (empty: every raw-published contract type is currently at full
            // parity with its flattener. Kept, with this comment, because the
            // NEXT field added ahead of its producer needs somewhere honest to
            // go, and the alternative is someone quietly deleting the
            // assertion.)
        };

        /// <summary>
        /// Every raw-published payload type: a <see cref="SitrepContractAttribute"/>
        /// type that goes through the real stream-data wire path without the
        /// payload switch throwing. Hitting the switch's default-throw is what
        /// identifies a producer-flattened / envelope / inbound-only type, and
        /// that is <see cref="WirePayloadCoverageTests"/>'s subject rather than
        /// this file's, so it is skipped here instead of being listed.
        /// </summary>
        public static IEnumerable<object[]> RawPublishedTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // IsDefined for THIS attribute only: it does not construct the
                // sibling Reinforced.Typings [TsInterface] (whose assembly is
                // not loadable in this net10.0 test), unlike
                // GetCustomAttributesData(). Same guard WirePayloadCoverageTests
                // documents.
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false))
                .Where(t => t.GetConstructor(Type.EmptyTypes) != null)
                .Where(SerializesRaw)
                .OrderBy(t => t.Name, StringComparer.Ordinal)
                .Select(t => new object[] { t.Name });

        [Theory]
        [MemberData(nameof(RawPublishedTypes))]
        public void EveryPublicReadablePropertyReachesTheWire(string typeName)
        {
            var type = typeof(CommsDelay).Assembly.GetType("Sitrep.Contract." + typeName, throwOnError: true)!;

            // Populated, not default-constructed: a flattener that writes a
            // field only when it is non-null (the shape
            // AppendProviderExtensions deliberately has) would otherwise pass
            // on an all-null instance and hide the omission.
            var payload = Populate(type);
            var wire = WirePayloadObject(payload);

            var required = type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.CanRead)
                // The provider extension bag is the one member that must NOT
                // mirror: it is omitted from the wire entirely unless a provider
                // filled it, and ReliabilityExtensionWireTests pins that
                // omission as bytes. Excluded by ATTRIBUTE rather than by name,
                // so the exemption cannot quietly widen to a hand-added field
                // (the same reasoning, and the same mechanism,
                // ScienceContractShapeTests uses).
                .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() == null)
                .Where(p => !DeliberatelyNotOnTheWire.Contains(type.Name + "." + p.Name))
                .ToArray();

            Assert.NotEmpty(required);

            var missing = required
                .Select(p => CamelCase(p.Name))
                .Where(key => !wire.ContainsKey(key))
                .ToArray();

            Assert.True(
                missing.Length == 0,
                $"{type.Name} declares {string.Join(", ", missing)} but JsonWriter.Append{type.Name} never writes "
                    + $"{(missing.Length == 1 ? "that key" : "those keys")}, so the field is in the generated TS SDK and "
                    + "permanently undefined on the wire. Add the missing line to the flattener, or (only if the omission "
                    + "is deliberate) add \"Type.Property\" to DeliberatelyNotOnTheWire with a reason.");
        }

        /// <summary>
        /// Guards the discovery itself. If <see cref="RawPublishedTypes"/> ever
        /// silently narrows (an attribute renamed, the wire path changed shape)
        /// the Theory above would pass by covering nothing, which is the failure
        /// mode a discovered universe has and a hand-listed one does not. The
        /// floor is deliberately well below the real count rather than pinned to
        /// it: this is a "did discovery collapse" assertion, not a second
        /// inventory to keep updated.
        /// </summary>
        [Fact]
        public void DiscoveryFindsTheRawPublishedTypes()
        {
            var found = RawPublishedTypes().Select(row => (string)row[0]).ToArray();

            Assert.True(
                found.Length >= 15,
                "Raw-published type discovery collapsed to " + found.Length
                    + " types, so the parity Theory is covering almost nothing. Found: " + string.Join(", ", found));

            // Named spot-checks across the three families that publish POCOs
            // raw, so a discovery change that drops a whole family is a red
            // here rather than a quiet loss of coverage.
            foreach (var name in new[]
                     {
                         nameof(IsruDrillEntry), nameof(IsruConverterEntry), nameof(IsruResourceFlow),
                         nameof(ReliabilitySummary), nameof(ReliabilityPartEntry),
                         nameof(CommsConnectivity), nameof(CommsPath), nameof(CommsNetwork),
                         nameof(FlightCurrent), nameof(PendingUplinkQueue),
                     })
            {
                Assert.Contains(name, found);
            }
        }

        // ----------------------------------------------------------------
        // helpers
        // ----------------------------------------------------------------

        private static bool SerializesRaw(Type type)
        {
            try
            {
                WirePayloadObject(Activator.CreateInstance(type)!);
                return true;
            }
            catch (NotSupportedException)
            {
                return false;
            }
        }

        /// <summary>
        /// Runs the payload through the REAL wire path
        /// (<see cref="EnvelopeCodec.WriteStreamData"/> →
        /// <c>JsonWriter</c>) and hands back the parsed <c>payload</c> object's
        /// keys. Deliberately the real codec rather than reflection into
        /// JsonWriter's private flatteners: what matters is the bytes a
        /// subscriber receives.
        /// </summary>
        private static Dictionary<string, JsonElement> WirePayloadObject(object payload)
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "parity",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            });

            using var document = JsonDocument.Parse(json);
            var element = document.RootElement.GetProperty("payload");
            return element.ValueKind == JsonValueKind.Object
                ? element.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone())
                : new Dictionary<string, JsonElement>();
        }

        /// <summary>
        /// Fills every settable public property with a non-null value, so a
        /// write-only-when-non-null flattener cannot pass by accident. A
        /// property whose type cannot be filled is left at its default: this is
        /// a key-presence gate, and a hand-written flattener writes its key
        /// literally, so a stubborn value type costs coverage of the
        /// conditional case only, never correctness of the assertion.
        /// </summary>
        private static object Populate(Type type)
        {
            var instance = Activator.CreateInstance(type)!;
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!property.CanWrite || property.GetIndexParameters().Length > 0)
                {
                    continue;
                }

                // Left null on purpose: the bag's whole additive claim is that a
                // payload no provider extended is byte-identical to one from
                // before the mechanism existed, so filling it here would assert
                // the opposite of what ReliabilityExtensionWireTests pins.
                if (property.GetCustomAttribute<ProviderExtensionBagAttribute>() != null)
                {
                    continue;
                }

                try
                {
                    var value = Dummy(property.PropertyType, depth: 0);
                    if (value != null)
                    {
                        property.SetValue(instance, value);
                    }
                }
                catch (Exception)
                {
                    // A property that resists filling keeps its default; see the
                    // method doc comment for why that is safe here.
                }
            }
            return instance;
        }

        private static object? Dummy(Type type, int depth)
        {
            if (depth > 3)
            {
                return null;
            }

            var underlying = Nullable.GetUnderlyingType(type);
            if (underlying != null)
            {
                return Dummy(underlying, depth);
            }

            if (type == typeof(string))
            {
                return "x";
            }
            if (type == typeof(bool))
            {
                return true;
            }
            if (type == typeof(double) || type == typeof(float) || type == typeof(decimal))
            {
                return Convert.ChangeType(1.5, type, CultureInfo.InvariantCulture);
            }
            if (type == typeof(int) || type == typeof(long) || type == typeof(short) || type == typeof(byte))
            {
                return Convert.ChangeType(1, type, CultureInfo.InvariantCulture);
            }
            if (type.IsEnum)
            {
                var values = Enum.GetValues(type);
                return values.Length > 0 ? values.GetValue(0) : null;
            }
            if (type == typeof(object))
            {
                return "x";
            }

            if (type.IsGenericType)
            {
                var definition = type.GetGenericTypeDefinition();
                var args = type.GetGenericArguments();

                if (definition == typeof(List<>) || definition == typeof(IList<>)
                    || definition == typeof(IEnumerable<>) || definition == typeof(IReadOnlyList<>))
                {
                    var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(args[0]))!;
                    var element = Dummy(args[0], depth + 1);
                    if (element != null)
                    {
                        list.Add(element);
                    }
                    return list;
                }

                if ((definition == typeof(Dictionary<,>) || definition == typeof(IDictionary<,>))
                    && args[0] == typeof(string))
                {
                    var map = (IDictionary)Activator.CreateInstance(typeof(Dictionary<,>).MakeGenericType(args))!;
                    var value = Dummy(args[1], depth + 1);
                    if (value != null)
                    {
                        map["k"] = value;
                    }
                    return map;
                }
            }

            return type.IsClass && type.GetConstructor(Type.EmptyTypes) != null
                ? Populate(type)
                : null;
        }

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);
    }
}
