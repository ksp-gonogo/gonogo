using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command centre knows, after a load, what it knew when the game was
    /// saved, the facts the comms backend states for each hop of the path it
    /// believes in included, and not only after each craft has been heard from
    /// again a light-time later.
    /// </summary>
    public class ColdLoadHopFactsTests
    {
        private static ScriptedContactGame Game() => new ScriptedContactGame { LinkStrengths = (a, b) => 0.7 };

        private static string?[] HopFacts(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.PathTopic);
            if (payload == null)
            {
                return new string?[0];
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("hops").EnumerateArray()
                .Select(hop => hop.TryGetProperty("extensions", out var e) && e.ValueKind == JsonValueKind.Object ? e.GetRawText() : null)
                .ToArray();
        }

        [Fact]
        public async Task AfterALoadTheBelievedPathCarriesItsHopFactsBeforeAnyCraftIsHeardFromAgain()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(Game());
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var kernel = world.Engine.Kernel;
            var saved = HeardSnapshotCodec.Decode(
                HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!),
                (model, data) => CommsElection.RestoreLinkStrength(kernel, model, data));

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            world.Tick(703.0);
            world.Tick(704.0);
            await world.SettleAsync();
            var (client, view) = await world.SitDownAtAsync(world.Engine.HomeCentre());
            await using var seated = client;
            world.Tick(705.0);
            world.Tick(706.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            var facts = HopFacts(view);
            Assert.NotEmpty(facts);
            Assert.All(facts, hop => Assert.Contains("scripted", hop ?? ""));
        }
    }
}
