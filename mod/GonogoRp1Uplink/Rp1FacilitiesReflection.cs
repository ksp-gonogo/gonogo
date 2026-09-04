// The space centre's buildings, read the way RP-1 reads them rather than the way
// KSP's scene does, so the answer survives leaving the space centre.
//
// WHY THIS FILE EXISTS. Core fills career.status.facilities from
// ScenarioUpgradeableFacilities.protoUpgradeables[id].facilityRefs, and that
// list is populated by UpgradeableFacility MonoBehaviours which KSP instantiates
// in the SPACECENTER scene only. So in the editor, in flight and in the tracking
// station every tier and every price on that payload arrives absent. The
// standing sentence about it -- that the buildings are not in the scene, so
// their tiers cannot be read from here -- is true of THAT path and is not true
// of the game.
//
// RP-1 READS THEM OFF-SCENE ITSELF, EVERY TICK, and that is the fact this file
// is built on rather than an inference from one:
//
//   MaintenanceHandler.UpdateUpkeep() walks FacilitiesForMaintenance and calls
//   KCTUtilities.GetFacilityLevel(facility) for each, to bill the career for
//   what it owns. MaintenanceHandler carries
//   [KSPScenario(..., EDITOR, FLIGHT, SPACECENTER, TRACKSTATION)] -- read out of
//   the IL rather than the decompiled attribute, whose arguments ilspycmd cannot
//   render -- so that walk runs in all four scenes.
//
// THE TWO READS THAT MAKE IT WORK, both off the shipped RP-1 v4.6.0.0 RP0.dll:
//
//   KCTUtilities.GetFacilityLevel(SpaceCenterFacility)
//       => MathUtils.GetIndexFromNorm(
//              ScenarioUpgradeableFacilities.GetFacilityLevel(facility),
//              Database.GetFacilityLevelCount(facility))
//
//     The first argument is the NORMALISED level KSP persists in the save.
//     ProtoUpgradeable.GetLevel() returns facilityRefs[0].GetNormLevel() when the
//     scene has instantiated the building and PARSES configNode's "lvl" when it
//     has not, which is the branch that answers off-scene. The operator's own
//     save carries it: a SCENARIO named ScenarioUpgradeableFacilities, marked
//     `scene = 5, 6, 7, 8`, holding one `lvl` per building.
//
//   Database.FacilityLevelCosts : Dictionary<SpaceCenterFacility, List<int>>
//
//     RP-1's own copy of the CustomBarnKit `upgrades` list, parsed at load time
//     in Database.<LoadFacilityData> and never touched again. Its Count is the
//     number of tiers and entry [n] is what tier n costs, so the price of the
//     next step is [tier + 1]. Both were checked against the shipped
//     RP-1/CustomBarnKit.cfg and against a live reading of the running career:
//     ADMINISTRATION declares `levels = 9` and
//     `upgrades = 25000, 40000, 140000, ...`, and the space centre showed
//     "Administration tier 0 of 8, upgrade 40,000f" -- Count-1 and entry [1].
//
// WHAT IS STILL SCENE-BOUND, and is therefore not here. The tier DESCRIPTIONS
// (GetLevelText / GetNextLevelText) come off the live facility and have no
// config mirror, so they stay on career.status where they can only be read at
// the space centre. This channel carries three facts, not four.
//
// NOTHING IS INVOKED THAT WRITES. GetFacilityLevel's whole effect is its return
// value; the two static string dictionaries it memoises into
// (ScenarioUpgradeableFacilities.facilityStrings and .slashSanitizedStrings) are
// transient lookup caches, not save state, and RP-1's own upkeep pass fills them
// on the same tick anyway.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of the space centre's buildings, as plain data with no
    /// live RP-1 or KSP object in it. Everything is reached by reflection, so this
    /// compiles and runs headless against a stand-in object graph.
    /// </summary>
    public sealed class Rp1FacilitiesReflection
    {
        private const string DatabaseTypeName = "RP0.Database";
        private const string KctUtilitiesTypeName = "RP0.KCTUtilities";
        private const string HighLogicTypeName = "HighLogic";

        private readonly Type? _database;
        private readonly Type? _kctUtilities;
        private readonly Type? _highLogic;

        /// <summary>
        /// Resolved once. Arity alone would be ambiguous on a type with this many
        /// statics, so the lookup is by name and one parameter and the result is
        /// held rather than re-resolved per facility per tick.
        /// </summary>
        private readonly MethodInfo? _getFacilityLevel;

        public Rp1FacilitiesReflection()
            : this(
                Rp1Types.Find(DatabaseTypeName),
                Rp1Types.Find(KctUtilitiesTypeName),
                Rp1Types.Find(HighLogicTypeName))
        {
        }

        /// <summary>Seam for the headless tests, which hand in stand-in types.</summary>
        internal Rp1FacilitiesReflection(Type? database, Type? kctUtilities, Type? highLogic)
        {
            _database = database;
            _kctUtilities = kctUtilities;
            _highLogic = highLogic;
            _getFacilityLevel = _kctUtilities == null
                ? null
                : Rp1Types.StaticMethod(_kctUtilities, "GetFacilityLevel", 1);
        }

        /// <summary>
        /// True when every member this reads resolved. False publishes an empty
        /// list, which is the same answer a stock install gives.
        /// </summary>
        public bool Available => _database != null && _getFacilityLevel != null;

        /// <summary>
        /// One row per building RP-1 priced, in whatever order its own dictionary
        /// yields them. Empty when RP-1 is absent or its cost table has not loaded,
        /// never a partial guess: a facility whose tier could not be read is left
        /// out rather than published at a default, because tier zero is a real
        /// reading a new career starts at.
        /// </summary>
        public List<Rp1FacilityRaw> Read()
        {
            var rows = new List<Rp1FacilityRaw>();
            if (!Available)
            {
                return rows;
            }

            if (!(Rp1Types.StaticValue(_database!, "FacilityLevelCosts") is IDictionary costs))
            {
                return rows;
            }

            var locked = LockedFacilityNames();
            var multiplier = FundsLossMultiplier();

            foreach (DictionaryEntry entry in costs)
            {
                var facility = entry.Key;
                if (facility == null)
                {
                    continue;
                }
                var tiers = TierCosts(entry.Value);
                if (tiers == null || tiers.Count == 0)
                {
                    continue;
                }

                var tier = FacilityLevel(facility);
                if (tier == null)
                {
                    continue;
                }

                var name = facility.ToString();
                rows.Add(new Rp1FacilityRaw
                {
                    Facility = name,
                    CurrentTier = tier,
                    MaxTier = tiers.Count - 1,
                    UpgradeCost = UpgradeCost(tiers, tier.Value, multiplier),
                    UpgradedByRp1 = locked == null ? (bool?)null : !locked.Contains(name),
                });
            }

            return rows;
        }

        /// <summary>
        /// What the next tier costs, or absent when there is no next tier and when
        /// the career's multiplier could not be read.
        /// </summary>
        /// <remarks>
        /// The multiplier is not defaulted to 1. UpgradeableFacility.GetUpgradeCost
        /// applies HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier to
        /// the same config figure, and that slider genuinely moves: KSP's own easy
        /// and hard presets set it to 0.5 and 1.5. A price that is right on a
        /// default career and quietly wrong on every other is worse than no price,
        /// because nothing downstream can tell the two apart.
        /// </remarks>
        private static double? UpgradeCost(IList<double> tiers, int tier, double? multiplier)
        {
            var next = tier + 1;
            if (next < 0 || next >= tiers.Count || multiplier == null)
            {
                return null;
            }
            return tiers[next] * multiplier.Value;
        }

        /// <summary>
        /// RP-1's own denormalisation, invoked rather than reproduced. Reproducing
        /// it would mean holding a copy of GetIndexFromNorm's 0.01 epsilon, and a
        /// copy of an arithmetic detail agrees with itself forever.
        /// </summary>
        private int? FacilityLevel(object facility)
        {
            try
            {
                return _getFacilityLevel!.Invoke(null, new[] { facility }) as int?;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The buildings RP-1 does not upgrade as buildings, by enum name, or null
        /// when the list could not be read.
        /// </summary>
        /// <remarks>
        /// Null rather than empty, because an empty list is a real answer: a config
        /// that prices every building properly leaves nothing locked, and reporting
        /// that as "could not tell" would hide a working install.
        /// </remarks>
        private HashSet<string>? LockedFacilityNames()
        {
            if (!(Rp1Types.StaticValue(_database!, "LockedFacilities") is IEnumerable list))
            {
                return null;
            }
            var names = new HashSet<string>();
            foreach (var facility in list)
            {
                if (facility != null)
                {
                    names.Add(facility.ToString());
                }
            }
            return names;
        }

        /// <summary>The per-tier costs, widened once so the arithmetic above is type-free.</summary>
        private static IList<double>? TierCosts(object? value)
        {
            if (!(value is IEnumerable list))
            {
                return null;
            }
            var costs = new List<double>();
            foreach (var cost in list)
            {
                var d = Rp1Types.ToDouble(cost);
                if (d == null)
                {
                    return null;
                }
                costs.Add(d.Value);
            }
            return costs;
        }

        private double? FundsLossMultiplier()
        {
            if (_highLogic == null)
            {
                return null;
            }
            return Rp1Types.ToDouble(
                Rp1Types.Member(
                    Rp1Types.Member(
                        Rp1Types.Member(Rp1Types.StaticValue(_highLogic, "CurrentGame"), "Parameters"),
                        "Career"),
                    "FundsLossMultiplier"));
        }
    }

    /// <summary>
    /// One building's three off-scene facts. Same shape as the wire row, and the
    /// mapper in <see cref="Rp1ScCapture"/> is what keeps them in step.
    /// </summary>
    public sealed class Rp1FacilityRaw
    {
        public string? Facility;
        public int? CurrentTier;
        public int? MaxTier;
        public double? UpgradeCost;
        public bool? UpgradedByRp1;
    }
}
