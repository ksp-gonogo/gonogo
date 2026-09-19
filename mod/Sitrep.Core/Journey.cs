using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// One leg of a signal's route between a vantage and a node: its own
    /// share of the one-way delay, plus whatever geometry and opaque backend
    /// handles the writer had for the leg's two endpoints.
    ///
    /// <para>C#-ONLY, no TS reference (see <see cref="INetwork.JourneyTo"/>).
    /// Mirrors the shape of <see cref="Sitrep.Contract.CommsRouteHop"/>: a writer that only
    /// ever had a scalar delay to give supplies a single leg with the
    /// geometry and handle fields left at their defaults.</para>
    /// </summary>
    public readonly struct Leg
    {
        public Leg(
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

        /// <summary>This leg's own one-way light-time, in seconds.</summary>
        public double Seconds { get; }

        /// <summary>Straight-line distance between the leg's two endpoints, or 0 when no geometry was given.</summary>
        public double DistanceMeters { get; }

        /// <summary>True when EITHER endpoint is a ground station.</summary>
        public bool TouchesHome { get; }

        /// <summary>The live object behind this leg's origin endpoint, or null when the writer had none to give.</summary>
        public object? FromHandle { get; }

        /// <summary>The live object behind this leg's destination endpoint, or null when the writer had none to give.</summary>
        public object? ToHandle { get; }
    }

    /// <summary>
    /// The ordered legs a signal takes from a vantage to a node.
    ///
    /// <para>C#-ONLY, no TS reference (see <see cref="INetwork.JourneyTo"/>).
    /// Legs are additive, so <see cref="INetwork.DelayTo"/> is exactly
    /// <c>JourneyTo(vantage, node).TotalSeconds</c>: nothing that only ever
    /// wanted the total has to change to make room for this.</para>
    /// </summary>
    public sealed class Journey
    {
        public Journey(IReadOnlyList<Leg> legs)
        {
            Legs = legs;
        }

        /// <summary>The legs, in travel order.</summary>
        public IReadOnlyList<Leg> Legs { get; }

        /// <summary>The sum of every leg's <see cref="Leg.Seconds"/>.</summary>
        public double TotalSeconds
        {
            get
            {
                var total = 0.0;
                for (var i = 0; i < Legs.Count; i++)
                {
                    total += Legs[i].Seconds;
                }
                return total;
            }
        }
    }
}
