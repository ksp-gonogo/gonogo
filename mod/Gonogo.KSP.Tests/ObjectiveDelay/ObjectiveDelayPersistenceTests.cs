using System;
using Gonogo.KSP.ObjectiveDelay;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.ObjectiveDelay
{
    public class ObjectiveDelayPersistenceTests
    {
        private static readonly Guid Contract = new Guid("0a1b2c3d-0000-4000-8000-000000000001");

        private static ObjectiveChange Change(double craftUt, params string[] sources) => new ObjectiveChange
        {
            ContractId = Contract,
            OwnerId = ObjectiveDelayCapability.StockOwner,
            ObjectivePath = "1/0",
            Target = ObjectiveState.Failed,
            SourceVesselIds = sources,
            CraftUt = craftUt,
            Description = "Orbit the Mun",
        };

        private static ContractView Active => new ContractView(true, true, true, null, true, ObjectiveState.Unmet);

        [Fact]
        public void AHeldChangeSurvivesASaveAndLoadAndAppliesOnceItsOwnerRebinds()
        {
            var saved = new ObjectiveDelayBook();
            saved.Offer(Change(100.25, "probe", "station"), () => { }, true, id => id == "probe" ? 40 : (double?)null);
            var node = new ConfigNode("SCENARIO");
            ObjectiveDelayPersistence.Save(saved, node);

            var loaded = new ObjectiveDelayBook();
            ObjectiveDelayPersistence.Load(loaded, node);

            var restored = Assert.Single(loaded.Held);
            Assert.Equal(Contract, restored.Change.ContractId);
            Assert.Equal("1/0", restored.Change.ObjectivePath);
            Assert.Equal(ObjectiveState.Failed, restored.Change.Target);
            Assert.Equal(100.25, restored.Change.CraftUt);
            Assert.Equal(new[] { "probe", "station" }, restored.Change.SourceVesselIds);
            Assert.Equal(140.25, restored.ArrivesUt);
            Assert.Equal(new[] { "station" }, restored.UnheardSources);
            Assert.Equal(saved.Held[0].Key, restored.Key);
            Assert.True(loaded.HasHeldAtOrBefore(Contract, 100.25));

            var applied = 0;
            loaded.Rebind(ObjectiveDelayCapability.StockOwner, _ => () => applied++);
            loaded.Release(500, _ => new HomeCraftView(CentreContactState.InContact, 200, HomeVerdictState.Nominal, 0), _ => Active);
            Assert.Equal(1, applied);
        }

        /// <summary>A change made after the save point is not in the node a revert or quickload restores.</summary>
        [Fact]
        public void ARevertRestoresOnlyWhatWasOnTheLineAtTheSave()
        {
            var book = new ObjectiveDelayBook();
            book.Offer(Change(100, "probe"), () => { }, true, _ => 10);
            var node = new ConfigNode("SCENARIO");
            ObjectiveDelayPersistence.Save(book, node);
            book.Offer(Change(200, "probe"), () => { }, true, _ => 10);

            var reverted = new ObjectiveDelayBook();
            ObjectiveDelayPersistence.Load(reverted, node);

            Assert.Equal(100, Assert.Single(reverted.Held).Change.CraftUt);
        }

        [Fact]
        public void ASaveFromBeforeTheLineLoadsEmpty()
        {
            var book = new ObjectiveDelayBook();
            ObjectiveDelayPersistence.Load(book, new ConfigNode("SCENARIO"));
            Assert.Empty(book.Held);
        }
    }
}
