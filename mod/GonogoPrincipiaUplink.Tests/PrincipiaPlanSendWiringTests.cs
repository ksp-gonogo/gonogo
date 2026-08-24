using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The wiring for the composed send. The rules that decide whether a plan may be
    /// installed are tested elsewhere; those tests all pass whether or not anything
    /// can reach them, which is how a command ships unreachable.
    /// </summary>
    public class PrincipiaPlanSendWiringTests
    {
        [Fact]
        public void TheUplinkDeclaresTheComposedSendAsACommand()
        {
            var manifest = new PrincipiaUplink().Manifest;

            Assert.Contains(
                manifest.Commands, c => c.Command == PlanCommands.SendCommand);
        }

        [Fact]
        public void TheSendIsDelayedLikeEveryOtherPlanWrite()
        {
            // A command centre telling a craft what to fly is the case the delay model
            // exists for. TrueNow here would let a plan take effect before the light
            // carrying it could have arrived.
            var manifest = new PrincipiaUplink().Manifest;

            var send = manifest.Commands.First(c => c.Command == PlanCommands.SendCommand);

            Assert.True(send.Delayed);
        }

        [Fact]
        public void TheCommandIsNamedUnderThePlanFamily()
        {
            // Clients discover it by prefix, so the name is part of the contract.
            Assert.Equal("principia.plan.send", PlanCommands.SendCommand);
        }

        [Fact]
        public void SendingNothingIsRefusedRatherThanTreatedAsAnEmptyPlan()
        {
            // A command that arrived without its payload must not read as "install a
            // plan with no burns", which is a real and destructive instruction.
            var commands = new PlanCommands(() => null, () => null);
            commands.BindToCallingThread();

            var result = commands.SendPlan(null);

            // Asserting only that it refused is not enough, and mutation testing is
            // how that was found: with no session it refuses anyway, so the test
            // passed against a version that quietly turned missing args into an empty
            // plan. The REASON is what distinguishes them.
            Assert.NotNull(result.Payload);
            Assert.Equal(
                (int)PrincipiaWriteOutcome.Refused, (int)result.Payload!["outcome"]!);
            Assert.Contains(
                "no arguments",
                (string)result.Payload!["refusalDetail"]!,
                System.StringComparison.OrdinalIgnoreCase);
        }
    }
}
