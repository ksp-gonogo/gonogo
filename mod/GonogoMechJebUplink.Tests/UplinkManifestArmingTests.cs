using Gonogo.MechJebUplink;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    public class UplinkManifestArmingTests
    {
        /// <summary>
        /// This Uplink is ARMED: ExpectedClientHash.g.cs carries a real hash, so the
        /// manifest the loader reads must carry it too or the arming does nothing
        /// (the loader records the mod-hash arm as pending and falls back to the
        /// two-way index==bytes check, with nothing red anywhere).
        ///
        /// The mapping is the invariant in both directions: an empty const reports
        /// null, because the contract reserves null, not "", for "this DLL vouches
        /// for nothing"; a filled one reports the hash.
        ///
        /// Read straight off the Uplink rather than through UplinkDiscovery, which
        /// lives in Sitrep.Host: this project may reference Sitrep.Contract and its
        /// own contract slice, and the manifest is a plain property, so the
        /// discovery round-trip would buy nothing but an isolation breach.
        /// The cross-Uplink half, which no single project can assert, is
        /// Sitrep.Core.Tests.UplinkArmingCoverageTests.
        /// </summary>
        [Fact]
        public void Manifest_ExpectedClientHash_MirrorsTheGeneratedConst()
        {
            var expected = string.IsNullOrEmpty(ExpectedClientHash.Value)
                ? null
                : ExpectedClientHash.Value;

            Assert.Equal(expected, new MechJebUplink().Manifest.ExpectedClientHash);
        }
    }
}
