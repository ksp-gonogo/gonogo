using System;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The body a planetary system is named after: a planet, for the planet and
    /// every moon around it, or a star, for anything orbiting the star directly.
    /// </summary>
    public sealed class SystemRoot
    {
        public SystemRoot(int bodyIndex, string name, bool isStar)
        {
            BodyIndex = bodyIndex;
            Name = name;
            IsStar = isStar;
        }

        /// <summary>Index into system.bodies. Two roots are the same system exactly when these match.</summary>
        public int BodyIndex { get; }

        public string Name { get; }

        public bool IsStar { get; }
    }

    /// <summary>
    /// What the game says about a launch's two ends at the moment it is
    /// commanded: the centre it was sent from and the site it names. Read by
    /// <see cref="IFlightOpsActuator.ReachOf"/>, judged by
    /// <see cref="LaunchAuthority"/>.
    /// </summary>
    public sealed class LaunchReach
    {
        /// <summary>The sending centre's display name; null when the vantage names no active command centre.</summary>
        public string? CentreName { get; set; }

        /// <summary>The site's display name; null when no launch site answers to the requested name.</summary>
        public string? SiteName { get; set; }

        /// <summary>The root of the system the centre is in; null when its body could not be read.</summary>
        public SystemRoot? CentreSystem { get; set; }

        /// <summary>The root of the system the site is in; null when its body could not be read.</summary>
        public SystemRoot? SiteSystem { get; set; }
    }

    /// <summary>
    /// Who may launch from a pad: a command centre in the same planetary system
    /// as it. A planet and its moons are one system, so a centre anywhere around
    /// Kerbin, on the Mun or at Minmus may launch from any pad in that system,
    /// and a centre at Duna may launch from none of them.
    ///
    /// <para>The launch itself stays instant. This gates the SENDER, not the
    /// moment, which is why it is a refusal and not a delay: a centre on another
    /// world may watch a pad at KSC but may not put a craft on it.</para>
    ///
    /// <para><b>A relationship, not a distance.</b> Which body a moon orbits
    /// does not change when a planet pack rescales or relocates everything, so
    /// the answer does not either. Any fixed radius would include or exclude a
    /// neighbouring planet according to the pack's scale.</para>
    ///
    /// <para>A centre orbiting a star directly, in transit between planets or
    /// parked at a Lagrange point, belongs to no planet's system and so may
    /// launch from nothing. The game's own sphere of influence says it is not
    /// part of any planet's neighbourhood, and every pad's own system always has
    /// somewhere a centre can stand.</para>
    /// </summary>
    public static class LaunchAuthority
    {
        /// <summary>Deeper than any real hierarchy, so reaching it means a cycle rather than a system.</summary>
        internal const int MaxSystemDepth = 32;

        /// <summary>
        /// The body at the root of <paramref name="body"/>'s planetary system:
        /// climb while the parent is a body other than this one and is not a
        /// star. A planet orbiting a star is its own root; a moon's root is its
        /// planet; a star's root, and a root with no orbit at all, is itself.
        /// Null when the climb never ends.
        ///
        /// <para>Generic so the walk is exercised headlessly: KSP's
        /// <c>CelestialBody.referenceBody</c> answers the body itself when it has
        /// no orbit, never null, but null is tolerated as the same answer.</para>
        /// </summary>
        public static TBody? SystemRootOf<TBody>(TBody body, Func<TBody, TBody?> parentOf, Func<TBody, bool> isStar)
            where TBody : class
        {
            if (body == null) throw new ArgumentNullException(nameof(body));
            if (parentOf == null) throw new ArgumentNullException(nameof(parentOf));
            if (isStar == null) throw new ArgumentNullException(nameof(isStar));

            var current = body;
            for (var hop = 0; hop < MaxSystemDepth; hop++)
            {
                var parent = parentOf(current);
                if (parent == null || ReferenceEquals(parent, current) || isStar(parent))
                {
                    return current;
                }
                current = parent;
            }
            return null;
        }

        /// <summary>
        /// The refusal for launching onto <paramref name="site"/> from
        /// <paramref name="vantage"/>, or null when the launch may proceed.
        /// <paramref name="read"/> is asked only when the vantage is a place.
        /// </summary>
        public static CommandResult? Refusal(string? vantage, string? site, Func<LaunchReach> read)
        {
            if (read == null) throw new ArgumentNullException(nameof(read));

            // No active centre exists at all, so there is no vantage to be in the
            // wrong system: a save with no comms network, or none built yet.
            if (string.IsNullOrEmpty(vantage))
            {
                return null;
            }

            if (vantage == ChannelEngine.MetaVantage)
            {
                return CommandResult.Fail(
                    CommandErrorCode.OutOfReach,
                    "a launch is sent from a command centre, and the meta vantage is not one");
            }

            var reach = read();
            if (reach.CentreName == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound, $"'{vantage}' is not an active command centre");
            }

            if (reach.SiteName == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound, $"no launch site is named '{site}'");
            }

            if (reach.CentreSystem == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unreadable, $"which system {reach.CentreName} is in could not be read");
            }

            if (reach.SiteSystem == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unreadable, $"which system {reach.SiteName} is in could not be read");
            }

            if (reach.CentreSystem.BodyIndex == reach.SiteSystem.BodyIndex)
            {
                return null;
            }

            var where = reach.CentreSystem.IsStar
                ? $"{reach.CentreName} is in orbit of {reach.CentreSystem.Name}, outside every planet's system"
                : $"{reach.CentreName} is in the {reach.CentreSystem.Name} system";
            return CommandResult.Fail(
                CommandErrorCode.OutOfReach,
                $"{where}, and a launch from {reach.SiteName} needs a command centre in the {reach.SiteSystem.Name} system");
        }
    }
}
