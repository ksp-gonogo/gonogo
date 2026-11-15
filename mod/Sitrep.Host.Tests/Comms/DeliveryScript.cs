using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// One scripted flight for the delivery network: a home centre, a relay and
    /// a craft, the windows their plan predicts, the links the game really has,
    /// what is sent and when, and how far each tick moves the game. Running it
    /// returns everything a player could observe, each line with its game time.
    /// </summary>
    internal sealed class DeliveryScript
    {
        public const string Home = "ground:home";
        public const string Relay = "vessel:relay";
        public const string Craft = "vessel:craft";
        public const double Horizon = 400_000.0;
        private const double Step = 10_000.0;

        /// <summary>A pair's plain windows, as open and close instants.</summary>
        public Dictionary<(string, string), List<(double Open, double Close)>> Windows { get; } =
            new Dictionary<(string, string), List<(double, double)>>();

        /// <summary>The stretches a node could turn a dish to a peer in: node, peer, open, close.</summary>
        public List<(string Node, string Peer, double Open, double Close)> RetargetWindows { get; } =
            new List<(string, string, double, double)>();

        /// <summary>How much later than planned each real link comes up and goes down, in game seconds.</summary>
        public double LinkLag { get; set; }

        /// <summary>Whether a turned dish brings its link up at the next look at the game.</summary>
        public bool TurnsLink { get; set; } = true;

        /// <summary>The game time of each tick, ascending.</summary>
        public List<double> Ticks { get; } = new List<double>();

        /// <summary>The ticks a command is sent to the craft at.</summary>
        public HashSet<double> Commands { get; } = new HashSet<double>();

        /// <summary>The ticks the craft records telemetry for home at.</summary>
        public HashSet<double> Spans { get; } = new HashSet<double>();

        /// <summary>The signal delay of a link that ends at home, in game seconds.</summary>
        public double HomeLightSeconds { get; set; } = 2.0;

        /// <summary>The signal delay between the relay and the craft, in game seconds.</summary>
        public double NearLightSeconds { get; set; } = 0.5;

        /// <summary>How many clock callbacks the last run fired.</summary>
        public long CallbacksFired { get; private set; }

        /// <summary>How many clock callbacks a run may fire before it throws <see cref="InvalidOperationException"/>, for a script that might never finish.</summary>
        public long CallbackLimit { get; set; } = long.MaxValue;

        public bool HasRetargetWindows => RetargetWindows.Count > 0;

        private double Light(string a, string b) => a == Home || b == Home ? HomeLightSeconds : NearLightSeconds;

        private ContactPlan Plan()
        {
            var pairs = new List<PairPlan>();
            foreach (var pair in new[] { (Relay, Home), (Craft, Relay), (Craft, Home) })
            {
                var windows = Windows.TryGetValue(pair, out var list)
                    ? list.Select(w => new ContactWindow(w.Open, w.Close)).ToArray()
                    : new ContactWindow[0];
                var retargets = RetargetWindows
                    .Where(r => (r.Node == pair.Item1 && r.Peer == pair.Item2) || (r.Node == pair.Item2 && r.Peer == pair.Item1))
                    .Select(r => new RetargetWindow(r.Node, r.Node + "#dish", r.Peer, r.Open, r.Close))
                    .ToArray();
                var meters = Enumerable.Repeat(Light(pair.Item1, pair.Item2) * PairPlan.SpeedOfLight, (int)(Horizon / Step) + 1).ToArray();
                pairs.Add(new PairPlan(pair.Item1, pair.Item2, Horizon, windows, 0.0, Step, meters, retargets));
            }
            return new ContactPlan(0.0, Horizon, Step, pairs, 0, 0);
        }

        /// <summary>The links the game has, read once a tick, and the ones a turned dish holds.</summary>
        private sealed class Links : IDeliveryLinks
        {
            private readonly HashSet<(string, string)> _up = new HashSet<(string, string)>();
            private readonly DeliveryScript _script;

            public Links(DeliveryScript script) => _script = script;

            public HashSet<(string, string)> Turned { get; } = new HashSet<(string, string)>();

            public void Read(double ut)
            {
                var script = _script;
                _up.Clear();
                foreach (var pair in script.Windows)
                {
                    if (pair.Value.Any(w => ut >= w.Open + script.LinkLag && ut < w.Close + script.LinkLag))
                    {
                        _up.Add(pair.Key);
                    }
                }
                if (script.TurnsLink)
                {
                    _up.UnionWith(Turned);
                }
            }

            public double? LiveLink(string from, string to) =>
                _up.Contains((from, to)) || _up.Contains((to, from)) ? _script.Light(from, to) : (double?)null;

            public double? LivePath(string from, string to)
            {
                var direct = LiveLink(from, to);
                if (direct != null)
                {
                    return direct;
                }
                var first = LiveLink(from, Relay);
                var second = LiveLink(Relay, to);
                return first != null && second != null ? first + second : null;
            }
        }

        /// <summary>A clock that counts the callbacks it fires.</summary>
        private sealed class CountingClock : IClock
        {
            private readonly ManualClock _clock = new ManualClock();
            private readonly long _limit;

            public CountingClock(long limit) => _limit = limit;

            public long Fired { get; private set; }

            public double Now() => _clock.Now();

            public Action Schedule(double atUt, Action fn) => _clock.Schedule(atUt, () =>
            {
                if (++Fired > _limit)
                {
                    throw new InvalidOperationException("more than " + _limit + " clock callbacks fired, the last due at UT " + At(atUt) + " with the clock at " + At(_clock.Now()));
                }
                fn();
            });

            public void Reset(double ut) => _clock.Reset(ut);

            public void AdvanceTo(double ut) => _clock.AdvanceTo(ut);
        }

        private sealed class Beliefs : ISenderPlans
        {
            public IDeliveryRoutes? Plan { get; set; }

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => Plan;
        }

        private sealed class Actuator : IDishActuator
        {
            private readonly Links _links;
            private readonly List<string> _log;
            private int _records;

            public Actuator(Links links, List<string> log)
            {
                _links = links;
                _log = log;
            }

            public string? Turn(string node, string dishId, string peer, double ut)
            {
                _log.Add("turn " + dishId + " to " + peer + " at " + At(ut));
                _links.Turned.Add((node, peer));
                return (++_records) + "|" + node + "|" + peer;
            }

            public bool Restore(string recordId, double ut)
            {
                var parts = recordId.Split('|');
                _log.Add("restore " + parts[1] + "#dish from " + parts[2] + " at " + At(ut));
                _links.Turned.Remove((parts[1], parts[2]));
                return true;
            }
        }

        private static string At(double ut) => ut.ToString("0.###", CultureInfo.InvariantCulture);

        /// <summary>Runs the script and returns what happened, in the order it happened.</summary>
        /// <param name="wakesOnDishTurnWaits">Whether a message waiting on a dish turn wakes itself for the turn's link-up time.</param>
        public List<string> Run(bool wakesOnDishTurnWaits)
        {
            var log = new List<string>();
            var clock = new CountingClock(CallbackLimit);
            var links = new Links(this);
            var beliefs = new Beliefs
            {
                Plan = new PlanRoutes(Plan(), 1.0, null, null, HasRetargetWindows ? new RetargetRouting(2.0, 10.0) : null),
            };
            var network = new DeliveryNetwork(
                clock,
                links,
                new PlanRoutes(null),
                (command, ut) =>
                {
                    log.Add("command " + command.LaneSeq + " ran at " + At(ut));
                    return "done";
                },
                report => log.Add(
                    "report " + report.Kind + " of command " + report.LaneSeq + " from " + report.At + " said at " + At(report.AtUt)
                    + " landed at " + At(report.LandedUt) + (report.UntilUt == null ? "" : " until " + At(report.UntilUt.Value))
                    + (report.Detail == null ? "" : " (" + report.Detail + ")")),
                beliefs: beliefs,
                deliverSpan: (span, ut) => log.Add("telemetry " + span.Topic + " of " + span.Samples.Count + " samples landed at " + At(ut)));
            network.SetRetargeting(new Actuator(links, log), new RetargetOptions());
            DeliveryNetworkSeams.WakeOnDishTurnWaits(network, wakesOnDishTurnWaits);

            var lane = new LaneKey(1, Home, Craft);
            foreach (var ut in Ticks)
            {
                links.Read(ut);
                clock.AdvanceTo(ut);
                network.Tick(ut);
                var sent = false;
                if (Commands.Contains(ut))
                {
                    network.SendCommand(lane, "c", null, "system", null, ut, null);
                    sent = true;
                }
                if (Spans.Contains(ut))
                {
                    network.AddSpan(Craft, new SpanMessage
                    {
                        Craft = Craft, Centre = Home, Topic = "telemetry", Samples = { new SpanSample(ut, new SpanPayload()) },
                    });
                    sent = true;
                }
                for (var pass = 0; sent && pass < 4; pass++)
                {
                    network.Tick(ut);
                    clock.AdvanceTo(ut);
                }
            }
            CallbacksFired = clock.Fired;
            log.Add("left held: " + string.Join(", ", network.HeldMessages().Select(h => h.Node + " " + h.Message.GetType().Name).OrderBy(x => x, StringComparer.Ordinal)));
            return log;
        }

        /// <summary>A script made from <paramref name="seed"/>: the same seed always makes the same one.</summary>
        /// <param name="retargets">Whether the plan holds stretches a dish could be turned in.</param>
        /// <param name="warp">Whether some stretches skip more than a second a tick.</param>
        public static DeliveryScript From(int seed, bool retargets, bool warp = true)
        {
            var random = new Random(seed);
            var script = new DeliveryScript
            {
                LinkLag = random.Next(3) == 0 ? random.Next(1, 40) : 0.0,
                TurnsLink = random.Next(4) != 0,
            };

            List<(double, double)> Passes(double chance)
            {
                var windows = new List<(double, double)>();
                if (random.NextDouble() < chance)
                {
                    windows.Add((0.0, Horizon));
                    return windows;
                }
                var at = random.Next(0, 400);
                while (at < Horizon)
                {
                    var open = at + random.Next(20, 4000);
                    var close = open + random.Next(5, 3000);
                    windows.Add((open, close));
                    at = (int)close;
                }
                return windows;
            }

            script.Windows[(Relay, Home)] = Passes(0.5);
            if (random.Next(2) == 0)
            {
                script.Windows[(Craft, Home)] = Passes(0.0);
            }
            if (!retargets || random.Next(2) == 0)
            {
                script.Windows[(Craft, Relay)] = Passes(0.1);
            }
            if (retargets)
            {
                foreach (var (node, peer) in new[] { (Craft, Relay), (Relay, Craft) })
                {
                    var at = (double)random.Next(0, 600);
                    while (at < Horizon)
                    {
                        var open = at + random.Next(10, 3000);
                        var close = open + random.Next(30, 20_000);
                        script.RetargetWindows.Add((node, peer, open, close));
                        at = close;
                    }
                }
            }

            // A stretch at one second a tick, a stretch of warp, and one second a tick again, three times over.
            var ut = 0.0;
            var steps = new[] { 1.0, 5.0, 50.0, 500.0, 5000.0, 21_600.0 };
            for (var round = 0; round < 3; round++)
            {
                for (var i = random.Next(40, 400); i > 0; i--)
                {
                    script.Ticks.Add(ut += 1.0);
                }
                var step = warp ? steps[random.Next(steps.Length)] : 1.0;
                for (var i = random.Next(1, 12); i > 0 && ut + step < Horizon - 1000.0; i--)
                {
                    script.Ticks.Add(ut += step);
                }
            }
            for (var i = 0; i < 300; i++)
            {
                script.Ticks.Add(ut += 1.0);
            }

            foreach (var tick in script.Ticks)
            {
                if (random.Next(60) == 0)
                {
                    script.Commands.Add(tick);
                }
                if (random.Next(25) == 0)
                {
                    script.Spans.Add(tick);
                }
            }
            return script;
        }
    }
}
