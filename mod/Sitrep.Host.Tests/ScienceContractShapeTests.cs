using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Locks the P0.5 typing change for <c>science.*</c>: proves the named
    /// <c>Sitrep.Contract</c> payload types (<see cref="ExperimentEntry"/>,
    /// <see cref="LabEntry"/>) mirror: field name
    /// for field name, camelCase wire key for camelCase wire key, type for
    /// type: the EXACT serialized shape <see cref="ScienceViewProvider"/>
    /// already emits. This is a typing change only: the wire is written by
    /// <c>JsonWriter</c> walking the provider's dictionary, not by serializing
    /// these POCOs, so if the two shapes ever drift (a field renamed, removed,
    /// added, or retyped on either side) this test fails, the guarantee that
    /// the contract type a widget codes against is byte-identical to the wire.
    ///
    /// <para>Each channel's payload is a BARE ARRAY of the entry type (or
    /// null), tagged via <c>[SitrepTopic(..., isArray: true)]</c>, so the
    /// element type's property set is what must match one emitted dictionary
    /// entry.</para>
    ///
    /// <para><b>The shape under test is the PUBLISHED one</b>, mapper output plus
    /// the subject-vessel stamp <c>Gonogo.KSP.ScienceCoreUplink</c>'s channel
    /// source adds (see <c>Sitrep.Host.VesselAttribution</c>). Attribution
    /// belongs to the uplink that owns the topic rather than to the elected
    /// backend, so the wire a subscriber receives is that composition, and
    /// asserting the mapper's intermediate instead would leave <c>vesselId</c>
    /// ungated on both sides at once.</para>
    /// </summary>
    public class ScienceContractShapeTests
    {
        [Fact]
        public void ExperimentEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("experiments", new Dictionary<string, object?>
            {
                ["partName"] = "Mystery Goo Containment Pod",
                ["location"] = "experiment",
                ["experimentId"] = "mysteryGoo",
                ["subjectId"] = "mysteryGoo@KerbinSrfLanded",
                ["title"] = "Mystery Goo Observation",
                ["dataAmount"] = 5.0,
                ["scienceValueRatio"] = 1.0,
                ["baseTransmitValue"] = 0.3,
                ["transmitBonus"] = 1.0,
                ["labValue"] = 1.0,
                ["deployed"] = true,
                ["inoperable"] = false,
                ["situation"] = "LANDED",
            });

            AssertTypeMirrorsEntry(typeof(ExperimentEntry), Published(ScienceViewProvider.BuildExperiments(snapshot), snapshot));
        }

        [Fact]
        public void InstrumentEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("instruments", new Dictionary<string, object?>
            {
                ["partId"] = "12345",
                ["partName"] = "Mystery Goo Containment Pod",
                ["experimentId"] = "mysteryGoo",
                ["title"] = "Mystery Goo Observation",
                ["deployed"] = true,
                ["inoperable"] = false,
                ["rerunnable"] = false,
                ["resettable"] = true,
                ["dataIsCollectable"] = true,
            });

            AssertTypeMirrorsEntry(typeof(InstrumentEntry), Published(ScienceViewProvider.BuildInstruments(snapshot), snapshot));
        }

        [Fact]
        public void LabEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("lab", new Dictionary<string, object?>
            {
                ["partName"] = "Mobile Processing Lab MPL-LG-2",
                ["dataStored"] = 120.0,
                ["dataStorage"] = 500.0,
                ["storedScience"] = 15.5,
                ["processingData"] = true,
                ["statusText"] = "Analyzing data...",
                ["scientistCount"] = 2,
                ["scienceRate"] = 0.02,
                ["isOperational"] = true,
            });

            AssertTypeMirrorsEntry(typeof(LabEntry), Published(ScienceViewProvider.BuildLab(snapshot), snapshot));
        }

        // DeployedEntry ("deployed.bases") is exercised in
        // BreakingGroundContractShapeTests, alongside BreakingGroundViewProvider,
        // the two moved together out of ScienceViewProvider.

        [Fact]
        public void SensorEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("sensors", new Dictionary<string, object?>
            {
                ["partId"] = "101",
                ["partName"] = "PresMat Barometer",
                ["type"] = "PRES",
                ["readout"] = "0.998atm",
                ["active"] = true,
            });

            AssertTypeMirrorsEntry(typeof(SensorEntry), Published(ScienceViewProvider.BuildSensors(snapshot), snapshot));
        }

        [Fact]
        public void ExperimentBreakdownEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("experimentBreakdown", new Dictionary<string, object?>
            {
                ["subjectId"] = "mysteryGoo@KerbinSrfLandedShores",
                ["biome"] = "Shores",
                ["situation"] = "SrfLanded",
                ["expTitle"] = "Mystery Goo Observation",
                ["dataMits"] = 5.0,
                ["remainingPotential"] = 12.5,
            });

            AssertTypeMirrorsEntry(typeof(ExperimentBreakdownEntry), Published(ScienceViewProvider.BuildExperimentBreakdown(snapshot), snapshot));
        }

        // NOTE: the [SitrepTopic("science.*", isArray: true)] tag on each entry
        // type is deliberately NOT asserted via CLR reflection here. These
        // types also carry [TsInterface], and reading ANY custom attribute off
        // such a type through System.Reflection forces the CLR to resolve the
        // compile-time-only Reinforced.Typings assembly (never deployed at
        // runtime) and throws FileNotFoundException: the exact trap
        // ContractShapeGateTests works around with raw ECMA-335 metadata. The
        // tag is source-visible and is consumed by the TS-SDK codegen via
        // metadata (the next P0.5 task), which is where it is exercised.

        /// <summary>A stand-in for the captured <c>Vessel.id.ToString()</c>, in the shape the fleet./currency. namespaces key by.</summary>
        private const string VesselGuid = "e34e5a6d-2c1f-4b18-9c4a-1f2b3c4d5e6f";

        private static KspSnapshot SnapshotWith(string subGroup, Dictionary<string, object?> entry) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?>
            {
                // The vessel group the attribution reads its subject from, the same
                // Values["vessel"]["identity"]["id"] VesselViewProvider.BuildIdentity
                // uses. Present here because the shape under test is the PUBLISHED
                // one (see Published below), not the mapper's intermediate.
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = VesselGuid },
                },
                ["science"] = new Dictionary<string, object?>
                {
                    [subGroup] = new List<object?> { entry },
                },
            },
        };

        /// <summary>
        /// What a subscriber actually receives: the mapper's entries with the
        /// subject vessel stamped on, which is what
        /// <c>Gonogo.KSP.ScienceCoreUplink</c>'s channel source publishes. The
        /// mirror assertion is deliberately against THIS rather than the bare
        /// mapper output, because the contract type describes the wire and the wire
        /// is the composition: attribution is added by the uplink that owns the
        /// topic, not by the elected backend (see Sitrep.Host.VesselAttribution).
        /// Asserting the intermediate would leave vesselId ungated on both sides.
        /// </summary>
        private static object? Published(object? payload, KspSnapshot snapshot) =>
            VesselAttribution.Stamp(payload, VesselAttribution.VesselIdOf(snapshot));

        /// <summary>
        /// The core round-trip assertion: the single emitted dictionary entry's
        /// key set must equal the entry type's camelCase'd property-name set
        /// (no extra, no missing), and every emitted non-null value's runtime
        /// type must match the corresponding property's (Nullable-unwrapped)
        /// type. Guards against a field added/removed/renamed/re-cased/retyped
        /// on EITHER the provider or the contract type.
        /// </summary>
        private static void AssertTypeMirrorsEntry(Type entryType, object? payload)
        {
            var list = Assert.IsType<List<object?>>(payload);
            var emitted = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));

            // The provider extension bag is the one member that must NOT mirror:
            // it is omitted from the wire entirely unless a provider filled it
            // (see Sitrep.Contract/ProviderExtensions.cs, and
            // ReliabilityExtensionWireTests, which pins that omission as bytes),
            // so the stock backend never emits the key. Excluded by ATTRIBUTE
            // rather than by name so the exemption cannot quietly widen to a
            // hand-added field.
            var props = entryType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() == null)
                .ToDictionary(p => CamelCase(p.Name), p => p);

            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

            foreach (var (key, value) in emitted)
            {
                var prop = props[key];
                var expected = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;

                // Every field is optional on the wire (SnapshotDict.Get* yields
                // null on absence), so value types are Nullable<T>; reference
                // types are plain (NRT is compile-time only).
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

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);
    }
}
