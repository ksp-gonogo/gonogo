using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That a SCET alarm's onboard actions are actually REACHED by the shipped
    /// uplink.
    ///
    /// <para><c>ScetAlarmActionsTests</c> proves the rules and the runner. It
    /// cannot prove the uplink asks them: <c>ScetAlarmUplink</c> needs a live
    /// scene, so each wiring below is reachable only as source text, and each one
    /// lost fails silently. An arm that skips the refusal accepts an action the
    /// craft could not honestly run; a capture that skips the runner fires the
    /// alarm and does nothing; an actuator with no backend refuses every custom
    /// group.</para>
    /// </summary>
    public class ScetAlarmActionsAreWiredTests
    {
        private static string Uplink() => CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

        [Fact]
        public void the_arm_asks_whether_its_actions_are_allowed()
        {
            var arm = CurrencyDelaySourceText.MethodBody(
                Uplink(), "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)");

            Assert.Contains("ScetAlarmActions.RefusalFor(args)", arm, StringComparison.Ordinal);
        }

        [Fact]
        public void the_capture_runs_the_actions_its_fires_queued()
        {
            var uplink = Uplink();
            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            var run = CurrencyDelaySourceText.MethodBody(
                uplink, "private void RunActions(List<ScetAlarmActionsDue> actionsDue)");

            Assert.Contains("tick.ActionsDue", capture, StringComparison.Ordinal);
            Assert.Contains("RunActions(actionsDue)", capture, StringComparison.Ordinal);
            Assert.Contains("ScetAlarmActions.Run(due, flying, _actuator, EngagedNow)", run, StringComparison.Ordinal);
        }

        /// <summary>
        /// The uplink builds its own actuator, and a custom group is set through
        /// the elected backend, which only the caller can install.
        /// </summary>
        [Fact]
        public void its_actuator_is_given_the_elected_action_groups_backend()
        {
            var register = CurrencyDelaySourceText.MethodBody(Uplink(), "public void Register(IUplinkHost host)");

            Assert.Contains("ActionGroupsElection.Elected(kernel)", register, StringComparison.Ordinal);
            Assert.Contains("SetActionGroupsBackendSource(_actionGroups)", register, StringComparison.Ordinal);
        }
    }
}
