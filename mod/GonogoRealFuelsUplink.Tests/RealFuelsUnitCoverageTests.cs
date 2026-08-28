using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRealFuelsUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the Unit guard: these wire types live in this
    /// Uplink's own assembly, so nothing else forces a future property on them
    /// to declare its unit. The sweep is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// slice; this file names what is this Uplink's own.
    ///
    /// <para>No baseline file: the surface starts entirely covered and must stay
    /// that way.</para>
    /// </summary>
    public class RealFuelsUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(RealFuelsEngines).Assembly,
                "Units.Ratio");

        /// <summary>
        /// The three types are reached and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> would pass on an
        /// EMPTY set, which is what a type quietly losing
        /// <c>[SitrepContract]</c> leaves behind. It also pins that
        /// <see cref="RealFuelsEngineEntry"/> is REACHED: it carries no
        /// <c>[SitrepTopic]</c> of its own and is only on the wire as the element
        /// type of <see cref="RealFuelsEngines.Engines"/>, which is exactly the
        /// shape a sweep can walk past.
        /// </summary>
        [Fact]
        public void TheContractTypesAreExactlyTheThreePayloads() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(RealFuelsEngines).Assembly,
                nameof(RealFuelsEngineEntry),
                nameof(RealFuelsEngines),
                nameof(RealFuelsBoiloff));
    }
}
