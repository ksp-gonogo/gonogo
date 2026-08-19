using System.IO;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Maneuver
{
    /// <summary>
    /// The maneuver WRITE path respects the same election the read path does.
    ///
    /// <para>The read side has always known the plan might not be ours
    /// (<c>KspHost.BuildManeuverNodes</c>: "Whatever the ELECTED provider
    /// answered, never <c>patchedConicSolver</c> directly"). The write side did not
    /// check at all, so under a foreign plan owner it produced a GHOST NODE: we
    /// mutate stock's solver, the owning planner never reads it, and the operator
    /// sees a maneuver node that does precisely nothing.</para>
    ///
    /// <para>This file exists because a doc comment cannot establish that a branch
    /// is CORRECT, only that it should not be deleted. Nothing on a stock install
    /// has ever executed the refusal, since the maneuver-plan election has exactly
    /// one member, so "correct in advance" needed evidence.</para>
    ///
    /// <para><b>Why the three commands are asserted STRUCTURALLY rather than by
    /// calling them.</b> Their bodies reference Unity types that the
    /// reference-assembly set does not ship (`UnityEngine.PhysicsModule`), so a
    /// headless test cannot enter the methods at all: it fails on assembly load
    /// before reaching any guard. So the RULE is exercised directly and the WIRING
    /// is checked against the source. Stated plainly because a structural check is
    /// weaker than a behavioural one and a reader should know which they have.</para>
    /// </summary>
    public class ManeuverPlanOwnershipTests
    {
        [Fact]
        public void OnlyAForeignPlanRefusesTheWrite()
        {
            Assert.Equal(
                CommandErrorCode.PlanNotOwned,
                ManeuverPlanWriteRule.RefusalFor(PlanOwner.Foreign));
        }

        [Fact]
        public void StockOwningThePlanDoesNotRefuse()
        {
            // The negative. A rule that refused everything would pass the test above
            // just as well as one that refuses correctly.
            Assert.Null(ManeuverPlanWriteRule.RefusalFor(PlanOwner.Stock));
        }

        [Fact]
        public void NoPlannerAtAllIsNotAForeignPlanner()
        {
            // Null-planner means the craft cannot hold a plan (an un-upgraded
            // Tracking Station leaves `patchedConicSolver` null), a different fact
            // with its own existing answer. It must not read as somebody else's plan.
            Assert.Null(ManeuverPlanWriteRule.RefusalFor(PlanOwner.None));
        }

        [Theory]
        [InlineData("AddManeuverNode")]
        [InlineData("UpdateManeuverNode")]
        [InlineData("RemoveManeuverNode")]
        public void EveryWriteCommandConsultsTheOwnershipGuard(string command)
        {
            // Fixing only `Add` would leave two doors into a foreign plan, which is
            // not a partial fix but the same bug with a smaller entrance. This is the
            // check that all three stayed shut.
            var source = File.ReadAllText(ActuatorSourcePath());
            var start = source.IndexOf("public CommandResult", System.StringComparison.Ordinal);
            Assert.True(start >= 0);

            var signature = source.IndexOf(command + "(", System.StringComparison.Ordinal);
            Assert.True(signature >= 0, command + " not found in KspVesselActuator");

            // The guard must appear inside the method, which for all three means
            // before the next method's signature. Bounded rather than searching the
            // whole file, so moving the guard out of one method fails this.
            var body = source.Substring(signature);
            var nextMethod = body.IndexOf("\n        public ", System.StringComparison.Ordinal);
            if (nextMethod > 0)
            {
                body = body.Substring(0, nextMethod);
            }
            Assert.Contains("PlanWriteRefusal()", body);
        }

        private static string ActuatorSourcePath()
        {
            // Walk up to the repo root rather than assuming a run directory.
            var dir = Directory.GetCurrentDirectory();
            while (dir != null && !Directory.Exists(Path.Combine(dir, "mod", "Gonogo.KSP")))
            {
                dir = Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return Path.Combine(dir!, "mod", "Gonogo.KSP", "KspVesselActuator.cs");
        }
    }
}
