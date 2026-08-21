using System;
using System.IO;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Maneuver
{
    /// <summary>
    /// The maneuver write path asks the facility that actually authorises a
    /// maneuver node.
    ///
    /// <para>It used to ask <c>patchedConicSolver != null</c>, which derives
    /// from the <b>Tracking Station</b>, and called that flight planning, which
    /// is <b>Mission Control</b>. The two buildings upgrade independently, so
    /// Tracking Station 2 with Mission Control 1 — an ordinary early-career
    /// save — plotted burns the player had not bought, and the craft flew them.
    /// See <see cref="Gonogo.KSP.ManeuverWriteAuthority"/> for the decompiled
    /// bodies of both.</para>
    ///
    /// <para>The wiring is asserted structurally for the reason
    /// <see cref="ManeuverPlanOwnershipTests"/> already gives: the actuator's
    /// command bodies reference Unity assemblies the reference set does not
    /// ship, so a headless test cannot enter the methods at all.</para>
    /// </summary>
    public class ManeuverWriteAuthorityTests
    {
        [Fact]
        public void EveryAuthoritySatisfiedPlantsTheNode()
        {
            Assert.Null(Refusal(plans: true));
        }

        /// <summary>
        /// The bug. A Tracking Station past patched conics attaches the solver,
        /// so the old gate passed; Mission Control below
        /// <c>UnlockedFlightPlanning</c>'s 0.4 means the player has no route to
        /// a node in game.
        /// </summary>
        [Fact]
        public void ASolverWithoutMissionControlsFlightPlanningStillRefuses()
        {
            var refusal = Refusal(plans: true, flightPlanningUnlocked: false);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.NotUnlocked, refusal!.Value.Code);
            Assert.Contains("flight planning", refusal.Value.Detail);
        }

        /// <summary>
        /// Removing a node is the undo, not a capability. Refusing one because
        /// the building it was planned from has since been downgraded would
        /// strand a node with no way to clear it.
        /// </summary>
        [Fact]
        public void RemovingANodeDoesNotNeedFlightPlanning()
        {
            Assert.Null(Refusal(plans: false, flightPlanningUnlocked: false));
        }

        /// <summary>
        /// The reverse direction we were wrong in. There is a vessel; the fact
        /// is a facility tier, and "no vessel" sends an operator looking for the
        /// wrong thing.
        /// </summary>
        [Fact]
        public void NoSolverIsAFacilityTierAndNotAMissingVessel()
        {
            var refusal = Refusal(plans: true, solverAttached: false);

            Assert.Equal(CommandErrorCode.NotUnlocked, refusal!.Value.Code);
            Assert.Contains("Tracking Station", refusal.Value.Detail);
        }

        [Fact]
        public void NoVesselIsStillNoVessel()
        {
            var refusal = Refusal(plans: true, hasVessel: false);

            Assert.Equal(CommandErrorCode.NoVessel, refusal!.Value.Code);
        }

        /// <summary>
        /// <c>ControlTypes.MANNODE_ADDEDIT</c> / <c>MANNODE_DELETE</c>: stock's
        /// own add-node handler is one line of exactly this, and <c>Vessel</c>
        /// sets the lock itself for a craft with no control. It resolves by
        /// waiting, which is what separates it from the facility arms.
        /// </summary>
        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void ALockedNodeEditorRefusesBothPlansAndDeletes(bool plans)
        {
            var refusal = Refusal(plans, nodeEditingUnlocked: false);

            Assert.Equal(CommandErrorCode.NotClearToProceed, refusal!.Value.Code);
        }

        /// <summary>
        /// A sandbox save has no <c>ScenarioUpgradeableFacilities</c> at all, so
        /// the caller cannot read a tier and reports the switch open. A career
        /// gate that refused where there is no career would break every sandbox
        /// maneuver node.
        /// </summary>
        [Fact]
        public void AnUnreadableFacilityTierReadsAsUnlocked()
        {
            Assert.Null(Refusal(plans: true, flightPlanningUnlocked: true));
        }

        /// <summary>
        /// The facility name comes from KSP's Localizer and can come back empty.
        /// An empty clause reads as a sentence that failed rather than a reason.
        /// </summary>
        [Fact]
        public void AnUnnamedFacilityStillNamesSomething()
        {
            var refusal = ManeuverWriteAuthority.RefusalFor(
                hasVessel: true,
                solverAttached: true,
                flightPlanningUnlocked: false,
                nodeEditingUnlocked: true,
                plans: true,
                trackingStationName: "",
                missionControlName: "");

            Assert.Contains("Mission Control", refusal!.Value.Detail);
        }

        [Theory]
        [InlineData("AddManeuverNode")]
        [InlineData("UpdateManeuverNode")]
        [InlineData("RemoveManeuverNode")]
        public void EveryWriteCommandConsultsTheFacilityAuthority(string command)
        {
            // Fixing one of the three would leave two doors onto a plan the
            // player has not bought.
            var source = File.ReadAllText(ActuatorSourcePath());
            var signature = source.IndexOf(command + "(", StringComparison.Ordinal);
            Assert.True(signature >= 0, command + " not found in KspVesselActuator");

            var body = source.Substring(signature);
            var nextMethod = body.IndexOf("\n        public ", StringComparison.Ordinal);
            if (nextMethod > 0) body = body.Substring(0, nextMethod);

            Assert.Contains("ManeuverWriteRefusal(", body);
        }

        private static ManeuverRefusal? Refusal(
            bool plans,
            bool hasVessel = true,
            bool solverAttached = true,
            bool flightPlanningUnlocked = true,
            bool nodeEditingUnlocked = true) =>
            ManeuverWriteAuthority.RefusalFor(
                hasVessel,
                solverAttached,
                flightPlanningUnlocked,
                nodeEditingUnlocked,
                plans,
                "Tracking Station",
                "Mission Control");

        private static string ActuatorSourcePath()
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !Directory.Exists(Path.Combine(dir, "mod", "Gonogo.KSP")))
            {
                dir = Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return Path.Combine(dir!, "mod", "Gonogo.KSP", "KspVesselActuator.cs");
        }
    }
}
