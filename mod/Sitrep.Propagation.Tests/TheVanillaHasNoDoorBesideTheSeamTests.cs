using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// The two-body vanilla may not expose a way in that
    /// <see cref="IPropagationProvider"/> does not have.
    ///
    /// <para>This is the check that makes "orbits are conics is assumed in exactly one
    /// place" literally true rather than nearly true. The arithmetic living in one class
    /// is not enough on its own: for as long as that class also published
    /// <c>Solve(OrbitElements, double)</c>, any caller could take a conic straight out of
    /// it without the seam being involved at all, and sixteen tests across six files
    /// did exactly that. The seam is only a seam if there is no door beside it.</para>
    ///
    /// <para>Written as a reflection ratchet rather than left to the compiler on purpose.
    /// A future second element-keyed entry point would compile perfectly, every existing
    /// test would stay green, and nothing would say so: "the build passes" cannot express
    /// this failure. This can.</para>
    ///
    /// <para>And it compares SIGNATURES rather than names, because the first draft did not
    /// and passed while the door was still wide open: <c>Solve(OrbitElements, double)</c>
    /// shares its name with the seam's own <c>Solve</c>, so a name check called it a member
    /// of the interface. An overload is exactly how a second door gets added.</para>
    /// </summary>
    public class TheVanillaHasNoDoorBesideTheSeamTests
    {
        [Fact]
        public void EveryPublicMemberOfTheVanillaIsOneTheSeamDeclares()
        {
            var seam = new HashSet<string>(
                typeof(IPropagationProvider)
                    .GetMembers(BindingFlags.Public | BindingFlags.Instance)
                    .Select(Signature),
                StringComparer.Ordinal);

            // Property accessors arrive as get_X methods behind the property itself, and a
            // constructor is not a way into the solver.
            var beside = typeof(KeplerProvider)
                .GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.MemberType != MemberTypes.Constructor)
                .Where(m => !(m is MethodInfo method && method.IsSpecialName))
                .Where(m => !seam.Contains(Signature(m)))
                .Select(Signature)
                .ToList();

            Assert.True(
                beside.Count == 0,
                "KeplerProvider must be reachable only through IPropagationProvider, and these are "
                + "reachable without it: " + string.Join(", ", beside));
        }

        /// <summary>
        /// The guard on the guard. The check above would also pass if the element-keyed
        /// door were merely RENAMED onto the interface, so this pins the shape that must
        /// not exist: nothing public may take a bare <see cref="OrbitElements"/>, whatever
        /// it is called.
        /// </summary>
        [Fact]
        public void NothingPublicOnTheVanillaTakesABareConic()
        {
            var conicDoors = typeof(KeplerProvider)
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.GetParameters().Any(p => p.ParameterType == typeof(OrbitElements)))
                .Select(Signature)
                .ToList();

            Assert.True(
                conicDoors.Count == 0,
                "A conic reaches a provider as a PropagationTarget's payload, never as an argument "
                + "in its own right, and these take one: " + string.Join(", ", conicDoors));
        }

        [Fact]
        public void TheSeamStillOffersEverythingACallerNeeds()
        {
            // The paired half of the ratchet above, so that "no door beside the seam" can
            // never be satisfied by narrowing the seam itself until nothing goes through
            // it. These four are what the codebase actually asks a provider.
            var seam = typeof(IPropagationProvider)
                .GetMembers(BindingFlags.Public | BindingFlags.Instance)
                .Select(m => m.Name)
                .ToList();

            foreach (var expected in new[]
            {
                nameof(IPropagationProvider.ProviderId),
                nameof(IPropagationProvider.Solve),
                nameof(IPropagationProvider.SolveMany),
                nameof(IPropagationProvider.CharacteristicCycleSeconds),
                nameof(IPropagationProvider.CanPropagate),
            })
            {
                Assert.Contains(expected, seam);
            }
        }

        /// <summary>Name plus parameter types, so an OVERLOAD cannot pass for the member it shares a name with.</summary>
        private static string Signature(MemberInfo member)
        {
            if (member is MethodInfo method)
            {
                return method.Name + "("
                    + string.Join(", ", method.GetParameters().Select(p => p.ParameterType.Name))
                    + ")";
            }
            return member.MemberType + " " + member.Name;
        }
    }
}
