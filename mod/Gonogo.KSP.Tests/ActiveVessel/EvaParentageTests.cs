using System;
using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.ActiveVessel
{
    /// <summary>
    /// The rule behind <c>ActiveVesselScope.Current</c>, exercised without KSP.
    /// The live half is one <c>FlightGlobals</c> read and two GameEvents hooks;
    /// everything that can be got wrong is here.
    /// </summary>
    public class EvaParentageTests
    {
        private static readonly Guid Ship = new Guid("11111111-1111-1111-1111-111111111111");
        private static readonly Guid Kerbal = new Guid("22222222-2222-2222-2222-222222222222");
        private static readonly Guid OtherShip = new Guid("33333333-3333-3333-3333-333333333333");

        /// <summary>Everything named here is still in the world.</summary>
        private static Func<Guid, bool> Flying(params Guid[] alive)
        {
            var set = new HashSet<Guid>(alive);
            return id => set.Contains(id);
        }

        [Fact]
        public void ReportsTheKspActiveVesselWhenItIsNotAKerbal()
        {
            var book = new EvaParentage();

            Assert.Equal(Ship, book.Reported(Ship, kspActiveIsEva: false, Flying(Ship)));
        }

        [Fact]
        public void ReportsNothingWhenKspHasNoActiveVessel()
        {
            var book = new EvaParentage();

            Assert.Null(book.Reported(null, kspActiveIsEva: false, Flying()));
        }

        /// <summary>
        /// The whole point: a kerbal steps out, KSP switches the active vessel to
        /// them, and gonogo goes on reporting the craft they left.
        /// </summary>
        [Fact]
        public void KeepsReportingTheCraftAKerbalSteppedOutOf()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            Assert.Equal(Ship, book.Reported(Kerbal, kspActiveIsEva: true, Flying(Ship, Kerbal)));
        }

        /// <summary>
        /// A kerbal we never saw leave (the seam was installed mid-EVA, or KSP's
        /// own debug spawn, which fires the egress event with a null source part).
        /// </summary>
        [Fact]
        public void ReportsTheKerbalWhenNoEgressWasRecorded()
        {
            var book = new EvaParentage();

            Assert.Equal(Kerbal, book.Reported(Kerbal, kspActiveIsEva: true, Flying(Kerbal)));
        }

        [Fact]
        public void ReportsTheKerbalOnceTheCraftIsGone()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            Assert.Equal(Kerbal, book.Reported(Kerbal, kspActiveIsEva: true, Flying(Kerbal)));
        }

        /// <summary>
        /// A craft that is gone is gone: the relation is dropped rather than
        /// re-checked every sample, so a later vessel reusing nothing of it can
        /// never be resurrected by a stale row.
        /// </summary>
        [Fact]
        public void ForgetsTheRelationWhenTheCraftIsGone()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            book.Reported(Kerbal, kspActiveIsEva: true, Flying(Kerbal));

            Assert.False(book.TryParentOf(Kerbal, out _));
        }

        /// <summary>
        /// Boarding ends the substitution whatever was boarded, so whatever KSP makes
        /// active next is reported as-is. A kerbal walking into a craft that is not
        /// the one they left is a routine vessel switch and looks like one.
        /// </summary>
        [Fact]
        public void BoardingEndsTheSubstitutionWhateverWasBoarded()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            book.Forget(Kerbal);

            Assert.Equal(OtherShip, book.Reported(OtherShip, kspActiveIsEva: false, Flying(Ship, OtherShip)));
            Assert.False(book.TryParentOf(Kerbal, out _));
        }

        /// <summary>A second egress from a different craft replaces the first.</summary>
        [Fact]
        public void ASecondEgressReplacesTheRecordedCraft()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);
            book.RecordEgress(Kerbal, OtherShip);

            Assert.Equal(OtherShip, book.Reported(Kerbal, kspActiveIsEva: true, Flying(Ship, OtherShip, Kerbal)));
        }

        /// <summary>A craft cannot be its own parent; that row would loop the lookup.</summary>
        [Fact]
        public void RefusesToRecordAKerbalAsItsOwnParent()
        {
            var book = new EvaParentage();

            book.RecordEgress(Kerbal, Kerbal);

            Assert.False(book.TryParentOf(Kerbal, out _));
        }

        [Fact]
        public void RefusesToRecordAnEmptyId()
        {
            var book = new EvaParentage();

            book.RecordEgress(Guid.Empty, Ship);
            book.RecordEgress(Kerbal, Guid.Empty);

            Assert.Empty(book.Entries);
        }

        [Fact]
        public void ClearDropsEveryRelation()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            book.Clear();

            Assert.Empty(book.Entries);
        }

        [Fact]
        public void EntriesRoundTripThroughRecordEgress()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);

            var restored = new EvaParentage();
            foreach (var entry in book.Entries)
            {
                restored.RecordEgress(entry.Key, entry.Value);
            }

            Assert.Equal(Ship, restored.Reported(Kerbal, kspActiveIsEva: true, Flying(Ship, Kerbal)));
        }

        /// <summary>
        /// The liveness probe is a live-scene walk, so it is asked once per sample
        /// and only when it can change the answer.
        /// </summary>
        [Fact]
        public void DoesNotProbeLivenessWhenTheActiveVesselIsNotAKerbal()
        {
            var book = new EvaParentage();
            book.RecordEgress(Kerbal, Ship);
            var asked = new List<Guid>();

            book.Reported(Ship, kspActiveIsEva: false, id => { asked.Add(id); return true; });

            Assert.Empty(asked);
        }
    }
}
