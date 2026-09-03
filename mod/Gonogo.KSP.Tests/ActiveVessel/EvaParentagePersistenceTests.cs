using System;
using System.Linq;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.ActiveVessel
{
    /// <summary>
    /// The quickload half. ConfigNode is a plain data structure with no scene
    /// dependency, so the round-trip runs headlessly against the reference DLL -
    /// the same contract <c>PendingCreditLedgerTests</c> already relies on.
    /// </summary>
    public class EvaParentagePersistenceTests
    {
        private static readonly Guid Ship = new Guid("11111111-1111-1111-1111-111111111111");
        private static readonly Guid Kerbal = new Guid("22222222-2222-2222-2222-222222222222");

        private static Func<Guid, bool> AlwaysFlying => _ => true;

        [Fact]
        public void ARelationSurvivesTheRoundTrip()
        {
            var saved = new EvaParentage();
            saved.RecordEgress(Kerbal, Ship);

            var node = new ConfigNode();
            EvaParentagePersistence.Save(saved, node);

            var restored = new EvaParentage();
            EvaParentagePersistence.Load(restored, node);

            Assert.Equal(Ship, restored.Reported(Kerbal, kspActiveIsEva: true, AlwaysFlying));
        }

        [Fact]
        public void ASaveFromBeforeThisExistedLeavesTheBookEmpty()
        {
            var restored = new EvaParentage();

            EvaParentagePersistence.Load(restored, new ConfigNode());

            Assert.Empty(restored.Entries);
        }

        [Fact]
        public void AnUnparseableRowIsSkippedRatherThanThrowing()
        {
            var node = new ConfigNode();
            var entry = node.AddNode("EVA_PARENTAGE").AddNode("KERBAL");
            entry.AddValue("kerbal", "not-a-guid");
            entry.AddValue("parent", Ship.ToString());

            var restored = new EvaParentage();
            EvaParentagePersistence.Load(restored, node);

            Assert.Empty(restored.Entries);
        }

        [Fact]
        public void EveryRelationIsSaved()
        {
            var otherKerbal = new Guid("44444444-4444-4444-4444-444444444444");
            var saved = new EvaParentage();
            saved.RecordEgress(Kerbal, Ship);
            saved.RecordEgress(otherKerbal, Ship);

            var node = new ConfigNode();
            EvaParentagePersistence.Save(saved, node);

            var restored = new EvaParentage();
            EvaParentagePersistence.Load(restored, node);

            Assert.Equal(2, restored.Entries.Count());
        }
    }
}
