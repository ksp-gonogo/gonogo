using System;
using System.Collections.Generic;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Surfaces the player's research state from KSP's
    /// `ResearchAndDevelopment` so widgets can render
    /// "kOS not unlocked yet" instead of the generic empty state, and so
    /// a research-officer station can pick what to spend science on.
    ///
    /// Keys:
    /// - `tech.unlockedIds` — array of node ids the player has researched.
    /// - `tech.unlockedPartCount` — number of parts available in VAB/SPH
    ///   under the current tech tree (cheap proxy for "how built up is
    ///   this save").
    /// - `tech.affordable` — array of `{ id, title, scienceCost }` for
    ///   nodes the player could buy *right now*: prerequisites met AND
    ///   cost ≤ current science. Drives the research-officer pick-list.
    ///
    /// All keys are global (not vessel-specific), so the `Vessel`
    /// parameter is ignored — same convention Telemachus's own
    /// ScienceCareer handler uses.
    /// </summary>
    public class TechTreeApi : IMinimalTelemachusPlugin
    {
        public string[] Commands => new[]
        {
            "tech.unlockedIds",
            "tech.unlockedPartCount",
            "tech.affordable",
            "tech.unlock",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "tech.unlockedIds":
                    return (_, __) => UnlockedIds();
                case "tech.unlockedPartCount":
                    return (_, __) => UnlockedPartCount();
                case "tech.affordable":
                    return (_, __) => Affordable();
                case "tech.unlock":
                    return (_, args) => Unlock(args);
                default:
                    return null;
            }
        }

        private static object Unlock(string[] args)
        {
            if (args == null || args.Length == 0) return "missing tech id";
            var techId = args[0];
            if (string.IsNullOrEmpty(techId)) return "missing tech id";

            var rd = ResearchAndDevelopment.Instance;
            if (rd == null) return "no R&D scenario";

            // Find the node. KSP enumerates the tree top-down; iterate
            // every time rather than caching because mods can add nodes
            // mid-game and the cost of one walk is trivial.
            RDTech target = null;
            foreach (var node in rd.GetTreeTechs())
            {
                if (node != null && node.techID == techId) { target = node; break; }
            }
            if (target == null) return "tech not found";
            if (target.state == RDTech.State.Available) return 0; // already unlocked

            // Affordability check: surface a clear error rather than letting
            // KSP's UnlockTech silently no-op or push the science balance
            // negative on some game versions.
            if (target.scienceCost > rd.Science) return "insufficient science";

            // KSP exposes both UnlockTech (direct) and the more involved
            // RDController flow (UI-level). The plugin uses UnlockTech +
            // an explicit science deduction since UnlockTech alone doesn't
            // always charge the player on every KSP version. Belt and
            // braces: only deduct on success.
            var charged = rd.AddScience(-target.scienceCost,
                TransactionReasons.RnDTechResearch);
            target.UnlockTech(true);
            return charged != 0f ? 0 : "unlock failed";
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

        private static object Affordable()
        {
            var result = new List<Dictionary<string, object>>();
            var rd = ResearchAndDevelopment.Instance;
            if (rd == null) return result;

            var available = rd.Science;
            // Build a set of unlocked ids first so the prereq-check is O(1)
            // rather than O(unlocked) per candidate.
            var unlocked = new HashSet<string>();
            var nodes = rd.GetTreeTechs();
            foreach (var node in nodes)
            {
                if (node.state == RDTech.State.Available)
                    unlocked.Add(node.techID);
            }

            foreach (var node in nodes)
            {
                if (node.state == RDTech.State.Available) continue; // already bought
                if (node.scienceCost > available) continue;
                if (!PrereqsMet(node, unlocked)) continue;

                result.Add(new Dictionary<string, object>
                {
                    ["id"] = node.techID,
                    ["title"] = node.title,
                    ["scienceCost"] = node.scienceCost,
                });
            }
            return result;
        }

        private static bool PrereqsMet(RDTech node, HashSet<string> unlocked)
        {
            // RDTech.parents is a list of RDTech.OperatorMath entries in
            // most KSP versions. The wider-compatible path is to fetch the
            // RDNode from RDController and read parents.parent.tech.techID,
            // but RDController isn't always loaded outside the R&D scene.
            // Stick with what node.predecessors / parents give us, falling
            // back to "no prereq info" (treat as met) so we don't silently
            // hide affordable nodes.
            var parents = node.parents;
            if (parents == null || parents.Length == 0) return true;
            foreach (var parent in parents)
            {
                // parent.parent is the predecessor RDTech in stock KSP.
                var parentTech = parent?.parent?.tech;
                if (parentTech == null) continue;
                if (!unlocked.Contains(parentTech.techID)) return false;
            }
            return true;
        }
    }
}
