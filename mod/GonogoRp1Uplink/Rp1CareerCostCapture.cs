using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: the funds breakdown and the career log to the dicts the wire
    /// carries. KSP-free, RP-1-free and side-effect-free.
    /// </summary>
    public static class Rp1CareerCostCapture
    {
        /// <summary>
        /// The funds breakdown, or NOTHING when there is no vehicle being
        /// designed. Absent rather than zeroed: a payload of zeros would read as a
        /// vehicle that costs nothing to fly.
        /// </summary>
        public static Dictionary<string, object?>? BuildCost(Rp1BuildCostRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["vehicleCost"] = raw.VehicleCost,
                // An OF WHICH of the line above, never an addend: the surcharge is
                // already inside the vehicle cost.
                ["untooledSurcharge"] = raw.UntooledSurcharge,
                ["toolingCost"] = raw.ToolingCost,
                ["unlockCost"] = raw.UnlockCost,
                ["rolloutCost"] = raw.RolloutCost,
                ["requiredTechs"] = RequiredTechs(raw.RequiredTechs),
            };
        }

        /// <summary>
        /// The blocking nodes, each as its id, its title and what is waiting for it.
        ///
        /// <para>A null title and a null parts list are both written out as nulls
        /// rather than dropped, because each means something on the wire: no title
        /// in the career's tree, and no readable editor ship. An EMPTY parts list
        /// is not the same as a null one and survives as an empty list.</para>
        /// </summary>
        private static List<object?>? RequiredTechs(List<Rp1RequiredTechRaw>? rows)
        {
            if (rows == null)
            {
                return null;
            }
            var techs = new List<object?>();
            foreach (var row in rows)
            {
                techs.Add(new Dictionary<string, object?>
                {
                    ["id"] = row.Id,
                    ["title"] = row.Title,
                    ["parts"] = row.Parts,
                });
            }
            return techs;
        }

        /// <summary>
        /// The career timeline, or NOTHING when RP-1's log handler is not live.
        /// That third state matters: it is distinct from logging switched off and
        /// from logging on with nothing recorded, and all three would otherwise
        /// look like an empty list.
        /// </summary>
        public static Dictionary<string, object?>? BuildEvents(Rp1CareerEventsRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }

            var events = new List<object?>();
            foreach (var e in raw.Events)
            {
                events.Add(new Dictionary<string, object?>
                {
                    ["ut"] = e.Ut,
                    ["kind"] = e.Kind,
                    ["name"] = e.Name,
                    ["detail"] = e.Detail,
                    ["launchId"] = e.LaunchId,
                    ["repChange"] = e.RepChange,
                    ["cost"] = e.Cost,
                    ["isAdd"] = e.IsAdd,
                    ["builtAt"] = e.BuiltAt,
                });
            }

            return new Dictionary<string, object?>
            {
                ["enabled"] = raw.Enabled,
                ["events"] = events,
            };
        }
    }
}
