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

        // Sticky-cache for transient empty results. KSP clears
        // ResearchAndDevelopment.Instance.protoTechNodes during scene
        // loads and rebuilds it from the save — there's a one-frame
        // window where every node reports Unavailable. If a query
        // would have returned a non-empty list last time but now
        // returns empty, surface the cached result instead. Sticks
        // until KSP repopulates and we naturally overwrite the cache.
        private static List<string> _cachedUnlockedIds;
        private static List<Dictionary<string, object>> _cachedAffordable;

        // In any career/science save, `start` is always unlocked from
        // game-start. If GetTechnologyState reports it as Unavailable,
        // we're in the brief window where KSP has cleared
        // protoTechNodes but not yet repopulated. Return cached values
        // for that window.
        private static bool IsTransientLoadingState()
        {
            if (ResearchAndDevelopment.Instance == null) return false;
            return ResearchAndDevelopment.GetTechnologyState("start")
                != RDTech.State.Available;
        }

        private static object UnlockedIds()
        {
            // Sandbox / science-mode saves have no R&D instance; the tree
            // is still loaded but no nodes show as Available. Empty result
            // is the right shape.
            if (ResearchAndDevelopment.Instance == null) return new List<string>();

            if (IsTransientLoadingState() && _cachedUnlockedIds != null)
                return new List<string>(_cachedUnlockedIds);

            var result = new List<string>();
            // ProtoTechNode.state on the AssetBase tree reflects the
            // *static config-loaded* state — i.e. only `start` ever shows
            // as Available, regardless of player progression. The
            // player's actual unlocked set lives in
            // ResearchAndDevelopment.Instance.protoTechNodes (private),
            // accessed via the public static GetTechnologyState(id). Walk
            // the tree for ids, query real state per node.
            foreach (var node in GetTreeTechs())
            {
                if (node == null) continue;
                if (ResearchAndDevelopment.GetTechnologyState(node.techID)
                    == RDTech.State.Available)
                {
                    result.Add(node.techID);
                }
            }
            _cachedUnlockedIds = result;
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

            // During a scene load, GetTechnologyState briefly says
            // Unavailable for every node — that'd cause Affordable to
            // *balloon* (every cheap-enough node looks "not yet
            // unlocked"). Detect via the same `start` check as
            // UnlockedIds and return the previous cache instead.
            if (IsTransientLoadingState() && _cachedAffordable != null)
                return new List<Dictionary<string, object>>(_cachedAffordable);

            var available = rd.Science;
            foreach (var node in GetTreeTechs())
            {
                if (node == null) continue;
                // Same lookup-via-static-API trick as UnlockedIds — the
                // node.state on the AssetBase tree is config-static and
                // reads as Unavailable for everything except `start`.
                if (ResearchAndDevelopment.GetTechnologyState(node.techID)
                    == RDTech.State.Available) continue;
                if (node.scienceCost > available) continue;
                result.Add(new Dictionary<string, object>
                {
                    ["id"] = node.techID,
                    ["scienceCost"] = node.scienceCost,
                });
            }
            _cachedAffordable = result;
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
            // Real state via the static lookup — the in-tree node.state
            // is config-static (always Unavailable except for `start`).
            if (ResearchAndDevelopment.GetTechnologyState(target.techID)
                == RDTech.State.Available) return 0; // idempotent
            if (target.scienceCost > rd.Science) return "insufficient science";

            // ResearchAndDevelopment.UnlockProtoTechNode is the direct
            // path (per the decompiled RefreshTechTreeUI flow). The
            // automatic charge fires through the R&D scene UI, not the
            // programmatic unlock — deduct funds explicitly with a
            // matching transaction reason.
            //
            // Defer onto the main thread: UnlockProtoTechNode walks parts
            // and triggers part-purchased state on stock prefabs, which
            // can re-instantiate Unity objects. Same Unity-only contract
            // as Contract.Accept / KscApi.UpgradeFacility.
            var captured = target;
            GonogoTelemetryAddon.Defer(() =>
            {
                ResearchAndDevelopment.Instance.AddScience(
                    -captured.scienceCost,
                    TransactionReasons.RnDTechResearch);
                ResearchAndDevelopment.Instance.UnlockProtoTechNode(captured);
            });
            return 0;
        }
    }
}
