// What this Uplink DECLARES and what it REGISTERS have to agree.
//
// Shared assertions, because the bug they guard is shared. On 2026-08-31 the
// whole telemetry mod failed to start because ONE command in one Uplink was
// registered with no matching declaration: AddCommandHandler throws for that, the
// Uplink's single try/catch around its whole registration block turned the throw
// into a health string, and every registration after it was skipped, including a
// gate evaluator that a DIFFERENT command's declared requirement needed. The
// error named that innocent command.
//
// The channel half is quieter and has no exception at all: a publisher taken for
// an undeclared topic works, publishes every tick, and is simply refused at
// subscribe, so the topic is missing from the wire with nothing logged.
using System;
using Gonogo.MechJebUplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    public class UplinkWiringTests
    {
        [Fact]
        public void Every_command_it_registers_is_also_declared()
        {
            var undeclared = CommandRegistrationAssertion.UndeclaredRegistrations(new MechJebUplink());

            Assert.True(
                undeclared.Count == 0,
                "registered with no CommandDeclaration, which throws inside the Uplink's own "
                + "fail-soft and silently skips every registration after it: "
                + string.Join(", ", undeclared));
        }

        [Fact]
        public void Every_topic_it_publishes_to_is_also_declared()
        {
            var undeclared = CommandRegistrationAssertion.UndeclaredPublishers(new MechJebUplink());

            Assert.True(
                undeclared.Count == 0,
                "published to with no ChannelDeclaration, so the engine refuses every subscribe "
                + "and the topic is silently absent from the wire: " + string.Join(", ", undeclared));
        }
    }
}
