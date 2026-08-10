using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Gonogo.MechJebUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that <see cref="MechJebAscentArgs"/>/<see cref="MechJebNoArgs"/>
    /// live in their own assembly (<c>GonogoMechJebUplink.Contract</c>) instead
    /// of <c>Sitrep.Contract</c>, nothing FORCES a future property on this
    /// Uplink's own contract types to declare its unit. This is a scoped-down
    /// copy of <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s exhaustiveness
    /// check, repointed at THIS assembly instead of the hardcoded
    /// first-party one.
    ///
    /// <para><b>Why a copy, not a shared helper, for the pilot.</b> The plan
    /// (§5b) recommends extracting <c>UnitCoverageTests</c>'s reflection body
    /// into a shared internal helper (<c>UnitCoverageAssertion.AssertExhaustive
    /// (Assembly)</c>) once a second Uplink migrates, so both call sites stay
    /// in lockstep. One Uplink does not justify standing up a new shared
    /// test-support project yet; this file is the thing to fold into that
    /// helper when Avionics (the plan's next step) needs the identical
    /// check.</para>
    ///
    /// <para><b>Why no baseline file, unlike the core gate.</b>
    /// <c>UnitCoverageTests</c> ships a shrink-only baseline because core has
    /// ~580 properties and some are still bare. This Uplink has exactly one
    /// scalar property (<see cref="MechJebAscentArgs.TargetAltitudeKm"/>) and
    /// it is already annotated, so the surface starts, and must stay,
    /// entirely covered: a bare assertion is the honest gate for a
    /// zero-pending starting point, and adding a baseline mechanism nothing
    /// uses yet would be needless ceremony.</para>
    ///
    /// <para><b>What this pilot does NOT exercise.</b> Both of this
    /// assembly's types are command ARGS (inbound-only), which
    /// <c>RtConfig.ApplyUnitValueTypes</c> deliberately never retypes to
    /// <c>Value&lt;&gt;</c>/<c>Vec3Of&lt;&gt;</c> (see its own doc comment): a
    /// widget JSON-stringifies these straight to the wire, and there is no
    /// unwrap step to make a wrapped value round-trip. So the plan's "resolves
    /// to a core gonogo Value type" half of §5b has nothing to check here,
    /// <c>mod/GonogoMechJebUplink/client/src/generated-value-import.test.ts</c>
    /// covers the mechanism generically (it passes vacuously for MechJeb
    /// today) and is the one that will actually fire once an Uplink with an
    /// outbound, unit-bearing payload migrates (Avionics's
    /// <c>AvionicsStatus</c> is next in the plan's sequencing).</para>
    /// </summary>
    public class MechJebUnitCoverageTests
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
        /// Mirrors <c>UnitCoverageTests.RequiresUnit</c>, minus the Vec3/
        /// sequence/dictionary branches this Uplink's two trivial DTOs have no
        /// use for yet: kept simple deliberately, extend alongside a real need
        /// rather than pre-building unreachable branches.
        /// </summary>
        private static bool RequiresUnit(PropertyInfo prop) => IsScalar(Unwrap(prop.PropertyType));

        private static IEnumerable<Type> ContractTypes() =>
            typeof(MechJebAscentArgs).Assembly.GetTypes()
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
                "These GonogoMechJebUplink.Contract wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (Units.Kilometres etc.), or a non-quantity token (Units.Count/" +
                "Id/Text/Flag/Enumeration/NotApplicable) if it genuinely is not a magnitude. " +
                "This Uplink started fully annotated; it should never regress.");
        }
    }
}
