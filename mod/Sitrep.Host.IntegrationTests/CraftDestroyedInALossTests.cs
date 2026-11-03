using System.Text.Json;
using Sitrep.Contract;
using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The active craft is destroyed while it has no link. The game drops it at
    /// once, but what a centre learns of a craft is what light carries from it,
    /// so the centre's link, path and delay stay as they were and its loss
    /// stays a loss.
    /// </summary>
    public class CraftDestroyedInALossTests
    {
        private const string Home = ScriptedContactGame.Home;

        private static readonly string[] Topics =
        {
            ContactPlanSource.DelayTopic, ContactPlanSource.NextLossTopic,
        };

        private static string Basis(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Latest(ContactPlanSource.NextLossTopic)!);
            return doc.RootElement.GetProperty("basis").ToString();
        }

        private static string Hops(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Path!);
            return string.Join(",", System.Linq.Enumerable.Select(
                doc.RootElement.GetProperty("hops").EnumerateArray(),
                h => h.GetProperty("from").GetString() + ">" + h.GetProperty("to").GetString()));
        }

        private static double Seconds(string delay)
        {
            using var doc = JsonDocument.Parse(delay);
            var seconds = doc.RootElement.GetProperty("oneWaySeconds");
            return seconds.ValueKind == JsonValueKind.Null ? double.NaN : seconds.GetDouble();
        }

        [Fact]
        public async Task ACraftDestroyedDuringALossLeavesTheCentresLinkReadingsAsTheyWere()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Game.TracksBySight = false;
            var (client, view) = await world.SitDownAtAsync(Home, Topics);
            await using var seated = client;
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            world.Game.ActiveConnected = false;
            world.Game.ActiveListedLink = false;
            world.Game.Radio = new ContactRadio(
                ScriptedContactGame.Active,
                false,
                0.0,
                new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 },
                new RadioHop[0]);
            foreach (var ut in new[] { 703.0, 704.0, 705.0, 706.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            var before = (
                Delay: view.Latest(ContactPlanSource.DelayTopic),
                Hops: Hops(view),
                Centre: view.CommandCentre,
                Basis: Basis(view));

            world.Game.ActiveDestroyed = true;
            foreach (var ut in new[] { 707.0, 708.0, 709.0, 710.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.Equal(Seconds(before.Delay!), Seconds(view.Latest(ContactPlanSource.DelayTopic)!), 0);
            Assert.Equal(before.Hops, Hops(view));
            Assert.Equal(before.Centre, view.CommandCentre);
            Assert.Equal(before.Basis, Basis(view));
        }
    }
}
