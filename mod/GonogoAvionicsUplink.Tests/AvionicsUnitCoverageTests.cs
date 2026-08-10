using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoAvionicsUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoAvionicsUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b), the same shape as <c>GonogoMechJebUplink.Tests.MechJebUnitCoverageTests</c>:
    /// now that <see cref="AvionicsStatus"/> lives in its own assembly
    /// (<c>GonogoAvionicsUplink.Contract</c>) instead of <c>Sitrep.Contract</c>,
    /// nothing FORCES a future property on this Uplink's own contract type to
    /// declare its unit. Scoped-down copy of
    /// <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s exhaustiveness check,
    /// repointed at THIS assembly.
    ///
    /// <para><b>Why a copy, not a shared helper, still.</b> Same call the
    /// MechJeb pilot made: one more Uplink does not yet justify a shared
    /// <c>UnitCoverageAssertion.AssertExhaustive(Assembly)</c> helper project.
    /// Worth extracting once a third Uplink migrates.</para>
    ///
    /// <para><b>Why no baseline file.</b> This Uplink has exactly four scalar
    /// properties and all four are already annotated, so the surface starts,
    /// and must stay, entirely covered: same zero-pending starting point as
    /// MechJeb's.</para>
    ///
    /// <para><b>What this one DOES exercise, unlike MechJeb's.</b>
    /// <see cref="AvionicsStatus"/> is an outbound READ payload, not command
    /// args, so <c>RtConfig.ApplyUnitValueTypes</c> genuinely retypes
    /// <see cref="AvionicsStatus.ControllableMassTons"/>/
    /// <see cref="AvionicsStatus.VesselMassTons"/> to <c>Value&lt;"t"&gt;</c> in
    /// the generated contract (see <c>AvionicsRtConfig.Configure</c>'s doc
    /// comment). This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package.</para>
    /// </summary>
    public class AvionicsUnitCoverageTests
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
        /// sequence/dictionary branches this Uplink's one trivial DTO has no
        /// use for yet: kept simple deliberately, extend alongside a real need
        /// rather than pre-building unreachable branches.
        /// </summary>
        private static bool RequiresUnit(PropertyInfo prop) => IsScalar(Unwrap(prop.PropertyType));

        private static IEnumerable<Type> ContractTypes() =>
            typeof(AvionicsStatus).Assembly.GetTypes()
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
                "These GonogoAvionicsUplink.Contract wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (Units.Tonnes etc.), or a non-quantity token (Units.Count/" +
                "Id/Text/Flag/Enumeration/NotApplicable) if it genuinely is not a magnitude. " +
                "This Uplink started fully annotated; it should never regress.");
        }
    }
}
