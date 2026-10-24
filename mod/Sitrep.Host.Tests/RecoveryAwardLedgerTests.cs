using System.Collections.Generic;
using Sitrep.Host.Recovery;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A recovery pays more than its summary dialog reports: the game's progress milestones and
    /// contract rewards land while it is processed. The ledger names each, and never makes one up
    /// from a balance that merely moved.
    /// </summary>
    public class RecoveryAwardLedgerTests
    {
        [Fact]
        public void A_progress_award_is_named_for_the_milestone_reached_and_carries_each_currency_it_paid()
        {
            var ledger = new RecoveryAwardLedger();
            ledger.Open(funds: 210548, reputation: 41, science: 81);

            ledger.Milestone("RecoveryFromSuborbit");
            ledger.Funds(215348, isProgress: true, isContract: false);
            ledger.Reputation(42, isProgress: true, isContract: false);

            var awards = ledger.Close();

            var award = Assert.Single(awards);
            Assert.Equal("Recovery from suborbit", award.Title);
            Assert.Equal(4800, award.Funds);
            Assert.Equal(1, award.Reputation);
            Assert.Null(award.Science);
        }

        [Fact]
        public void A_balance_that_moved_for_another_reason_is_not_an_award()
        {
            var ledger = new RecoveryAwardLedger();
            ledger.Open(1000, 0, 0);

            ledger.Funds(4960, isProgress: false, isContract: false);
            ledger.Funds(4000, isProgress: false, isContract: false);

            Assert.Empty(ledger.Close());
        }

        [Fact]
        public void A_contract_reward_is_listed_as_one()
        {
            var ledger = new RecoveryAwardLedger();
            ledger.Open(1000, 0, 0);

            ledger.Funds(21800, isProgress: false, isContract: true);

            var award = Assert.Single(ledger.Close());
            Assert.Equal(RecoveryAwardLedger.ContractReward, award.Title);
            Assert.Equal(20800, award.Funds);
        }

        [Fact]
        public void Awards_before_the_window_opens_or_after_it_closes_are_ignored()
        {
            var ledger = new RecoveryAwardLedger();
            ledger.Funds(500, isProgress: true, isContract: false);
            ledger.Open(500, 0, 0);
            ledger.Close();
            ledger.Funds(900, isProgress: true, isContract: false);

            ledger.Open(900, 0, 0);

            Assert.Empty(ledger.Close());
        }

        [Fact]
        public void Opening_again_forgets_what_an_earlier_unfinished_recovery_collected()
        {
            var ledger = new RecoveryAwardLedger();
            ledger.Open(100, 0, 0);
            ledger.Funds(300, isProgress: true, isContract: false);

            ledger.Open(300, 0, 0);

            Assert.Empty(ledger.Close());
        }

        [Fact]
        public void The_wire_carries_each_award_by_title_and_leaves_an_unpaid_currency_null()
        {
            var capture = new RecoveryCapture
            {
                Awards = new List<RecoveryAwardItem> { new RecoveryAwardItem { Title = "Recovery", Funds = 4800 } },
            };

            var wire = (List<object?>)RecoveryPayload.Build(capture)["awards"]!;

            var entry = (Dictionary<string, object?>)wire[0]!;
            Assert.Equal("Recovery", entry["title"]);
            Assert.Equal(4800.0, entry["fundsEarned"]);
            Assert.Null(entry["reputationEarned"]);
        }
    }
}
