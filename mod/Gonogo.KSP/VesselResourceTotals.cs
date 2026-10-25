using System.Collections.Generic;
using System.Linq;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the vessel-wide resource map from the game's connected totals plus the
    /// resources that never flow between parts (life support supplies, solid fuel,
    /// ablator), which the connected totals leave out and which are summed per part.
    /// A flowing resource on a part is ignored here, so fuel the engines cannot reach is
    /// not counted. A resource with no capacity is dropped, and keys follow
    /// <see cref="VesselResourceNames"/>.
    /// </summary>
    internal static class VesselResourceTotals
    {
        public readonly struct Reading
        {
            public Reading(string name, double amount, double maxAmount, bool flowsBetweenParts = true)
            {
                Name = name;
                Amount = amount;
                MaxAmount = maxAmount;
                FlowsBetweenParts = flowsBetweenParts;
            }

            public string Name { get; }
            public double Amount { get; }
            public double MaxAmount { get; }
            public bool FlowsBetweenParts { get; }
        }

        public static Dictionary<string, object?> Sum(IEnumerable<Reading> connected, IEnumerable<Reading> parts)
        {
            var summed = new Dictionary<string, object?>();
            foreach (var reading in connected)
            {
                TrackingStationVesselResourcesBuilder.Add(summed, reading.Name, reading.Amount, reading.MaxAmount);
            }

            foreach (var reading in parts.Where(r => !r.FlowsBetweenParts))
            {
                TrackingStationVesselResourcesBuilder.Add(summed, reading.Name, reading.Amount, reading.MaxAmount);
            }

            var result = new Dictionary<string, object?>();
            foreach (var name in VesselResourceNames.Order(summed.Keys))
            {
                result[name] = summed[name];
            }

            return result;
        }
    }
}
