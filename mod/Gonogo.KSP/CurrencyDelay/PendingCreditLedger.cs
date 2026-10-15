using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Holds pending delayed-currency credits and matures them by UT.
    ///
    /// Pure logic: no GameEvents, no Harmony, no live KSP calls. The only KSP
    /// type touched is <see cref="ConfigNode"/> for save/load, which is a
    /// plain data structure with no scene/runtime dependency. Each save's
    /// ledger is round-tripped through <c>CurrencyDelayScenario</c>'s
    /// <c>OnSave</c>/<c>OnLoad</c>, as the stock Funding/RnD/Reputation
    /// scenario modules do their balances.
    ///
    /// <see cref="PendingCreditRow"/> and <see cref="DelayedCurrency"/> live
    /// in their own file (PendingCreditRow.cs) precisely so they - and
    /// anything built on them - stay free of this file's ConfigNode
    /// dependency.
    /// </summary>
    public sealed class PendingCreditLedger
    {
        private const string RowNodeName = "ROW";

        private const string LandedOnLostNodeName = "LANDED_ON_LOST";

        private readonly List<PendingCreditRow> _rows = new List<PendingCreditRow>();
        private readonly List<LandedOnLost> _landedOnLost = new List<LandedOnLost>();

        /// <summary>Every held change that landed on a Lost declaration, in the order it landed.</summary>
        public IReadOnlyList<LandedOnLost> LandedOnLost => _landedOnLost;

        /// <summary>Read-only view of every row still waiting to mature.</summary>
        public IReadOnlyList<PendingCreditRow> Pending => _rows;

        /// <summary>
        /// Brings every row not yet due forward: what is left until each row's
        /// reveal is multiplied by <paramref name="remainingFactor"/>, so 0 makes
        /// every row due now and 0.5 halves what is left. Rows keep the order
        /// they were taken in. A factor of 1 or more changes nothing.
        ///
        /// <para>A held row waits for home to hear of its craft, not for a span,
        /// so only 0, signal delay switched off, makes it due.</para>
        /// </summary>
        public void BringForward(double nowUt, double remainingFactor)
        {
            if (double.IsNaN(remainingFactor) || remainingFactor >= 1.0)
            {
                return;
            }

            var factor = Math.Max(0.0, remainingFactor);
            for (var i = 0; i < _rows.Count; i++)
            {
                var row = _rows[i];
                if (row.HeldSinceUt != null)
                {
                    if (factor == 0.0)
                    {
                        _rows[i] = row.DueAt(nowUt);
                    }
                    continue;
                }
                if (row.RevealUt > nowUt)
                {
                    _rows[i] = new PendingCreditRow(
                        row.Currency,
                        row.BaseAmount,
                        nowUt + ((row.RevealUt - nowUt) * factor),
                        row.OriginVesselId,
                        row.OriginDescription);
                }
            }
        }

        /// <summary>
        /// Makes each held row <paramref name="landing"/> lands due at
        /// <paramref name="nowUt"/>, in place, so it is revealed in the order it
        /// was taken in. A row that lands on a Lost declaration, a non-zero
        /// declaration number, is also recorded in <see cref="LandedOnLost"/>.
        /// </summary>
        public void ReleaseHeld(double nowUt, Func<PendingCreditRow, (bool Lands, int LostSeq)> landing)
        {
            for (var i = 0; i < _rows.Count; i++)
            {
                var row = _rows[i];
                if (row.HeldSinceUt == null)
                {
                    continue;
                }
                var (lands, lostSeq) = landing(row);
                if (!lands)
                {
                    continue;
                }
                _rows[i] = row.DueAt(nowUt);
                if (lostSeq != 0)
                {
                    _landedOnLost.Add(new LandedOnLost(row.Currency, row.BaseAmount, row.OriginVesselId, lostSeq, nowUt));
                }
            }
        }

        public void RecordLandedOnLost(LandedOnLost landed) => _landedOnLost.Add(landed ?? throw new ArgumentNullException(nameof(landed)));

        public void Enqueue(PendingCreditRow row)
        {
            if (row == null) throw new ArgumentNullException(nameof(row));
            _rows.Add(row);
        }

        /// <summary>
        /// Removes and returns every row whose RevealUt has passed, in the
        /// order they were enqueued. Time-warp can jump UT past several
        /// reveals in a single check, so this always matures all eligible
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
                if (row.HeldSinceUt is double heldSinceUt)
                {
                    rowNode.AddValue("heldSinceUt", heldSinceUt);
                }
                else
                {
                    rowNode.AddValue("revealUt", row.RevealUt);
                }
                rowNode.AddValue("originVesselId", row.OriginVesselId);
                rowNode.AddValue("originDescription", row.OriginDescription);
            }
            foreach (var landed in _landedOnLost)
            {
                var landedNode = root.AddNode(LandedOnLostNodeName);
                landedNode.AddValue("currency", landed.Currency.ToString());
                landedNode.AddValue("baseAmount", landed.BaseAmount);
                landedNode.AddValue("originVesselId", landed.OriginVesselId);
                landedNode.AddValue("lostSeq", landed.LostSeq);
                landedNode.AddValue("landedUt", landed.LandedUt);
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
                double heldSinceUt = 0;
                var held = rowNode.TryGetValue("heldSinceUt", ref heldSinceUt);

                ledger.Enqueue(held
                    ? PendingCreditRow.Held(currency, baseAmount, heldSinceUt, originVesselId, originDescription)
                    : new PendingCreditRow(currency, baseAmount, revealUt, originVesselId, originDescription));
            }

            foreach (var landedNode in node.GetNodes(LandedOnLostNodeName))
            {
                var currencyText = landedNode.GetValue("currency");
                if (currencyText == null || !Enum.TryParse(currencyText, out DelayedCurrency currency))
                {
                    continue;
                }
                double baseAmount = 0;
                var lostSeq = 0;
                double landedUt = 0;
                landedNode.TryGetValue("baseAmount", ref baseAmount);
                landedNode.TryGetValue("lostSeq", ref lostSeq);
                landedNode.TryGetValue("landedUt", ref landedUt);
                ledger.RecordLandedOnLost(new LandedOnLost(currency, baseAmount, landedNode.GetValue("originVesselId") ?? "", lostSeq, landedUt));
            }

            return ledger;
        }
    }
}
