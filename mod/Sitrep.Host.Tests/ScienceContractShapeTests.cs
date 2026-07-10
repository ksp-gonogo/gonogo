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
    /// <see cref="LabEntry"/>, <see cref="DeployedEntry"/>) mirror — field name
    /// for field name, camelCase wire key for camelCase wire key, type for
    /// type — the EXACT serialized shape <see cref="ScienceViewProvider"/>
    /// already emits. This is a typing change only: the wire is written by
    /// <c>JsonWriter</c> walking the provider's dictionary, not by serializing
    /// these POCOs, so if the two shapes ever drift (a field renamed, removed,
    /// added, or retyped on either side) this test fails — the guarantee that
    /// the contract type a widget codes against is byte-identical to the wire.
    ///
    /// <para>Each channel's payload is a BARE ARRAY of the entry type (or
    /// null), tagged via <c>[SitrepTopic(..., isArray: true)]</c>, so the
    /// element type's property set is what must match one emitted dictionary
    /// entry.</para>
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

            AssertTypeMirrorsEntry(typeof(ExperimentEntry), ScienceViewProvider.BuildExperiments(snapshot));
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

            AssertTypeMirrorsEntry(typeof(LabEntry), ScienceViewProvider.BuildLab(snapshot));
        }

        [Fact]
        public void DeployedEntryTypeMirrorsProviderWireShape()
        {
            var snapshot = SnapshotWith("deployed", new Dictionary<string, object?>
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
            });

            AssertTypeMirrorsEntry(typeof(DeployedEntry), ScienceViewProvider.BuildDeployed(snapshot));
        }

        // NOTE: the [SitrepTopic("science.*", isArray: true)] tag on each entry
        // type is deliberately NOT asserted via CLR reflection here. These
        // types also carry [TsInterface], and reading ANY custom attribute off
        // such a type through System.Reflection forces the CLR to resolve the
        // compile-time-only Reinforced.Typings assembly (never deployed at
        // runtime) and throws FileNotFoundException — the exact trap
        // ContractShapeGateTests works around with raw ECMA-335 metadata. The
        // tag is source-visible and is consumed by the TS-SDK codegen via
        // metadata (the next P0.5 task), which is where it is exercised.

        private static KspSnapshot SnapshotWith(string subGroup, Dictionary<string, object?> entry) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?>
            {
                ["science"] = new Dictionary<string, object?>
                {
                    [subGroup] = new List<object?> { entry },
                },
            },
        };

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

            var props = entryType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
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
