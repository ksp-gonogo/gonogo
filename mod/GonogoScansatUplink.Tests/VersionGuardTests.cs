using Gonogo.ScansatUplink;
using Xunit;
using Good = GonogoScansatUplink.Tests.Fakes.Good;

namespace GonogoScansatUplink.Tests
{
    public class VersionGuardTests
    {
        [Fact]
        public void Probe_NullAssembly_FailsSoft()
        {
            var result = VersionGuard.Probe(null);

            Assert.False(result.IsAvailable);
            Assert.Contains("not loaded", result.Reason);
        }

        [Fact]
        public void ProbeTypes_AllMembersPresent_ExpectedEnumValues_Succeeds()
        {
            var types = new[]
            {
                typeof(Good.SCANUtil), typeof(Good.SCANcontroller), typeof(Good.SCANdata), typeof(Good.SCANtype),
            };

            var result = VersionGuard.ProbeTypes(types);

            Assert.True(result.IsAvailable);
            Assert.Null(result.Reason);
        }

        [Fact]
        public void ProbeTypes_MissingMember_FailsSoft_DoesNotThrow()
        {
            var types = new[]
            {
                typeof(GonogoScansatUplink.Tests.Fakes.MissingMember.SCANUtil),
                typeof(GonogoScansatUplink.Tests.Fakes.MissingMember.SCANcontroller),
                typeof(GonogoScansatUplink.Tests.Fakes.MissingMember.SCANdata),
                typeof(GonogoScansatUplink.Tests.Fakes.MissingMember.SCANtype),
            };

            var result = VersionGuard.ProbeTypes(types);

            Assert.False(result.IsAvailable);
            Assert.Contains("isCovered", result.Reason);
        }

        [Fact]
        public void ProbeTypes_RenumberedEnumValue_FailsSoft()
        {
            var types = new[]
            {
                typeof(GonogoScansatUplink.Tests.Fakes.RenumberedEnum.SCANUtil),
                typeof(GonogoScansatUplink.Tests.Fakes.RenumberedEnum.SCANcontroller),
                typeof(GonogoScansatUplink.Tests.Fakes.RenumberedEnum.SCANdata),
                typeof(GonogoScansatUplink.Tests.Fakes.RenumberedEnum.SCANtype),
            };

            var result = VersionGuard.ProbeTypes(types);

            Assert.False(result.IsAvailable);
            Assert.Contains("renumbered", result.Reason);
        }

        [Fact]
        public void ProbeTypes_MissingType_FailsSoft()
        {
            var types = new[] { typeof(Good.SCANUtil) }; // controller/data/type missing

            var result = VersionGuard.ProbeTypes(types);

            Assert.False(result.IsAvailable);
        }
    }
}
