using System;
using System.IO;
using Xunit;

namespace Gonogo.KSP.Tests.Maneuver
{
    /// <summary>
    /// A facility upgraded in flight raises the Tracking Station's tier but stock
    /// attaches a vessel's patched-conics solver only when the vessel loads, so
    /// the availability read said yes while the add command, which needs the
    /// solver, said not unlocked until a scene reload.
    ///
    /// <para>The actuator's bodies reference Unity assemblies the reference set
    /// does not ship, so the wiring is asserted structurally, as in
    /// <see cref="ManeuverWriteAuthorityTests"/>.</para>
    /// </summary>
    public class PatchedConicsAttachTests
    {
        [Fact]
        public void AVesselWithNoSolverIsGivenOne()
        {
            Assert.True(PatchedConicsAttachRule.ShouldAttach(
                hasVessel: true, reportingTheCraftAKerbalLeft: false, solverAttached: false));
        }

        [Fact]
        public void AVesselWithASolverIsLeftAlone()
        {
            Assert.False(PatchedConicsAttachRule.ShouldAttach(
                hasVessel: true, reportingTheCraftAKerbalLeft: false, solverAttached: true));
        }

        [Fact]
        public void NoVesselHasNothingToAttachTo()
        {
            Assert.False(PatchedConicsAttachRule.ShouldAttach(
                hasVessel: false, reportingTheCraftAKerbalLeft: false, solverAttached: false));
        }

        /// <summary>
        /// A kerbal stepping out detaches the craft's solver on purpose, so
        /// attaching it again would fight the game.
        /// </summary>
        [Fact]
        public void AnEvaKeepsTheDetachedSolverDetached()
        {
            Assert.False(PatchedConicsAttachRule.ShouldAttach(
                hasVessel: true, reportingTheCraftAKerbalLeft: true, solverAttached: false));
        }

        [Fact]
        public void TheWriteRefusalAttachesBeforeItReadsTheSolver()
        {
            var source = File.ReadAllText(SourcePath("KspVesselActuator.cs"));
            var start = source.IndexOf("private static Refusal? ManeuverWriteRefusal", StringComparison.Ordinal);
            Assert.True(start >= 0);
            var body = source.Substring(start);
            var attach = body.IndexOf("EnsurePatchedConicsSolver(", StringComparison.Ordinal);
            var read = body.IndexOf("solverAttached:", StringComparison.Ordinal);
            Assert.True(attach >= 0, "the write refusal never attaches the solver");
            Assert.True(attach < read, "the solver is read before it is attached");
        }

        [Fact]
        public void AFacilityUpgradeAttachesTheActiveVesselsSolver()
        {
            var source = File.ReadAllText(SourcePath("KspHost.cs"));
            var start = source.IndexOf("private void OnCareerFacility(", StringComparison.Ordinal);
            Assert.True(start >= 0);
            var body = source.Substring(start, 400);
            Assert.Contains("EnsurePatchedConicsSolver(", body);
        }

        private static string SourcePath(string file)
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !Directory.Exists(Path.Combine(dir, "mod", "Gonogo.KSP")))
            {
                dir = Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return Path.Combine(dir!, "mod", "Gonogo.KSP", file);
        }
    }
}
