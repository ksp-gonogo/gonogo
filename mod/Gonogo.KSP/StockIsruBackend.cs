using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The always-present VANILLA ISRU backend: the structural counterpart to
    /// <see cref="StockActionGroupsBackend"/>, registered as the <c>"isru"</c>
    /// capability's <c>Vanilla</c> factory by
    /// <see cref="IsruCoreUplink.DeclareCapabilities"/>.
    ///
    /// <para>Unlike reliability's vanilla backend, this one is a REAL reader:
    /// stock KSP models ISRU with two part modules and this walks both. An empty
    /// list means the active vessel carries no drills or converters, which is a
    /// fact about the vessel, not a gap in the backend.</para>
    ///
    /// <para><b>Main thread only</b>: every method reads live KSP
    /// (<c>FlightGlobals.ActiveVessel</c> and its PartModules). See
    /// <see cref="IIsruBackend"/>'s threading note: this is called from
    /// <see cref="IsruCoreUplink"/>'s main-thread capture, never from a channel
    /// mapper.</para>
    ///
    /// <para><b>Asteroid and comet drills are out of scope here.</b> Those are
    /// <c>ModuleAsteroidDrill</c>, a different module with a different source of
    /// abundance (the rock's remaining mass, not a resource map), so sweeping them
    /// into this walk would mean reporting a made-up abundance. They are their own
    /// piece of work.</para>
    /// </summary>
    public sealed class StockIsruBackend : IIsruBackend
    {
        /// <summary>
        /// The harvest rate stock itself computed this tick: abundance times the
        /// drill's efficiency, times the intake multiplier for the atmospheric
        /// harvester types. It is protected, and the multiplier that produces it is
        /// private, so reading the field is the only way to report stock's own
        /// number rather than a re-derivation that would quietly disagree with the
        /// part's own readout on every atmospheric harvester. Resolved once; a
        /// rename degrades to the abundance-times-efficiency fallback below.
        /// </summary>
        private static readonly FieldInfo? ResFlowField = typeof(ModuleResourceHarvester).GetField(
            "_resFlow", BindingFlags.NonPublic | BindingFlags.Instance);

        public string ProviderId => "stock";

        public IReadOnlyList<IsruDrillEntry> Drills()
        {
            var entries = new List<IsruDrillEntry>();
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                return entries;
            }

            for (var i = 0; i < vessel.parts.Count; i++)
            {
                var part = vessel.parts[i];
                if (part == null)
                {
                    continue;
                }

                var harvesters = part.FindModulesImplementing<ModuleResourceHarvester>();
                if (harvesters == null)
                {
                    continue;
                }

                for (var h = 0; h < harvesters.Count; h++)
                {
                    var harvester = harvesters[h];
                    if (harvester == null)
                    {
                        continue;
                    }

                    entries.Add(BuildDrill(part, harvester));
                }
            }

            return entries;
        }

        public IReadOnlyList<IsruConverterEntry> Converters()
        {
            var entries = new List<IsruConverterEntry>();
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                return entries;
            }

            for (var i = 0; i < vessel.parts.Count; i++)
            {
                var part = vessel.parts[i];
                if (part == null)
                {
                    continue;
                }

                var converters = part.FindModulesImplementing<ModuleResourceConverter>();
                if (converters == null)
                {
                    continue;
                }

                for (var c = 0; c < converters.Count; c++)
                {
                    var converter = converters[c];
                    if (converter == null)
                    {
                        continue;
                    }

                    entries.Add(BuildConverter(part, converter));
                }
            }

            return entries;
        }

        private static IsruDrillEntry BuildDrill(Part part, ModuleResourceHarvester harvester)
        {
            var running = harvester.IsActivated;
            var abundance = AbundanceAt(part, harvester);

            return new IsruDrillEntry
            {
                PartId = part.flightID.ToString(),
                PartTitle = TitleOf(part),
                Resource = string.IsNullOrEmpty(harvester.ResourceName) ? null : harvester.ResourceName,
                Deployed = DeployedState(part),
                Running = running,
                Abundance = abundance,
                // Not running means extracting nothing, which is a real zero rather
                // than an absence. Running means stock's own harvest rate scaled by
                // the same live efficiency multiplier its converter loop applies.
                Rate = running ? HarvestRate(harvester, abundance) : 0.0,
            };
        }

        private static IsruConverterEntry BuildConverter(Part part, ModuleResourceConverter converter)
        {
            var entry = new IsruConverterEntry
            {
                PartId = part.flightID.ToString(),
                PartTitle = TitleOf(part),
                Running = converter.IsActivated,
            };

            ConversionRecipe? recipe = null;
            try
            {
                recipe = converter.Recipe;
            }
            catch (Exception)
            {
                // A converter whose recipe fails to build reports as a running/idle
                // part with no flows rather than sinking the whole channel.
            }

            if (recipe == null)
            {
                return entry;
            }

            var multiplier = EfficiencyMultiplier(converter);
            AddFlows(entry.Inputs, recipe.Inputs, multiplier);
            AddFlows(entry.Outputs, recipe.Outputs, multiplier);
            return entry;
        }

        private static void AddFlows(List<IsruResourceFlow> into, List<ResourceRatio> ratios, double multiplier)
        {
            if (ratios == null)
            {
                return;
            }

            for (var i = 0; i < ratios.Count; i++)
            {
                var ratio = ratios[i];
                into.Add(new IsruResourceFlow
                {
                    Resource = string.IsNullOrEmpty(ratio.ResourceName) ? null : ratio.ResourceName,
                    Rate = ratio.Ratio * multiplier,
                });
            }
        }

        /// <summary>
        /// The live efficiency multiplier stock applies to every flow in the recipe
        /// (efficiency bonus, heat throttle, part modifiers, crew skill), so the
        /// reported rates are what is actually moving rather than what the config
        /// asked for. A converter that throws here is reported at its raw recipe
        /// ratios rather than not at all.
        /// </summary>
        private static double EfficiencyMultiplier(BaseConverter converter)
        {
            try
            {
                return converter.GetEfficiencyMultiplier();
            }
            catch (Exception)
            {
                return 1.0;
            }
        }

        /// <summary>
        /// The same resource-map lookup the drill's own right-click readout makes,
        /// at the vessel's current position. Null when the map is unavailable (it
        /// exists only once a game is loaded) or the lookup throws.
        /// </summary>
        private static double? AbundanceAt(Part part, ModuleResourceHarvester harvester)
        {
            var vessel = part.vessel;
            if (vessel == null || !ResourceMap.Initialized || string.IsNullOrEmpty(harvester.ResourceName))
            {
                return null;
            }

            var body = vessel.mainBody;
            if (body == null)
            {
                return null;
            }

            try
            {
                var request = new AbundanceRequest
                {
                    Altitude = vessel.altitude,
                    BodyId = body.flightGlobalsIndex,
                    CheckForLock = false,
                    Latitude = vessel.latitude,
                    Longitude = vessel.longitude,
                    ResourceType = (HarvestTypes)harvester.HarvesterType,
                    ResourceName = harvester.ResourceName,
                };
                return ResourceMap.Instance.GetAbundance(request);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static double? HarvestRate(ModuleResourceHarvester harvester, double? abundance)
        {
            var multiplier = EfficiencyMultiplier(harvester);

            if (ResFlowField != null)
            {
                try
                {
                    if (ResFlowField.GetValue(harvester) is double resFlow)
                    {
                        return resFlow * multiplier;
                    }
                }
                catch (Exception)
                {
                    // fall through to the derived figure
                }
            }

            // Fallback only: correct for the surface and ocean harvester types, and
            // low for the atmospheric ones, whose intake multiplier lives behind a
            // private method. Reached only if stock renames the field above.
            return abundance.HasValue ? abundance.Value * harvester.Efficiency * multiplier : (double?)null;
        }

        /// <summary>
        /// Deploy state off the part's animation group, the module that actually
        /// owns the drill-head animation. Null when the part has none, which is the
        /// honest answer for a harvester that simply does not deploy.
        /// </summary>
        private static bool? DeployedState(Part part)
        {
            try
            {
                var group = part.FindModuleImplementing<ModuleAnimationGroup>();
                return group != null ? group.isDeployed : (bool?)null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string? TitleOf(Part part) =>
            part.partInfo != null ? part.partInfo.title : part.name;
    }
}
