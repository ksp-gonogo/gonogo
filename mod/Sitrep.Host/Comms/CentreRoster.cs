using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>commandCentre.roster</c> one command centre is sent: the centres
    /// it knows of.
    ///
    /// <para>A ground station is the ground's own and every centre knows of it.
    /// A craft that is a command centre is known of once the craft's own word
    /// that it is one has reached the centre, and goes on being listed until
    /// its word that it no longer is, or that it is gone, has. So a crew
    /// boarding a craft far away does not put a new centre on a screen before
    /// the light of it could arrive. A centre always lists itself.</para>
    /// </summary>
    public static class CentreRoster
    {
        /// <param name="centre">The centre the roster is for.</param>
        /// <param name="game">Every centre as the game has them now.</param>
        /// <param name="heard">The newest state the centre has received of each craft.</param>
        public static List<CommandCentreEntry> For(
            string centre, IReadOnlyList<CommandCentreEntry> game, IReadOnlyCollection<CraftState> heard)
        {
            var heardCentres = new Dictionary<string, CommandCentreEntry>(StringComparer.Ordinal);
            foreach (var state in heard)
            {
                if (state.Exists && state.Centre != null)
                {
                    heardCentres[state.Id] = state.Centre;
                }
            }

            var roster = new List<CommandCentreEntry>(game.Count);
            var listed = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in game)
            {
                var id = entry.Id ?? "";
                if (!IsCraft(id) || id == centre)
                {
                    roster.Add(entry);
                    listed.Add(id);
                    continue;
                }
                if (heardCentres.TryGetValue(id, out var asHeard))
                {
                    roster.Add(asHeard);
                    listed.Add(id);
                }
            }
            // A craft the game no longer lists is still a centre here until its own word that it is not has arrived.
            foreach (var entry in heardCentres)
            {
                if (!listed.Contains(entry.Key) && entry.Key != centre)
                {
                    roster.Add(entry.Value);
                }
            }
            return roster;
        }

        /// <summary>Whether a roster id names a craft, whose existence is news that has to travel, and not a fixed centre.</summary>
        public static bool IsCraft(string id) => id.StartsWith(CraftStateRecorder.VesselPrefix, StringComparison.Ordinal);

        /// <summary>Whether two entries would read the same on a roster.</summary>
        public static bool Same(CommandCentreEntry? a, CommandCentreEntry? b)
        {
            if (a == null || b == null)
            {
                return a == null && b == null;
            }
            return a.Id == b.Id
                && a.DisplayName == b.DisplayName
                && a.Kind == b.Kind
                && a.BodyIndex == b.BodyIndex
                && Nullable.Equals(a.Latitude, b.Latitude)
                && Nullable.Equals(a.Longitude, b.Longitude)
                && a.Active == b.Active
                && a.IsHome == b.IsHome
                && a.IsHomeFallback == b.IsHomeFallback
                && a.DelayQuality == b.DelayQuality;
        }

        /// <summary>Whether two rosters would read the same, entry for entry and in the same order.</summary>
        public static bool Same(IReadOnlyList<CommandCentreEntry>? a, IReadOnlyList<CommandCentreEntry>? b)
        {
            if (a == null || b == null || a.Count != b.Count)
            {
                return a == null && b == null;
            }
            for (var i = 0; i < a.Count; i++)
            {
                if (!Same(a[i], b[i]))
                {
                    return false;
                }
            }
            return true;
        }
    }
}
