using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command accepted with no route planned says so only when the centre holds
    /// a plan that has none. A centre that has not planned yet has said nothing.
    /// </summary>
    public class NoRouteWarningTests
    {
        private const string Home = ScriptedContactGame.Home;

        private static async Task<string?> WarningWith(ContactPlan? plan)
        {
            await using var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame(0.0));
            world.Engine.SetCentrePlans(_ => plan, () => 1);
            world.Tick(1.0);
            world.Tick(2.0);

            string? warning = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.LightsCommand,
                new Dictionary<string, object?> { ["enabled"] = true },
                Home,
                _ => { },
                TestBudgets.Op,
                onWarned: text => warning = text);
            return warning;
        }

        [Fact]
        public async Task ACentreHoldingNoPlanYetCarriesNoWarning()
        {
            Assert.Null(await WarningWith(null));
        }

        [Fact]
        public async Task ACentreWhosePlanHasNoRouteIsWarned()
        {
            var empty = new ContactPlan(0.0, 100000.0, 60.0, new List<PairPlan>(), 0, 0);

            Assert.Contains("no route to the craft", await WarningWith(empty));
        }
    }
}
