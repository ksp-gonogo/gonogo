using System;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The anti-pattern ratchet for <c>isru.*</c>, the same guard
    /// <see cref="ReliabilityContractShapeTests"/> and
    /// <c>ScienceProviderExtensionRatchetTests</c> hold for their own elected
    /// payloads: a NEW provider-specific ISRU field lands in the extension bag, not
    /// as another hand-listed member on <see cref="IsruDrillEntry"/> or
    /// <see cref="IsruConverterEntry"/>.
    ///
    /// <para>ISRU starts in a better place than reliability did. Reliability's
    /// frozen list records a hand-curated superset that predates the bag and is
    /// recorded rather than condemned. Here the bag existed from the first commit,
    /// so the frozen set below is the literal intersection of what stock and a
    /// modelling mod both have: every member is source-agnostic by construction.
    /// That makes the rule stricter in practice, because there is no legacy
    /// provider-specific member to point at as precedent.</para>
    ///
    /// <para>The set is exact rather than a max count, so a RENAME fails too: a
    /// renamed wire field is the same break as a removal wearing a different hat.
    /// Removals are already gated by <see cref="ContractShapeGateTests"/>.</para>
    /// </summary>
    public class IsruContractShapeTests
    {
        /// <summary>
        /// <see cref="IsruDrillEntry"/> as frozen when the capability landed: the
        /// two identification fields every list-shaped payload carries, the four
        /// operationally-meaningful drill numbers stock itself has, and the bag.
        /// </summary>
        private static readonly string[] FrozenDrillMembers =
        {
            // Core ATTRIBUTION, not a provider-specific reading: the core
            // registrar that owns the topic stamps the subject vessel's guid, and
            // no elected backend can vary it, so it is source-agnostic by
            // construction rather than by curation. The rule this ratchet holds is
            // unchanged: a field one provider knows and another does not still goes
            // in the bag.
            nameof(IsruDrillEntry.VesselId),
            nameof(IsruDrillEntry.PartId),
            nameof(IsruDrillEntry.PartTitle),
            nameof(IsruDrillEntry.Resource),
            nameof(IsruDrillEntry.Deployed),
            nameof(IsruDrillEntry.Running),
            nameof(IsruDrillEntry.Abundance),
            nameof(IsruDrillEntry.Rate),
            nameof(IsruDrillEntry.Extensions),
        };

        /// <summary>
        /// <see cref="IsruConverterEntry"/> as frozen when the capability landed.
        /// Note what is absent and must stay absent: a blocking-reason string for a
        /// starved recipe. Running true alongside zero rates already says it, so a
        /// field would be a fabricated diagnostic rather than a reported one.
        /// </summary>
        private static readonly string[] FrozenConverterMembers =
        {
            // Core attribution: see the note on the first frozen list above.
            nameof(IsruConverterEntry.VesselId),
            nameof(IsruConverterEntry.PartId),
            nameof(IsruConverterEntry.PartTitle),
            nameof(IsruConverterEntry.Running),
            nameof(IsruConverterEntry.Inputs),
            nameof(IsruConverterEntry.Outputs),
            nameof(IsruConverterEntry.Extensions),
        };

        [Fact]
        public void IsruDrillEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(IsruDrillEntry), FrozenDrillMembers);

        [Fact]
        public void IsruConverterEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(IsruConverterEntry), FrozenConverterMembers);

        /// <summary>
        /// Both elected payloads actually carry a bag, so the guard above offers a
        /// real alternative rather than just refusing the old route. Asserted
        /// through the ATTRIBUTE, since that is what codegen and the wire writer
        /// both key off.
        /// </summary>
        [Fact]
        public void BothElectedIsruPayloadsCarryAProviderExtensionBag()
        {
            foreach (var type in new[] { typeof(IsruDrillEntry), typeof(IsruConverterEntry) })
            {
                var bags = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null)
                    .ToArray();

                Assert.True(
                    bags.Length == 1,
                    type.Name + " must carry exactly one [ProviderExtensionBag] property; found " +
                    bags.Length + ".");
            }
        }

        /// <summary>
        /// The nested recipe-flow shape deliberately has NO bag. A provider that
        /// wants to say more about a flow says it on the converter entry that owns
        /// the recipe: a bag per flow would multiply the namespace by every resource
        /// in every recipe for no reader that wants it.
        /// </summary>
        [Fact]
        public void TheNestedFlowShapeCarriesNoBag()
        {
            var bags = typeof(IsruResourceFlow)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null)
                .ToArray();

            Assert.Empty(bags);
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
                "New hand-listed member(s) on the elected payload " + type.Name + ":\n  " +
                string.Join("\n  ", added) +
                "\n\nA provider-specific ISRU field goes in the extension bag, under the provider's " +
                "own id: write it into Extensions[\"<providerId>\"] server-side and ship a typed " +
                "accessor from the provider's OWN client package (see " +
                "mod/Sitrep.Contract/ProviderExtensions.cs for the mechanism). Adding a member here " +
                "is the hand-curated-superset anti-pattern the bag replaces: it needs a core PR, " +
                "which an out-of-tree provider cannot land. If the field genuinely is " +
                "source-AGNOSTIC (every backend can fill it), that is the one case where a member " +
                "still belongs here, and adding it to the frozen list above is the deliberate act " +
                "that records the call.");

            var removed = frozen.Except(actual, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                removed.Count == 0,
                "Frozen member(s) missing from " + type.Name + ":\n  " + string.Join("\n  ", removed) +
                "\n\nThis list is a baseline, not a wish: a member leaving it is a wire break that " +
                "belongs to ContractShapeGateTests and a Major bump, not to a quiet edit here.");
        }
    }
}
