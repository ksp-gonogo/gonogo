using Gonogo.ActionGroupsExtendedUplink;
using Xunit;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// AGExt is never present in this headless test environment (no
    /// AGExt.dll on the reference path — docs/superpowers/specs/2026-07-17-agx-backend-design.md
    /// §3), so this is exactly the "AGX absent" case every real install
    /// without AGX will also hit: the probe must fail-soft to a NOT-available
    /// instance rather than throwing or returning null. The live
    /// AGX-installed binding itself is Deck-validated (Task 5), mirroring
    /// GonogoRealAntennasUplink.RaReflection's untested-live-binding posture.
    /// </summary>
    public class AgxReflectionTests
    {
        [Fact]
        public void Probe_WithAgxAbsent_ReturnsNotAvailableInstance()
        {
            var agx = AgxReflection.Probe();

            Assert.NotNull(agx);
            Assert.False(agx.IsAvailable);
        }

        [Fact]
        public void Probe_WithAgxAbsent_AssignedGroupsIsNull()
        {
            var agx = AgxReflection.Probe();

            Assert.Null(agx.AssignedGroups());
        }

        [Fact]
        public void Probe_WithAgxAbsent_ActivateReturnsFalse()
        {
            var agx = AgxReflection.Probe();

            Assert.False(agx.Activate(1, true));
            Assert.False(agx.Activate(1, false));
        }
    }
}
