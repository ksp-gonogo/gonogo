using System;
using System.Collections.Generic;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Surfaces the player's research state from KSP's research tree so
    /// widgets can render "kOS not unlocked yet" instead of the generic
    /// empty state, and so a research-officer station can pick what to
    /// spend science on.
    ///
    /// Keys:
    /// - `tech.unlockedIds` — array of node ids the player has researched.
    /// - `tech.unlockedPartCount` — number of parts available in VAB/SPH
    ///   under the current tech tree.
    /// - `tech.affordable` — array of `{ id, scienceCost }` for nodes the
    ///   player could buy: not-yet-unlocked AND scienceCost ≤ current
    ///   science. Prereq filtering is left to KSP's own check at unlock
    ///   time (ProtoTechNode doesn't expose predecessor info; widget
    ///   consumes the list and KSP refuses prereq-blocked unlocks).
    /// - `tech.unlock[techId]` — write action.
    ///
    /// All keys are global (vessel parameter ignored). Same convention as
    /// Telemachus's own ScienceCareer handler.
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

        // The tech tree is owned by AssetBase.RnDTechTree, not
        // ResearchAndDevelopment.Instance. Returns ProtoTechNode[]; each
        // entry has techID, scienceCost, state (RDTech.State), and
        // partsPurchased.
        private static ProtoTechNode[] GetTreeTechs()
        {
            var tree = AssetBase.RnDTechTree;
            if (tree == null) return Array.Empty<ProtoTechNode>();
            return tree.GetTreeTechs() ?? Array.Empty<ProtoTechNode>();
        }

        private static object UnlockedIds()
        {
            var result = new List<string>();
            // Sandbox / science-mode saves have no R&D instance; the tree
            // is still loaded but no nodes show as Available. Empty result
            // is the right shape.
            if (ResearchAndDevelopment.Instance == null) return result;
            foreach (var node in GetTreeTechs())
            {
                if (node != null && node.state == RDTech.State.Available)
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
            // Without parent / prerequisite info on ProtoTechNode, we
            // can't gate on prereqs-met server-side. Return all
            // not-yet-unlocked nodes whose science cost is affordable;
            // KSP's UnlockProtoTechNode refuses prereq-blocked unlocks at
            // call time, so the widget showing the list and the unlock
            // action both behave correctly. Better than silently hiding
            // affordable-but-locked nodes.
            var result = new List<Dictionary<string, object>>();
            var rd = ResearchAndDevelopment.Instance;
            if (rd == null) return result;

            var available = rd.Science;
            foreach (var node in GetTreeTechs())
            {
                if (node == null) continue;
                if (node.state == RDTech.State.Available) continue;
                if (node.scienceCost > available) continue;
                result.Add(new Dictionary<string, object>
                {
                    ["id"] = node.techID,
                    ["scienceCost"] = node.scienceCost,
                });
            }
            return result;
        }

        private static object Unlock(string[] args)
        {
            if (args == null || args.Length == 0) return "missing tech id";
            var techId = args[0];
            if (string.IsNullOrEmpty(techId)) return "missing tech id";

            var rd = ResearchAndDevelopment.Instance;
            if (rd == null) return "no R&D scenario";

            ProtoTechNode target = null;
            foreach (var node in GetTreeTechs())
            {
                if (node != null && node.techID == techId)
                {
                    target = node;
                    break;
                }
            }
            if (target == null) return "tech not found";
            if (target.state == RDTech.State.Available) return 0; // idempotent
            if (target.scienceCost > rd.Science) return "insufficient science";

            // ResearchAndDevelopment.UnlockProtoTechNode is the direct
            // path (per the decompiled RefreshTechTreeUI flow). The
            // automatic charge fires through the R&D scene UI, not the
            // programmatic unlock — deduct funds explicitly with a
            // matching transaction reason.
            ResearchAndDevelopment.Instance.AddScience(
                -target.scienceCost,
                TransactionReasons.RnDTechResearch);
            ResearchAndDevelopment.Instance.UnlockProtoTechNode(target);
            return 0;
        }
    }
}
