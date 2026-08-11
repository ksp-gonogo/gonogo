using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoScansatUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b), the same shape as the equivalent check in each earlier relocated
    /// Uplink's own Tests project (the plan doc names them; this file does not,
    /// since naming a sibling Uplink would trip ITS own frontend
    /// uplink-boundary token): now that
    /// <see cref="ScanningVesselEntry"/>/<see cref="ScanSensorEntry"/>/
    /// <see cref="ScanTrackColor"/>/<see cref="ScanScienceEntry"/>/
    /// <see cref="ScanAnomalyEntry"/> live in their own assembly
    /// (<c>GonogoScansatUplink.Contract</c>) instead of <c>Sitrep.Contract</c>,
    /// nothing FORCES a future property on this Uplink's own contract types to
    /// declare its unit. Scoped-down copy of
    /// <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s exhaustiveness check,
    /// repointed at THIS assembly.
    ///
    /// <para><b>Why a copy, not a shared helper.</b> The pilot deferred
    /// extraction, and the two relocations after it each renewed the deferral
    /// with "worth extracting once a fourth Uplink migrates". This IS the
    /// fourth, so the deferral has run out on its own terms, and it is recorded
    /// here as a called-in debt rather than silently renewed a third time: a
    /// shared <c>UnitCoverageAssertion.AssertExhaustive(Assembly)</c>
    /// (its natural home a small test-support project the four Tests projects
    /// all reference) would now delete four near-identical copies. It is NOT
    /// done in this commit deliberately, because this commit's job is the
    /// relocation and the extraction touches three Uplinks it otherwise leaves
    /// alone; doing both at once would make a green run ambiguous about which
    /// change carried it. The extraction is the natural next commit on this
    /// line.</para>
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's five contract types
    /// carry thirty-two scalar properties total and every one is already
    /// annotated, so the surface starts, and must stay, entirely covered: same
    /// zero-pending starting point as every earlier relocated slice.</para>
    ///
    /// <para><b>What this one exercises that no predecessor did.</b> All three
    /// earlier relocations moved FLAT DTOs, so their copies of this check kept
    /// <c>RequiresUnit</c> scalar-only and said so. This set is not flat:
    /// <see cref="ScanningVesselEntry"/> carries
    /// <c>List&lt;ScanSensorEntry&gt; Sensors</c> and a nested
    /// <see cref="ScanTrackColor"/>, so the sequence-element branch of core's
    /// own <c>RequiresUnit</c> is genuinely reachable here and is carried over
    /// below. Its effect is to keep a container of annotated POCOs exempt (each
    /// element carries its own units) while still demanding an annotation on a
    /// future <c>List&lt;double&gt;</c>, which a bare scalar-only check would
    /// wave through. The <c>Vec3</c> branch is still omitted: no type in this
    /// assembly uses one, and the repo's standing preference is to extend
    /// alongside a real need rather than pre-build unreachable branches.</para>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package,
    /// and the decode-time side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class ScansatUnitCoverageTests
    {
        private static Type Unwrap(Type t) => Nullable.GetUnderlyingType(t) ?? t;

        private static bool IsScalar(Type t) =>
            t.IsEnum
            || t == typeof(string)
            || t == typeof(bool)
            || t == typeof(double) || t == typeof(float) || t == typeof(decimal)
            || t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte)
            || t == typeof(uint) || t == typeof(ulong) || t == typeof(ushort) || t == typeof(sbyte);

        /// <summary>
        /// The type whose dimension is in question: a sequence's element, or the
        /// type itself. Mirrors <c>UnitCoverageTests.ElementType</c>'s sequence
        /// branch (the one this assembly's types actually reach, via
        /// <see cref="ScanningVesselEntry.Sensors"/>). <c>string</c> is
        /// short-circuited because it is an enumerable of <c>char</c> and is
        /// emphatically not a sequence of quantities.
        /// </summary>
        private static Type ElementType(Type t)
        {
            if (t == typeof(string))
            {
                return t;
            }

            if (t.IsArray)
            {
                return Unwrap(t.GetElementType()!);
            }

            if (t.IsGenericType)
            {
                var def = t.GetGenericTypeDefinition();
                if (def == typeof(List<>) || def == typeof(IReadOnlyList<>) ||
                    def == typeof(IList<>) || def == typeof(IEnumerable<>) ||
                    def == typeof(ICollection<>) || def == typeof(IReadOnlyCollection<>))
                {
                    return Unwrap(t.GetGenericArguments()[0]);
                }
            }

            return t;
        }

        /// <summary>
        /// Mirrors <c>UnitCoverageTests.RequiresUnit</c>, minus its Vec3 branch
        /// (see this class's doc comment for why). A nested contract POCO, or a
        /// sequence of them, needs no annotation of its own: each element
        /// carries its own annotated properties, and this same check reaches
        /// them because <see cref="ContractTypes"/> enumerates every
        /// <c>[SitrepContract]</c> type in the assembly, nested ones included.
        /// </summary>
        private static bool RequiresUnit(PropertyInfo prop) =>
            IsScalar(ElementType(Unwrap(prop.PropertyType)));

        private static IEnumerable<Type> ContractTypes() =>
            typeof(ScanningVesselEntry).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false));

        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit()
        {
            var bare = new List<string>();
            foreach (var type in ContractTypes())
            {
                foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    if (!RequiresUnit(prop))
                    {
                        continue;
                    }

                    if (prop.GetCustomAttribute<SitrepUnitAttribute>() is null)
                    {
                        bare.Add(type.Name + "." + prop.Name);
                    }
                }
            }

            Assert.True(
                bare.Count == 0,
                "These GonogoScansatUplink.Contract wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (Units.Degrees/Units.Metres etc.), or a non-quantity token " +
                "(Units.Count/Id/Text/Flag/Enumeration/NotApplicable) if it genuinely is not a " +
                "magnitude. This Uplink started fully annotated; it should never regress.");
        }

        /// <summary>
        /// The nesting this relocation introduced, asserted rather than assumed.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> above would pass
        /// vacuously on the nested half if
        /// <see cref="ScanSensorEntry"/>/<see cref="ScanTrackColor"/> ever
        /// stopped being reached, either because they lost
        /// <c>[SitrepContract]</c> (dropping them from
        /// <see cref="ContractTypes"/>) or because
        /// <see cref="ScanningVesselEntry"/> stopped referencing them. Both are
        /// silent failures of the guard, not of the wire, so they get their own
        /// assertion.
        /// </summary>
        [Fact]
        public void TheNestedPayloadTypesAreReachedByTheCoverageScan()
        {
            var scanned = ContractTypes().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);

            Assert.Contains(nameof(ScanSensorEntry), scanned);
            Assert.Contains(nameof(ScanTrackColor), scanned);
            Assert.Contains(nameof(ScanningVesselEntry), scanned);
            Assert.Contains(nameof(ScanScienceEntry), scanned);
            Assert.Contains(nameof(ScanAnomalyEntry), scanned);

            // ScanningVesselEntry genuinely nests both, so the sequence-element
            // branch of RequiresUnit is exercised by real data, not just present.
            var sensors = typeof(ScanningVesselEntry).GetProperty(nameof(ScanningVesselEntry.Sensors))!;
            Assert.False(RequiresUnit(sensors), "List<ScanSensorEntry> must be exempt: each element carries its own units.");

            var trackColor = typeof(ScanningVesselEntry).GetProperty(nameof(ScanningVesselEntry.TrackColor))!;
            Assert.False(RequiresUnit(trackColor), "A nested ScanTrackColor must be exempt: its own four channels are annotated.");
        }
    }
}
