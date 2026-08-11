using System;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The anti-pattern ratchet for the four elected <c>science.*</c> payloads, the
    /// sibling <see cref="ReliabilityContractShapeTests"/> asked for by name when it
    /// said "when <c>science</c> becomes Kernel-electable and takes the bag, it
    /// should get a ratchet of its own in the same shape". Same rule, same reasons:
    /// a NEW provider-specific science field belongs in the extension bag under the
    /// provider's own id, not as another hand-listed nullable member here.
    ///
    /// <para><b>Why science needs this more than reliability did.</b> The
    /// stock-versus-modelled-science overlap survey found four whole concepts one provider
    /// models and the other has no word for (storage capacity, files vs samples,
    /// a 62-condition requirement gate, continuous transmission) on top of five
    /// more where one model is strictly richer. Adding that as core nullable
    /// members would roughly double these payloads with fields exactly one mod ever
    /// fills, and every future science mod would face the same core PR. That is the
    /// pressure the bag exists to absorb.</para>
    ///
    /// <para>Fails on an ADDITION. The frozen sets below are the members as they
    /// stood when science took the bag: the pre-existing ones are recorded, not
    /// condemned. Removals belong to <see cref="ContractShapeGateTests"/> and a
    /// Major bump.</para>
    ///
    /// <para><see cref="SensorEntry"/> is deliberately absent: it is the one science
    /// payload with no bag at all, because a live sensor readout maps cleanly
    /// between every model surveyed (type string, readout string, active bool) and
    /// nothing has needed to extend it. It gets a ratchet the day it gets a
    /// bag.</para>
    /// </summary>
    public class ScienceProviderExtensionRatchetTests
    {
        /// <summary>
        /// <see cref="ExperimentEntry"/> as frozen when the bag landed.
        /// <c>Extensions</c> is in the set because it IS the bag, and
        /// <c>ValueModel</c> because it is source-AGNOSTIC: every backend fills it,
        /// which is the one case a shared member is still the right answer.
        /// </summary>
        private static readonly string[] FrozenExperimentMembers =
        {
            nameof(ExperimentEntry.PartName),
            nameof(ExperimentEntry.Location),
            nameof(ExperimentEntry.ExperimentId),
            nameof(ExperimentEntry.SubjectId),
            nameof(ExperimentEntry.Title),
            nameof(ExperimentEntry.DataAmount),
            nameof(ExperimentEntry.ScienceValueRatio),
            nameof(ExperimentEntry.BaseTransmitValue),
            nameof(ExperimentEntry.TransmitBonus),
            nameof(ExperimentEntry.LabValue),
            nameof(ExperimentEntry.Deployed),
            nameof(ExperimentEntry.Inoperable),
            nameof(ExperimentEntry.Situation),
            nameof(ExperimentEntry.ValueModel),
            nameof(ExperimentEntry.Extensions),
        };

        private static readonly string[] FrozenInstrumentMembers =
        {
            nameof(InstrumentEntry.PartId),
            nameof(InstrumentEntry.PartName),
            nameof(InstrumentEntry.ExperimentId),
            nameof(InstrumentEntry.Title),
            nameof(InstrumentEntry.Deployed),
            nameof(InstrumentEntry.Inoperable),
            nameof(InstrumentEntry.Rerunnable),
            nameof(InstrumentEntry.Resettable),
            nameof(InstrumentEntry.DataIsCollectable),
            nameof(InstrumentEntry.Extensions),
        };

        private static readonly string[] FrozenLabMembers =
        {
            nameof(LabEntry.PartName),
            nameof(LabEntry.DataStored),
            nameof(LabEntry.DataStorage),
            nameof(LabEntry.StoredScience),
            nameof(LabEntry.ProcessingData),
            nameof(LabEntry.StatusText),
            nameof(LabEntry.ScientistCount),
            nameof(LabEntry.ScienceRate),
            nameof(LabEntry.IsOperational),
            nameof(LabEntry.ValueModel),
            nameof(LabEntry.Extensions),
        };

        private static readonly string[] FrozenBreakdownMembers =
        {
            nameof(ExperimentBreakdownEntry.SubjectId),
            nameof(ExperimentBreakdownEntry.Biome),
            nameof(ExperimentBreakdownEntry.Situation),
            nameof(ExperimentBreakdownEntry.ExpTitle),
            nameof(ExperimentBreakdownEntry.DataMits),
            nameof(ExperimentBreakdownEntry.RemainingPotential),
            nameof(ExperimentBreakdownEntry.ValueModel),
            nameof(ExperimentBreakdownEntry.Extensions),
        };

        [Fact]
        public void ExperimentEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(ExperimentEntry), FrozenExperimentMembers);

        [Fact]
        public void InstrumentEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(InstrumentEntry), FrozenInstrumentMembers);

        [Fact]
        public void LabEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(LabEntry), FrozenLabMembers);

        [Fact]
        public void ExperimentBreakdownEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(ExperimentBreakdownEntry), FrozenBreakdownMembers);

        /// <summary>
        /// The bag is actually THERE on all four, which is what makes the ratchet's
        /// advice followable: a test that only forbade new members while no
        /// alternative existed would just be a wall.
        /// </summary>
        [Fact]
        public void EveryElectedSciencePayloadCarriesABag()
        {
            foreach (var type in new[]
            {
                typeof(ExperimentEntry), typeof(InstrumentEntry),
                typeof(LabEntry), typeof(ExperimentBreakdownEntry),
            })
            {
                var bag = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .SingleOrDefault(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null);
                Assert.NotNull(bag);
                Assert.Equal(nameof(ExperimentEntry.Extensions), bag!.Name);
            }
        }

        /// <summary>
        /// <see cref="SensorEntry"/> has no bag, stated as an assertion rather than
        /// left as an omission: if a provider ever needs to extend a sensor readout,
        /// the person adding the bag should also add it to the ratchet above, and
        /// this is what tells them.
        /// </summary>
        [Fact]
        public void SensorEntryStillHasNoBagToRatchet()
        {
            var bag = typeof(SensorEntry)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Any(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null);

            Assert.False(bag, "SensorEntry gained a provider extension bag: give it a frozen member set in this file too.");
        }

        private static void AssertNoNewMembers(Type type, string[] frozen)
        {
            var actual = type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(p => p.Name)
                .ToArray();

            var added = actual.Except(frozen, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                added.Count == 0,
                "New hand-listed member(s) on the elected science payload " + type.Name + ":\n  " +
                string.Join("\n  ", added) +
                "\n\nA provider-specific science field goes in the extension bag now, under the " +
                "provider's own id: write it into Extensions[\"<providerId>\"] server-side and ship a " +
                "typed accessor from the provider's OWN client package (see " +
                "mod/Sitrep.Contract/ProviderExtensions.cs for the mechanism, and the science map + " +
                "client-side reader in whichever provider Uplink already ships a namespace, for a " +
                "worked example on these very payloads). Adding a member here needs a core PR, " +
                "which an out-of-tree science " +
                "provider cannot land. If the field genuinely is source-AGNOSTIC (every backend can " +
                "fill it, as valueModel is), that is the one case where a member still belongs here, " +
                "and adding it to the frozen list above is the deliberate act that records the call.");

            var removed = frozen.Except(actual, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                removed.Count == 0,
                "Frozen member(s) missing from " + type.Name + ":\n  " + string.Join("\n  ", removed) +
                "\n\nThis list is a baseline, not a wish: a member leaving it is a wire break that " +
                "belongs to ContractShapeGateTests and a Major bump, not to a quiet edit here.");
        }
    }
}
