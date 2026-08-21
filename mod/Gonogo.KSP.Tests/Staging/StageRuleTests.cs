using System;
using System.IO;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Staging
{
    /// <summary>
    /// A console stage now does what pressing the space bar does.
    ///
    /// <para><c>FlightInputHandler</c> gates staging on
    /// <c>InputLockManager.IsUnlocked(ControlTypes.STAGING)</c> and on
    /// <c>Vessel.ActionControlBlocked(KSPActionGroup.Stage)</c>, and fires
    /// <c>ActionGroups.ToggleGroup(KSPActionGroup.Stage)</c> either way. The
    /// console checked for an active vessel and called
    /// <c>StageManager.ActivateNextStage()</c>, so it staged through a lock and
    /// never fired the group: part actions the player had assigned to Stage did
    /// not run on a console-issued stage, which is a silent behavioural
    /// difference from the space bar rather than a missing refusal.</para>
    /// </summary>
    public class StageRuleTests
    {
        [Fact]
        public void AnUnlockedStagingCommandIsNotRefused()
        {
            Assert.Null(StageRule.RefusalFor(hasVessel: true, stagingUnlocked: true));
        }

        [Fact]
        public void AVesselIsStillRequired()
        {
            var refusal = StageRule.RefusalFor(hasVessel: false, stagingUnlocked: true);

            Assert.Equal(CommandErrorCode.NoVessel, refusal!.Value.Code);
        }

        /// <summary>
        /// <c>ControlTypes.STAGING</c>, which tutorials and <c>manualStageLock</c>
        /// set. It resolves by waiting, which is what makes it a moment.
        /// </summary>
        [Fact]
        public void ALockedStagingControlRefuses()
        {
            var refusal = StageRule.RefusalFor(hasVessel: true, stagingUnlocked: false);

            Assert.Equal(CommandErrorCode.NotClearToProceed, refusal!.Value.Code);
        }

        /// <summary>
        /// The Making History mission override holds the stack. Stock does NOT
        /// treat that as a refusal: the keypress still fires the Stage action
        /// group, because <c>ToggleGroup</c> sits outside that arm and inside
        /// the lock.
        /// </summary>
        [Fact]
        public void AMissionOverrideHoldsTheStackWithoutRefusingTheCommand()
        {
            Assert.False(StageRule.AdvancesTheStack(actionControlBlocked: true));
            Assert.Null(StageRule.RefusalFor(hasVessel: true, stagingUnlocked: true));
        }

        [Fact]
        public void AnUnblockedVesselAdvancesTheStack()
        {
            Assert.True(StageRule.AdvancesTheStack(actionControlBlocked: false));
        }

        /// <summary>
        /// The side effect is the half a rule cannot hold: firing the Stage
        /// action group is what makes a console stage the same event as the
        /// space bar for every part the player assigned to it. Asserted against
        /// the source for the reason <c>ManeuverPlanOwnershipTests</c> gives:
        /// the actuator's body reaches Unity assemblies the reference set does
        /// not ship.
        /// </summary>
        [Fact]
        public void TheStageCommandFiresTheStageActionGroup()
        {
            var source = File.ReadAllText(ActuatorSourcePath());
            var signature = source.IndexOf("CommandResult<int> Stage()", StringComparison.Ordinal);
            Assert.True(signature >= 0, "Stage() not found in KspVesselActuator");

            var body = source.Substring(signature);
            var nextMethod = body.IndexOf("\n        public ", StringComparison.Ordinal);
            if (nextMethod > 0) body = body.Substring(0, nextMethod);

            Assert.Contains("ToggleGroup(KSPActionGroup.Stage)", body);
            Assert.Contains("StageRule.RefusalFor(", body);
            Assert.Contains("StageRule.AdvancesTheStack(", body);
        }

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
