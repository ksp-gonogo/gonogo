using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure mappers from the reflected <see cref="HarvesterRaw"/>/<see cref="ProcessRaw"/>
    /// to the source-agnostic <c>isru.*</c> contract POCOs. KSP-free
    /// (Sitrep.Contract only) so it is headless-testable against captured fixtures,
    /// the same split every other mapper in this Uplink follows.
    ///
    /// <para>Each entry carries Kerbalism's own extra state in its provider extension
    /// bag, under the provider id this Uplink registers with the Kernel. Those
    /// sub-trees are this Uplink's shape, not core's: declared in
    /// GonogoKerbalismUplink.Contract/KerbalismIsruExt.cs, written here as a plain
    /// value tree (JsonWriter walks it, exactly as it does every other
    /// producer-flattened payload), and typed client-side by this Uplink's own
    /// readKerbalismIsru*Ext.</para>
    ///
    /// <para><b>Every ProcessController becomes a converter row, unfiltered.</b>
    /// Kerbalism does not distinguish an ISRU process from a life-support one: a
    /// scrubber, a water recycler and a Molten Regolith Electrolysis plant are the
    /// same module running different chemistry. Any filter here would be gonogo
    /// asserting a taxonomy the engine does not draw. The consequence is a deliberate
    /// overlap with kerbalism.lifesupport, which reports the same parts: these are two
    /// honest views of one set of parts, this one the per-part converter chemistry and
    /// that one the supply and consumption picture, never two separate Kerbalism
    /// systems.</para>
    /// </summary>
    public static class KerbalismIsruMap
    {
        /// <summary>The Kernel provider id, and so the bag key both halves agree on.</summary>
        public const string ProviderId = "kerbalism";

        public static List<IsruDrillEntry> Drills(IEnumerable<HarvesterRaw> harvesters)
        {
            var list = new List<IsruDrillEntry>();
            if (harvesters == null)
            {
                return list;
            }

            foreach (var h in harvesters)
            {
                if (h == null)
                {
                    continue;
                }

                var ext = new Dictionary<string, object?>
                {
                    // Empty means nothing is wrong, and the wire carries that as null
                    // rather than "": a reader should not have to know that one
                    // particular empty string is the all-clear.
                    ["issue"] = string.IsNullOrEmpty(h.Issue) ? null : h.Issue,
                    ["harvestType"] = h.Type.ToString(CultureInfo.InvariantCulture),
                    ["ecRate"] = h.EcRate,
                    ["sourceMassRemaining"] = h.SourceMassRemaining,
                    ["sourceMassThreshold"] = h.SourceMassThreshold,
                };

                list.Add(new IsruDrillEntry
                {
                    PartId = FlightId(h.FlightId),
                    // Kerbalism's Harvester carries no part title of its own; the
                    // backend fills it from the host part, so it is absent here rather
                    // than invented.
                    PartTitle = null,
                    Resource = string.IsNullOrEmpty(h.Resource) ? null : h.Resource,
                    Deployed = h.Deployed,
                    Running = h.Running,
                    Abundance = h.Abundance,
                    // Not running means extracting nothing, a real zero rather than an
                    // absence, the same rule the stock backend follows.
                    Rate = h.Running ? h.AdjustedRate ?? 0.0 : 0.0,
                    Extensions = new Dictionary<string, object?> { [ProviderId] = ext },
                });
            }

            return list;
        }

        /// <summary>
        /// One converter row per ProcessController, with the recipe resolved from the
        /// loaded profile.
        /// </summary>
        /// <param name="processes">The vessel's live ProcessControllers.</param>
        /// <param name="definitions">
        /// The loaded profile's process definitions, joined by
        /// <see cref="ProcessDefRaw.Modifiers"/> containing the controller's
        /// pseudo-resource: the same join ProcessController performs internally. A
        /// controller whose definition cannot be found still produces a row, with
        /// empty recipe sides, because the part is genuinely there and reporting it
        /// with no chemistry beats dropping it.
        /// </param>
        public static List<IsruConverterEntry> Converters(
            IEnumerable<ProcessRaw> processes,
            IEnumerable<ProcessDefRaw>? definitions)
        {
            var list = new List<IsruConverterEntry>();
            if (processes == null)
            {
                return list;
            }

            var defs = definitions != null ? new List<ProcessDefRaw>(definitions) : new List<ProcessDefRaw>();

            foreach (var p in processes)
            {
                if (p == null)
                {
                    continue;
                }

                var entry = new IsruConverterEntry
                {
                    PartId = FlightId(p.FlightId),
                    // The PROCESS title, not the part's: filled by the backend from the
                    // host part when it can be, and carried in the bag either way.
                    PartTitle = null,
                    Running = p.Running,
                    Extensions = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["processToken"] = string.IsNullOrEmpty(p.Resource) ? null : p.Resource,
                            ["title"] = string.IsNullOrEmpty(p.Title) ? null : p.Title,
                            ["capacity"] = p.Capacity,
                            ["broken"] = p.Broken,
                            ["valveIndex"] = p.ValveIndex,
                        },
                    },
                };

                var def = FindDefinition(defs, p.Resource);
                if (def != null)
                {
                    // Every rate is scaled by the part's capacity and, where the live
                    // environment product was resolved, by that too: the shared shape
                    // promises what is actually moving, not the config ratio.
                    var scale = p.Capacity * (p.EnvModifier ?? 1.0);
                    AddFlows(entry.Inputs, def.Inputs, scale);
                    AddFlows(entry.Outputs, def.Outputs, scale);
                }

                list.Add(entry);
            }

            return list;
        }

        private static ProcessDefRaw? FindDefinition(List<ProcessDefRaw> defs, string? token)
        {
            if (string.IsNullOrEmpty(token))
            {
                return null;
            }

            foreach (var def in defs)
            {
                if (def?.Modifiers != null && def.Modifiers.Contains(token!))
                {
                    return def;
                }
            }

            return null;
        }

        private static void AddFlows(List<IsruResourceFlow> into, Dictionary<string, double>? rates, double scale)
        {
            if (rates == null)
            {
                return;
            }

            foreach (var pair in rates)
            {
                into.Add(new IsruResourceFlow
                {
                    Resource = pair.Key,
                    Rate = pair.Value * scale,
                });
            }
        }

        /// <summary>
        /// The flightID as the same stringified join key every other list-shaped
        /// payload uses. Zero means the part could not be read, which is an absent id
        /// rather than part number zero.
        /// </summary>
        private static string? FlightId(double flightId) =>
            flightId > 0 ? ((uint)flightId).ToString(CultureInfo.InvariantCulture) : null;
    }
}
