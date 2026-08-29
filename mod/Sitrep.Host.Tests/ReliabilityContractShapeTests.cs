using System;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The anti-pattern ratchet for the provider extension mechanism: a NEW
    /// provider-specific reliability field must land in the extension bag, not as
    /// another hand-listed member on the core <c>Reliability*</c> classes.
    ///
    /// <para><b>The anti-pattern, precisely.</b> <c>reliability.*</c> is a
    /// Kernel-elected capability: one shared payload shape whichever backend won the
    /// election fills. Its per-provider fields grew as a hand-curated CORE SUPERSET,
    /// with one modelling mod's consumed-fraction fields and another's
    /// live-probability fields side by side, all nullable, each doc-commented with
    /// which provider fills it. That works only because the core maintainer already knew about, and
    /// coordinated with, both providers. It does not scale: a third field-owner the
    /// core dev has never heard of has no way to land a field without a PR against
    /// <c>Sitrep.Contract</c>, and per the decentralised-Uplink model that is exactly
    /// who a provider is expected to be. The bag
    /// (<c>Sitrep.Contract/ProviderExtensions.cs</c>) is the route that needs no such
    /// PR, and this test is what stops the old route being taken by habit.</para>
    ///
    /// <para><b>The follow-up landed, and the superset SHRANK.</b> The baselines
    /// below were once the hand-curated superset this guard merely recorded: one
    /// modelling mod's consumed-fraction fields beside another's live-probability
    /// fields, all nullable, each doc-commented with who filled it. That set is
    /// gone. The summary went from six members to three and the part entry from
    /// twelve to nine (Major 13 -&gt; 14; see <c>ContractVersion</c>), and what
    /// replaced the provider-shaped members is the OPEN one: a
    /// <see cref="ReliabilityBudget"/> list whose dimensions a provider names
    /// itself, plus the extension bag for anything genuinely provider-shaped. So a
    /// new consumed dimension now needs no core PR at all, which is what makes this
    /// guard a redirection rather than a dead end.</para>
    ///
    /// <para><b>What is pinned, and what is deliberately NOT failed.</b> This fails
    /// on an ADDITION. Adding a member is the anti-pattern; the sets below are the
    /// baseline it is measured against.</para>
    ///
    /// <para><b>Why an exact set rather than a max count.</b> A count would let a
    /// rename through, and a rename of a wire field is the same break as a removal
    /// wearing a different hat. Removals are already gated by
    /// <see cref="ContractShapeGateTests"/>; naming the set here costs nothing and
    /// makes the failure message able to say which member appeared.</para>
    ///
    /// <para>Not a general contract-shape gate. This is scoped to the two elected
    /// reliability payloads on purpose: they are the multi-provider capability the
    /// mechanism was proven on. When <c>science</c> becomes Kernel-electable and
    /// takes the bag, it should get a ratchet of its own in the same shape.</para>
    /// </summary>
    public class ReliabilityContractShapeTests
    {
        /// <summary>
        /// <see cref="ReliabilitySummary"/>: two facts and the bag, and NO
        /// judgements. A roll-up here would be a second authority for something
        /// derivable from the part list published in the same capture at the same
        /// UT, which is how two adjacent numbers come to disagree.
        /// </summary>
        private static readonly string[] FrozenSummaryMembers =
        {
            nameof(ReliabilitySummary.Source),
            nameof(ReliabilitySummary.Coverage),
            nameof(ReliabilitySummary.Extensions),
        };

        /// <summary>
        /// <see cref="ReliabilityPartEntry"/>. Not one of these is
        /// provider-shaped: a condition and the provider's own word for it, a
        /// forward probability that MUST carry its horizon, the open budget list,
        /// and the bag. A new consumed dimension is a
        /// <see cref="ReliabilityBudget"/> entry, never a member here.
        /// </summary>
        private static readonly string[] FrozenPartEntryMembers =
        {
            nameof(ReliabilityPartEntry.PartId),
            nameof(ReliabilityPartEntry.Title),
            nameof(ReliabilityPartEntry.Condition),
            nameof(ReliabilityPartEntry.ConditionDetail),
            nameof(ReliabilityPartEntry.Survival),
            nameof(ReliabilityPartEntry.SurvivalHorizonSeconds),
            nameof(ReliabilityPartEntry.Budgets),
            nameof(ReliabilityPartEntry.Extensions),
        };

        /// <summary>
        /// <see cref="ReliabilityBudget"/>: the ONE open member's own shape. It is
        /// pinned for the same reason the two payloads are, and it is the reason
        /// their member counts could FALL. A provider with a dimension nobody
        /// anticipated invents an id and a label and fills whichever typed pair it
        /// has; it does not add a field here either.
        /// </summary>
        private static readonly string[] FrozenBudgetMembers =
        {
            nameof(ReliabilityBudget.Id),
            nameof(ReliabilityBudget.Label),
            nameof(ReliabilityBudget.Kind),
            nameof(ReliabilityBudget.Consumed),
            nameof(ReliabilityBudget.UsedSeconds),
            nameof(ReliabilityBudget.LimitSeconds),
            nameof(ReliabilityBudget.UsedCount),
            nameof(ReliabilityBudget.LimitCount),
        };

        [Fact]
        public void ReliabilitySummaryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(ReliabilitySummary), FrozenSummaryMembers);

        [Fact]
        public void ReliabilityPartEntryGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(ReliabilityPartEntry), FrozenPartEntryMembers);

        [Fact]
        public void ReliabilityBudgetGainsNoNewHandListedMember() =>
            AssertNoNewMembers(typeof(ReliabilityBudget), FrozenBudgetMembers);

        /// <summary>
        /// Both payloads actually carry a bag, so the guard above is offering a real
        /// alternative rather than just refusing the old one. Asserted through the
        /// ATTRIBUTE rather than the property name, since the attribute is what
        /// codegen and the wire writer both key off.
        /// </summary>
        [Fact]
        public void BothElectedReliabilityPayloadsCarryAProviderExtensionBag()
        {
            foreach (var type in new[] { typeof(ReliabilitySummary), typeof(ReliabilityPartEntry) })
            {
                var bags = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null)
                    .ToArray();

                Assert.True(
                    bags.Length == 1,
                    type.Name + " must carry exactly one [ProviderExtensionBag] property; found " +
                    bags.Length + ". The bag is what makes the no-new-members rule above a " +
                    "redirection rather than a dead end.");
            }
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
                "\n\nA provider-specific reliability field goes in the extension bag now, under the " +
                "provider's own id: write it into Extensions[\"<providerId>\"] server-side and ship a " +
                "typed accessor from the provider's OWN client package (see " +
                "mod/Sitrep.Contract/ProviderExtensions.cs for the mechanism, and " +
                "ReliabilityExtensionWireTests in the provider Uplink that already ships a " +
                "namespace for a worked example). Adding a member here is the " +
                "hand-curated-superset anti-pattern the bag replaces: it needs a core PR, which an " +
                "out-of-tree provider cannot land. If the field genuinely is source-AGNOSTIC (every " +
                "backend can fill it), that is the one case where a member still belongs here, and " +
                "adding it to the frozen list above is the deliberate act that records the call.");

            var removed = frozen.Except(actual, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                removed.Count == 0,
                "Frozen member(s) missing from " + type.Name + ":\n  " + string.Join("\n  ", removed) +
                "\n\nThis list is a baseline, not a wish: a member leaving it is a wire break that " +
                "belongs to ContractShapeGateTests and a Major bump, not to a quiet edit here.");
        }
    }
}
