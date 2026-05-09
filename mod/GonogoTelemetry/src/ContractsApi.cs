using System;
using System.Collections.Generic;
using Contracts;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Surfaces the contract system so a station can render a Mission
    /// Director view: active objectives, offers waiting in Mission
    /// Control, and the recent completion feed.
    ///
    /// Keys (all global — `Vessel` argument ignored, same convention as
    /// `ScienceCareerDataLinkHandler`):
    ///
    /// - `contracts.active` — array of `[{ id, title, agency, state,
    ///   fundsAdvance, fundsCompletion, fundsFailure,
    ///   scienceCompletion, repCompletion, deadlineUt, parameters: [{
    ///   title, state, optional }] }]`. One entry per `Contract` whose
    ///   `ContractState == Active`.
    /// - `contracts.offered` — same shape, contracts in `Offered`
    ///   state (i.e. waiting in Mission Control).
    /// - `contracts.completedRecent` — same shape, the last
    ///   `RECENT_LIMIT` contracts whose state is `Completed` or
    ///   `Failed`. Sorted newest-first by date-finished where the
    ///   field is present; otherwise insertion-order.
    ///
    /// Wire shape mirrors `Contract` directly — no client-side
    /// derivation in the plugin (e.g. don't compute "time until
    /// deadline" server-side; the widget combines `deadlineUt` with
    /// `t.universalTime` itself, same way `ScienceCareerDataLinkHandler`
    /// surfaces `subjectID` raw).
    /// </summary>
    public class ContractsApi : IMinimalTelemachusPlugin
    {
        // Cap completedRecent so a long career save doesn't push a
        // multi-MB blob through the WS every poll.
        private const int RECENT_LIMIT = 20;

        public string[] Commands => new[]
        {
            "contracts.active",
            "contracts.offered",
            "contracts.completedRecent",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "contracts.active":
                    return (_, __) => ContractsByState(Contract.State.Active);
                case "contracts.offered":
                    return (_, __) => ContractsByState(Contract.State.Offered);
                case "contracts.completedRecent":
                    return (_, __) => CompletedRecent();
                default:
                    return null;
            }
        }

        private static object ContractsByState(Contract.State state)
        {
            var result = new List<Dictionary<string, object>>();
            var system = ContractSystem.Instance;
            if (system == null || system.Contracts == null) return result;

            foreach (var c in system.Contracts)
            {
                if (c == null || c.ContractState != state) continue;
                result.Add(SerialiseContract(c));
            }
            return result;
        }

        private static object CompletedRecent()
        {
            var result = new List<Dictionary<string, object>>();
            var system = ContractSystem.Instance;
            if (system == null) return result;

            // ContractSystem stores finished contracts in `ContractsFinished`
            // (most KSP versions). Fall back to filtering Contracts when
            // that's not available — defensive against API drift.
            var finished = system.ContractsFinished;
            if (finished == null && system.Contracts != null)
            {
                finished = new List<Contract>();
                foreach (var c in system.Contracts)
                {
                    if (c == null) continue;
                    if (c.ContractState == Contract.State.Completed ||
                        c.ContractState == Contract.State.Failed)
                        finished.Add(c);
                }
            }
            if (finished == null) return result;

            // DateFinished is most-recent-last in stock KSP; reverse for
            // newest-first.
            var ordered = new List<Contract>(finished);
            ordered.Sort((a, b) =>
            {
                var ad = a != null ? a.DateFinished : 0;
                var bd = b != null ? b.DateFinished : 0;
                return bd.CompareTo(ad);
            });

            for (var i = 0; i < ordered.Count && result.Count < RECENT_LIMIT; i++)
            {
                if (ordered[i] == null) continue;
                result.Add(SerialiseContract(ordered[i]));
            }
            return result;
        }

        private static Dictionary<string, object> SerialiseContract(Contract c)
        {
            var entry = new Dictionary<string, object>
            {
                ["id"] = c.ContractID,
                ["title"] = c.Title ?? string.Empty,
                ["agency"] = c.Agent != null ? c.Agent.Name : string.Empty,
                ["state"] = c.ContractState.ToString(),
                ["fundsAdvance"] = c.FundsAdvance,
                ["fundsCompletion"] = c.FundsCompletion,
                ["fundsFailure"] = c.FundsFailure,
                ["scienceCompletion"] = c.ScienceCompletion,
                ["repCompletion"] = c.ReputationCompletion,
                ["deadlineUt"] = c.DateExpire,
                ["parameters"] = SerialiseParameters(c),
            };
            return entry;
        }

        private static object SerialiseParameters(Contract c)
        {
            var result = new List<Dictionary<string, object>>();
            var parameters = c.AllParameters;
            if (parameters == null) return result;
            foreach (var p in parameters)
            {
                if (p == null) continue;
                result.Add(new Dictionary<string, object>
                {
                    ["title"] = p.Title ?? string.Empty,
                    ["state"] = p.State.ToString(),
                    ["optional"] = p.Optional,
                });
            }
            return result;
        }
    }
}
