using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Strategies;
using Upgradeables;

namespace Gonogo.KSP.Gates
{
    /**
     * The game state the per-item gates read, as the readings the gate report
     * compares from one frame to the next. Each reading is cheap and
     * allocation-light because every one declared by a watched evaluator is
     * taken once per frame; a reading is a number or a hash, never the state
     * itself.
     *
     * An input changes when a verdict that reads it can: the strategy reading
     * folds in what each running strategy's own commitment check says, so a
     * commitment that elapses is a change at the frame it flips.
     */
    internal static class GateInputs
    {
        public static readonly GateInput Scene = new GateInput("scene", () => (int)HighLogic.LoadedScene);

        public static readonly GateInput Funds = new GateInput("funds", () => Funding.Instance?.Funds);

        public static readonly GateInput Science = new GateInput(
            "science", () => ResearchAndDevelopment.Instance?.Science);

        public static readonly GateInput Reputation = new GateInput(
            "reputation", () => global::Reputation.Instance != null ? global::Reputation.CurrentRep : (float?)null);

        public static readonly GateInput Facilities = new GateInput("facilities", () => ReadFacilities());

        public static readonly GateInput Research = new GateInput("research", () => ReadResearch());

        public static readonly GateInput Strategies = new GateInput("strategies", () => ReadStrategies());

        public static readonly GateInput Vessels = new GateInput("vessels", () => ReadVessels());

        private static long Mix(long hash, long value) => unchecked(hash * 31 + value);

        private static long ReadFacilities()
        {
            if (ScenarioUpgradeableFacilities.Instance == null) return 0;
            long hash = 1;
            foreach (SpaceCenterFacility facility in Enum.GetValues(typeof(SpaceCenterFacility)))
            {
                hash = Mix(hash, ScenarioUpgradeableFacilities.GetFacilityLevel(facility).GetHashCode());
            }
            return hash;
        }

        private static long ReadResearch()
        {
            var tree = AssetBase.RnDTechTree;
            var techs = tree?.GetTreeTechs();
            if (techs == null || ResearchAndDevelopment.Instance == null) return 0;
            long hash = 1;
            foreach (var tech in techs)
            {
                if (tech == null) continue;
                hash = Mix(hash, (long)ResearchAndDevelopment.GetTechnologyState(tech.techID));
            }
            return hash;
        }

        private static long ReadStrategies()
        {
            var strategies = StrategySystem.Instance?.Strategies;
            if (strategies == null) return 0;
            long hash = 1;
            foreach (var strategy in strategies)
            {
                if (strategy == null) continue;
                hash = Mix(hash, strategy.Config?.Name?.GetHashCode() ?? 0);
                hash = Mix(hash, strategy.IsActive ? 1 : 0);
                hash = Mix(hash, strategy.Factor.GetHashCode());
                if (strategy.IsActive) hash = Mix(hash, CommitmentElapsed(strategy) ? 1 : 0);
            }
            return hash;
        }

        private static bool CommitmentElapsed(Strategy strategy)
        {
            try
            {
                return strategy.CanBeDeactivated(out _);
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Which saved vessels sit where, since a craft parked on a facility refuses its upgrade.</summary>
        private static long ReadVessels()
        {
            var vessels = HighLogic.CurrentGame?.flightState?.protoVessels;
            if (vessels == null) return 0;
            long hash = vessels.Count;
            foreach (var vessel in vessels)
            {
                if (vessel == null) continue;
                hash = Mix(hash, vessel.vesselName?.GetHashCode() ?? 0);
                hash = Mix(hash, (long)vessel.situation);
                hash = Mix(hash, vessel.landedAt?.GetHashCode() ?? 0);
                hash = Mix(hash, vessel.latitude.GetHashCode());
                hash = Mix(hash, vessel.longitude.GetHashCode());
            }
            return hash;
        }
    }
}
