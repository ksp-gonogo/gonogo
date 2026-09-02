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

        /// <summary>
        /// This Uplink is ARMED: ExpectedClientHash.g.cs carries a real hash, so the
        /// manifest the loader reads must carry it too or the arming does nothing
        /// (the loader records the mod-hash arm as pending and falls back to the
        /// two-way index==bytes check, with nothing red anywhere).
        ///
        /// The mapping is the invariant in both directions: an empty const reports
        /// null, because the contract reserves null, not "", for "this DLL vouches
        /// for nothing"; a filled one reports the hash.
        ///
        /// Read straight off the Uplink rather than through UplinkDiscovery, which
        /// lives in Sitrep.Host: this project may reference Sitrep.Contract and its
        /// own contract slice, and the manifest is a plain property, so the
        /// discovery round-trip would buy nothing but an isolation breach.
        /// The cross-Uplink half, which no single project can assert, is
        /// Sitrep.Core.Tests.UplinkArmingCoverageTests.
        /// </summary>
        [Fact]
        public void Manifest_ExpectedClientHash_MirrorsTheGeneratedConst()
        {
            var expected = string.IsNullOrEmpty(ExpectedClientHash.Value)
                ? null
                : ExpectedClientHash.Value;

            Assert.Equal(expected, new MechJebUplink().Manifest.ExpectedClientHash);
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
