using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// One vocabulary for a provider's identity, held as a mechanism rather than
    /// as a state.
    ///
    /// <para>The seams grew one at a time and each named the same member its own
    /// way: <c>BackendId</c> on four of them, <c>ProviderId</c> on two,
    /// <c>SourceId</c> on one. Nothing failed, because nothing was looking. An
    /// author implementing two seams wrote a different word in each for identical
    /// semantics and had no way to notice.</para>
    ///
    /// <para>Renaming them all fixes today and permits tomorrow: the next seam is
    /// written by whoever is nearest a <c>Backend</c>-suffixed neighbour. So the
    /// rule is that an identity comes from <see cref="ISitrepProvider"/> and from
    /// nowhere else, which is checked here two ways. The first stops the old
    /// spellings coming back under any interface. The second stops the NEW
    /// spelling being re-declared privately, which would pass the first check
    /// while re-creating exactly the drift it exists to prevent.</para>
    /// </summary>
    public class ProviderIdentityVocabularyTests
    {
        private static IEnumerable<Type> ContractInterfaces() =>
            typeof(ISitrepProvider).Assembly
                .GetTypes()
                .Where(t => t.IsInterface && t.IsPublic);

        [Fact]
        public void NoInterfaceSpellsAProviderIdentityTheOldWay()
        {
            var offenders = ContractInterfaces()
                .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .Where(p => p.Name == "BackendId" || p.Name == "SourceId")
                    .Select(p => t.Name + "." + p.Name))
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "A provider says what it is through ISitrepProvider.ProviderId, and these spell it "
                + "another way: " + string.Join(", ", offenders));
        }

        [Fact]
        public void OnlyTheBaseInterfaceDeclaresProviderId()
        {
            var offenders = ContractInterfaces()
                .Where(t => t != typeof(ISitrepProvider))
                .Where(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .Any(p => p.Name == nameof(ISitrepProvider.ProviderId)))
                .Select(t => t.Name)
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "ProviderId is declared once, on ISitrepProvider, so two seams cannot describe it "
                + "differently. These declare their own: " + string.Join(", ", offenders));
        }

        /// <summary>
        /// The paired half: the checks above are both satisfied by an assembly
        /// with no seams in it at all, and an empty scan reads exactly like a
        /// clean one. This pins that the seams are actually here and actually
        /// derive.
        /// </summary>
        [Fact]
        public void EveryCapabilitySeamCarriesTheSharedIdentity()
        {
            foreach (var seam in new[]
            {
                typeof(ICommsBackend),
                typeof(IActionGroupsBackend),
                typeof(IPropagationProvider),
                typeof(IManeuverPlanSource),
                typeof(IScienceBackend),
                typeof(IReliabilityBackend),
                typeof(IIsruBackend),
                typeof(IDelayedScienceSink),
                typeof(ICommandCentreSource),
            })
            {
                Assert.True(
                    typeof(ISitrepProvider).IsAssignableFrom(seam),
                    seam.Name + " is something a third party implements and registers, so it says what "
                    + "it is through ISitrepProvider.");
            }
        }

        /// <summary>
        /// The closest-approach seam merged into propagation, and this is what
        /// says so. A reintroduced <c>ITargetApproachSolver</c> would compile, and
        /// every test would stay green, while the pair it was removed to prevent
        /// came back: an integrated trajectory and a two-body encounter for the
        /// same vessel at the same instant.
        /// </summary>
        [Fact]
        public void ClosestApproachHasNoSeamOfItsOwn()
        {
            var separate = typeof(ISitrepProvider).Assembly
                .GetTypes()
                .Where(t => t.IsInterface && t != typeof(IPropagationProvider))
                .Where(t => t.GetMethods().Any(m => m.ReturnType == typeof(ClosestApproach)))
                .Select(t => t.Name)
                .ToList();

            Assert.True(
                separate.Count == 0,
                "An encounter is a consequence of a trajectory, so it is answered by the propagation "
                + "provider and by nothing else. These answer one too: " + string.Join(", ", separate));
        }
    }
}
