using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.IntegrationTests;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace UplinkRoutingProbe
{
    /// <summary>
    /// <c>UplinkRoutingProbe [--refs &lt;dir&gt;]... &lt;plugin.dll&gt;...</c>
    ///
    /// For each plugin: registers the Uplink with a real <see cref="ChannelEngine"/>
    /// through the mod's own <see cref="UplinkDiscovery"/>, then for every topic it
    /// declared (static channels, and a sample key under each dynamic namespace, and the Subject of each command)
    /// checks that the engine routes it to a placed node and that a client
    /// subscribed to it is sent a reading. Prints one line per topic and exits 1
    /// when any fails or a plugin cannot be probed.
    ///
    /// <para>The vessel a namespace key belongs to is plugin runtime state (kOS
    /// maps a CPU to its craft from the live game), so a namespace that declares
    /// <see cref="ChannelDeclaration.PerVesselNode"/> is given a fixed resolver:
    /// what is under test is how the engine routes the declared topic shapes, not
    /// the plugin's own map.</para>
    /// </summary>
    public static class Program
    {
        private const string ProbeVessel = "probe-vessel";
        private static readonly TimeSpan Op = TimeSpan.FromSeconds(10);

        public static async Task<int> Main(string[] args)
        {
            var refs = new List<string>();
            var plugins = new List<string>();
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i] == "--refs" && i + 1 < args.Length)
                {
                    refs.Add(args[++i]);
                }
                else
                {
                    plugins.Add(args[i]);
                }
            }
            if (plugins.Count == 0)
            {
                Console.Error.WriteLine("usage: UplinkRoutingProbe [--refs <dir>]... <plugin.dll>...");
                return 2;
            }

            var searchDirs = plugins.Select(p => Path.GetDirectoryName(Path.GetFullPath(p))!).Concat(refs).ToList();
            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
            {
                var name = new AssemblyName(e.Name).Name + ".dll";
                foreach (var dir in searchDirs)
                {
                    var candidate = Path.Combine(dir, name);
                    if (File.Exists(candidate))
                    {
                        return Assembly.LoadFrom(candidate);
                    }
                }
                return null;
            };

            var failures = 0;
            foreach (var plugin in plugins)
            {
                failures += await ProbeAsync(plugin);
            }
            Console.WriteLine(failures == 0 ? "routing probe: all declared topics route and deliver" : $"routing probe: {failures} failure(s)");
            return failures == 0 ? 0 : 1;
        }

        private static async Task<int> ProbeAsync(string pluginPath)
        {
            var label = Path.GetFileNameWithoutExtension(pluginPath);
            IReadOnlyList<UplinkDiscovery.DiscoveredUplink> discovered;
            try
            {
                discovered = UplinkDiscovery.Discover(new[] { Assembly.LoadFrom(pluginPath) }, _ => { });
            }
            catch (Exception ex)
            {
                return Fail(label, "-", "cannot load the plugin: " + ex.Message);
            }
            if (discovered.Count == 0)
            {
                return Fail(label, "-", "the Uplink scan found nothing in the assembly");
            }
            var unloadable = discovered.FirstOrDefault(d => d.LoadFailure != null);
            if (unloadable.LoadFailure != null)
            {
                return Fail(label, "-", "cannot load the Uplink: " + unloadable.LoadFailure);
            }

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            var log = new List<string>();
            engine.SetDiagnosticLog(log.Add);
            engine.RegisterDiscoveredUplinks(discovered);
            engine.Start();

            var failures = 0;
            var topics = new List<(string Topic, string? Prefix, string? SubTopic)>();
            foreach (var d in discovered)
            {
                var id = d.Uplink!.Manifest.Id;
                if (!engine.IsUplinkRunning(id))
                {
                    /* Register needs the running game for most Uplinks, so this is the
                       expected state; the namespaces the manifest lists are registered
                       before Register runs and are probed all the same. */
                    Console.WriteLine($"note {label}: {id} is not running here: {string.Join(" | ", log.Where(l => l.Contains("\"" + id + "\"") && l.Contains("UNAVAILABLE")).Take(1))}");
                }
                foreach (var channel in d.Uplink!.Manifest.Channels)
                {
                    topics.Add((channel.Topic, null, null));
                }
                foreach (var command in d.Uplink!.Manifest.Commands.Where(c => !string.IsNullOrEmpty(c.Subject)))
                {
                    topics.Add((System.Text.RegularExpressions.Regex.Replace(command.Subject!, @"\{[^}]*\}", "1"), null, null));
                }
            }
            foreach (var ns in engine.DynamicNamespaceTemplates)
            {
                if (ns.Value.PerVesselNode)
                {
                    ns.Value.VesselIdForKey = _ => ProbeVessel;
                }
                topics.Add((ns.Key + "1", ns.Key, "1"));
                topics.Add((ns.Key + "1.sample", ns.Key, "1.sample"));
            }
            if (topics.Count == 0)
            {
                Console.WriteLine($"note {label}: declares no channel, Subject or namespace, so there is nothing to route");
                return failures;
            }

            engine.SetVesselDelay(ProbeVessel, 0.0);
            await using var client = await TestClient.ConnectAsync(engine.BoundPort, Op);
            var ut = 1000.0;
            foreach (var (topic, prefix, subTopic) in topics)
            {
                var node = engine.NodeFor(topic);
                if (node == ChannelEngine.UnplacedLensNode)
                {
                    failures += Fail(label, topic, "routes to the unplaced node, so its readings are held and never delivered");
                    continue;
                }
                if (prefix == null)
                {
                    Console.WriteLine($"ok   {label,-28} {topic,-40} -> {node}");
                    continue;
                }
                try
                {
                    await SubscribeAsync(client, topic, Op);
                    ut += 1;
                    engine.DynamicSourceFor(prefix).Publisher(subTopic!).Publish(new Dictionary<string, object?> { ["probe"] = 1 }, ut);
                    engine.TickAndWait(ut + 0.5, new KspSnapshot { Ut = ut + 0.5 }, Op);
                    var reading = await ReceiveStreamDataAsync(client, Op);
                    if (reading.Topic != topic)
                    {
                        failures += Fail(label, topic, "a reading for " + reading.Topic + " arrived instead");
                        continue;
                    }
                    Console.WriteLine($"ok   {label,-28} {topic,-40} -> {node}, delivered");
                }
                catch (Exception ex)
                {
                    failures += Fail(label, topic, "placed on " + node + " but no reading was delivered: " + ex.GetType().Name + ": " + ex.Message);
                }
            }
            return failures;
        }

        private static int Fail(string plugin, string topic, string why)
        {
            Console.WriteLine($"FAIL {plugin,-28} {topic,-40} {why}");
            return 1;
        }
    }
}
