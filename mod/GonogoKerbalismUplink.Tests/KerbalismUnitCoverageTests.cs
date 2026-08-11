using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoKerbalismUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b), the same shape as the equivalent check in each earlier relocated
    /// Uplink's own Tests project (the plan doc names them; this file does not,
    /// since naming a sibling Uplink would trip ITS own frontend
    /// uplink-boundary token): now that the fifteen <c>kerbalism.*</c> payload
    /// types live in their own assembly (<c>GonogoKerbalismUplink.Contract</c>)
    /// instead of <c>Sitrep.Contract</c>, nothing FORCES a future property on
    /// this Uplink's own contract types to declare its unit. Scoped-down copy of
    /// <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s exhaustiveness check,
    /// repointed at THIS assembly.
    ///
    /// <para><b>Why still a copy.</b> This is the fifth of these, and the
    /// fourth already recorded the extraction as a called-in debt: a shared
    /// <c>UnitCoverageAssertion.AssertExhaustive(Assembly)</c> in a small
    /// test-support project would now delete five near-identical copies. It
    /// stays deferred for the same reason it did there, and the reason is worth
    /// restating rather than treating as a formality: extracting it touches four
    /// Uplinks this commit otherwise leaves alone, so doing both at once would
    /// make a green run ambiguous about which change carried it. This commit is
    /// already the largest relocation of the five. The extraction is a small,
    /// self-contained commit on its own; it does not get smaller by being
    /// hidden inside this one.</para>
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's fifteen contract types
    /// carry every scalar property annotated already, so the surface starts, and
    /// must stay, entirely covered: same zero-pending starting point as every
    /// earlier relocated slice.</para>
    ///
    /// <para><b>What this one exercises that no predecessor did.</b> This is the
    /// first relocated slice to reach ALL THREE branches of core's own
    /// <c>RequiresUnit</c>, so all three are carried over below rather than
    /// trimmed to what the types happen to use:</para>
    /// <list type="bullet">
    /// <item><b>Sequence</b>: <see cref="KerbalismSpaceWeather.Stars"/>,
    /// <see cref="KerbalismCrewEntry.Rules"/>,
    /// <see cref="KerbalismLifeSupport.Processes"/> and others hold lists of
    /// annotated POCOs, which must stay exempt (each element carries its own
    /// units) while a future <c>List&lt;double&gt;</c> is still demanded. Note
    /// <see cref="KerbalismRuleDef.Modifiers"/> is the contrast case: a
    /// <c>List&lt;string&gt;</c> IS a sequence of scalars and DOES carry an
    /// annotation.</item>
    /// <item><b>Dictionary</b>: <see cref="KerbalismProfile.Resources"/> is a
    /// map of POCOs and <see cref="KerbalismLifeSupport.Rates"/> a map of bare
    /// doubles. Core's <c>ElementType</c> collapses every dictionary to
    /// <c>object</c>, so NEITHER is required to be annotated. Rates is annotated
    /// anyway, and has to be: the unit is what makes it renderable. That is a
    /// real hole in the mechanical guard, not a quirk to leave implied, so it
    /// gets its own assertion below.</item>
    /// <item><b>Vec3</b>: <see cref="KerbalismStarInfo.Direction"/>. Every
    /// earlier relocated slice omitted this branch as unreachable; here it is
    /// reachable, and on a type only ever reached through an array, so the
    /// branch is carried over in full.</item>
    /// </list>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package,
    /// and the decode-time side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class KerbalismUnitCoverageTests
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
        /// Mirrors <c>UnitCoverageTests.IsVec3</c>: a <c>Vec3</c>-typed field is
        /// a composite that carries a real unit, not a structural container to
        /// be exempted. The ONE canonical Vec3 is used at sites carrying
        /// different units, so the unit sits on the FIELD and codegen propagates
        /// it to the three scalar leaves. Matched by name, the same string-only
        /// discipline core's copy keeps.
        /// </summary>
        private static bool IsVec3(Type t) => t.FullName == "Sitrep.Contract.Vec3";

        /// <summary>
        /// The type whose dimension is in question: a sequence's element, or the
        /// type itself. Mirrors <c>UnitCoverageTests.ElementType</c> including
        /// its dictionary branch (a dictionary is a bag of heterogeneous values
        /// by definition, so one unit could not describe all of them).
        /// <c>string</c> is short-circuited because it is an enumerable of
        /// <c>char</c> and is emphatically not a sequence of quantities.
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

                if (def == typeof(Dictionary<,>) || def == typeof(IDictionary<,>) ||
                    def == typeof(IReadOnlyDictionary<,>))
                {
                    return typeof(object);
                }
            }

            return t;
        }

        /// <summary>
        /// Mirrors <c>UnitCoverageTests.RequiresUnit</c> in full, Vec3 branch
        /// included (see this class's doc comment for why that matters here and
        /// did not for any predecessor). A nested contract POCO, or a sequence of
        /// them, needs no annotation of its own: each element carries its own
        /// annotated properties, and this same check reaches them because
        /// <see cref="ContractTypes"/> enumerates every
        /// <c>[SitrepContract]</c> type in the assembly, nested ones included.
        /// </summary>
        private static bool RequiresUnit(PropertyInfo prop)
        {
            var element = ElementType(Unwrap(prop.PropertyType));
            return IsScalar(element) || IsVec3(element);
        }

        private static IEnumerable<Type> ContractTypes() =>
            typeof(KerbalismSpaceWeather).Assembly.GetTypes()
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
                "These GonogoKerbalismUplink.Contract wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (Units.RadPerSecond/Units.ResourceUnitsPerSecond etc.), or a " +
                "non-quantity token (Units.Count/Id/Text/Flag/Enumeration/NotApplicable) if it " +
                "genuinely is not a magnitude. This Uplink started fully annotated; it should " +
                "never regress.");
        }

        /// <summary>
        /// Every one of the fifteen is reached by the scan, asserted rather than
        /// assumed. <see cref="EveryScalarWirePropertyDeclaresAUnit"/> above
        /// passes VACUOUSLY on any type the scan does not reach, and there are
        /// two silent ways for that to happen: a type loses
        /// <c>[SitrepContract]</c> (dropping it from
        /// <see cref="ContractTypes"/>), or a nested type stops being referenced
        /// by its parent. Both are failures of the guard rather than of the wire,
        /// so they get their own assertion. Ten of the fifteen are nested-only,
        /// which is what makes this worth spelling out here more than in any
        /// earlier slice.
        /// </summary>
        [Fact]
        public void EveryRelocatedTypeIsReachedByTheCoverageScan()
        {
            var scanned = ContractTypes().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);

            foreach (var name in new[]
            {
                nameof(KerbalismSpaceWeather), nameof(KerbalismStarInfo), nameof(KerbalismStormEntry),
                nameof(KerbalismLifeSupport), nameof(KerbalismResource), nameof(KerbalismHabitat),
                nameof(KerbalismProcessEntry), nameof(KerbalismGreenhouseEntry),
                nameof(KerbalismCrewEntry), nameof(KerbalismCrewRule),
                nameof(KerbalismProfile), nameof(KerbalismResourceDef), nameof(KerbalismRuleDef),
                nameof(KerbalismProcessDef), nameof(KerbalismFeatures),
            })
            {
                Assert.Contains(name, scanned);
            }

            // Exactly fifteen, so a SIXTEENTH type added here without a
            // [SitrepUnit] review shows up as a red rather than joining the set
            // unexamined.
            Assert.Equal(15, scanned.Count);
        }

        /// <summary>
        /// The three <c>RequiresUnit</c> branches, exercised by real properties
        /// rather than merely present in the code above. Each of these would go
        /// quietly wrong in a way the exhaustiveness test cannot see: an exemption
        /// that stopped applying would demand a nonsense annotation on a
        /// container, and an exemption that started applying too widely would stop
        /// demanding a real one.
        /// </summary>
        [Fact]
        public void TheSequenceVec3AndDictionaryBranchesAreExercisedByRealProperties()
        {
            // Sequence of annotated POCOs: exempt, each element carries its own.
            var stars = typeof(KerbalismSpaceWeather).GetProperty(nameof(KerbalismSpaceWeather.Stars))!;
            Assert.False(RequiresUnit(stars), "List<KerbalismStarInfo> must be exempt: each element carries its own units.");
            var rules = typeof(KerbalismCrewEntry).GetProperty(nameof(KerbalismCrewEntry.Rules))!;
            Assert.False(RequiresUnit(rules), "List<KerbalismCrewRule> must be exempt: each element carries its own units.");

            // A nested single POCO: same exemption.
            var habitat = typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.Habitat))!;
            Assert.False(RequiresUnit(habitat), "A nested KerbalismHabitat must be exempt: its own seven scalars are annotated.");

            // Sequence of SCALARS: the contrast case, genuinely required, and
            // annotated (Units.Text).
            var modifiers = typeof(KerbalismRuleDef).GetProperty(nameof(KerbalismRuleDef.Modifiers))!;
            Assert.True(RequiresUnit(modifiers), "List<string> IS a sequence of scalars and must be demanded.");
            Assert.NotNull(modifiers.GetCustomAttribute<SitrepUnitAttribute>());

            // Vec3: required despite being an object, because the unit sits on
            // the field and codegen carries it to x/y/z.
            var direction = typeof(KerbalismStarInfo).GetProperty(nameof(KerbalismStarInfo.Direction))!;
            Assert.True(RequiresUnit(direction), "A Vec3 field carries a real unit and must be demanded, not exempted as a container.");
            Assert.NotNull(direction.GetCustomAttribute<SitrepUnitAttribute>());
        }

        /// <summary>
        /// The hole in the mechanical guard, stated rather than left implied.
        /// Core's <c>ElementType</c> collapses every dictionary to
        /// <c>object</c>, so a name-keyed map is never REQUIRED to declare a
        /// unit, whichever kind of value it holds. That is right for
        /// <see cref="KerbalismProfile.Resources"/> (a map of POCOs, each
        /// carrying its own units) and wrong-but-unenforceable for
        /// <see cref="KerbalismLifeSupport.Rates"/> (a map of bare doubles, where
        /// the unit is the only thing that makes the numbers renderable).
        ///
        /// <para>This Domain holds every name-keyed unit map in the entire
        /// contract, so if the four of them are ever un-annotated nothing
        /// mechanical objects and the decode silently hands a widget bare
        /// numbers. Pinning them by name here is the guard the type system cannot
        /// provide. The corresponding decode-time proof is in this Uplink's
        /// client <c>topics.test.ts</c>.</para>
        /// </summary>
        [Fact]
        public void TheNameKeyedValueMapsAreAnnotatedEvenThoughTheScanCannotDemandIt()
        {
            var resources = typeof(KerbalismProfile).GetProperty(nameof(KerbalismProfile.Resources))!;
            Assert.False(RequiresUnit(resources), "A dictionary collapses to object: core's scan cannot demand an annotation.");

            foreach (var prop in new[]
            {
                typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.Rates))!,
                typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.RuleEnvModifiers))!,
                typeof(KerbalismProcessDef).GetProperty(nameof(KerbalismProcessDef.Inputs))!,
                typeof(KerbalismProcessDef).GetProperty(nameof(KerbalismProcessDef.Outputs))!,
            })
            {
                Assert.False(
                    RequiresUnit(prop),
                    prop.DeclaringType!.Name + "." + prop.Name +
                    " is a dictionary, so the scan above cannot demand its unit.");
                Assert.True(
                    prop.GetCustomAttribute<SitrepUnitAttribute>() is not null,
                    prop.DeclaringType!.Name + "." + prop.Name +
                    " is a name-keyed map of BARE scalars: without [SitrepUnit] the decode hands " +
                    "every value to a widget as a raw number and no gate objects. Declare the unit.");
            }
        }
    }
}
