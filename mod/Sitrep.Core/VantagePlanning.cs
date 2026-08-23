using System;
using Sitrep.Contract;

namespace Sitrep.Core
{
    /// <summary>
    /// Answers "where does this craft go, given what THIS command centre can see".
    ///
    /// <para>The whole point is the seam between two things that already existed and
    /// were never joined: the archive knows what a vantage has been told, and a
    /// propagation provider knows physics. Joined the wrong way round, the provider
    /// answers from the game's live truth and a distant operator is shown a future
    /// their light has not reached, which is indistinguishable on screen from a
    /// correct answer.</para>
    ///
    /// <para>There is no path through here that reaches a live state. The seed comes
    /// from <see cref="DelayedStateReader"/> or the answer is a refusal, and the
    /// refusal names the observer rather than the craft: a vantage that has heard
    /// nothing is not a craft that has gone wrong.</para>
    /// </summary>
    public static class VantagePlanning
    {
        /// <summary>
        /// Propagate <paramref name="topic"/>'s craft as <paramref name="vantage"/>
        /// may currently see it, out to <paramref name="toUt"/>.
        ///
        /// <para><paramref name="toUt"/> is a horizon the CALLER chose, and it is
        /// allowed to be beyond the vantage's view instant. That is not a leak: the
        /// operator is asking where the craft will be, and the answer is a prediction
        /// from what they know, not an observation of what happened. What would leak
        /// is seeding it from a state they have not been told, which is the one thing
        /// this cannot do.</para>
        /// </summary>
        /// <summary>
        /// The same rules, for a caller that has already established what its vantage
        /// may see. Used where the archive and the delay live together, so the read
        /// and the delay cannot be taken from different places.
        /// </summary>
        public static SeededTrajectory Solve(
            DelayedObservation seed,
            ISeededPropagationProvider? provider,
            double toUt,
            int maxPoints)
        {
            if (provider == null)
            {
                return SeededTrajectory.Refused(
                    "No propagation provider is elected, so nothing here can integrate a trajectory.");
            }
            if (!seed.Established)
            {
                return SeededTrajectory.Refused(
                    seed.Reason ?? "This vantage has nothing to plan from yet.");
            }
            if (double.IsNaN(toUt) || toUt <= seed.ObservedAtUt)
            {
                return SeededTrajectory.Refused(
                    "The requested horizon is at or before the instant this state was true, so "
                        + "there is nothing to propagate.");
            }
            if (!provider.CanSeedFrom(seed))
            {
                return SeededTrajectory.Refused(
                    "The elected provider cannot propagate from this state, most likely because it "
                        + "has no gravity model for the body it is measured about.");
            }
            return provider.SolveFrom(seed, toUt, maxPoints);
        }

        public static SeededTrajectory Solve(
            Archive archive,
            ISeededPropagationProvider? provider,
            string topic,
            string vantage,
            double delaySeconds,
            double nowUt,
            double toUt,
            int maxPoints,
            Func<object?, StateAboutBody?> toState)
        {
            if (provider == null)
            {
                return SeededTrajectory.Refused(
                    "No propagation provider is elected, so nothing here can integrate a trajectory.");
            }

            var seed = DelayedStateReader.Read(archive, topic, vantage, delaySeconds, nowUt, toState);
            if (!seed.Established)
            {
                return SeededTrajectory.Refused(
                    seed.Reason ?? "This vantage has nothing to plan from yet.");
            }

            // A horizon at or before the seed is not a prediction, and integrating
            // backwards is a different question nobody asked. Caught here rather than
            // inside a provider so every provider does not have to.
            if (double.IsNaN(toUt) || toUt <= seed.ObservedAtUt)
            {
                return SeededTrajectory.Refused(
                    "The requested horizon is at or before the instant this state was true, so "
                        + "there is nothing to propagate.");
            }

            if (!provider.CanSeedFrom(seed))
            {
                return SeededTrajectory.Refused(
                    "The elected provider cannot propagate from this state, most likely because it "
                        + "has no gravity model for the body it is measured about.");
            }

            return provider.SolveFrom(seed, toUt, maxPoints);
        }
    }
}
