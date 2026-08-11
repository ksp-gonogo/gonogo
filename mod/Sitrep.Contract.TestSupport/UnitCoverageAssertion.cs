using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b), in ONE place: once an Uplink's wire types live in their own
    /// assembly instead of <c>Sitrep.Contract</c>, nothing FORCES a future
    /// property on them to declare its unit, so each relocated slice re-asserts
    /// the exhaustiveness core's own gate gives its own types.
    ///
    /// <para><b>Why this exists.</b> The first five relocations each carried a
    /// scoped-down copy of <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s
    /// reflection body, and each one recorded the extraction as a deferred debt
    /// rather than fold it into a relocation commit. Five copies is where the
    /// deferral stops being defensible: the copies had already drifted, three of
    /// them trimming <c>RequiresUnit</c> to scalars-only on the grounds that
    /// their DTOs were flat. A trimmed copy is not a smaller gate, it is a gate
    /// with a hole: a <c>List&lt;double&gt;</c> added to one of those slices
    /// later would have been waved through. This helper carries core's rule in
    /// FULL for every caller, so the sequence, dictionary and Vec3 branches are
    /// there before the type that needs them is.</para>
    ///
    /// <para><b>What stays in the caller.</b> Only the mechanical sweep is
    /// shared. Each Uplink's Tests project keeps its own <c>[Fact]</c>s naming
    /// its own real properties, because those assertions are what stop the sweep
    /// passing VACUOUSLY: that a nested type is still reached, that a container
    /// is still exempt, that a name-keyed map the sweep cannot demand is
    /// annotated anyway. Sharing the sweep does not make those generic, and a red
    /// still names the Uplink that broke.</para>
    ///
    /// <para><b>Why core's own gate does not call this.</b>
    /// <c>Sitrep.Core.Tests.UnitCoverageTests</c> looks like a sixth caller and
    /// is not: it reads annotations through a <c>MetadataReader</c> rather than
    /// <c>PropertyInfo.GetCustomAttribute</c> (its own doc comment records the
    /// clean-checkout <c>FileNotFoundException: Reinforced.Typings</c> that
    /// forced this, a hazard the Uplink slices do not have because they carry no
    /// property-level RT attributes), and it gates against a shrink-only
    /// baseline because core still has bare properties. Folding the two would
    /// mean either dragging the metadata reader into a check that does not need
    /// it or giving core's ratchet up. The shared part is <see cref="RequiresUnit"/>
    /// and that is duplicated deliberately, in a file whose doc comment says
    /// so.</para>
    /// </summary>
    public static class UnitCoverageAssertion
    {
        /// <summary>
        /// True when a property carries a VALUE rather than a structure, and so
        /// is something a unit can describe. Mirrors
        /// <c>UnitCoverageTests.RequiresUnit</c> in full, all three branches.
        /// </summary>
        public static bool RequiresUnit(PropertyInfo prop)
        {
            var element = ElementType(Unwrap(prop.PropertyType));
            return IsScalar(element) || IsVec3(element);
        }

        /// <summary>
        /// Every <see cref="SitrepContractAttribute"/>-tagged type in an
        /// Uplink's own contract assembly, nested-only shapes included.
        /// </summary>
        public static IEnumerable<Type> ContractTypes(Assembly contractAssembly) =>
            contractAssembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // IsDefined only, never GetCustomAttributesData: the sibling
                // Reinforced.Typings attributes are not loadable in a net10.0
                // test, the same constraint core's gates work under.
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false));

        /// <summary>
        /// Every scalar/Vec3 wire property in the assembly declares a unit.
        /// </summary>
        /// <param name="contractAssembly">The Uplink's own contract assembly,
        /// reached via <c>typeof(OneOfItsTypes).Assembly</c> so the anchor is a
        /// compile-time reference rather than a string.</param>
        /// <param name="unitExamples">The tokens this Uplink's own quantities
        /// actually use, e.g. <c>"Units.Degrees/Units.Metres"</c>. Named in the
        /// failure so the fix reads as a choice from a catalog rather than an
        /// invitation to invent a token.</param>
        public static void AssertExhaustive(Assembly contractAssembly, string unitExamples)
        {
            var bare = new List<string>();
            foreach (var type in ContractTypes(contractAssembly))
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
                "These " + contractAssembly.GetName().Name + " wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (" + unitExamples + " etc.), or a non-quantity token (Units.Count/" +
                "Id/Text/Flag/Enumeration/NotApplicable) if it genuinely is not a magnitude. " +
                "Every relocated Uplink started fully annotated; none should ever regress.");
        }

        /// <summary>
        /// The assembly's contract types are EXACTLY the named set.
        ///
        /// <para><see cref="AssertExhaustive"/> passes vacuously on any type the
        /// scan does not reach, and there are two silent ways for that to
        /// happen: a type loses <c>[SitrepContract]</c>, or a nested type stops
        /// being referenced by its parent. Both are failures of the guard rather
        /// than of the wire. Asserting the set both ways also means a NEW type
        /// added to a slice shows up as a red here rather than joining the sweep
        /// unexamined, which is the point at which someone should be looking at
        /// its annotations.</para>
        /// </summary>
        public static void AssertContractTypesAreExactly(Assembly contractAssembly, params string[] expectedTypeNames)
        {
            var scanned = ContractTypes(contractAssembly).Select(t => t.Name).ToHashSet(StringComparer.Ordinal);

            foreach (var name in expectedTypeNames)
            {
                Assert.Contains(name, scanned);
            }

            var unexpected = scanned.Except(expectedTypeNames, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                unexpected.Count == 0,
                "These " + contractAssembly.GetName().Name + " contract types are not in the list this " +
                "Uplink's own coverage test names:\n  " + string.Join("\n  ", unexpected) +
                "\n\nAdd them, having first checked their scalar properties carry [SitrepUnit]. The list " +
                "is exhaustive on purpose: a type that joins the sweep silently joins it unreviewed.");
        }

        // ---------------------------------------------------------------
        // Core's rule, carried in full.
        // ---------------------------------------------------------------

        private static Type Unwrap(Type t) => Nullable.GetUnderlyingType(t) ?? t;

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
        /// by definition, so one unit could not describe all of them, and the
        /// consequence for a map of BARE scalars is a hole each Uplink holding
        /// one has to pin by name itself). <c>string</c> is short-circuited
        /// because it is an <see cref="IEnumerable"/> of <c>char</c> and is
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

                if (def == typeof(Dictionary<,>) || def == typeof(IDictionary<,>) ||
                    def == typeof(IReadOnlyDictionary<,>))
                {
                    return typeof(object);
                }
            }

            return t;
        }

        private static bool IsScalar(Type t) =>
            t.IsEnum
            || t == typeof(string)
            || t == typeof(bool)
            || t == typeof(double) || t == typeof(float) || t == typeof(decimal)
            || t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte)
            || t == typeof(uint) || t == typeof(ulong) || t == typeof(ushort) || t == typeof(sbyte);
    }
}
