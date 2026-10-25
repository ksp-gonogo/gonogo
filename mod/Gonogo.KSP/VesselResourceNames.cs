using System;
using System.Collections.Generic;
using System.Linq;

namespace Gonogo.KSP
{
    /// <summary>
    /// The resource names the vessel's resource channel looks up: the stock fuels in a fixed
    /// order, then every other resource the game defines (life support supplies, modded
    /// propellants) alphabetically, so the order does not change from one tick to the next.
    /// </summary>
    internal static class VesselResourceNames
    {
        private static readonly string[] Stock =
        {
            "LiquidFuel", "Oxidizer", "SolidFuel", "MonoPropellant",
            "ElectricCharge", "XenonGas", "Ore", "Ablator",
        };

        public static IReadOnlyList<string> Order(IEnumerable<string> defined)
        {
            var distinct = new HashSet<string>(defined, StringComparer.Ordinal);
            var others = distinct.Where(n => !Stock.Contains(n)).OrderBy(n => n, StringComparer.Ordinal);
            return Stock.Where(distinct.Contains).Concat(others).ToList();
        }
    }
}
