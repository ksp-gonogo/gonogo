using Gonogo.KSP.CurrencyDelay;
using Gonogo.KSP.Tests.Comms;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// One save's pending-credit books: what they write into the save, what they
    /// read back, and what the per-frame tick does with a row whose time has come.
    /// The books are never started here: starting subscribes to <c>GameEvents</c>,
    /// whose static initialiser throws outside the engine.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class CurrencyDelayBooksTests
    {
        private static SignalDelayConfig DelayOn() => new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static PendingCreditRow Penalty(double revealUt) =>
            new PendingCreditRow(DelayedCurrency.Reputation, -10.0, revealUt, "craft-1", "crew lost");

        [Fact]
        public void APendingPenaltyIsWrittenIntoTheSaveAndReadBackIntoTheNextSavesBooks()
        {
            using var ksp = new UnityStandIns(100.0, DelayOn());
            var saving = new CurrencyDelayBooks();
            saving.Ledger.Enqueue(Penalty(revealUt: 21_700.0));
            var save = new ConfigNode("SCENARIO");
            saving.Save(save);

            var loading = new CurrencyDelayBooks();
            loading.Load(save);

            var row = Assert.Single(loading.Ledger.Pending);
            Assert.Equal(21_700.0, row.RevealUt);
            Assert.Equal(-10.0, row.BaseAmount);
            Assert.Equal("craft-1", row.OriginVesselId);
        }

        [Fact]
        public void ASaveWrittenBeforeAnyPenaltyLoadsAnEmptyLedger()
        {
            using var ksp = new UnityStandIns(100.0, DelayOn());
            var books = new CurrencyDelayBooks();

            books.Load(new ConfigNode("SCENARIO"));

            Assert.Empty(books.Ledger.Pending);
        }

        [Fact]
        public void APenaltyStaysPendingUntilItsRevealTime()
        {
            using var ksp = new UnityStandIns(100.0, DelayOn());
            var books = new CurrencyDelayBooks();
            books.Ledger.Enqueue(Penalty(revealUt: 200.0));

            ksp.Ut = 199.0;
            books.Tick();

            Assert.Single(books.Ledger.Pending);
        }

        /// <summary>
        /// A row is taken off the ledger before it is paid, so with no career to
        /// pay it into, as here, it is gone and nothing was paid.
        /// </summary>
        [Fact]
        public void APenaltyWhoseTimeHasComeLeavesTheLedgerEvenWithNoCareerToPayItInto()
        {
            using var ksp = new UnityStandIns(100.0, DelayOn());
            var books = new CurrencyDelayBooks();
            books.Ledger.Enqueue(Penalty(revealUt: 200.0));

            ksp.Ut = 200.0;
            books.Tick();

            Assert.Empty(books.Ledger.Pending);
        }
    }
}
