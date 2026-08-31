// What this Uplink DECLARES and what it REGISTERS have to agree.
//
// WHY THIS EXISTS, and it is not hypothetical. On 2026-08-31 the whole telemetry
// mod failed to start on the rig with:
//
//   [Gonogo] Failed to start: gate requirements that cannot be enforced:
//   command "rp1.facility.upgrade" requires gate kind "rp1.facilities"
//
// rp1.facility.upgrade was INNOCENT. rp1.strategy.activate had been registered
// with no matching declaration; AddCommandHandler throws for that, the single
// try/catch around the whole registration block turned the throw into a health
// string, and every registration AFTER it was skipped, including the gate
// evaluator that rp1.facility.upgrade's declared requirement needs. So a missing
// declaration on one command took the entire mod offline and named a different
// command on the way out.
//
// The assertions themselves are SHARED, in Sitrep.Contract.TestSupport: the
// fail-soft-a-block-of-registrations shape is idiomatic across every Uplink here,
// so the bug is available to all of them and the guard should be too.
using System;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    [Collection("rp0-static-graph")]
    public class Rp1UplinkStartsTests : IDisposable
    {
        public Rp1UplinkStartsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            Confidence.Instance = null;
            MaintenanceHandler.Instance = null;
        }

        /// <summary>
        /// Every command registered is declared. This is the assertion that names
        /// the offending command; the engine's own start failure names whichever
        /// declaration lost its evaluator instead, which sends a reader to
        /// innocent code.
        /// </summary>
        [Fact]
        public void Every_command_it_registers_is_also_declared()
        {
            var undeclared = CommandRegistrationAssertion.UndeclaredRegistrations(new Rp1ScUplink());

            Assert.True(
                undeclared.Count == 0,
                "registered with no CommandDeclaration, which throws inside the Uplink's own "
                + "fail-soft and silently skips every registration after it: "
                + string.Join(", ", undeclared));
        }

        /// <summary>
        /// Every topic published to is declared as a channel.
        ///
        /// <para>Quieter than the command case and so worth its own assertion: an
        /// undeclared channel throws nothing, publishes happily, and is simply
        /// refused at subscribe. rp1.fundTarget shipped that way and was caught by
        /// probing the live stream, which is not a check that runs anywhere.</para>
        /// </summary>
        [Fact]
        public void Every_topic_it_publishes_to_is_also_declared()
        {
            var undeclared = CommandRegistrationAssertion.UndeclaredPublishers(new Rp1ScUplink());

            Assert.True(
                undeclared.Count == 0,
                "published to with no ChannelDeclaration, so the engine refuses every subscribe "
                + "and the topic is silently absent from the wire: " + string.Join(", ", undeclared));
        }

        /// <summary>
        /// A registration that throws does not cost the registrations after it.
        ///
        /// <para>The structural half, and the reason the declaration test is not
        /// enough on its own: while every registration shares one try/catch, the
        /// first failure ends the block, and the next missing declaration will do
        /// the same damage as the last one.</para>
        /// </summary>
        [Fact]
        public void One_commands_registration_failure_does_not_skip_the_others()
        {
            var (withoutFailure, afterOneRefusal) =
                CommandRegistrationAssertion.SurvivesOneRegistrationFailure(() => new Rp1ScUplink());

            // Guards against passing because nothing registers at all, which is
            // how an exhaustiveness claim goes vacuous.
            Assert.True(withoutFailure > 0, "no command handlers registered at all, so this proves nothing");
            Assert.Equal(withoutFailure - 1, afterOneRefusal);
        }

        /// <summary>
        /// Nothing was swallowed while registering against a working host.
        ///
        /// <para>The COMMAND registrations only. The capability providers are
        /// excluded because a bare Kernel has no capabilities registered and core
        /// registers them before any Uplink runs, so their failure here is a
        /// property of the harness rather than of the Uplink.</para>
        /// </summary>
        [Fact]
        public void No_command_registration_was_swallowed()
        {
            var uplink = new Rp1ScUplink();
            CommandRegistrationAssertion.UndeclaredRegistrations(uplink);

            var swallowed = uplink.Health().Facts
                .Where(f => f.Label.Contains("commands", StringComparison.OrdinalIgnoreCase))
                .Where(f => f.Value != null && f.Value.StartsWith("not registered", StringComparison.Ordinal))
                .Select(f => f.Label + ": " + f.Value)
                .ToList();

            Assert.True(swallowed.Count == 0, string.Join("; ", swallowed));
        }
    }
}
