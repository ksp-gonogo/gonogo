using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoFerramAerospaceResearchUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the Unit guard. <see cref="AeroState"/> lives in
    /// this Uplink's own contract slice rather than in <c>Sitrep.Contract</c>, so
    /// nothing else in the build forces a future property on it to declare its
    /// unit. The sweep is <c>UnitCoverageAssertion.AssertExhaustive</c>, shared
    /// with every other Uplink; this file names what is ours.
    ///
    /// <para><b>Why no baseline file.</b> Every one of this slice's fifteen
    /// properties is annotated on the day it lands, so the surface starts, and
    /// must stay, entirely covered.</para>
    /// </summary>
    public class AeroUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(AeroState).Assembly,
                "Units.Degrees, Contract.Units.KilogramsPerSquareMetre");

        /// <summary>
        /// The one type is reached by the sweep, and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> would pass on an
        /// EMPTY set, which is exactly what a type quietly losing
        /// <c>[SitrepContract]</c> would leave behind.
        /// </summary>
        [Fact]
        public void TheContractTypeIsExactlyTheAeroStatePayload() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(AeroState).Assembly,
                nameof(AeroState));
    }
}
