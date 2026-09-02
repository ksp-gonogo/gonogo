// Every command an Uplink registers a handler for must also be declared in its
// manifest, and one registration failing must not skip the rest.
//
// WHY THIS IS SHARED RATHER THAN WRITTEN PER UPLINK. On 2026-08-31 the whole
// telemetry mod failed to start on the rig, reporting:
//
//   gate requirements that cannot be enforced: command "rp1.facility.upgrade"
//   requires gate kind "rp1.facilities"
//
// rp1.facility.upgrade was innocent. A DIFFERENT command had been registered
// with no matching declaration; AddCommandHandler throws for that, the Uplink's
// single try/catch around its whole registration block turned the throw into a
// health string, and every registration after it was skipped, one of which was
// the gate evaluator rp1.facility.upgrade's requirement needed.
//
// Three properties of that failure are why it belongs to every Uplink and not
// just the one that had it:
//
//   1. The symptom names an INNOCENT command, so the reader starts in the wrong
//      file.
//   2. The fault is invisible to every per-command test. Each command's own
//      tests passed; the manifest's tests passed; only the two together fail.
//   3. Any Uplink that fail-softs a block of registrations has it. The shape is
//      idiomatic here, so the bug is available to all of them.
//
// WHAT THESE CANNOT SEE, and it is not a small caveat. They ask what Register
// DID, so they are worth exactly as much as the Register the headless test build
// can run, and for most Uplinks here that is nothing. KosExtension and
// MechJebUplink keep their whole registration body in a .Ksp.cs half the test
// csproj deliberately excludes, so Register forwards to an unimplemented
// `partial void` that compiles away to nothing; an Uplink that gates
// registration on a reflection probe of a mod that is not loaded returns early.
// Either way nothing registers, nothing is compared, and the test passes against
// an Uplink whose wiring is entirely missing. That is how three of the four
// projects holding these assertions held a guard that could not fail.
//
// So a caller that cannot ALSO show a non-zero registration count (as
// Rp1UplinkStartsTests does, off its stand-in RP-1 types) is not covered by
// these, and should not be read as covered. The gate that does not depend on
// running Register is Sitrep.Core.Tests.UplinkWiringCoverageTests, which pairs
// the same two halves by walking every Uplink's SOURCE.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Assertions about the agreement between what an Uplink DECLARES and what it
    /// REGISTERS. Call both from each Uplink's own test project.
    /// </summary>
    public static class CommandRegistrationAssertion
    {
        /// <summary>
        /// Every command handler the Uplink registers has a matching
        /// <see cref="CommandDeclaration"/>.
        ///
        /// <para>The engine already enforces this and throws; the problem is that
        /// the throw lands inside the Uplink's own fail-soft, where it becomes a
        /// health string nobody reads until the mod will not start. Asserted here
        /// it names the offending command directly.</para>
        /// </summary>
        /// <returns>The commands registered without a declaration, empty when correct.</returns>
        public static IReadOnlyList<string> UndeclaredRegistrations(ISitrepUplink uplink)
        {
            if (uplink == null)
            {
                throw new ArgumentNullException(nameof(uplink));
            }

            var declared = new HashSet<string>(
                (uplink.Manifest.Commands ?? new List<CommandDeclaration>()).Select(c => c.Command));

            var host = new RegistrationRecordingHost();
            uplink.Register(host);

            return host.HandlersRegistered.Where(c => !declared.Contains(c)).ToList();
        }

        /// <summary>
        /// Every topic the Uplink takes a publisher for is declared as a channel
        /// in its manifest.
        ///
        /// <para>The same half-wired shape as an undeclared command, with a
        /// quieter failure: an undeclared channel does not throw at all. The
        /// publisher works, the Uplink publishes into it every tick, and the
        /// engine simply refuses the subscription, so the topic is missing from
        /// the wire with nothing logged anywhere. Found live on 2026-08-31, when
        /// rp1.fundTarget answered no subscribe while its siblings answered
        /// theirs.</para>
        /// </summary>
        /// <returns>Topics published to but never declared, empty when correct.</returns>
        public static IReadOnlyList<string> UndeclaredPublishers(ISitrepUplink uplink)
        {
            if (uplink == null)
            {
                throw new ArgumentNullException(nameof(uplink));
            }

            var declared = new HashSet<string>(
                (uplink.Manifest.Channels ?? new List<ChannelDeclaration>()).Select(c => c.Topic));

            var host = new RegistrationRecordingHost();
            uplink.Register(host);

            return host.PublishersTaken.Where(t => !declared.Contains(t)).Distinct().ToList();
        }

        /// <summary>
        /// A registration that throws does not cost the registrations after it.
        ///
        /// <para>Takes a FACTORY rather than an instance because it registers
        /// twice and an Uplink that has already registered may not be asked
        /// again.</para>
        /// </summary>
        /// <returns>
        /// How many handlers were registered with no failure, and how many
        /// survived one refusal. The second should be exactly one fewer.
        /// </returns>
        public static (int WithoutFailure, int AfterOneRefusal) SurvivesOneRegistrationFailure(
            Func<ISitrepUplink> factory)
        {
            if (factory == null)
            {
                throw new ArgumentNullException(nameof(factory));
            }

            var all = new RegistrationRecordingHost();
            factory().Register(all);

            var refusing = new RegistrationRecordingHost { RefuseFirstHandler = true };
            factory().Register(refusing);

            return (all.HandlersRegistered.Count, refusing.HandlersRegistered.Count);
        }
    }
}
