using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// What an Uplink DECLARES and what it REGISTERS have to agree, on every
    /// Uplink rather than on the ones somebody remembered.
    ///
    /// <para>WHY THIS EXISTS. On 2026-08-31 the whole telemetry mod failed to
    /// start on the rig with <c>gate requirements that cannot be enforced: command
    /// "rp1.facility.upgrade" requires gate kind "rp1.facilities"</c>.
    /// rp1.facility.upgrade was innocent: a DIFFERENT command had been registered
    /// with no matching declaration, <c>AddCommandHandler</c> throws for that, the
    /// Uplink's fail-soft turned the throw into a health string, and every
    /// registration after it was skipped, one of which was the gate evaluator that
    /// the named command's requirement needed. The channel half is quieter still
    /// and throws nothing at all: an undeclared topic publishes happily every tick
    /// and is simply refused at subscribe, so it is missing from the wire with
    /// nothing logged.</para>
    ///
    /// <para><b>Why a walk, and why it replaced the per-Uplink form.</b> The guard
    /// written after that outage was a runtime one: hand the Uplink a recording
    /// host, compare against its manifest. It was added to four Uplinks, and on
    /// three of the four it could not fail. Two of them keep their entire
    /// registration body in a <c>.Ksp.cs</c> half that the headless test csproj
    /// deliberately excludes, so <c>Register</c> forwards to an unimplemented
    /// <c>partial void</c> that compiles away to nothing: the test registered
    /// nothing, compared nothing to nothing, and passed. The third declares and
    /// registers no commands or channels at all, so it had nothing to check.
    /// Meanwhile the two Uplinks with the largest command surfaces, ten and five,
    /// had no such test at all, and neither did the four publish-only ones. This
    /// file names none of them on purpose: core may not reach an Uplink, and a
    /// comment is a reach the boundary ratchet counts. A per-project assertion
    /// is the thing that gets forgotten; a walk enrols an Uplink by existing.</para>
    ///
    /// <para><b>The runtime form is still the stronger one where it runs.</b>
    /// <c>Rp1UplinkStartsTests</c> keeps it: that project compiles stand-in RP-1
    /// types, so its <c>Register</c> really executes and it can also assert the
    /// structural half a source walk cannot see, that one registration failing
    /// does not skip the rest. This walk is the floor under every Uplink, not a
    /// replacement for that.</para>
    ///
    /// <para><b>Why source rather than loaded assemblies.</b> No project here may
    /// reference every Uplink (<c>UplinkIsolationTests</c> exists to prevent that
    /// coupling and its debt list is shrink-only), and one loading them from
    /// <c>bin/</c> is green whenever they have not been built, which is the
    /// failure mode a coverage gate must not have. Same shape, and the same
    /// reasoning, as <see cref="UplinkArmingCoverageTests"/>.</para>
    ///
    /// <para><b>What it cannot see.</b> It pairs the two sides unconditionally, so
    /// it does not notice a registration whose <c>IsAvailable</c> guard is a
    /// different one from its declaration's: both names are present, and the
    /// mismatch only shows on an install where one probe resolves and the other
    /// does not. It does not follow a name built by concatenation at runtime
    /// (<see cref="EveryNameTheWalkReadsResolvesToAValue"/> makes that visible
    /// rather than silent), and it does not look at dynamic-namespace sub-topics,
    /// which are correctly absent from the channel list.</para>
    /// </summary>
    public class UplinkWiringCoverageTests
    {
        private readonly ITestOutputHelper _output;

        public UplinkWiringCoverageTests(ITestOutputHelper output) => _output = output;

        /// <summary>
        /// Uplinks that must be seen to register a command handler. A floor, not a
        /// list to keep current: it exists so an extractor that stops matching
        /// <c>host.AddCommandHandler</c> goes red instead of reporting a clean
        /// repo.
        /// </summary>
        private const int MinimumUplinksRegisteringCommands = 4;

        /// <summary>Uplinks that must be seen to take a publisher. Same floor, same reason.</summary>
        private const int MinimumUplinksPublishingTopics = 6;

        [Fact]
        public void EveryCommandAnUplinkRegistersIsAlsoDeclared()
        {
            var offenders = Scan()
                .Where(u => u.UndeclaredCommands.Count > 0)
                .Select(u => u.Name + ": " + string.Join(", ", u.UndeclaredCommands))
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "These commands are registered with no matching CommandDeclaration. "
                + "AddCommandHandler throws for that, the throw lands in the Uplink's own "
                + "fail-soft, and every registration after it is skipped:\n  "
                + string.Join("\n  ", offenders));
        }

        [Fact]
        public void EveryTopicAnUplinkPublishesToIsAlsoDeclared()
        {
            var offenders = Scan()
                .Where(u => u.UndeclaredTopics.Count > 0)
                .Select(u => u.Name + ": " + string.Join(", ", u.UndeclaredTopics))
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "These topics are published to with no matching ChannelDeclaration. Nothing "
                + "throws: the publisher works, the Uplink publishes every tick, and the engine "
                + "refuses every subscribe, so the topic is absent from the wire with nothing "
                + "logged:\n  " + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The walk has to find its subjects or it reports a clean repo while
        /// proving nothing, and it has to find the REGISTRATIONS specifically: the
        /// Uplinks are discovered by <see cref="UplinkProjects"/>, which
        /// <see cref="UplinkArmingCoverageTests.ScanFindsEveryUplinkProject"/>
        /// already holds to <c>Gonogo.sln</c>, but an extractor that matched
        /// nothing inside them would pass every assertion above.
        /// </summary>
        [Fact]
        public void TheWalkSeesTheWiringItIsMeantToCover()
        {
            var scanned = Scan();

            foreach (var uplink in scanned)
            {
                _output.WriteLine(
                    $"{uplink.Name}: {uplink.RegisteredCommands.Count} registered / "
                    + $"{uplink.DeclaredCommands.Count} declared commands, "
                    + $"{uplink.PublishedTopics.Count} published / "
                    + $"{uplink.DeclaredTopics.Count} declared topics");
            }

            var registering = scanned.Where(u => u.RegisteredCommands.Count > 0).Select(u => u.Name).ToList();
            var publishing = scanned.Where(u => u.PublishedTopics.Count > 0).Select(u => u.Name).ToList();

            Assert.True(
                registering.Count >= MinimumUplinksRegisteringCommands,
                $"The walk saw command handlers on only {registering.Count} Uplink(s), expected at "
                + $"least {MinimumUplinksRegisteringCommands}. An extractor that matches nothing "
                + "reports no violations and looks exactly like a correctly wired repo. Saw: "
                + string.Join(", ", registering));

            Assert.True(
                publishing.Count >= MinimumUplinksPublishingTopics,
                $"The walk saw publishers on only {publishing.Count} Uplink(s), expected at least "
                + $"{MinimumUplinksPublishingTopics}. Saw: " + string.Join(", ", publishing));
        }

        /// <summary>
        /// Every name the walk reads has to resolve to the string it carries.
        ///
        /// <para>The comparison is by VALUE, so a name the walk cannot resolve is
        /// not reported as a violation: it drops out of both sides and the pair it
        /// belonged to is silently not checked. That is the same hole this file
        /// exists to close, one level down, so it is asserted rather than
        /// tolerated. A new Uplink naming a command by anything but a string
        /// literal or a <c>const string</c> fails here, which is a request to
        /// teach the walk that shape.</para>
        /// </summary>
        [Fact]
        public void EveryNameTheWalkReadsResolvesToAValue()
        {
            var unresolved = Scan()
                .Where(u => u.Unresolved.Count > 0)
                .Select(u => u.Name + ": " + string.Join(", ", u.Unresolved))
                .ToList();

            Assert.True(
                unresolved.Count == 0,
                "The walk read these command/topic names and could not resolve them to a string, "
                + "so both sides of their pairing silently drop out of the comparison:\n  "
                + string.Join("\n  ", unresolved));
        }

        /// <summary>
        /// Every registration is written on the <c>host</c> parameter, which is
        /// the only receiver the walk reads.
        ///
        /// <para>An Uplink that stashed the host in a field and called
        /// <c>_host.AddCommandHandler</c> would register commands this walk never
        /// sees, report no violation, and be indistinguishable from a correctly
        /// wired one. Nothing does that today and there is no reason to: the shape
        /// is asserted so it stays that way rather than quietly blinding the
        /// gate.</para>
        /// </summary>
        [Fact]
        public void EveryRegistrationIsWrittenOnTheHostParameter()
        {
            var offenders = Scan()
                .Where(u => u.OffHostCalls.Count > 0)
                .Select(u => u.Name + ": " + string.Join(", ", u.OffHostCalls))
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "These registrations are made on something other than the host parameter, so the "
                + "walk cannot see them and reports nothing about whether they are declared. "
                + "Register on the host parameter, or teach the walk this receiver:\n  "
                + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The instrument check, and the reason anything above can be believed. A
        /// guard that cannot fail is what this file replaces, so shipping a second
        /// one would be worse than shipping nothing: the walk is made to see a
        /// violation that is known to be there, by deleting a real declaration
        /// from a real Uplink's source IN MEMORY and requiring that the walk then
        /// names exactly that command.
        /// </summary>
        [Fact]
        public void TheWalkNamesACommandWhoseDeclarationIsRemoved()
        {
            var (name, directory) = FirstUplinkWith(u => u.RegisteredCommands.Count > 0);
            var wiring = UplinkWiringScan.Scan(name, directory);

            Assert.Empty(wiring.UndeclaredCommands);

            var declaration = OnlyDeclarationOf(wiring.DeclaredCommands, wiring.RegisteredCommands);
            var sabotaged = UplinkWiringScan.Scan(name, directory, Without(declaration));

            Assert.True(
                sabotaged.UndeclaredCommands.Any(u => u.Value == declaration.Value),
                $"{name}'s declaration of \"{declaration.Value}\" was removed from its source and "
                + "the walk still reported it as declared, so it cannot tell a wired Uplink from "
                + "an unwired one and every pass it reports is meaningless. Reported: "
                + string.Join(", ", sabotaged.UndeclaredCommands));
        }

        /// <summary>
        /// The same instrument check for the channel half, separately, because the
        /// two halves are read by different code: a command name is a call
        /// argument, a topic is usually an object-initialiser assignment, so one
        /// half can go blind while the other still sees.
        /// </summary>
        [Fact]
        public void TheWalkNamesATopicWhoseDeclarationIsRemoved()
        {
            var (name, directory) = FirstUplinkWith(u => u.PublishedTopics.Count > 0);
            var wiring = UplinkWiringScan.Scan(name, directory);

            Assert.Empty(wiring.UndeclaredTopics);

            var declaration = OnlyDeclarationOf(wiring.DeclaredTopics, wiring.PublishedTopics);
            var sabotaged = UplinkWiringScan.Scan(name, directory, Without(declaration));

            Assert.True(
                sabotaged.UndeclaredTopics.Any(u => u.Value == declaration.Value),
                $"{name}'s declaration of \"{declaration.Value}\" was removed from its source and "
                + "the walk still reported it as declared: "
                + string.Join(", ", sabotaged.UndeclaredTopics));
        }

        /// <summary>
        /// A declaration that is used and written exactly once, so removing it
        /// removes the whole of one side of one pairing. Removing one of two
        /// declarations of the same name would leave the other and prove nothing.
        /// </summary>
        private static WiringUse OnlyDeclarationOf(
            IReadOnlyList<WiringUse> declared, IReadOnlyList<WiringUse> used)
        {
            var wanted = used.Where(u => u.Value is not null).Select(u => u.Value!).ToHashSet(StringComparer.Ordinal);

            return declared
                .Where(d => d.Value is not null && wanted.Contains(d.Value))
                .GroupBy(d => d.Value!, StringComparer.Ordinal)
                .Where(g => g.Count() == 1)
                .Select(g => g.Single())
                .First();
        }

        /// <summary>
        /// The named declaration deleted from the one line it is written on, and
        /// nothing else touched. Replacing the const everywhere would move the
        /// registration with it and the two would still agree.
        /// </summary>
        private static Func<string, string, string> Without(WiringUse declaration) => (file, text) =>
        {
            if (!string.Equals(file, declaration.File, StringComparison.Ordinal))
            {
                return text;
            }

            var offset = 0;
            for (var line = 1; line < declaration.Line; line++)
            {
                offset = text.IndexOf('\n', offset) + 1;
            }

            var at = text.IndexOf(declaration.Expression, offset, StringComparison.Ordinal);

            return at < 0
                ? text
                : text.Remove(at, declaration.Expression.Length).Insert(at, "\"gonogo.notDeclared\"");
        };

        private static (string Name, string Directory) FirstUplinkWith(Func<UplinkWiring, bool> predicate)
        {
            foreach (var (name, directory) in UplinkProjects.Discover().OrderBy(u => u.Key, StringComparer.Ordinal))
            {
                if (predicate(UplinkWiringScan.Scan(name, directory)))
                {
                    return (name, directory);
                }
            }

            throw new InvalidOperationException(
                "No Uplink matched, so this instrument check has nothing to plant a violation in.");
        }

        private static List<UplinkWiring> Scan() =>
            UplinkProjects.Discover()
                .OrderBy(u => u.Key, StringComparer.Ordinal)
                .Select(u => UplinkWiringScan.Scan(u.Key, u.Value))
                .ToList();
    }
}
