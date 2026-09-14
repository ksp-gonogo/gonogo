using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The RP-1 home-command claimant: home is the oldest space centre RP-1 still
    /// holds, as the command centre of the ground station RP-1 associates with it.
    ///
    /// <para>RP-1 appends a centre to <c>SpaceCenterManagement.KSCs</c> the first time
    /// a career makes a site active, never reorders the list, and saves it in that
    /// order, so the first entry is the oldest. When a save loads it drops every
    /// centre that has nothing built at it and is not the active one, so a founding
    /// site left empty stops being home and the next-oldest takes over.</para>
    ///
    /// <para>The station is KSCSwitcher's <c>groundStation</c> value for the site,
    /// which is the node name of the station built for that site and so the name core
    /// mints the centre's id from. RP-1 enables its launch-site stations by comparing
    /// the same two strings.</para>
    ///
    /// <para>Registered only while RP-1 is loaded, at <see cref="Priority"/>, above a
    /// comms claimant that can only infer home from where stations stand. It withdraws
    /// on an install without KSCSwitcher, where RP-1 associates no station with any
    /// centre.</para>
    /// </summary>
    public sealed class Rp1HomeCommandProvider : IHomeCommandProvider
    {
        public const string Id = "rp1";

        /// <summary>Strictly above a comms claimant's 10, and never <c>IsDefault</c>, as <see cref="HomeCommandCapability"/> requires of two claimants installed together.</summary>
        public const double Priority = 20.0;

        /// <summary>The prefix core mints every ground station's id under.</summary>
        private const string GroundPrefix = "ground:";

        private readonly Func<string?> _oldestGroundStation;

        /// <param name="oldestGroundStation">
        /// The ground station of the oldest centre RP-1 holds, or null when there is no
        /// such centre or it names no station. Called from <see cref="Identify"/>, so on
        /// the main thread only.
        /// </param>
        public Rp1HomeCommandProvider(Func<string?> oldestGroundStation) =>
            _oldestGroundStation = oldestGroundStation ?? throw new ArgumentNullException(nameof(oldestGroundStation));

        public string ProviderId => Id;

        /// <summary>The kernel registration for this claimant, the one the Uplink makes.</summary>
        /// <param name="canServe">Whether KSCSwitcher is loaded, asked once at resolve time.</param>
        public static ProviderRegistration Registration(Func<string?> oldestGroundStation, Func<bool> canServe) =>
            new ProviderRegistration
            {
                Capability = HomeCommandCapability.Id,
                Id = Id,
                Priority = Priority,
                CanServe = canServe,
                Factory = _ => new Rp1HomeCommandProvider(oldestGroundStation),
            };

        /// <summary>
        /// The id of the active centre for the oldest space centre's ground station, or
        /// <see cref="HomeCommand.NotIdentified"/> when RP-1 holds no centre, the oldest
        /// names no station, or no single active centre carries it.
        /// </summary>
        public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres)
        {
            var station = _oldestGroundStation();
            if (string.IsNullOrEmpty(station) || activeCentres == null)
            {
                return HomeCommand.NotIdentified;
            }

            var id = CentreFor(station!, activeCentres);
            return id == null ? HomeCommand.NotIdentified : HomeCommand.Identified(id);
        }

        /// <summary>
        /// The id of the one active ground station core minted from
        /// <paramref name="station"/>, or null when there is none or more than one.
        ///
        /// <para>Core mints <c>ground:&lt;name&gt;</c> for a station and
        /// <c>ground:&lt;name&gt;#&lt;n&gt;</c> for each further station sharing the name,
        /// handing the suffixes out by position. Nothing in an id says which of two
        /// same-named stations belongs to the site, so two candidates are no answer
        /// rather than a guess.</para>
        /// </summary>
        public static string? CentreFor(string station, IReadOnlyList<ICommandCentre> centres)
        {
            var bare = GroundPrefix + station;
            string? found = null;
            foreach (var centre in centres)
            {
                if (centre == null
                    || centre.Kind != CommandCentreKind.GroundStation
                    || !IsMintedFrom(centre.Id, bare))
                {
                    continue;
                }

                if (found != null)
                {
                    return null;
                }

                found = centre.Id;
            }

            return found;
        }

        private static bool IsMintedFrom(string? id, string bare)
        {
            if (id == null || !id.StartsWith(bare, StringComparison.Ordinal))
            {
                return false;
            }

            if (id.Length == bare.Length)
            {
                return true;
            }

            if (id[bare.Length] != '#' || id.Length == bare.Length + 1)
            {
                return false;
            }

            for (var i = bare.Length + 1; i < id.Length; i++)
            {
                if (id[i] < '0' || id[i] > '9')
                {
                    return false;
                }
            }

            return true;
        }
    }
}
