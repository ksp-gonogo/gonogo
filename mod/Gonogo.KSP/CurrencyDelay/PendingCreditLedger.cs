using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Holds pending delayed-currency credits and matures them by UT.
    ///
    /// Pure logic: no GameEvents, no Harmony, no live KSP calls. The only KSP
    /// type touched is <see cref="ConfigNode"/> for save/load, which is a
    /// plain data structure with no scene/runtime dependency. A future
    /// <c>CurrencyDelayScenario : ScenarioModule</c> owns an instance of this
    /// ledger and round-trips it through <c>OnSave</c>/<c>OnLoad</c> exactly
    /// like the stock Funding/RnD/Reputation scenario modules.
    ///
    /// <see cref="PendingCreditRow"/> and <see cref="DelayedCurrency"/> live
    /// in their own file (PendingCreditRow.cs) precisely so they - and
    /// anything built on them - stay free of this file's ConfigNode
    /// dependency.
    /// </summary>
    public sealed class PendingCreditLedger
    {
        private const string RowNodeName = "ROW";

        private readonly List<PendingCreditRow> _rows = new List<PendingCreditRow>();

        /// <summary>Read-only view of every row still waiting to mature.</summary>
        public IReadOnlyList<PendingCreditRow> Pending => _rows;

        public void Enqueue(PendingCreditRow row)
        {
            if (row == null) throw new ArgumentNullException(nameof(row));
            _rows.Add(row);
        }

        /// <summary>
        /// Removes and returns every row whose RevealUt has passed, in the
        /// order they were enqueued. Time-warp can jump UT past several
        /// reveals in a single check, so this always matures ALL eligible
        /// rows in one call rather than just the earliest one.
        /// </summary>
        public List<PendingCreditRow> PopMatured(double nowUt)
        {
            var matured = new List<PendingCreditRow>();
            var remaining = new List<PendingCreditRow>(_rows.Count);

            foreach (var row in _rows)
            {
                if (row.RevealUt <= nowUt)
                {
                    matured.Add(row);
                }
                else
                {
                    remaining.Add(row);
                }
            }

            _rows.Clear();
            _rows.AddRange(remaining);

            return matured;
        }

        public ConfigNode ToConfigNode()
        {
            var root = new ConfigNode("PENDING_CREDIT_LEDGER");
            foreach (var row in _rows)
            {
                var rowNode = root.AddNode(RowNodeName);
                rowNode.AddValue("currency", row.Currency.ToString());
                rowNode.AddValue("baseAmount", row.BaseAmount);
                rowNode.AddValue("revealUt", row.RevealUt);
                rowNode.AddValue("originVesselId", row.OriginVesselId);
                rowNode.AddValue("originDescription", row.OriginDescription);
            }
            return root;
        }

        public static PendingCreditLedger FromConfigNode(ConfigNode node)
        {
            var ledger = new PendingCreditLedger();
            if (node == null) return ledger;

            foreach (var rowNode in node.GetNodes(RowNodeName))
            {
                var currencyText = rowNode.GetValue("currency");
                if (currencyText == null || !Enum.TryParse(currencyText, out DelayedCurrency currency))
                {
                    continue;
                }

                double baseAmount = 0;
                double revealUt = 0;
                rowNode.TryGetValue("baseAmount", ref baseAmount);
                rowNode.TryGetValue("revealUt", ref revealUt);
                var originVesselId = rowNode.GetValue("originVesselId") ?? "";
                var originDescription = rowNode.GetValue("originDescription") ?? "";

                ledger.Enqueue(new PendingCreditRow(currency, baseAmount, revealUt, originVesselId, originDescription));
            }

            return ledger;
        }
    }
}
