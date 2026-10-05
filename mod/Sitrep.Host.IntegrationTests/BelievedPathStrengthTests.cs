using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command centre is sent the strength of the path it believes in. Each
    /// believed hop carries what the comms backend says that hop is worth, from
    /// the link model the centre heard with the craft's state, and the signal
    /// is the backend's combination of them, marked as worked out. Where the
    /// craft's radio has reported on that very path, the measured strength is
    /// sent, unmarked.
    ///
    /// <para>The backend here says every link is worth 0.5.</para>
    /// </summary>
    public class BelievedPathStrengthTests
    {
        private const double T0 = 1000.0;

        // The path is one of the topics every seated session already takes.
        private static readonly string[] Topics = { ContactPlanSource.SignalTopic, ContactPlanSource.DegradeTopic };

        private static ScriptedContactGame Game() => new ScriptedContactGame { LinkStrengths = (a, b) => 0.5 };

        private static (double Strength, bool Modelled)? Signal(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.SignalTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            return (doc.RootElement.GetProperty("strength").GetDouble(), doc.RootElement.GetProperty("modelled").GetBoolean());
        }

        private static List<(string From, string To, double? Strength)> Hops(CentreView view)
        {
            var hops = new List<(string, string, double?)>();
            var payload = view.Latest(ContactPlanSource.PathTopic);
            if (payload == null)
            {
                return hops;
            }
            using var doc = JsonDocument.Parse(payload);
            foreach (var hop in doc.RootElement.GetProperty("hops").EnumerateArray())
            {
                var strength = hop.TryGetProperty("strength", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetDouble() : (double?)null;
                hops.Add((hop.GetProperty("from").GetString()!, hop.GetProperty("to").GetString()!, strength));
            }
            return hops;
        }

        private static ContactRadio Reported(double strength, IEnumerable<(string From, string To)> hops) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            strength,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 - strength },
            hops.Select(h => new RadioHop(h.From, h.To, false)).ToArray());

        [Fact]
        public async Task ACentreIsSentWhatItsOwnBelievedPathIsWorthMarkedAsWorkedOutUntilTheRadioReportsOnThatPath()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(Game());
            var home = world.Engine.HomeCentre();
            var (client, view) = await world.SitDownAtAsync(home, Topics);
            await using var seated = client;
            foreach (var ut in new[] { T0, T0 + 1.0, T0 + 5.0, T0 + 6.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            var hops = Hops(view);
            Assert.NotEmpty(hops);
            Assert.All(hops, hop => Assert.NotNull(hop.Strength));
            var worth = hops.Min(hop => hop.Strength!.Value);
            var signal = Signal(view);
            Assert.NotNull(signal);
            Assert.Equal(worth, signal!.Value.Strength, 6);
            Assert.True(signal.Value.Modelled, "a strength worked out for the believed path was sent as though it were measured");

            // The radio reports on another path altogether: the centre goes on being told what its own path is worth.
            world.Game.Radio = Reported(0.95, new[] { ("somewhere", "else") });
            foreach (var ut in new[] { T0 + 10.0, T0 + 11.0, T0 + 20.0, T0 + 21.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(worth, Signal(view)!.Value.Strength, 6);
            Assert.True(Signal(view)!.Value.Modelled);

            // The radio reports on the very path the centre believes in: the measured strength is what it is told.
            world.Game.Radio = Reported(0.95, hops.Select(h => (h.From, h.To)));
            foreach (var ut in new[] { T0 + 30.0, T0 + 31.0, T0 + 40.0, T0 + 41.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(0.95, Signal(view)!.Value.Strength, 6);
            Assert.False(Signal(view)!.Value.Modelled);
        }
    }
}
