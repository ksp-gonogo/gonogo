using System;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The anti-pattern ratchet for <see cref="CommsHop"/>, the same guard
    /// <see cref="IsruContractShapeTests"/> and
    /// <c>ReliabilityContractShapeTests</c> hold for their own elected payloads: a
    /// NEW provider-specific per-hop field lands in the extension bag, not as
    /// another hand-listed member on the shared hop.
    ///
    /// <para><see cref="CommsHop"/> is the one comms shape both backends (vanilla
    /// CommNet and an elected out-of-tree comms provider) fill, so a provider-only
    /// field on it would be the hand-curated-superset anti-pattern: it needs a
    /// core PR an out-of-tree comms provider (RemoteTech, a future mod) cannot
    /// land. There is no longer any provider-dependent member on the hop: the one
    /// that used to be here, <c>BandRateBitsPerSec</c>, was removed (Major 13) and
    /// its forward rate moved to the RealAntennas uplink's own
    /// <c>realantennas.hopRates</c> channel, so everything provider-specific now
    /// goes in <c>Extensions["&lt;providerId&gt;"]</c> or the provider's own
    /// channel.</para>
    ///
    /// <para>The set is exact rather than a max count, so a RENAME fails too.
    /// Removals are gated by <see cref="ContractShapeGateTests"/>.</para>
    /// </summary>
    public class CommsHopContractShapeTests
    {
        private static readonly string[] FrozenHopMembers =
        {
            nameof(CommsHop.From),
            nameof(CommsHop.To),
            nameof(CommsHop.Kind),
            nameof(CommsHop.DistanceMeters),
            // Which END of the hop is a ground station. Backend-independent
            // geometry, not a provider fact: every comms backend knows it, and
            // it is what tells a direct vessel-to-home link apart from a
            // relay-mediated one without parsing an endpoint name.
            nameof(CommsHop.FromIsHome),
            nameof(CommsHop.ToIsHome),
            nameof(CommsHop.Extensions),
        };

        [Fact]
        public void CommsHopGainsNoNewHandListedMember()
        {
            var actual = typeof(CommsHop)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(p => p.Name)
                .ToArray();

            var added = actual.Except(FrozenHopMembers, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                added.Count == 0,
                "New hand-listed member(s) on the shared CommsHop:\n  " +
                string.Join("\n  ", added) +
                "\n\nA provider-specific per-hop comms field goes in the extension bag, under the " +
                "provider's own id: write it into Extensions[\"<providerId>\"] server-side and ship a " +
                "typed accessor from the provider's OWN client package (see " +
                "mod/Sitrep.Contract/ProviderExtensions.cs, and a sibling Uplink's hop extension " +
                "for the exemplar). " +
                "Adding a member here is the hand-curated-superset anti-pattern the bag replaces.");

            var removed = FrozenHopMembers.Except(actual, StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                removed.Count == 0,
                "Frozen member(s) missing from CommsHop:\n  " + string.Join("\n  ", removed) +
                "\n\nA member leaving this list is a wire break that belongs to ContractShapeGateTests " +
                "and a Major bump, not a quiet edit here.");
        }

        [Fact]
        public void CommsHopCarriesExactlyOneProviderExtensionBag()
        {
            var bags = typeof(CommsHop)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() != null)
                .ToArray();

            Assert.True(
                bags.Length == 1,
                "CommsHop must carry exactly one [ProviderExtensionBag] property; found " + bags.Length + ".");
        }
    }
}
