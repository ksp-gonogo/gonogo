using System;
using System.Collections.Generic;
using System.Text;

namespace Sitrep.Host.Recovery
{
    /// <summary>
    /// What else a recovery paid: the progress milestones and contract rewards the game awards
    /// while it processes a recovery, which its own summary dialog does not include. The plain,
    /// KSP-free counterpart to <c>Sitrep.Contract.RecoveryAward</c>.
    /// </summary>
    public sealed class RecoveryAwardItem
    {
        public string Title = "";
        public double? Funds;
        public double? Reputation;
        public double? Science;
    }

    /// <summary>
    /// Collects the awards paid between a recovery being requested and its summary being built.
    /// The game announces a currency change as the new total and a reason, so the amount is
    /// derived against the last total seen; only the reasons that are awards are recorded, each
    /// under the milestone most recently reached, so a payment is never invented from a balance
    /// that merely moved.
    /// </summary>
    public sealed class RecoveryAwardLedger
    {
        /// <summary>The title used for a progress award reached with no milestone named.</summary>
        public const string UnnamedProgress = "Progress";

        /// <summary>The title used for a contract reward.</summary>
        public const string ContractReward = "Contract reward";

        private readonly List<RecoveryAwardItem> _awards = new List<RecoveryAwardItem>();
        private double? _funds;
        private double? _reputation;
        private double? _science;
        private string? _milestone;

        public bool IsOpen { get; private set; }

        /// <summary>Starts a window at the balances now, forgetting anything collected before.</summary>
        public void Open(double? funds, double? reputation, double? science)
        {
            _awards.Clear();
            _funds = funds;
            _reputation = reputation;
            _science = science;
            _milestone = null;
            IsOpen = true;
        }

        /// <summary>The progress milestone just reached, by the game's id; awards that follow are named for it.</summary>
        public void Milestone(string? id)
        {
            if (IsOpen && !string.IsNullOrEmpty(id))
            {
                _milestone = Humanise(id!);
            }
        }

        public void Funds(double newTotal, bool isProgress, bool isContract) =>
            Observe(ref _funds, newTotal, isProgress, isContract, (a, d) => a.Funds = (a.Funds ?? 0) + d);

        public void Reputation(double newTotal, bool isProgress, bool isContract) =>
            Observe(ref _reputation, newTotal, isProgress, isContract, (a, d) => a.Reputation = (a.Reputation ?? 0) + d);

        public void Science(double newTotal, bool isProgress, bool isContract) =>
            Observe(ref _science, newTotal, isProgress, isContract, (a, d) => a.Science = (a.Science ?? 0) + d);

        /// <summary>Ends the window and returns what it paid, in the order each award first appeared.</summary>
        public List<RecoveryAwardItem> Close()
        {
            IsOpen = false;
            var result = new List<RecoveryAwardItem>(_awards);
            _awards.Clear();
            return result;
        }

        private void Observe(
            ref double? last, double newTotal, bool isProgress, bool isContract, Action<RecoveryAwardItem, double> add)
        {
            if (!IsOpen || double.IsNaN(newTotal) || double.IsInfinity(newTotal))
            {
                return;
            }

            var delta = last == null ? 0.0 : newTotal - last.Value;
            last = newTotal;
            if (delta <= 0.0 || (!isProgress && !isContract))
            {
                return;
            }

            var title = isContract ? ContractReward : (_milestone ?? UnnamedProgress);
            var award = _awards.Find(a => a.Title == title);
            if (award == null)
            {
                award = new RecoveryAwardItem { Title = title };
                _awards.Add(award);
            }

            add(award, delta);
        }

        /// <summary>A game id as words: <c>RecoveryFromSuborbit</c> reads <c>Recovery from suborbit</c>.</summary>
        public static string Humanise(string id)
        {
            var words = new StringBuilder();
            for (var i = 0; i < id.Length; i++)
            {
                var c = id[i];
                if (i > 0 && char.IsUpper(c) && !char.IsUpper(id[i - 1]))
                {
                    words.Append(' ');
                    words.Append(char.ToLowerInvariant(c));
                }
                else
                {
                    words.Append(i == 0 ? char.ToUpperInvariant(c) : c);
                }
            }

            return words.ToString();
        }
    }
}
