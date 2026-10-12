using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What an <see cref="IVantageGateEvaluator"/> owes the host that asks it
    /// about a call from a particular command centre.
    /// </summary>
    public static class VantageGateConformance
    {
        /// <summary>
        /// Asks <paramref name="evaluator"/> about <paramref name="requirement"/> from
        /// <paramref name="vantage"/>, with every argument the requirement needs
        /// supplied, as a dispatch or a <c>system.gate.check</c> does.
        ///
        /// <para>Fails when the requirement does not set
        /// <see cref="CommandRequirement.NeedsVantage"/> (the host would never ask
        /// the three-argument form), when the evaluator is not the evaluator for
        /// the requirement's kind, when it returns no verdict, when it abstains
        /// although everything it needs was supplied, and when it throws.</para>
        /// </summary>
        /// <param name="evaluator">The implementation under test.</param>
        /// <param name="requirement">A requirement of the kind it answers, as a command declares it.</param>
        /// <param name="vantage">The sending command centre's id.</param>
        /// <returns>The verdict, for a caller that wants to assert on it.</returns>
        public static GateVerdict AssertAnswersForItsVantage(
            IVantageGateEvaluator evaluator, CommandRequirement requirement, string vantage)
        {
            Assert.NotNull(evaluator);
            Assert.NotNull(requirement);
            var name = evaluator.GetType().Name;

            Assert.True(
                requirement.NeedsVantage,
                "the requirement does not set NeedsVantage, so the host would call " + name
                + "'s two-argument Evaluate and never the one that reads the sender");
            Assert.True(
                evaluator.Kind == requirement.Kind,
                name + " resolves gate kind \"" + evaluator.Kind + "\" but was given a requirement of kind \""
                + requirement.Kind + "\"");

            var supplied = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var need in requirement.Needs ?? new string[0])
            {
                supplied[need] = "supplied";
            }

            GateVerdict? verdict = null;
            Exception? thrown = null;
            try
            {
                verdict = evaluator.Evaluate(requirement, new Arguments(supplied), vantage);
            }
            catch (Exception ex)
            {
                thrown = ex;
            }
            Assert.True(thrown == null, name + " threw instead of answering Unknown: " + thrown?.Message);
            Assert.True(verdict != null, name + " returned no verdict");
            Assert.True(
                verdict!.Outcome != GateOutcome.Abstain,
                name + " abstained although every argument and the vantage were supplied");
            return verdict;
        }

        private sealed class Arguments : IGateArguments
        {
            private readonly Dictionary<string, object> _values;

            public Arguments(Dictionary<string, object> values) => _values = values;

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }
    }
}
