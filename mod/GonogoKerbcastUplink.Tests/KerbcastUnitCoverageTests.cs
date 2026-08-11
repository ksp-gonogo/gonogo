using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoKerbcastUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbcastUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b), the same shape as <c>GonogoMechJebUplink.Tests.MechJebUnitCoverageTests</c>/
    /// <c>GonogoAvionicsUplink.Tests.AvionicsUnitCoverageTests</c>: now that
    /// <see cref="KerbcastCameraEntry"/>/<see cref="KerbcastSetFieldOfViewArgs"/>/
    /// <see cref="KerbcastSetPanArgs"/> live in their own assembly
    /// (<c>GonogoKerbcastUplink.Contract</c>) instead of <c>Sitrep.Contract</c>,
    /// nothing FORCES a future property on this Uplink's own contract types to
    /// declare its unit. Scoped-down copy of
    /// <c>Sitrep.Core.Tests.UnitCoverageTests</c>'s exhaustiveness check,
    /// repointed at THIS assembly.
    ///
    /// <para><b>Why a copy, not a shared helper, still.</b> Same call the
    /// MechJeb pilot and the Avionics relocation made: a third Uplink does not
    /// yet justify a shared <c>UnitCoverageAssertion.AssertExhaustive(Assembly)</c>
    /// helper project. Worth extracting once a fourth Uplink migrates.</para>
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's three contract types
    /// carry twenty-five scalar properties total and every one is already
    /// annotated, so the surface starts, and must stay, entirely covered: same
    /// zero-pending starting point as MechJeb's and Avionics's.</para>
    ///
    /// <para><b>What this one exercises that neither predecessor did alone.</b>
    /// <see cref="KerbcastCameraEntry"/> is an outbound READ payload (like
    /// <c>AvionicsStatus</c>): its nine <c>Units.Degrees</c> properties
    /// genuinely retype to <c>Value&lt;"deg"&gt;</c> in the generated contract
    /// (see <c>KerbcastRtConfig.Configure</c>'s doc comment).
    /// <see cref="KerbcastSetFieldOfViewArgs"/>/<see cref="KerbcastSetPanArgs"/>
    /// are command args (like MechJeb's two types): their own
    /// <c>Units.Degrees</c> properties stay bare, since
    /// <c>RtConfig.ApplyUnitValueTypes</c> deliberately skips inbound-only
    /// args. This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>) for all three types alike; the
    /// generated-file/import side is <c>generated-value-import.test.ts</c> in
    /// this Uplink's client package.</para>
    /// </summary>
    public class KerbcastUnitCoverageTests
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
        /// sequence/dictionary branches this Uplink's three flat DTOs have no
        /// use for yet: kept simple deliberately, extend alongside a real need
        /// rather than pre-building unreachable branches.
        /// </summary>
        private static bool RequiresUnit(PropertyInfo prop) => IsScalar(Unwrap(prop.PropertyType));

        private static IEnumerable<Type> ContractTypes() =>
            typeof(KerbcastCameraEntry).Assembly.GetTypes()
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
                "These GonogoKerbcastUplink.Contract wire properties carry no [SitrepUnit]:\n  " +
                string.Join("\n  ", bare) +
                "\n\nDeclare one (Units.Degrees etc.), or a non-quantity token (Units.Count/" +
                "Id/Text/Flag/Enumeration/NotApplicable) if it genuinely is not a magnitude. " +
                "This Uplink started fully annotated; it should never regress.");
        }
    }
}
