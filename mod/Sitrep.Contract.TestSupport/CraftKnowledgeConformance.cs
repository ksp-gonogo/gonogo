using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What an <see cref="ICraftKnowledge"/> owes on every answer, whatever it
    /// knows: the rules on <see cref="CraftKnowledgeReading"/>'s own members.
    /// </summary>
    public static class CraftKnowledgeConformance
    {
        /// <summary>
        /// Asks <paramref name="provider"/> about one craft at one centre and checks
        /// the answer keeps every rule a reading promises, then asks about a centre
        /// and a craft no provider can know and checks that each reads unknown.
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        /// <param name="centreId">A centre to ask about.</param>
        /// <param name="vesselId">A craft to ask about, as a bare vessel id.</param>
        /// <param name="ut">The instant to ask at.</param>
        /// <returns>The reading for <paramref name="centreId"/> and <paramref name="vesselId"/>, for the caller's own assertions.</returns>
        public static CraftKnowledgeReading AssertKnowledgeContract(ICraftKnowledge provider, string centreId, string vesselId, double ut)
        {
            SeamConformance.AssertProviderContract(provider);

            var reading = provider.KnowledgeAt(centreId, vesselId, ut);
            AssertReading(reading, provider.GetType().Name + " at " + centreId + " for " + vesselId);

            var stranger = "no-such-craft-" + Guid.NewGuid().ToString("N");
            AssertUnknown(provider.KnowledgeAt(centreId, stranger, ut), "a craft nobody has heard of");
            AssertUnknown(provider.KnowledgeAt("no-such-centre-" + Guid.NewGuid().ToString("N"), vesselId, ut), "a centre that does not exist");

            return reading;
        }

        private static void AssertReading(CraftKnowledgeReading? reading, string what)
        {
            Assert.True(reading != null, what + ": KnowledgeAt returned null. A centre that knows nothing reads CraftKnowledgeReading.Unknown.");

            if (reading!.State == CraftKnowledgeState.Unknown)
            {
                AssertUnknown(reading, what);
                return;
            }

            Assert.True(
                reading.LastKnownUt is double last && !double.IsNaN(last) && !double.IsInfinity(last),
                what + ": a centre that knows the craft knows when it last knew its place, so LastKnownUt is a finite time.");
            Assert.True(
                (reading.State == CraftKnowledgeState.Held) == (reading.HeldGrade != null),
                what + ": HeldGrade is set exactly when the state is Held, and is " + (reading.HeldGrade?.ToString() ?? "null") + " for " + reading.State + ".");
            Assert.True(
                reading.UncertaintyM is not double radius || (radius >= 0.0 && !double.IsNaN(radius) && !double.IsInfinity(radius)),
                what + ": UncertaintyM is a finite radius in metres, or null when it cannot be bounded; never negative and never a stand-in for unbounded.");
            Assert.True(
                reading.Place == null || (reading.UncertaintyM != null && IsFinite(reading.Place.Position)),
                what + ": a Place carries a finite position and the radius around it, so UncertaintyM is set whenever Place is.");
        }

        private static bool IsFinite(Vector3d v) =>
            !double.IsNaN(v.X + v.Y + v.Z) && !double.IsInfinity(v.X + v.Y + v.Z);

        private static void AssertUnknown(CraftKnowledgeReading? reading, string what)
        {
            Assert.True(reading != null, what + ": KnowledgeAt returned null rather than CraftKnowledgeReading.Unknown.");
            Assert.True(reading!.State == CraftKnowledgeState.Unknown, what + " reads " + reading.State + "; nothing is known of it, so it reads Unknown.");
            Assert.True(
                reading.HeldGrade == null && reading.LastKnownUt == null && reading.UncertaintyM == null && reading.Place == null,
                what + ": an unknown craft carries no grade, no time, no uncertainty and no place.");
            Assert.False(reading.LineOfSight, what + ": LineOfSight is false for an unknown craft, so it never reveals one the centre has not learned of.");
        }
    }
}
