using Sitrep.Contract.TestSupport;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// The shipped conformance assertion can SEE a non-conforming implementation.
    ///
    /// <para><b>Why this is not circular.</b> <c>SeamIsGoodTests</c> in
    /// <c>Sitrep.Core.Tests</c> checks that an assertion EXISTS for each seam; it
    /// cannot check that the assertion asserts anything, and an assertion that
    /// asserts nothing is worse than none because it reads as coverage. This is the
    /// other half: a conforming provider passes, and each thing the contract
    /// actually promises is broken in turn and must be caught. If a promise were
    /// dropped from <see cref="SeamConformance"/>, the corresponding case here goes
    /// green in the wrong direction and fails.</para>
    ///
    /// <para>It lives beside the contract rather than in the Uplink suites because
    /// it is about the ASSERTION, not about any one provider.</para>
    /// </summary>
    public class SeamConformanceTests
    {
        private sealed class Provider : ISitrepProvider
        {
            private readonly string[] _ids;
            private int _reads;

            internal Provider(params string[] ids) => _ids = ids;

            public string ProviderId => _ids[_reads++ % _ids.Length];
        }

        [Fact]
        public void AConformingProviderPasses()
        {
            SeamConformance.AssertProviderContract(new Provider("kepler"));
        }

        [Fact]
        public void AnEmptyProviderIdIsCaught()
        {
            Assert.ThrowsAny<XunitException>(
                () => SeamConformance.AssertProviderContract(new Provider("   ")));
        }

        [Fact]
        public void AProviderIdThatChangesBetweenReadsIsCaught()
        {
            Assert.ThrowsAny<XunitException>(
                () => SeamConformance.AssertProviderContract(new Provider("kepler", "stock")));
        }

        [Fact]
        public void AProviderIdThatIsADisplayNameIsCaught()
        {
            Assert.ThrowsAny<XunitException>(
                () => SeamConformance.AssertProviderContract(new Provider("Kepler Propagator")));
        }

        [Fact]
        public void AReportedIdThatDisagreesWithTheRegisteredOneIsCaught()
        {
            var registration = new ProviderRegistration { Capability = "propagation", Id = "stock" };

            Assert.ThrowsAny<XunitException>(
                () => SeamConformance.AssertProviderContract(new Provider("kepler"), registration));
        }

        [Fact]
        public void AReportedIdThatAgreesWithTheRegisteredOnePasses()
        {
            var registration = new ProviderRegistration { Capability = "propagation", Id = "kepler" };

            SeamConformance.AssertProviderContract(new Provider("kepler"), registration);
        }
    }
}
