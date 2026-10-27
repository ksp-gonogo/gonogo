using System;
using System.Collections.Generic;
using Gonogo.KSP.ObjectiveDelay;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.ObjectiveDelay
{
    public class ObjectiveDelayBookTests
    {
        private static readonly Guid Contract = new Guid("11111111-2222-3333-4444-555555555555");
        private const string Probe = "probe";
        private const string Station = "station";

        private static ObjectiveChange Change(
            double craftUt,
            ObjectiveState target = ObjectiveState.Met,
            string path = "0",
            Guid? contract = null,
            params string[] sources) =>
            new ObjectiveChange
            {
                ContractId = contract ?? Contract,
                OwnerId = ObjectiveDelayCapability.StockOwner,
                ObjectivePath = path,
                Target = target,
                SourceVesselIds = sources.Length == 0 ? new[] { Probe } : sources,
                CraftUt = craftUt,
                Description = "orbit",
            };

        private static Func<string, double?> Routed(double seconds) => _ => seconds;

        private static readonly Func<string, double?> NoRoute = _ => null;

        private static Func<string, HomeCraftView?> NoWord => _ => null;

        private static ContractView ActiveContract(ObjectiveState? objective = ObjectiveState.Unmet, double? deadline = null) =>
            new ContractView(readable: true, found: true, active: true, deadlineUt: deadline, objectiveFound: true, objectiveState: objective);

        private static Func<ObjectiveChange, ContractView> Always(ContractView view) => _ => view;

        [Fact]
        public void AChangeFromARoutedCraftAppliesAfterItsDelay()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;

            Assert.Equal(ObjectiveOffer.Held, book.Offer(Change(100), () => applied++, true, Routed(30)));

            book.Release(129, NoWord, Always(ActiveContract()));
            Assert.Equal(0, applied);
            Assert.True(book.HasHeldAtOrBefore(Contract, 100));

            book.Release(130, NoWord, Always(ActiveContract()));
            Assert.Equal(1, applied);
            Assert.Empty(book.Held);
            Assert.Equal(ObjectiveSettlement.Applied, Assert.Single(book.Settled).Outcome);
        }

        [Fact]
        public void WithDelaySwitchedOffAChangeAppliesNow()
        {
            var book = new ObjectiveDelayBook();
            Assert.Equal(ObjectiveOffer.ApplyNow, book.Offer(Change(100), () => { }, false, Routed(30)));
            Assert.Empty(book.Held);
        }

        [Fact]
        public void AChangeWithNoSourceCraftAppliesNow()
        {
            var book = new ObjectiveDelayBook();
            var homeChange = Change(100);
            homeChange.SourceVesselIds = Array.Empty<string>();
            Assert.Equal(ObjectiveOffer.ApplyNow, book.Offer(homeChange, () => { }, true, Routed(30)));
        }

        /// <summary>Per-frame objectives ask again every frame; only a change of target goes on the line.</summary>
        [Fact]
        public void ARepeatOfTheTargetAlreadyOnTheLineIsAbsorbed()
        {
            var book = new ObjectiveDelayBook();
            book.Offer(Change(100), () => { }, true, Routed(30));

            Assert.Equal(ObjectiveOffer.Absorbed, book.Offer(Change(100.02), () => { }, true, Routed(30)));
            Assert.Equal(ObjectiveOffer.Held, book.Offer(Change(101, ObjectiveState.Unmet), () => { }, true, Routed(30)));
            Assert.Equal(ObjectiveOffer.Held, book.Offer(Change(102, ObjectiveState.Met), () => { }, true, Routed(30)));
            Assert.Equal(3, book.Held.Count);
        }

        [Fact]
        public void ChangesApplyInTheOrderTheCraftMadeThem()
        {
            var book = new ObjectiveDelayBook();
            var order = new List<string>();
            var state = ObjectiveState.Unmet;
            book.Offer(Change(100, ObjectiveState.Met), () => { order.Add("met"); state = ObjectiveState.Met; }, true, Routed(30));
            book.Offer(Change(110, ObjectiveState.Unmet), () => { order.Add("unmet"); state = ObjectiveState.Unmet; }, true, Routed(30));

            book.Release(1000, NoWord, _ => ActiveContract(state));

            Assert.Equal(new[] { "met", "unmet" }, order);
        }

        /// <summary>A shorter delay later must not let a later change from the same craft overtake an earlier one.</summary>
        [Fact]
        public void ALaterChangeNeverOvertakesAnEarlierOneFromTheSameCraft()
        {
            var book = new ObjectiveDelayBook();
            var order = new List<string>();
            book.Offer(Change(100, path: "0"), () => order.Add("first"), true, Routed(500));
            book.Offer(Change(110, path: "1"), () => order.Add("second"), true, Routed(5));

            book.Release(200, NoWord, Always(ActiveContract()));
            Assert.Empty(order);

            book.Release(600, NoWord, Always(ActiveContract()));
            Assert.Equal(new[] { "first", "second" }, order);
        }

        [Fact]
        public void ChangesFromDifferentCraftForDifferentObjectivesDoNotWaitForEachOther()
        {
            var book = new ObjectiveDelayBook();
            var order = new List<string>();
            book.Offer(Change(100, path: "0", sources: Probe), () => order.Add("far"), true, Routed(500));
            book.Offer(Change(110, path: "1", sources: Station), () => order.Add("near"), true, Routed(5));

            book.Release(200, NoWord, Always(ActiveContract()));
            Assert.Equal(new[] { "near" }, order);
        }

        [Fact]
        public void ATwoCraftChangeArrivesWithTheLaterOfTheTwo()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100, sources: new[] { Probe, Station }), () => applied++, true, id => id == Probe ? 50 : 10);

            book.Release(120, NoWord, Always(ActiveContract()));
            Assert.Equal(0, applied);
            book.Release(150, NoWord, Always(ActiveContract()));
            Assert.Equal(1, applied);
        }

        [Fact]
        public void AChangeFromACraftWithNoRouteIsHeldUntilHomeHearsFromIt()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, NoRoute);

            book.Release(5000, NoWord, Always(ActiveContract()));
            book.Release(5000, _ => new HomeCraftView(CentreContactState.Silent, 90, HomeVerdictState.Silent, 0), Always(ActiveContract()));
            Assert.Equal(0, applied);
            Assert.True(book.HasHeldAtOrBefore(Contract, 100));

            // Contact from before the change is not word of it.
            book.Release(5000, _ => new HomeCraftView(CentreContactState.InContact, 99, HomeVerdictState.Nominal, 0), Always(ActiveContract()));
            Assert.Equal(0, applied);

            book.Release(5001, _ => new HomeCraftView(CentreContactState.InContact, 100, HomeVerdictState.Nominal, 0), Always(ActiveContract()));
            Assert.Equal(1, applied);
        }

        [Fact]
        public void AHeldChangeIsDroppedWithNoWordWhenHomeDeclaresTheCraftLost()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, NoRoute);

            book.Release(5000, _ => new HomeCraftView(CentreContactState.Silent, 90, HomeVerdictState.Lost, 1), Always(ActiveContract()));

            Assert.Equal(0, applied);
            Assert.Empty(book.Held);
            Assert.Equal(ObjectiveSettlement.Dropped, Assert.Single(book.Settled).Outcome);
            Assert.False(book.HasHeldAtOrBefore(Contract, 100));
        }

        [Fact]
        public void AHeldChangeIsDroppedWhenHomeKnowsTheCraftIsGoneWithoutWordOfIt()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, NoRoute);

            book.Release(5000, _ => new HomeCraftView(CentreContactState.Gone, 90, HomeVerdictState.Gone, 0), Always(ActiveContract()));

            Assert.Equal(0, applied);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void AHeldChangeLandsWhenTheCraftIsGoneButItsWordGotHomeFirst()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, NoRoute);

            book.Release(5000, _ => new HomeCraftView(CentreContactState.Gone, 150, HomeVerdictState.Gone, 0), Always(ActiveContract()));

            Assert.Equal(1, applied);
        }

        [Fact]
        public void AChangeForAFinishedContractIsDroppedWithoutApplying()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(new ContractView(true, found: true, active: false, deadlineUt: null, objectiveFound: true, objectiveState: ObjectiveState.Unmet)));

            Assert.Equal(0, applied);
            Assert.Equal(ObjectiveSettlement.Dropped, Assert.Single(book.Settled).Outcome);
        }

        [Fact]
        public void AChangeForAContractNoLongerInTheGameIsDropped()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(new ContractView(true, found: false, active: false, deadlineUt: null, objectiveFound: false, objectiveState: null)));

            Assert.Equal(0, applied);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void AChangeStampedAfterTheDeadlineIsDropped()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100.5), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(ActiveContract(deadline: 100)));

            Assert.Equal(0, applied);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void AChangeStampedAtTheDeadlineApplies()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(ActiveContract(deadline: 100)));

            Assert.Equal(1, applied);
        }

        /// <summary>The game's SetComplete turns a failed objective complete and pays for it, so the line must not call it.</summary>
        [Theory]
        [InlineData(ObjectiveState.Met)]
        [InlineData(ObjectiveState.Failed)]
        public void AMetChangeForAnObjectiveAlreadyMetOrFailedIsDropped(ObjectiveState current)
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(ActiveContract(current)));

            Assert.Equal(0, applied);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void ArrivalsWaitWhileTheContractSystemCannotBeRead()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(10));

            book.Release(200, NoWord, Always(ContractView.Unreadable));

            Assert.Equal(0, applied);
            Assert.Single(book.Held);
        }

        /// <summary>Once one change completes the contract, the next arrival in the same pass sees it finished.</summary>
        [Fact]
        public void EachArrivalReadsTheContractAfterTheOneBeforeItApplied()
        {
            var book = new ObjectiveDelayBook();
            var active = true;
            var applied = new List<string>();
            book.Offer(Change(100, path: "0"), () => { applied.Add("0"); active = false; }, true, Routed(10));
            book.Offer(Change(101, path: "1"), () => applied.Add("1"), true, Routed(10));

            book.Release(200, NoWord, _ => new ContractView(true, true, active, null, true, ObjectiveState.Unmet));

            Assert.Equal(new[] { "0" }, applied);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void HasHeldAtOrBeforeAsksOnlyAboutChangesStampedByThen()
        {
            var book = new ObjectiveDelayBook();
            book.Offer(Change(100), () => { }, true, Routed(10));

            Assert.True(book.HasHeldAtOrBefore(Contract, 100));
            Assert.True(book.HasHeldAtOrBefore(Contract, 500));
            Assert.False(book.HasHeldAtOrBefore(Contract, 99));
            Assert.False(book.HasHeldAtOrBefore(Guid.NewGuid(), 500));
        }

        [Fact]
        public void ARestoredChangeWaitsForItsOwnerAndAppliesOnceRebound()
        {
            var book = new ObjectiveDelayBook();
            var change = Change(100);
            change.OwnerId = ObjectiveDelayCapability.ContractConfiguratorOwner;
            book.Restore(change, arrivesUt: 110, unheardSources: Array.Empty<string>());

            book.Release(200, NoWord, Always(ActiveContract()));
            Assert.Single(book.Held);
            Assert.False(book.IsBound(ObjectiveDelayCapability.ContractConfiguratorOwner));

            var applied = 0;
            book.Rebind(ObjectiveDelayCapability.ContractConfiguratorOwner, _ => () => applied++);
            book.Release(200, NoWord, Always(ActiveContract()));

            Assert.Equal(1, applied);
            Assert.True(book.IsBound(ObjectiveDelayCapability.ContractConfiguratorOwner));
        }

        [Fact]
        public void ARestoredChangeItsOwnerCannotReachIsDropped()
        {
            var book = new ObjectiveDelayBook();
            book.Restore(Change(100), arrivesUt: 110, unheardSources: Array.Empty<string>());
            book.Rebind(ObjectiveDelayCapability.StockOwner, _ => null);

            book.Release(200, NoWord, Always(ActiveContract()));

            Assert.Empty(book.Held);
            Assert.Equal(ObjectiveSettlement.Dropped, Assert.Single(book.Settled).Outcome);
        }

        [Fact]
        public void ARestoreOfAChangeAlreadyOnTheLineAddsNothing()
        {
            var book = new ObjectiveDelayBook();
            book.Offer(Change(100), () => { }, true, Routed(10));
            book.Restore(Change(100), arrivesUt: 110, unheardSources: Array.Empty<string>());
            Assert.Single(book.Held);
        }

        [Fact]
        public void ARestoredHeldChangeStillWaitsForWordFromItsCraft()
        {
            var book = new ObjectiveDelayBook();
            book.Rebind(ObjectiveDelayCapability.StockOwner, _ => () => { });
            book.Restore(Change(100), arrivesUt: null, unheardSources: new[] { Probe });

            book.Release(5000, NoWord, Always(ActiveContract()));
            Assert.Single(book.Held);

            book.Release(5000, _ => new HomeCraftView(CentreContactState.InContact, 120, HomeVerdictState.Nominal, 0), Always(ActiveContract()));
            Assert.Empty(book.Held);
        }

        [Fact]
        public void SwitchingDelayOffLetsEveryChangeArriveNow()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100, path: "0"), () => applied++, true, Routed(1000));
            book.Offer(Change(100, path: "1", sources: Station), () => applied++, true, NoRoute);

            book.BringForward(nowUt: 150, remainingFactor: 0);
            book.Release(150, NoWord, Always(ActiveContract()));

            Assert.Equal(2, applied);
        }

        [Fact]
        public void AShorterDelayBringsATimedChangeForward()
        {
            var book = new ObjectiveDelayBook();
            var applied = 0;
            book.Offer(Change(100), () => applied++, true, Routed(100));

            book.BringForward(nowUt: 100, remainingFactor: 0.5);
            book.Release(150, NoWord, Always(ActiveContract()));

            Assert.Equal(1, applied);
        }

        [Fact]
        public void AnApplyThatThrowsDropsTheChangeAndSaysSo()
        {
            var book = new ObjectiveDelayBook();
            Exception? reported = null;
            book.Offer(Change(100), () => throw new InvalidOperationException("boom"), true, Routed(10));

            book.Release(200, NoWord, Always(ActiveContract()), (_, ex) => reported = ex);

            Assert.IsType<InvalidOperationException>(reported);
            Assert.Empty(book.Held);
        }

        [Fact]
        public void SettlementsAreKeptToABoundedTail()
        {
            var book = new ObjectiveDelayBook();
            for (var i = 0; i < ObjectiveDelayBook.SettledKept + 10; i++)
            {
                book.Offer(Change(i, path: i.ToString()), () => { }, true, Routed(1));
            }
            book.Release(10_000, NoWord, Always(ActiveContract()));

            Assert.Equal(ObjectiveDelayBook.SettledKept, book.Settled.Count);
            Assert.EndsWith("/" + (ObjectiveDelayBook.SettledKept + 9) + "/Met@" + (ObjectiveDelayBook.SettledKept + 9), book.Settled[book.Settled.Count - 1].Key);
        }

        [Fact]
        public void TheLineKeepsItsOwnCopyOfAChange()
        {
            var book = new ObjectiveDelayBook();
            var change = Change(100);
            book.Offer(change, () => { }, true, Routed(10));
            change.CraftUt = 999;
            change.ObjectivePath = "9";

            Assert.Equal(100, book.Held[0].Change.CraftUt);
            Assert.Equal("0", book.Held[0].Change.ObjectivePath);
        }
    }
}
