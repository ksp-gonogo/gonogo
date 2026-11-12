using System;
using System.Collections.Generic;
using System.Text;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A craft's link home, read once for every consumer: the delivery ledger
    /// through <see cref="FleetChannels"/> and the <c>system.vessels</c> roster.
    ///
    /// <para>A loaded craft reports its own live connection. A craft that is not
    /// loaded is not asked what it last computed, because the game computes that
    /// once when the craft's module starts and again only when it is focused on a
    /// map: a route is solved afresh over the live graph to each home node, with
    /// the active backend's router, so a craft the graph reaches reads connected
    /// whatever its own cache says. A solve that ran and found no route is
    /// disconnected; a craft with no connection object, no active backend, or a
    /// solve that could not be asked has no reading (null). A craft with no
    /// electric charge is disconnected whatever the network says (see
    /// <see cref="CraftPower"/>).</para>
    ///
    /// <para>Main thread only.</para>
    /// </summary>
    internal sealed class FleetLinkReader
    {
        internal static readonly FleetLinkReader Shared = new FleetLinkReader();

        private static readonly PerfBudget SolveBudget = new PerfBudget(
            "FleetLinkReader route solves", threshold: 400, windowSec: 1.0, unit: "solves");

        private readonly FleetLinkCache _cache = new FleetLinkCache(windowSeconds: 5.0);
        private readonly Dictionary<string, string> _traced = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>The elected backend, resolved on each solve; null before the election.</summary>
        internal Func<ICommsBackend?> Backend { get; set; } = () => null;

        internal bool? Read(Vessel? vessel, SignalDelayConfig? config, double ut)
        {
            try
            {
                if (vessel == null)
                {
                    return null;
                }
                if (config != null && config.CutForNoCommsModel)
                {
                    return true;
                }
                var conn = vessel.connection;
                if (conn == null)
                {
                    return null;
                }
                var powered = CraftPowerBook.Shared.Powered(vessel);
                if (vessel.loaded)
                {
                    return CraftPower.Link(conn.IsConnected && !CommNetBackend.CrossesUnpowered(conn.ControlPath), powered);
                }
                var comm = conn.Comm;
                var backend = Backend();
                if (comm == null || backend == null)
                {
                    return null;
                }
                var id = vessel.id.ToString();
                var solve = _cache.Get(id, ut, () =>
                    FleetLinkReading.SolveUnloaded(HomeNodes(), home =>
                    {
                        SolveBudget.Record(1, ut);
                        return backend.RouteBetween(CommsNodeHandle.Of(comm), home);
                    }));
                Trace(vessel, id, solve);
                return CraftPower.Link(solve.Connected, powered);
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("FleetLinkReader failed (no reading)", ex);
                return null;
            }
        }

        private static List<CommsNodeHandle> HomeNodes()
        {
            var homes = new List<CommsNodeHandle>();
            var net = CommNetNetwork.Instance?.CommNet;
            if (net == null)
            {
                return homes;
            }
            for (var i = 0; i < net.Count; i++)
            {
                var node = net[i];
                if (node != null && node.isHome && CommsNodeHandle.Of(node) is { } handle)
                {
                    homes.Add(handle);
                }
            }
            return homes;
        }

        /// <summary>
        /// Says, when a craft that is not loaded changes what its solve finds, what
        /// the solve found: the home it reached over how many hops and how far, or
        /// that it found no route and what antennas the craft carries. Never per tick.
        /// </summary>
        private void Trace(Vessel vessel, string id, FleetLinkReading.LinkSolve solve)
        {
            var home = solve.Home?.As<CommNode>();
            var state = solve.Connected switch
            {
                true => "route to " + (home?.displayName ?? "a home node"),
                false => "no route",
                _ => "no reading",
            };
            if (_traced.TryGetValue(id, out var said) && said == state)
            {
                return;
            }
            _traced[id] = state;

            var line = new StringBuilder().Append(vessel.vesselName).Append(' ').Append(id.Substring(0, Math.Min(8, id.Length))).Append(" (unloaded): ");
            if (solve.Connected == true && solve.Hops != null)
            {
                var metres = 0.0;
                foreach (var hop in solve.Hops)
                {
                    metres += hop.DistanceMeters;
                }
                line.Append(state).Append(" over ").Append(solve.Hops.Count).Append(" hops, ").Append((metres / 1000.0).ToString("F1")).Append(" km");
            }
            else
            {
                line.Append(state).Append("; its own state reads connected=").Append(vessel.connection?.IsConnected).Append("; antennas: ").Append(AntennasOf(vessel));
            }
            GonogoLog.Info("link trace", line.ToString());
        }

        private static string AntennasOf(Vessel vessel)
        {
            var parts = vessel.protoVessel?.protoPartSnapshots;
            if (parts == null)
            {
                return "unreadable";
            }
            var found = new List<string>();
            foreach (var part in parts)
            {
                foreach (var module in part.modules)
                {
                    var name = module.moduleName;
                    if (!IsAntennaModule(name))
                    {
                        continue;
                    }
                    var condition = module.moduleValues.HasValue("Condition") ? module.moduleValues.GetValue("Condition") : "no condition";
                    found.Add(part.partInfo?.title + " (" + name + ", " + condition + ", " + DeployStateOf(part) + ")");
                }
            }
            return (found.Count == 0 ? "none" : string.Join("; ", found)) + "; electric charge " + ElectricChargeOf(parts).ToString("F1");
        }

        /// <summary>Whether a module name is a transmitter or an antenna of any comms mod, leaving out the deploy module that only moves one.</summary>
        private static bool IsAntennaModule(string name) =>
            name == "ModuleDataTransmitter" || (name.Contains("Antenna") && name != "ModuleDeployableAntenna");

        /// <summary>Whether the part's own deployable antenna module reads extended, as a comms mod counts an unloaded antenna: a part with no such module is always deployed.</summary>
        private static string DeployStateOf(ProtoPartSnapshot part)
        {
            var deploy = part.FindModule("ModuleDeployableAntenna");
            if (deploy == null)
            {
                return "not deployable, counts as deployed";
            }
            var state = deploy.moduleValues.HasValue("deployState") ? deploy.moduleValues.GetValue("deployState") : "no deployState";
            return state == "EXTENDED" ? "deployed" : "deployState " + state + ", counts as inactive";
        }

        private static double ElectricChargeOf(List<ProtoPartSnapshot> parts)
        {
            var total = 0.0;
            foreach (var part in parts)
            {
                foreach (var resource in part.resources)
                {
                    if (resource.resourceName == "ElectricCharge")
                    {
                        total += resource.amount;
                    }
                }
            }
            return total;
        }
    }
}
