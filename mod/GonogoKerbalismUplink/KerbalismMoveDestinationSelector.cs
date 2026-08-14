using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// One drive <see cref="KerbalismMoveDestinationSelector.Select"/> is
    /// choosing between: whether its part also carries a <c>Laboratory</c>
    /// module, whether it is the sample's current drive (never its own
    /// destination), and how much sample capacity it has free for this
    /// subject (null when the live reflection call that would answer that
    /// failed).
    /// </summary>
    public readonly struct MoveDestinationCandidate
    {
        public readonly bool LabAdjacent;
        public readonly bool IsSource;
        public readonly double? AvailableCapacity;

        public MoveDestinationCandidate(bool labAdjacent, bool isSource, double? availableCapacity)
        {
            LabAdjacent = labAdjacent;
            IsSource = isSource;
            AvailableCapacity = availableCapacity;
        }
    }

    /// <summary>
    /// The pure "which drive gets the sample" decision behind
    /// <c>kerbalism.sample.moveToLab</c>, pulled out of
    /// <c>KerbalismFileActuator</c>'s live reflection glue so it is
    /// unit-testable without a live vessel. Picks the lab-adjacent,
    /// non-source candidate with the most available sample capacity, but
    /// only when it can hold the WHOLE sample: a partial move would split the
    /// sample across two drives, a worse state than refusing.
    /// </summary>
    public static class KerbalismMoveDestinationSelector
    {
        /// <summary>Index into <paramref name="candidates"/> of the chosen destination, or null when none qualifies.</summary>
        public static int? Select(IReadOnlyList<MoveDestinationCandidate> candidates, double sampleSize)
        {
            int? best = null;
            var bestAvailable = 0.0;

            for (var i = 0; i < candidates.Count; i++)
            {
                var candidate = candidates[i];
                if (!candidate.LabAdjacent || candidate.IsSource) continue;

                if (candidate.AvailableCapacity is double available
                    && available >= sampleSize
                    && available > bestAvailable)
                {
                    best = i;
                    bestAvailable = available;
                }
            }

            return best;
        }
    }
}
