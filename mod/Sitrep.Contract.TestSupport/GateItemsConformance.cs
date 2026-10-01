using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What an <see cref="ICommandGateItems"/> owes the gate report that samples
    /// it: items that can actually be asked about, each answered the way a
    /// dispatch naming it would be answered.
    /// </summary>
    public static class GateItemsConformance
    {
        /// <summary>
        /// Asks <paramref name="items"/> for every item of <paramref name="requirement"/>
        /// and evaluates each one, as the gate report does.
        ///
        /// <para>Fails when the requirement does not name exactly one need (the
        /// report keys items on one argument and asks nothing else), when the
        /// implementation is not also the <see cref="ICommandGateEvaluator"/> for
        /// that kind, when an item is empty or named twice, and when an item's
        /// verdict is missing or an Abstain: the argument was supplied, so there
        /// is nothing left to abstain on.</para>
        /// </summary>
        /// <param name="items">The implementation under test, which is also its kind's evaluator.</param>
        /// <param name="requirement">A requirement of the kind it answers, as a command declares it.</param>
        /// <returns>The items it named, for a caller that wants to assert on them.</returns>
        public static IReadOnlyList<string> AssertItemsAreAskable(ICommandGateItems items, CommandRequirement requirement)
        {
            Assert.NotNull(items);
            Assert.NotNull(requirement);
            var name = items.GetType().Name;

            Assert.True(
                requirement.Needs != null && requirement.Needs.Length == 1,
                "a requirement whose items are sampled names exactly one need: the gate report keys "
                + "each item on that one argument, and a requirement needing more would abstain on every item");
            var evaluator = items as ICommandGateEvaluator;
            Assert.True(
                evaluator != null && evaluator.Kind == requirement.Kind,
                name + " names items for gate kind \"" + requirement.Kind + "\" but is not that kind's "
                + "evaluator, so nothing would ever be asked about them");

            var named = items.Items(requirement);
            Assert.True(named != null, name + ".Items returned null; return an empty sequence when there are none");

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var asked = new List<string>();
            foreach (var value in named!)
            {
                Assert.False(string.IsNullOrEmpty(value), name + ".Items named an empty item, which no call can send");
                Assert.True(seen.Add(value), name + ".Items named \"" + value + "\" twice");
                asked.Add(value);

                var verdict = evaluator!.Evaluate(requirement, new OneArgument(requirement.Needs![0], value));
                Assert.True(verdict != null, name + " returned no verdict for \"" + value + "\"");
                Assert.True(
                    verdict!.Outcome != GateOutcome.Abstain,
                    name + " abstained on \"" + value + "\" although its one argument was supplied");
            }
            return asked;
        }

        private sealed class OneArgument : IGateArguments
        {
            private readonly string _path;
            private readonly string _value;

            public OneArgument(string path, string value)
            {
                _path = path;
                _value = value;
            }

            public bool TryGet(string path, out object value)
            {
                value = _value;
                return string.Equals(path, _path, StringComparison.Ordinal);
            }
        }
    }
}
