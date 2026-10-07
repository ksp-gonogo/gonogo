using System;
using System.Reflection;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;

namespace ScaffoldProbeHost
{
    /// <summary>
    /// <c>ScaffoldProbeHost &lt;plugin.dll&gt;</c>
    ///
    /// Stands in for the game: loads one built Uplink plugin, finds it with the
    /// same assembly scan the mod runs at startup, registers it with a real
    /// <see cref="ChannelEngine"/> and serves the stream on a free port, ticking
    /// until its standard input closes. It prints <c>PORT &lt;n&gt;</c> once the
    /// stream is up, and exits 1 when the scan finds no Uplink in the assembly.
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args)
        {
            if (args.Length != 1)
            {
                Console.Error.WriteLine("usage: ScaffoldProbeHost <plugin.dll>");
                return 2;
            }

            var plugin = Assembly.LoadFrom(args[0]);
            var discovered = UplinkDiscovery.Discover(new[] { plugin }, Console.Error.WriteLine);
            if (discovered.Count == 0)
            {
                Console.Error.WriteLine("the Uplink scan found nothing in " + args[0]);
                return 1;
            }

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(Console.Error.WriteLine);
            engine.RegisterDiscoveredUplinks(discovered);
            engine.Start();
            Console.WriteLine("PORT " + engine.BoundPort);
            Console.Out.Flush();

            var stop = new ManualResetEventSlim(false);
            var input = new Thread(() =>
            {
                while (Console.In.ReadLine() != null)
                {
                }
                stop.Set();
            })
            { IsBackground = true };
            input.Start();

            var ut = 1000.0;
            while (!stop.Wait(100))
            {
                ut += 0.1;
                engine.Tick(ut, new KspSnapshot { Ut = ut });
            }
            return 0;
        }
    }
}
