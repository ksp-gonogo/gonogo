using System.Reflection;
using GonogoKerbalismUplink;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that the fifteen <c>kerbalism.*</c> payload types live in their
    /// own assembly (<c>GonogoKerbalismUplink.Contract</c>) instead of
    /// <c>Sitrep.Contract</c>, nothing FORCES a future property on this Uplink's
    /// own contract types to declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's fifteen contract types
    /// carry every scalar property annotated already, so the surface starts, and
    /// must stay, entirely covered: same zero-pending starting point as every
    /// other relocated slice.</para>
    ///
    /// <para><b>This Domain is what makes all three branches of the shared
    /// <c>RequiresUnit</c> load-bearing rather than theoretical</b>, and each is
    /// pinned to a real property below:</para>
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
    /// doubles. The shared <c>ElementType</c> collapses every dictionary to
    /// <c>object</c>, so NEITHER is required to be annotated. Rates is annotated
    /// anyway, and has to be: the unit is what makes it renderable. That is a
    /// real hole in the mechanical guard, not a quirk to leave implied, so it
    /// gets its own assertion below.</item>
    /// <item><b>Vec3</b>: <see cref="KerbalismStarInfo.Direction"/>, on a type
    /// only ever reached through an array, so one declared unit survives two hops
    /// of shape resolution and then fans out to three leaves.</item>
    /// </list>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package,
    /// and the decode-time side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class KerbalismUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(KerbalismSpaceWeather).Assembly,
                "Units.RadPerSecond/Units.ResourceUnitsPerSecond");

        /// <summary>
        /// Every one of the fifteen is reached by the sweep, asserted rather than
        /// assumed. <see cref="EveryScalarWirePropertyDeclaresAUnit"/> passes
        /// VACUOUSLY on any type the sweep does not reach, and there are two
        /// silent ways for that to happen: a type loses <c>[SitrepContract]</c>,
        /// or a nested type stops being referenced by its parent. Ten of the
        /// fifteen are nested-only, which is what makes it worth spelling out
        /// here more than in any other slice.
        /// </summary>
        [Fact]
        public void EveryRelocatedTypeIsReachedByTheCoverageScan() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(KerbalismSpaceWeather).Assembly,
                nameof(KerbalismSpaceWeather), nameof(KerbalismStarInfo), nameof(KerbalismStormEntry),
                nameof(KerbalismLifeSupport), nameof(KerbalismResource), nameof(KerbalismHabitat),
                nameof(KerbalismProcessEntry), nameof(KerbalismGreenhouseEntry),
                nameof(KerbalismCrewEntry), nameof(KerbalismCrewRule),
                nameof(KerbalismProfile), nameof(KerbalismResourceDef), nameof(KerbalismRuleDef),
                nameof(KerbalismProcessDef), nameof(KerbalismFeatures),
                // Not a Topic payload of this Domain's own: the Kerbalism namespace
                // of the CORE reliability.summary payload's provider extension bag
                // (KerbalismReliabilityExt.cs). It is in this assembly for the same
                // reason the fifteen above are, and it needs the same annotation
                // guard: a quantity inside an extension is a Value like any other,
                // and its unit reaches the decode through this Uplink's own
                // generated TYPE map.
                nameof(KerbalismReliabilityExt),
                // The four Kerbalism namespaces of the CORE science.* payloads'
                // extension bags (KerbalismScienceExt.cs), same rationale as
                // KerbalismReliabilityExt above at a larger scale: Kerbalism wins the
                // science election, and most of what it knows has no core field to
                // land in. These carry this repo's FIRST Uplink-declared units
                // ("MB"/"MB/s"/"science/MB"), which makes the annotation guard load
                // -bearing in a new way: an unannotated megabyte figure would decode
                // as a bare number while the generated type still claimed Value<"MB">.
                nameof(KerbalismScienceExperimentExt), nameof(KerbalismScienceInstrumentExt),
                nameof(KerbalismScienceLabExt), nameof(KerbalismScienceBreakdownExt));

        /// <summary>
        /// The three <c>RequiresUnit</c> branches, exercised by real properties
        /// rather than merely present in the shared helper. Each of these would go
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
            Assert.False(UnitCoverageAssertion.RequiresUnit(stars), "List<KerbalismStarInfo> must be exempt: each element carries its own units.");
            var rules = typeof(KerbalismCrewEntry).GetProperty(nameof(KerbalismCrewEntry.Rules))!;
            Assert.False(UnitCoverageAssertion.RequiresUnit(rules), "List<KerbalismCrewRule> must be exempt: each element carries its own units.");

            // A nested single POCO: same exemption.
            var habitat = typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.Habitat))!;
            Assert.False(UnitCoverageAssertion.RequiresUnit(habitat), "A nested KerbalismHabitat must be exempt: its own seven scalars are annotated.");

            // Sequence of SCALARS: the contrast case, genuinely required, and
            // annotated (Units.Text).
            var modifiers = typeof(KerbalismRuleDef).GetProperty(nameof(KerbalismRuleDef.Modifiers))!;
            Assert.True(UnitCoverageAssertion.RequiresUnit(modifiers), "List<string> IS a sequence of scalars and must be demanded.");
            Assert.NotNull(modifiers.GetCustomAttribute<SitrepUnitAttribute>());

            // Vec3: required despite being an object, because the unit sits on
            // the field and codegen carries it to x/y/z.
            var direction = typeof(KerbalismStarInfo).GetProperty(nameof(KerbalismStarInfo.Direction))!;
            Assert.True(UnitCoverageAssertion.RequiresUnit(direction), "A Vec3 field carries a real unit and must be demanded, not exempted as a container.");
            Assert.NotNull(direction.GetCustomAttribute<SitrepUnitAttribute>());
        }

        /// <summary>
        /// The hole in the mechanical guard, stated rather than left implied. The
        /// shared <c>ElementType</c> collapses every dictionary to
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
            Assert.False(UnitCoverageAssertion.RequiresUnit(resources), "A dictionary collapses to object: the sweep cannot demand an annotation.");

            foreach (var prop in new[]
            {
                typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.Rates))!,
                typeof(KerbalismLifeSupport).GetProperty(nameof(KerbalismLifeSupport.RuleEnvModifiers))!,
                typeof(KerbalismProcessDef).GetProperty(nameof(KerbalismProcessDef.Inputs))!,
                typeof(KerbalismProcessDef).GetProperty(nameof(KerbalismProcessDef.Outputs))!,
            })
            {
                Assert.False(
                    UnitCoverageAssertion.RequiresUnit(prop),
                    prop.DeclaringType!.Name + "." + prop.Name +
                    " is a dictionary, so the sweep cannot demand its unit.");
                Assert.True(
                    prop.GetCustomAttribute<SitrepUnitAttribute>() is not null,
                    prop.DeclaringType!.Name + "." + prop.Name +
                    " is a name-keyed map of BARE scalars: without [SitrepUnit] the decode hands " +
                    "every value to a widget as a raw number and no gate objects. Declare the unit.");
            }
        }
    }
}
