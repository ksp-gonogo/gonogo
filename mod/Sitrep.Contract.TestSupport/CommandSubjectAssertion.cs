using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Core's startup check on command Subjects
    /// (<c>Sitrep.Host.ChannelEngine.ValidateCommandSubjects</c>), runnable
    /// against an Uplink's own manifest so a missing or unresolvable Subject
    /// fails here rather than only on a rig.
    ///
    /// <para><c>ChannelEngine</c> is not in the devkit, so this cannot see the
    /// live registry every registered Uplink contributes to. It approximates
    /// "a topic some Uplink declares" with the checking Uplink's own manifest
    /// channels plus every <see cref="SitrepTopicAttribute"/>-tagged type in
    /// <see cref="Sitrep.Contract"/> (core's own static channels), and
    /// accepts an explicit list of dynamic-namespace prefixes for a Subject
    /// that targets one: an Uplink calls both, and both share the exact same
    /// <see cref="CommandSubjectRule"/> the live engine runs, so the
    /// approximation cannot diverge on the algorithm itself, only on which
    /// channels it can see.</para>
    /// </summary>
    public static class CommandSubjectAssertion
    {
        /// <summary>
        /// Every delayed command in <paramref name="manifest"/> whose Subject
        /// does not resolve. Empty when every one does.
        /// </summary>
        /// <param name="manifest">The Uplink's own manifest.</param>
        /// <param name="commandAttributes">
        /// The assembly to scan for <see cref="SitrepCommandAttribute"/>
        /// tags, ordinarily the Uplink's own mod assembly.
        /// </param>
        /// <param name="dynamicNamespacePrefixes">
        /// Prefixes this Uplink registers with
        /// <c>IUplinkHost.RegisterDynamicNamespace</c>, for a Subject that
        /// targets one. Omit when the Uplink registers none of its own.
        /// </param>
        public static IReadOnlyList<CommandSubjectViolation> Violations(
            UplinkManifest manifest,
            Assembly commandAttributes,
            IEnumerable<string>? dynamicNamespacePrefixes = null)
        {
            if (manifest == null) throw new ArgumentNullException(nameof(manifest));
            if (commandAttributes == null) throw new ArgumentNullException(nameof(commandAttributes));

            var channels = new HashSet<string>(StringComparer.Ordinal);
            foreach (var channel in manifest.Channels ?? new List<ChannelDeclaration>())
            {
                channels.Add(channel.Topic);
            }
            foreach (var type in typeof(UplinkManifest).Assembly.GetTypes())
            {
                foreach (var tag in type.GetCustomAttributes<SitrepTopicAttribute>(false))
                {
                    channels.Add(tag.TopicId);
                }
            }

            var prefixes = (dynamicNamespacePrefixes ?? Enumerable.Empty<string>()).ToList();

            var delays = new Dictionary<string, DelayRole>(StringComparer.Ordinal);
            foreach (var type in commandAttributes.GetTypes())
            {
                foreach (var tag in type.GetCustomAttributes<SitrepCommandAttribute>(false))
                {
                    delays[tag.CommandId] = tag.Delay;
                }
            }

            return CommandSubjectRule.Violations(
                manifest.Commands ?? new List<CommandDeclaration>(),
                command => delays.TryGetValue(command, out var tagged) ? (DelayRole?)tagged : null,
                literal => channels.Contains(literal),
                literal => prefixes.Any(prefix => literal.StartsWith(prefix, StringComparison.Ordinal)));
        }
    }
}
