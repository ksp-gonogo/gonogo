using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// One hop of a signal's route between a vantage and a node: its own share of
    /// the one-way delay, plus whatever geometry and opaque backend handles the
    /// writer had for the hop's two endpoints.
    ///
    /// <para>C#-ONLY, no TS reference (see <see cref="INetwork.JourneyTo"/>). This is
    /// the TIMED form of <see cref="Sitrep.Contract.CommsRouteHop"/>: a backend supplies
    /// the geometry, the host derives <see cref="Seconds"/> from it. The two stay
    /// separate types because a backend must not be able to supply a time of its own,
    /// which the host would then have no way to reconcile against its own arithmetic.
    /// A writer that only ever had a scalar delay supplies a single hop with the
    /// geometry and handle fields left at their defaults.</para>
    /// </summary>
    public readonly struct Hop
    {
        public Hop(
            double seconds,
            double distanceMeters = 0,
            bool touchesHome = false,
            object? fromHandle = null,
            object? toHandle = null)
        {
            Seconds = seconds;
            DistanceMeters = distanceMeters;
            TouchesHome = touchesHome;
            FromHandle = fromHandle;
            ToHandle = toHandle;
        }

        /// <summary>This hop's own one-way light-time, in seconds.</summary>
        public double Seconds { get; }

        /// <summary>Straight-line distance between the hop's two endpoints, or 0 when no geometry was given.</summary>
        public double DistanceMeters { get; }

        /// <summary>True when EITHER endpoint is a ground station.</summary>
        public bool TouchesHome { get; }

        /// <summary>The live object behind this hop's origin endpoint, or null when the writer had none to give.</summary>
        public object? FromHandle { get; }

        /// <summary>The live object behind this hop's destination endpoint, or null when the writer had none to give.</summary>
        public object? ToHandle { get; }
    }

    /// <summary>
    /// The ordered hops a signal takes from a vantage to a node.
    ///
    /// <para>C#-ONLY, no TS reference (see <see cref="INetwork.JourneyTo"/>).
    /// Hops are additive, so <see cref="INetwork.DelayTo"/> is exactly
    /// <c>JourneyTo(vantage, node).TotalSeconds</c>: nothing that only ever
    /// wanted the total has to change to make room for this.</para>
    /// </summary>
    public sealed class Journey
    {
        public Journey(IReadOnlyList<Hop> hops)
        {
            Hops = hops;
        }

        /// <summary>The hops, in travel order.</summary>
        public IReadOnlyList<Hop> Hops { get; }

        /// <summary>The sum of every hop's <see cref="Hop.Seconds"/>.</summary>
        public double TotalSeconds
        {
            get
            {
                var total = 0.0;
                for (var i = 0; i < Hops.Count; i++)
                {
                    total += Hops[i].Seconds;
                }
                return total;
            }
        }
    }
}
