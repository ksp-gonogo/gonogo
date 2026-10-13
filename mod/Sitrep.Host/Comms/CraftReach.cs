using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Which command centres a craft could be heard at, as of one instant: for
    /// each centre that has had a route to the craft, the last instant it had
    /// one. A centre whose last instant is this one has a route now; a centre
    /// never named has never had one.
    /// </summary>
    public sealed class CraftReach
    {
        public CraftReach(string id, double capturedUt, IReadOnlyDictionary<string, double> lastReachedUt)
        {
            Id = id;
            CapturedUt = capturedUt;
            LastReachedUt = lastReachedUt;
        }

        /// <summary>The craft, as <c>vessel:&lt;guid&gt;</c>.</summary>
        public string Id { get; }

        /// <summary>The instant this was true at.</summary>
        public double CapturedUt { get; }

        /// <summary>For each centre that has had a route to the craft, the last instant it had one, by centre id.</summary>
        public IReadOnlyDictionary<string, double> LastReachedUt { get; }

        /// <summary>Whether <paramref name="centre"/> had a route to the craft at <see cref="CapturedUt"/>.</summary>
        public bool Reaches(string centre) => LastReachedUt.TryGetValue(centre, out var ut) && ut >= CapturedUt;

        /// <summary>The last instant <paramref name="centre"/> had a route to the craft, or null when it never had one.</summary>
        public double? LastReachedAt(string centre) => LastReachedUt.TryGetValue(centre, out var ut) ? ut : (double?)null;
    }

    /// <summary>The rule for whether a command centre has a route to a craft at this instant.</summary>
    public static class CentreReach
    {
        /// <summary>
        /// Whether <paramref name="centre"/> can hear the craft now.
        ///
        /// <para>A save that models no comms network has every centre in contact
        /// with every craft. Otherwise a crewed centre always hears its own craft,
        /// and no other centre hears a craft whose link is down. The home centre
        /// hears a craft whose route ends at any ground station, since every
        /// ground station is its antenna. Any other centre hears a craft its own
        /// route reaches.</para>
        /// </summary>
        /// <param name="centre">The centre's id.</param>
        /// <param name="vesselId">The craft's bare guid.</param>
        /// <param name="networkModelled">Whether the save models a comms network at all.</param>
        /// <param name="craftConnected">Whether the craft's link is up.</param>
        /// <param name="homeCentre">The home centre's id, or null while there is none.</param>
        /// <param name="offTheGround">Whether the craft's route ends somewhere other than a ground station.</param>
        /// <param name="unroutable">Whether the centre's own route finding found no path to the craft.</param>
        public static bool Reaches(
            string centre,
            string vesselId,
            bool networkModelled,
            bool craftConnected,
            string? homeCentre,
            bool offTheGround,
            bool unroutable)
        {
            if (!networkModelled)
            {
                return true;
            }
            if (string.Equals(centre, CraftStateRecorder.VesselPrefix + vesselId, StringComparison.Ordinal))
            {
                return true;
            }
            if (!craftConnected)
            {
                return false;
            }
            return string.Equals(centre, homeCentre, StringComparison.Ordinal) ? !offTheGround : !unroutable;
        }
    }
}
