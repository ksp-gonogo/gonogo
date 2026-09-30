using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// One command's Subject that failed to resolve, and why.
    /// </summary>
    public readonly struct CommandSubjectViolation
    {
        /// <summary>The command id that failed.</summary>
        public string Command { get; }

        /// <summary>A human-readable description of the failure.</summary>
        public string Message { get; }

        /// <summary>A violation of <paramref name="command"/>'s Subject, described by <paramref name="message"/>.</summary>
        public CommandSubjectViolation(string command, string message)
        {
            Command = command;
            Message = message;
        }

        public override string ToString() => Message;
    }

    /// <summary>
    /// Whether a delayed command's <see cref="CommandDeclaration.Subject"/>
    /// names a real destination.
    ///
    /// <para><c>Sitrep.Host.ChannelEngine.ValidateCommandSubjects</c> (the
    /// live registry, checked once at startup across every registered
    /// Uplink) and <c>Sitrep.Contract.TestSupport</c>'s per-Uplink assertion
    /// (a devkit-visible check an Uplink runs against its own manifest) both
    /// call this same rule, so the two cannot drift apart the way five
    /// hand-restated copies of it once did.</para>
    /// </summary>
    public static class CommandSubjectRule
    {
        /// <summary>
        /// A command's delay disposition: whatever its <c>[SitrepCommand]</c>
        /// tag says, when it has one, else its own
        /// <see cref="CommandDeclaration.Delay"/> (see
        /// <see cref="SitrepCommandAttribute.Delay"/>'s doc comment for why
        /// the attribute wins).
        /// </summary>
        public static DelayRole ResolveDelay(CommandDeclaration declaration, DelayRole? taggedDelay)
        {
            if (declaration == null) throw new ArgumentNullException(nameof(declaration));
            return taggedDelay ?? declaration.Delay;
        }

        /// <summary>
        /// The literal portion of <paramref name="subject"/> before its first
        /// <c>"{args.X}"</c> segment (or the whole string when it has none):
        /// what a declared channel topic, or a dynamic namespace prefix, is
        /// checked against. A concrete arg value cannot be known until
        /// dispatch, but the literal prefix in front of it is exactly what a
        /// dynamic namespace is keyed by.
        /// </summary>
        public static string LiteralPrefix(string subject)
        {
            if (string.IsNullOrEmpty(subject))
            {
                return subject ?? "";
            }
            var brace = subject.IndexOf('{');
            return brace < 0 ? subject : subject.Substring(0, brace);
        }

        /// <summary>
        /// Whether <paramref name="subject"/> names a real destination:
        /// either a topic <paramref name="isDeclaredChannel"/> recognises, or
        /// a topic whose literal prefix (see <see cref="LiteralPrefix"/>)
        /// <paramref name="isUnderDynamicNamespace"/> recognises.
        /// </summary>
        public static bool SubjectResolves(
            string subject,
            Func<string, bool> isDeclaredChannel,
            Func<string, bool> isUnderDynamicNamespace)
        {
            if (isDeclaredChannel == null) throw new ArgumentNullException(nameof(isDeclaredChannel));
            if (isUnderDynamicNamespace == null) throw new ArgumentNullException(nameof(isUnderDynamicNamespace));
            if (string.IsNullOrEmpty(subject))
            {
                return false;
            }
            var literal = LiteralPrefix(subject);
            return isDeclaredChannel(literal) || isUnderDynamicNamespace(literal);
        }

        /// <summary>
        /// Every command in <paramref name="commands"/> that rides the delay
        /// (see <see cref="ResolveDelay"/>) and whose Subject does not
        /// resolve (see <see cref="SubjectResolves"/>). Empty means every
        /// delayed command names a real destination.
        /// </summary>
        /// <param name="commands">The declarations to check.</param>
        /// <param name="taggedDelay">
        /// The <c>[SitrepCommand]</c> delay for a command id, or null when
        /// that command carries no tag.
        /// </param>
        /// <param name="isDeclaredChannel">
        /// Whether a literal topic is a channel some Uplink declares.
        /// </param>
        /// <param name="isUnderDynamicNamespace">
        /// Whether a literal topic falls under a registered dynamic
        /// namespace prefix.
        /// </param>
        public static IReadOnlyList<CommandSubjectViolation> Violations(
            IEnumerable<CommandDeclaration> commands,
            Func<string, DelayRole?> taggedDelay,
            Func<string, bool> isDeclaredChannel,
            Func<string, bool> isUnderDynamicNamespace)
        {
            if (commands == null) throw new ArgumentNullException(nameof(commands));
            if (taggedDelay == null) throw new ArgumentNullException(nameof(taggedDelay));

            var violations = new List<CommandSubjectViolation>();
            foreach (var command in commands)
            {
                var delay = ResolveDelay(command, taggedDelay(command.Command));
                if (delay == DelayRole.TrueNow)
                {
                    // TrueNow: no craft or ledger to address, so no Subject is
                    // expected. See SitrepCommandAttribute.Delay's doc comment
                    // for what earns TrueNow.
                    continue;
                }

                if (string.IsNullOrEmpty(command.Subject))
                {
                    violations.Add(new CommandSubjectViolation(command.Command, command.Command + " declares no Subject"));
                    continue;
                }

                if (!SubjectResolves(command.Subject, isDeclaredChannel, isUnderDynamicNamespace))
                {
                    violations.Add(new CommandSubjectViolation(
                        command.Command,
                        command.Command + " names Subject \"" + command.Subject + "\", which no channel declares"));
                }
            }
            return violations;
        }
    }
}
