using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// The level a building first unlocks something at, counted from 1 as the
    /// game shows it. A capability unlocked at no level answers null.
    /// </summary>
    internal static class FacilityTiers
    {
        /// <param name="levelCount">How many levels the building has: 3 in stock, more under a career mod.</param>
        /// <param name="unlockedAt">The game's own switch, asked at each level's normalised value.</param>
        public static int? LowestTier(int levelCount, Func<float, bool> unlockedAt)
        {
            if (levelCount <= 1) return unlockedAt(1f) ? 1 : (int?)null;
            for (var tier = 0; tier < levelCount; tier++)
            {
                if (unlockedAt(tier / (float)(levelCount - 1))) return tier + 1;
            }
            return null;
        }

        /// <summary>
        /// A building the save has not raised far enough, named and with the
        /// level it needs. The game's name when it gives one, its id otherwise,
        /// so the sentence never names nothing.
        /// </summary>
        public static MissingUnlock Missing(SpaceCenterFacility facility, string name, int? tier) => new MissingUnlock
        {
            Kind = UnlockKind.Facility,
            Id = facility.ToString(),
            Name = string.IsNullOrEmpty(name) ? facility.ToString() : name,
            Tier = tier,
        };
    }

    /// <summary>
    /// Authority: <c>GameVariables.GetOrbitDisplayMode</c> at the Tracking
    /// Station's level, the same switch <c>Vessel</c> reads before it attaches
    /// a patched-conics solver. <see cref="CommandRequirement.Quantity"/> is the
    /// display the capability needs: <c>patchedConics</c> for encounters,
    /// patches and maneuver nodes, <c>allOrbits</c> for other craft's orbits.
    ///
    /// <para>Read off <c>GameVariables</c> rather than a level number, so a
    /// career mod that rewrites the Tracking Station's levels is answered by its
    /// own table.</para>
    /// </summary>
    internal sealed class OrbitDisplayGate : ICommandGateEvaluator
    {
        public const string PatchedConics = "patchedConics";
        public const string AllOrbits = "allOrbits";

        private readonly Func<bool> _scenarioLoaded;
        private readonly Func<Game.Modes?> _gameMode;
        private readonly Func<float, GameVariables.OrbitDisplayMode?> _displayModeAt;
        private readonly Func<float> _trackingStationLevel;
        private readonly Func<int> _trackingStationLevelCount;

        /// <summary>The live reads, each replaceable for a headless test.</summary>
        public OrbitDisplayGate(
            Func<bool>? scenarioLoaded = null,
            Func<Game.Modes?>? gameMode = null,
            Func<float, GameVariables.OrbitDisplayMode?>? displayModeAt = null,
            Func<float>? trackingStationLevel = null,
            Func<int>? trackingStationLevelCount = null)
        {
            _scenarioLoaded = scenarioLoaded ?? FacilityGateHelp.FacilitiesScenarioLoaded;
            _gameMode = gameMode ?? FacilityGateHelp.CurrentGameMode;
            _displayModeAt = displayModeAt ?? (norm => GameVariables.Instance?.GetOrbitDisplayMode(norm));
            _trackingStationLevel = trackingStationLevel
                ?? (() => ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.TrackingStation));
            _trackingStationLevelCount = trackingStationLevelCount
                ?? (() => ScenarioUpgradeableFacilities.GetFacilityLevelCount(SpaceCenterFacility.TrackingStation));
        }

        public string Kind => KspGateEvaluators.Kinds.OrbitDisplay;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            GameVariables.OrbitDisplayMode needed;
            switch (requirement.Quantity)
            {
                case PatchedConics:
                    needed = GameVariables.OrbitDisplayMode.PatchedConics;
                    break;
                case AllOrbits:
                    needed = GameVariables.OrbitDisplayMode.AllOrbits;
                    break;
                default:
                    return GateVerdict.Unknown($"no orbit display is named \"{requirement.Quantity}\"");
            }

            var tiers = FacilityGateHelp.ReadFacilityTiers(_scenarioLoaded(), _gameMode());
            if (tiers == FacilityTierRead.Unreadable) return GateVerdict.Unknown("the facilities scenario is not loaded");
            if (tiers == FacilityTierRead.AlwaysMax) return GateVerdict.Pass();

            try
            {
                var current = _displayModeAt(_trackingStationLevel());
                if (current == null) return GateVerdict.Unknown("GameVariables is not loaded");
                if (current.Value >= needed) return GateVerdict.Pass();

                var tier = FacilityTiers.LowestTier(
                    _trackingStationLevelCount(),
                    norm => _displayModeAt(norm) is GameVariables.OrbitDisplayMode mode && mode >= needed);
                return GateVerdict.NotUnlocked(
                    "the Tracking Station does not show this yet",
                    FacilityTiers.Missing(
                        SpaceCenterFacility.TrackingStation,
                        FacilityGateHelp.DisplayName(SpaceCenterFacility.TrackingStation),
                        tier));
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the Tracking Station's orbit display: " + ex.Message);
            }
        }
    }

    /// <summary>One tech node's title and research cost, as the save's own tree states them.</summary>
    internal readonly struct TechDescription
    {
        public TechDescription(string title, double? scienceCost)
        {
            Title = title;
            ScienceCost = scienceCost;
        }

        public string Title { get; }
        public double? ScienceCost { get; }
    }

    /// <summary>Shared reads of the save's research tree, for the two tech gates.</summary>
    internal static class TechReads
    {
        /// <summary>Whether this mode has a research tree at all. Sandbox has every part from the start.</summary>
        public static bool HasResearch(Game.Modes? mode) =>
            mode != Game.Modes.SANDBOX;

        public static bool ResearchLoaded()
        {
            try
            {
                return ResearchAndDevelopment.Instance != null;
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static bool Researched(string techId) =>
            ResearchAndDevelopment.GetTechnologyState(techId) == RDTech.State.Available;

        public static TechDescription Describe(string techId)
        {
            var title = ResearchAndDevelopment.GetTechnologyTitle(techId);
            double? cost = null;
            var nodes = AssetBase.RnDTechTree != null ? AssetBase.RnDTechTree.GetTreeNodes() : null;
            if (nodes != null)
            {
                foreach (var node in nodes)
                {
                    if (node?.tech != null && node.tech.techID == techId)
                    {
                        cost = node.tech.scienceCost;
                        break;
                    }
                }
            }
            return new TechDescription(string.IsNullOrEmpty(title) ? techId : title, cost);
        }

        public static MissingUnlock Missing(string techId, TechDescription description) => new MissingUnlock
        {
            Kind = UnlockKind.Tech,
            Id = techId,
            Name = description.Title,
            ScienceCost = description.ScienceCost,
        };
    }

    /// <summary>
    /// Authority: <c>ResearchAndDevelopment.GetTechnologyState</c>.
    /// <see cref="CommandRequirement.Quantity"/> is the node's <c>techID</c>,
    /// for a capability that is a node rather than a part.
    /// </summary>
    internal sealed class TechResearchedGate : ICommandGateEvaluator
    {
        private readonly Func<Game.Modes?> _gameMode;
        private readonly Func<bool> _researchLoaded;
        private readonly Func<string, bool> _researched;
        private readonly Func<string, TechDescription> _describe;

        /// <summary>The live reads, each replaceable for a headless test.</summary>
        public TechResearchedGate(
            Func<Game.Modes?>? gameMode = null,
            Func<bool>? researchLoaded = null,
            Func<string, bool>? researched = null,
            Func<string, TechDescription>? describe = null)
        {
            _gameMode = gameMode ?? FacilityGateHelp.CurrentGameMode;
            _researchLoaded = researchLoaded ?? TechReads.ResearchLoaded;
            _researched = researched ?? TechReads.Researched;
            _describe = describe ?? TechReads.Describe;
        }

        public string Kind => KspGateEvaluators.Kinds.TechResearched;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var techId = requirement.Quantity ?? "";
            if (techId.Length == 0) return GateVerdict.Unknown("no tech node is named");
            var mode = _gameMode();
            if (mode == null) return GateVerdict.Unknown("no game is loaded");
            if (!TechReads.HasResearch(mode)) return GateVerdict.Pass();
            if (!_researchLoaded()) return GateVerdict.Unknown("the research scenario is not loaded");

            try
            {
                if (_researched(techId)) return GateVerdict.Pass();
                var description = _describe(techId);
                return GateVerdict.NotUnlocked(
                    $"{description.Title} has not been researched",
                    TechReads.Missing(techId, description));
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the research tree: " + ex.Message);
            }
        }
    }

    /// <summary>One loaded part that carries a module: the node it needs, and whether this save has it.</summary>
    internal readonly struct ModuleCarrier
    {
        public ModuleCarrier(string techRequired, bool researched)
        {
            TechRequired = techRequired;
            Researched = researched;
        }

        public string TechRequired { get; }
        public bool Researched { get; }
    }

    /// <summary>
    /// Authority: the loaded part list and
    /// <c>ResearchAndDevelopment.PartTechAvailable</c>.
    /// <see cref="CommandRequirement.Quantity"/> is a <c>PartModule</c> name,
    /// such as <c>ModuleDockingNode</c>, or several joined by
    /// <see cref="Alternatives"/>: the capability exists on this save once any
    /// part carrying any of them is researched.
    ///
    /// <para>The missing node is the cheapest one carrying the module, read off
    /// the installed parts, so a career mod that moves parts between nodes is
    /// answered by its own tree and nothing here names a node.</para>
    /// </summary>
    internal sealed class PartModuleResearchedGate : ICommandGateEvaluator
    {
        /// <summary>Joins module names a requirement accepts any one of, such as the four robotic joints.</summary>
        public const string Alternatives = "|";

        private readonly Func<Game.Modes?> _gameMode;
        private readonly Func<bool> _researchLoaded;
        private readonly Func<string, IReadOnlyList<ModuleCarrier>> _carriersOf;
        private readonly Func<string, TechDescription> _describe;

        /// <summary>The live reads, each replaceable for a headless test.</summary>
        public PartModuleResearchedGate(
            Func<Game.Modes?>? gameMode = null,
            Func<bool>? researchLoaded = null,
            Func<string, IReadOnlyList<ModuleCarrier>>? carriersOf = null,
            Func<string, TechDescription>? describe = null)
        {
            _gameMode = gameMode ?? FacilityGateHelp.CurrentGameMode;
            _researchLoaded = researchLoaded ?? TechReads.ResearchLoaded;
            _carriersOf = carriersOf ?? CarriersOf;
            _describe = describe ?? TechReads.Describe;
        }

        public string Kind => KspGateEvaluators.Kinds.PartModuleResearched;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var module = requirement.Quantity ?? "";
            if (module.Length == 0) return GateVerdict.Unknown("no part module is named");
            var mode = _gameMode();
            if (mode == null) return GateVerdict.Unknown("no game is loaded");
            if (!TechReads.HasResearch(mode)) return GateVerdict.Pass();
            if (!_researchLoaded()) return GateVerdict.Unknown("the research scenario is not loaded");

            try
            {
                var carriers = module
                    .Split(new[] { Alternatives }, StringSplitOptions.RemoveEmptyEntries)
                    .SelectMany(_carriersOf)
                    .ToList();
                return Decide(module, carriers, _describe);
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the parts carrying " + module + ": " + ex.Message);
            }
        }

        /// <summary>
        /// The verdict from the parts carrying the module. No part at all is
        /// Unknown rather than a lock: the mod that adds them is not installed,
        /// which is not something research would fix.
        /// </summary>
        public static GateVerdict Decide(
            string module, IReadOnlyList<ModuleCarrier> carriers, Func<string, TechDescription> describe)
        {
            if (carriers.Count == 0) return GateVerdict.Unknown($"no loaded part carries {module}");
            if (carriers.Any(c => c.Researched)) return GateVerdict.Pass();

            var cheapest = carriers
                .Select(c => c.TechRequired)
                .Where(id => !string.IsNullOrEmpty(id))
                .Distinct()
                .Select(id => (Id: id, Description: describe(id)))
                .OrderBy(t => t.Description.ScienceCost ?? double.MaxValue)
                .ThenBy(t => t.Id, StringComparer.Ordinal)
                .FirstOrDefault();
            if (cheapest.Id == null) return GateVerdict.Unknown($"no part carrying {module} names the tech it needs");

            return GateVerdict.NotUnlocked(
                $"no part carrying {module} has been researched",
                TechReads.Missing(cheapest.Id, cheapest.Description));
        }

        private static IReadOnlyList<ModuleCarrier> CarriersOf(string module)
        {
            var carriers = new List<ModuleCarrier>();
            foreach (var part in PartLoader.LoadedPartsList)
            {
                if (part?.partPrefab == null || !part.partPrefab.Modules.Contains(module)) continue;
                carriers.Add(new ModuleCarrier(part.TechRequired ?? "", ResearchAndDevelopment.PartTechAvailable(part)));
            }
            return carriers;
        }
    }
}
