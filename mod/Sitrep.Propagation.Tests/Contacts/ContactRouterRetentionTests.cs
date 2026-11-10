using System;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Propagation.Tests.Contacts
{
    /// <summary>
    /// A plan is replaced about once a second in flight, so anything the router keeps
    /// per plan outlives it for the whole session unless it lives on the plan itself.
    /// Unity's Mono collector holds a ConditionalWeakTable's keys strongly, so a
    /// static weak table keyed by plan kept every plan ever routed.
    /// </summary>
    public class ContactRouterRetentionTests
    {
        private const double Step = 10.0;
        private const double Horizon = 3600.0;

        [Fact]
        public void APlanThatHasBeenRoutedCanBeCollected()
        {
            var plans = Enumerable.Range(0, 50).Select(_ => RouteOnce()).ToArray();

            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            Assert.DoesNotContain(plans, plan => plan.IsAlive);
        }

        [Fact]
        public void TheRouterHoldsNoStaticStateBeyondConstants()
        {
            var held = typeof(ContactRouter)
                .GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .Where(field => !field.IsLiteral)
                .Select(field => field.Name)
                .ToArray();

            Assert.Empty(held);
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static WeakReference RouteOnce()
        {
            var plan = Plan();
            Assert.NotNull(ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0));
            return new WeakReference(plan);
        }

        private static ContactPlan Plan()
        {
            var distances = Enumerable.Repeat(PairPlan.SpeedOfLight, (int)(Horizon / Step) + 1).ToArray();
            var pair = new PairPlan("ground:a", "vessel:b", Horizon, new[] { new ContactWindow(null, null) }, 0.0, Step, distances);
            return new ContactPlan(0.0, Horizon, Step, new[] { pair }, 0, 0);
        }
    }
}
