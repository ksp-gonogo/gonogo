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
    /// <para>The backend here gives every link its own strength, and a path
    /// the least of its links, so the test can tell which hops were weighed
    /// and that they were not multiplied.</para>
    /// </summary>
    public class BelievedPathStrengthTests
    {
        private const double T0 = 1000.0;

        // The path is one of the topics every seated session already takes.
        private static readonly string[] Topics = { ContactPlanSource.SignalTopic, ContactPlanSource.DegradeTopic };

        private const double LanderToRelay = 0.9;
        private const double RelayToFarStation = 0.6;

        private static bool Between(string a, string b, string one, string other) => (a == one && b == other) || (a == other && b == one);

        private static ScriptedContactGame Game() => new ScriptedContactGame
        {
            LinkStrengths = (a, b) =>
                Between(a, b, ScriptedContactGame.Active, ScriptedContactGame.Relay) ? LanderToRelay
                : Between(a, b, ScriptedContactGame.Relay, ScriptedContactGame.Far) ? RelayToFarStation
                : 0.3,
        };

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

            // The lander reaches the far station through the relay: each hop carries its own link's strength.
            var hops = Hops(view);
            Assert.Equal(new double?[] { LanderToRelay, RelayToFarStation }, hops.Select(hop => hop.Strength).ToArray());
            // The least of the two, 0.6, where their product would be 0.54.
            const double worth = RelayToFarStation;
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

        private static ContactRadio ReportedOver(double strength, params RadioHop[] hops) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            strength,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 - strength },
            hops);

        private static List<(string Id, string Name)>? MeasuredPath(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.SignalTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            var path = doc.RootElement.GetProperty("measuredPath");
            if (path.ValueKind == JsonValueKind.Null)
            {
                return null;
            }
            return path.GetProperty("nodes").EnumerateArray().Select(n => (n.GetProperty("id").GetString()!, n.GetProperty("displayName").GetString()!)).ToList();
        }

        /// <summary>
        /// The backend here states no strength for any link, so the centre can
        /// work nothing out for the path it believes in. The radio reports on
        /// a path that is not that one: the centre is sent the radio's figure
        /// marked as being of another path, with the nodes of the path it was
        /// measured on and not the believed ones. The radio then reports
        /// through the relay, and the centre goes on being sent the first
        /// path until that reading has reached it, which is no sooner than
        /// light from the relay could.
        /// </summary>
        [Fact]
        public async Task ACentreSentAStrengthOfAnotherPathIsSentThePathItWasMeasuredOnAsOldAsTheStrength()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame());
            var home = world.Engine.HomeCentre();
            var (client, view) = await world.SitDownAtAsync(home, Topics);
            await using var seated = client;
            world.Game.Radio = ReportedOver(0.95, new RadioHop(ScriptedContactGame.ActiveGuid, "Outback Station", false));
            foreach (var ut in new[] { T0, T0 + 1.0, T0 + 5.0, T0 + 6.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            using (var doc = JsonDocument.Parse(view.Latest(ContactPlanSource.SignalTopic)!))
            {
                Assert.True(doc.RootElement.GetProperty("otherPath").GetBoolean(), "the centre was not told the figure is of another path");
            }
            var believedEnds = Hops(view).Select(hop => hop.To).ToList();
            var measured = MeasuredPath(view);
            Assert.NotNull(measured);
            Assert.Equal(new[] { ScriptedContactGame.ActiveGuid, "Outback Station" }, measured!.Select(node => node.Id).ToArray());
            Assert.DoesNotContain("Outback Station", believedEnds);
            Assert.Equal("Outback Station", measured[1].Name);

            // The radio now reports through the relay. That reading says something of the relay, so it reaches the centre no sooner than the relay's light.
            world.Game.Radio = ReportedOver(
                0.95,
                new RadioHop(ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid, true),
                new RadioHop(ScriptedContactGame.RelayGuid, "Outback Station", false));
            foreach (var ut in new[] { T0 + 10.0, T0 + 11.0, T0 + 20.0, T0 + 21.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(new[] { ScriptedContactGame.ActiveGuid, "Outback Station" }, MeasuredPath(view)!.Select(node => node.Id).ToArray());

            foreach (var ut in new[] { T0 + 700.0, T0 + 701.0, T0 + 702.0, T0 + 703.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            var later = MeasuredPath(view);
            Assert.NotNull(later);
            Assert.Equal(
                new[] { ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid, "Outback Station" },
                later!.Select(node => node.Id).ToArray());
            // The relay is named as the centre has heard it named.
            Assert.Equal("Relay", later[1].Name);
        }
    }
}
