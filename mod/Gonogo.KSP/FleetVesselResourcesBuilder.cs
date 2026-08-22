using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>fleet.&lt;guid&gt;.resources</c> wire dict: what is in one
    /// fleet vessel's tanks, keyed by resource name.
    ///
    /// <para>Same self-flattening producer pattern as its siblings: camelCase
    /// keys match <see cref="Sitrep.Contract.FleetVesselResources"/> and
    /// <see cref="Sitrep.Contract.ResourceAmount"/>, the TS codegen mirror. The
    /// per-resource shape is the ACTIVE vessel's, unchanged, so a client reads
    /// one craft's tanks the same way whether or not it is the one being
    /// flown.</para>
    ///
    /// <para>A resource with no capacity is dropped rather than reported as an
    /// empty one: <c>maxAmount &lt;= 0</c> means the craft does not carry it,
    /// which is the "key absent" arm of the three-way absence
    /// <see cref="Sitrep.Contract.VesselResources"/> documents, and reporting it
    /// as <c>0 / 0</c> would turn a structural fact into a reading.</para>
    /// </summary>
    public static class FleetVesselResourcesBuilder
    {
        /// <summary>
        /// Folds one part's resource into the running map, summing across parts
        /// the way a vessel-level total has to. Returns false when there was
        /// nothing worth recording.
        /// </summary>
        public static bool Add(
            Dictionary<string, object?> resources,
            string? name,
            double amount,
            double maxAmount)
        {
            if (string.IsNullOrEmpty(name) || maxAmount <= 0.0)
            {
                return false;
            }

            if (resources.TryGetValue(name!, out var existing)
                && existing is Dictionary<string, object?> row)
            {
                row["current"] = (double)(row["current"] ?? 0.0) + amount;
                row["max"] = (double)(row["max"] ?? 0.0) + maxAmount;
                return true;
            }

            resources[name!] = new Dictionary<string, object?>
            {
                ["current"] = amount,
                ["max"] = maxAmount,
                // Every resource this producer emits was actually read this
                // tick, which is exactly what `active` means: it exists so a
                // present-but-empty tank stays distinguishable from one that
                // stopped being reported.
                ["active"] = true,
            };
            return true;
        }

        /// <summary>The whole payload, wrapped as the contract shape declares it.</summary>
        public static Dictionary<string, object?> Build(Dictionary<string, object?> resources) =>
            new Dictionary<string, object?>
            {
                ["resources"] = resources,
            };
    }
}
