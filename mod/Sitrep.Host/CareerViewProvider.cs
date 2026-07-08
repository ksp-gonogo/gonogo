using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>career.status</c> channel — added
    /// the M3 session to get KSC/career state onto the wire quickly (speed
    /// prioritized: this is a primitives-dict pass-through, same posture
    /// <see cref="SystemViewProvider"/>'s own doc comment allows for
    /// "fine for now" channels — a typed <c>Sitrep.Contract</c> POCO is a
    /// follow-up, not a blocker). Reads <c>Values["career"]</c> —
    /// <c>Gonogo.KSP.KspHost.BuildCareer</c>'s raw dict — and republishes it
    /// through <see cref="SnapshotDict"/>'s readers so every scalar gets the
    /// same R1/F-1 non-finite-is-absent rule <see cref="SystemViewProvider"/>
    /// already applies, and so a <see cref="ReplayKspHost"/> snapshot (post
    /// JSON round-trip, every number arrives as <c>double</c>) maps
    /// identically to a live capture.
    ///
    /// <para><b>M3b career-detail capture-add:</b> facilities/contracts/
    /// strategies/tech were widened from the M3 session's "just enough to
    /// prove the channel exists" shape to what the KSC widgets
    /// (SpaceCenterStatus/ContractManager/Strategies/TechTree/Objectives)
    /// actually need — see each <c>Build*</c> method below and
    /// <c>Gonogo.KSP.KspHost</c>'s matching <c>BuildCareer*</c> methods for
    /// the decompile-confirmed KSP APIs behind each new field. Purely
    /// additive/reshaping within each group — <c>economy</c> is untouched.</para>
    ///
    /// <para><b>Raw snapshot encoding (Gonogo.KSP.KspHost.BuildCareer must
    /// populate exactly this shape at <c>Values["career"]</c> — entirely
    /// OMITTED, no key at all, outside career mode):</b></para>
    /// <code>
    /// snapshot.Values["career"] = Dictionary&lt;string, object?&gt; {
    ///   "economy":    { "funds": double?, "reputation": double?, "science": double? }
    ///   "facilities": { "&lt;SpaceCenterFacility name&gt;": { "currentTier": int?, "maxTier": int?, "upgradeCost": double? }, ... }
    ///   "contracts":  { "active": [ ContractEntry, ... ], "offered": [ ContractEntry, ... ] }
    ///   "strategies": { "active": [ StrategyEntry, ... ], "all": [ StrategyEntry, ... ], "activeCount": int }
    ///   "tech":       { "unlockedCount": int, "unlockedIds": [ string, ... ], "nodes": [ TechNodeEntry, ... ] }
    /// }
    /// // ContractEntry = { "id", "title", "agent", "state", "fundsAdvance",
    /// //   "fundsCompletion", "fundsFailure", "scienceCompletion",
    /// //   "reputationCompletion", "reputationFailure", "dateAccepted",
    /// //   "dateDeadline", "dateExpire", "parameters": [ { "title", "state" }, ... ] }
    /// // StrategyEntry = { "id", "title", "description", "department",
    /// //   "isActive", "factor", "dateActivated", "requiredReputation",
    /// //   "initialCostFunds", "initialCostScience", "initialCostReputation",
    /// //   "hasFactorSlider", "factorSliderDefault", "factorSliderSteps",
    /// //   "canActivate", "activateBlockedReason", "canDeactivate",
    /// //   "deactivateBlockedReason", "effect" }
    /// // TechNodeEntry = { "id", "title", "scienceCost", "unlocked",
    /// //   "parents": [ string, ... ] }
    /// </code>
    /// Any field may be omitted/null when the live game genuinely doesn't
    /// have the value yet — mapped to <c>null</c> here, never a sentinel,
    /// same discipline as every other provider in this assembly.
    /// </summary>
    public static class CareerViewProvider
    {
        /// <summary>The typed stream topic this provider feeds.</summary>
        public const string Topic = "career.status";

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw <c>"career"</c> value to
        /// the <c>career.status</c> payload. Returns <c>null</c> — the
        /// SANDBOX / no-data-yet case — whenever the snapshot doesn't carry
        /// a <c>"career"</c> dictionary at all, distinguishing "not career
        /// mode" from "career mode with everything genuinely empty" (which
        /// still produces a non-null payload with empty groups).
        /// </summary>
        public static object? BuildCareer(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("career", out var raw) || raw is not IDictionary<string, object?> career)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["economy"] = BuildEconomy(career),
                ["facilities"] = BuildFacilities(career),
                ["contracts"] = BuildContracts(career),
                ["strategies"] = BuildStrategies(career),
                ["tech"] = BuildTech(career),
            };
        }

        private static Dictionary<string, object?>? BuildEconomy(IDictionary<string, object?> career)
        {
            if (!TryGetDict(career, "economy", out var raw))
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["funds"] = GetDouble(raw, "funds"),
                ["reputation"] = GetDouble(raw, "reputation"),
                ["science"] = GetDouble(raw, "science"),
            };
        }

        private static Dictionary<string, object?>? BuildFacilities(IDictionary<string, object?> career)
        {
            if (!TryGetDict(career, "facilities", out var raw))
            {
                return null;
            }

            var result = new Dictionary<string, object?>();
            foreach (var pair in raw)
            {
                if (pair.Value is not IDictionary<string, object?> facility)
                {
                    continue;
                }

                result[pair.Key] = new Dictionary<string, object?>
                {
                    ["currentTier"] = GetInt(facility, "currentTier"),
                    ["maxTier"] = GetInt(facility, "maxTier"),
                    ["upgradeCost"] = GetDouble(facility, "upgradeCost"),
                };
            }

            return result;
        }

        private static Dictionary<string, object?>? BuildContracts(IDictionary<string, object?> career)
        {
            if (!TryGetDict(career, "contracts", out var raw))
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["active"] = BuildContractList(raw, "active"),
                ["offered"] = BuildContractList(raw, "offered"),
            };
        }

        private static List<object?> BuildContractList(IDictionary<string, object?> raw, string key)
        {
            var result = new List<object?>();
            if (!raw.TryGetValue(key, out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return result;
            }

            foreach (var rawEntry in list)
            {
                if (rawEntry is not IDictionary<string, object?> entry)
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["id"] = GetString(entry, "id"),
                    ["title"] = GetString(entry, "title"),
                    ["agent"] = GetString(entry, "agent"),
                    ["state"] = GetString(entry, "state"),
                    ["fundsAdvance"] = GetDouble(entry, "fundsAdvance"),
                    ["fundsCompletion"] = GetDouble(entry, "fundsCompletion"),
                    ["fundsFailure"] = GetDouble(entry, "fundsFailure"),
                    ["scienceCompletion"] = GetDouble(entry, "scienceCompletion"),
                    ["reputationCompletion"] = GetDouble(entry, "reputationCompletion"),
                    ["reputationFailure"] = GetDouble(entry, "reputationFailure"),
                    ["dateAccepted"] = GetDouble(entry, "dateAccepted"),
                    ["dateDeadline"] = GetDouble(entry, "dateDeadline"),
                    ["dateExpire"] = GetDouble(entry, "dateExpire"),
                    ["parameters"] = BuildContractParameters(entry),
                });
            }

            return result;
        }

        private static List<object?> BuildContractParameters(IDictionary<string, object?> entry)
        {
            var result = new List<object?>();
            if (!entry.TryGetValue("parameters", out var rawParameters) || rawParameters is not IEnumerable<object?> parameters)
            {
                return result;
            }

            foreach (var rawParameter in parameters)
            {
                if (rawParameter is not IDictionary<string, object?> parameter)
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["title"] = GetString(parameter, "title"),
                    ["state"] = GetString(parameter, "state"),
                });
            }

            return result;
        }

        private static Dictionary<string, object?>? BuildStrategies(IDictionary<string, object?> career)
        {
            if (!TryGetDict(career, "strategies", out var raw))
            {
                return null;
            }

            var active = BuildStrategyList(raw, "active");
            var all = BuildStrategyList(raw, "all");

            return new Dictionary<string, object?>
            {
                ["active"] = active,
                ["all"] = all,
                ["activeCount"] = GetInt(raw, "activeCount") ?? active.Count,
            };
        }

        private static List<object?> BuildStrategyList(IDictionary<string, object?> raw, string key)
        {
            var result = new List<object?>();
            if (!raw.TryGetValue(key, out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return result;
            }

            foreach (var rawEntry in list)
            {
                if (rawEntry is not IDictionary<string, object?> entry)
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["id"] = GetString(entry, "id"),
                    ["title"] = GetString(entry, "title"),
                    ["description"] = GetString(entry, "description"),
                    ["department"] = GetString(entry, "department"),
                    ["isActive"] = GetBool(entry, "isActive"),
                    ["factor"] = GetDouble(entry, "factor"),
                    ["dateActivated"] = GetDouble(entry, "dateActivated"),
                    ["requiredReputation"] = GetDouble(entry, "requiredReputation"),
                    ["initialCostFunds"] = GetDouble(entry, "initialCostFunds"),
                    ["initialCostScience"] = GetDouble(entry, "initialCostScience"),
                    ["initialCostReputation"] = GetDouble(entry, "initialCostReputation"),
                    ["hasFactorSlider"] = GetBool(entry, "hasFactorSlider"),
                    ["factorSliderDefault"] = GetDouble(entry, "factorSliderDefault"),
                    ["factorSliderSteps"] = GetInt(entry, "factorSliderSteps"),
                    ["canActivate"] = GetBool(entry, "canActivate"),
                    ["activateBlockedReason"] = GetString(entry, "activateBlockedReason"),
                    ["canDeactivate"] = GetBool(entry, "canDeactivate"),
                    ["deactivateBlockedReason"] = GetString(entry, "deactivateBlockedReason"),
                    ["effect"] = GetString(entry, "effect"),
                });
            }

            return result;
        }

        private static Dictionary<string, object?>? BuildTech(IDictionary<string, object?> career)
        {
            if (!TryGetDict(career, "tech", out var raw))
            {
                return null;
            }

            var ids = new List<object?>();
            if (raw.TryGetValue("unlockedIds", out var rawIds) && rawIds is IEnumerable<object?> list)
            {
                foreach (var rawId in list)
                {
                    if (rawId is string s)
                    {
                        ids.Add(s);
                    }
                }
            }

            return new Dictionary<string, object?>
            {
                ["unlockedCount"] = GetInt(raw, "unlockedCount") ?? ids.Count,
                ["unlockedIds"] = ids,
                ["nodes"] = BuildTechNodes(raw),
            };
        }

        private static List<object?> BuildTechNodes(IDictionary<string, object?> raw)
        {
            var result = new List<object?>();
            if (!raw.TryGetValue("nodes", out var rawNodes) || rawNodes is not IEnumerable<object?> nodes)
            {
                return result;
            }

            foreach (var rawNode in nodes)
            {
                if (rawNode is not IDictionary<string, object?> node)
                {
                    continue;
                }

                var parents = new List<object?>();
                if (node.TryGetValue("parents", out var rawParents) && rawParents is IEnumerable<object?> parentList)
                {
                    foreach (var rawParent in parentList)
                    {
                        if (rawParent is string parentId)
                        {
                            parents.Add(parentId);
                        }
                    }
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["id"] = GetString(node, "id"),
                    ["title"] = GetString(node, "title"),
                    ["scienceCost"] = GetDouble(node, "scienceCost"),
                    ["unlocked"] = GetBool(node, "unlocked"),
                    ["parents"] = parents,
                });
            }

            return result;
        }

        private static bool TryGetDict(IDictionary<string, object?> raw, string key, out IDictionary<string, object?> result)
        {
            if (raw.TryGetValue(key, out var v) && v is IDictionary<string, object?> dict)
            {
                result = dict;
                return true;
            }

            result = new Dictionary<string, object?>();
            return false;
        }

        // Scalar readers live in the shared SnapshotDict — see that class's
        // doc comment for the R1/F-1 non-finite-is-absent rule GetDouble
        // applies.
        private static string? GetString(IDictionary<string, object?> raw, string key) => SnapshotDict.GetString(raw, key);
        private static int? GetInt(IDictionary<string, object?> raw, string key) => SnapshotDict.GetInt(raw, key);
        private static double? GetDouble(IDictionary<string, object?> raw, string key) => SnapshotDict.GetDouble(raw, key);
        private static bool? GetBool(IDictionary<string, object?> raw, string key) => SnapshotDict.GetBool(raw, key);
    }
}
