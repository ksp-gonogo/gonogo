using System;
using System.Collections.Generic;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// First gonogo telemetry handler — surfaces the player's research
    /// state from KSP's `ResearchAndDevelopment` so widgets can render
    /// "kOS not unlocked yet" instead of the generic empty state.
    ///
    /// Phase 1 keys:
    /// - `tech.unlockedIds` — array of node ids the player has researched.
    /// - `tech.unlockedPartCount` — number of parts available in VAB/SPH
    ///   under the current tech tree (cheap proxy for "how built up is
    ///   this save").
    ///
    /// Both are global (not vessel-specific), so the `Vessel` parameter
    /// is ignored — same convention Telemachus's own ScienceCareer
    /// handler uses.
    /// </summary>
    public class TechTreeApi : IMinimalTelemachusPlugin
    {
        public string[] Commands => new[]
        {
            "tech.unlockedIds",
            "tech.unlockedPartCount",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "tech.unlockedIds":
                    return (_, __) => UnlockedIds();
                case "tech.unlockedPartCount":
                    return (_, __) => UnlockedPartCount();
                default:
                    return null;
            }
        }

        private static object UnlockedIds()
        {
            // Sandbox + science modes don't have a research progression,
            // so ResearchAndDevelopment.Instance is null. Return an empty
            // list rather than throwing so the WS payload stays well-formed.
            if (ResearchAndDevelopment.Instance == null)
                return new List<string>();
            var result = new List<string>();
            foreach (var node in ResearchAndDevelopment.Instance.GetTreeTechs())
            {
                if (node.state == RDTech.State.Available)
                    result.Add(node.techID);
            }
            return result;
        }

        private static object UnlockedPartCount()
        {
            if (PartLoader.LoadedPartsList == null) return 0;
            var count = 0;
            foreach (var part in PartLoader.LoadedPartsList)
            {
                if (ResearchAndDevelopment.PartTechAvailable(part)) count++;
            }
            return count;
        }
    }
}
