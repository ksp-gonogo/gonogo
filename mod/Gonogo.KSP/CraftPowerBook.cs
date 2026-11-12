using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Every craft's power as <see cref="CraftPower"/> rules it, read once a frame
    /// for every link reader: the active craft's connectivity, the fleet's, the
    /// stock route solves and the live link graph. A craft that is not loaded is
    /// read from its saved parts, which is the charge the game holds for it.
    ///
    /// <para>Reads no craft unless the save's "Vessel telemetry requires vessel charge" setting is
    /// on, so with it off every reader leaves the link to the network.</para>
    ///
    /// <para>Main thread only.</para>
    /// </summary>
    internal sealed class CraftPowerBook
    {
        internal static readonly CraftPowerBook Shared = new CraftPowerBook();

        private const string ElectricCharge = "ElectricCharge";

        private readonly CraftPower _rule = new CraftPower();
        private readonly Dictionary<Guid, bool?> _powered = new Dictionary<Guid, bool?>();
        private readonly HashSet<CommNode> _unpoweredNodes = new HashSet<CommNode>();
        private readonly HashSet<string> _present = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> _traced = new HashSet<string>(StringComparer.Ordinal);
        private int _frame = -1;
        private bool _noGame;

        /// <summary>Whether <paramref name="vessel"/> is powered; null when its charge cannot be read or it holds no electric charge storage.</summary>
        internal bool? Powered(Vessel? vessel)
        {
            if (vessel == null)
            {
                return null;
            }
            Refresh();
            return _powered.TryGetValue(vessel.id, out var powered) ? powered : null;
        }

        /// <summary>Every craft read as unpowered this frame, as <c>vessel:&lt;guid&gt;</c>.</summary>
        internal List<string> UnpoweredIds()
        {
            Refresh();
            var ids = new List<string>();
            foreach (var entry in _powered)
            {
                if (entry.Value == false)
                {
                    ids.Add("vessel:" + entry.Key);
                }
            }
            return ids;
        }

        /// <summary>Whether <paramref name="node"/> is the radio of a craft with no power, which neither links nor relays.</summary>
        internal bool IsUnpowered(CommNode? node)
        {
            if (node == null)
            {
                return false;
            }
            Refresh();
            return _unpoweredNodes.Contains(node);
        }

        private void Refresh()
        {
            if (_noGame)
            {
                return;
            }
            int frame;
            try
            {
                frame = Time.frameCount;
            }
            catch (Exception)
            {
                // No Unity runtime to read a frame from, so no craft to read either.
                _noGame = true;
                return;
            }
            if (frame == _frame)
            {
                return;
            }
            _frame = frame;
            _powered.Clear();
            _unpoweredNodes.Clear();
            _present.Clear();
            if (!RuleOnInSave())
            {
                _rule.KeepOnly(_present);
                _traced.Clear();
                return;
            }
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return;
            }
            foreach (var vessel in vessels)
            {
                if (vessel == null)
                {
                    continue;
                }
                var id = vessel.id.ToString();
                _present.Add(id);
                bool? powered;
                try
                {
                    var (stored, capacity) = Charge(vessel);
                    powered = _rule.Powered(id, stored, capacity);
                }
                catch (Exception ex)
                {
                    GonogoLog.WarnLimited("CraftPowerBook could not read a craft's charge (no reading)", ex);
                    powered = _rule.Powered(id, null, null);
                }
                _powered[vessel.id] = powered;
                Trace(vessel, id, powered);
                if (powered == false && vessel.connection?.Comm is CommNode node)
                {
                    _unpoweredNodes.Add(node);
                }
            }
            _rule.KeepOnly(_present);
            _traced.RemoveWhere(id => !_present.Contains(id));
        }

        /// <summary>
        /// Whether a craft with no charge loses its link: the value an Uplink
        /// locked the setting at, otherwise the loaded save's choice. False with
        /// no lock and no save loaded or the setting unreadable, which leaves
        /// every link to the network as stock CommNet has it.
        /// </summary>
        internal static bool RuleOnInSave()
        {
            if (GonogoGameParameters.LockOn(Sitrep.Contract.CoreSettings.TelemetryRequiresCharge) is { } held)
            {
                return held.Value;
            }
            try
            {
                return HighLogic.CurrentGame?.Parameters?.CustomParams<GonogoGameParameters>()?.telemetryRequiresCharge == true;
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("CraftPowerBook could not read the \"Vessel telemetry requires vessel charge\" setting (off)", ex);
                return false;
            }
        }

        /// <summary>
        /// Says in the log, once per change, that a craft lost or regained the
        /// charge to run its radio, which is when its link to every centre is cut
        /// or comes back. Never per frame.
        /// </summary>
        private void Trace(Vessel vessel, string id, bool? powered)
        {
            var unpowered = powered == false;
            if (unpowered == _traced.Contains(id))
            {
                return;
            }
            if (unpowered)
            {
                _traced.Add(id);
            }
            else
            {
                _traced.Remove(id);
            }
            GonogoLog.Info(
                "link trace",
                GameWords.VesselName(vessel) + " (" + id + ") "
                + (unpowered
                    ? "has no electric charge: its link to every command centre is down"
                    : "has electric charge again: its link is the network's")
                + " at UT " + Planetarium.GetUniversalTime().ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
        }

        /// <summary>The electric charge the craft can draw and the most it can hold, or nulls when its parts cannot be read.</summary>
        private static (double? Stored, double? Capacity) Charge(Vessel vessel)
        {
            var stored = 0.0;
            var capacity = 0.0;
            if (vessel.loaded)
            {
                var parts = vessel.parts;
                if (parts == null)
                {
                    return (null, null);
                }
                foreach (var part in parts)
                {
                    var resources = part?.Resources;
                    if (resources == null)
                    {
                        continue;
                    }
                    foreach (PartResource res in resources)
                    {
                        if (res == null || res.resourceName != ElectricCharge)
                        {
                            continue;
                        }
                        capacity += res.maxAmount;
                        if (res.flowState)
                        {
                            stored += res.amount;
                        }
                    }
                }
                return (stored, capacity);
            }

            var snapshots = vessel.protoVessel?.protoPartSnapshots;
            if (snapshots == null)
            {
                return (null, null);
            }
            foreach (var snapshot in snapshots)
            {
                var resources = snapshot?.resources;
                if (resources == null)
                {
                    continue;
                }
                foreach (var res in resources)
                {
                    if (res == null || res.resourceName != ElectricCharge)
                    {
                        continue;
                    }
                    capacity += res.maxAmount;
                    if (res.flowState)
                    {
                        stored += res.amount;
                    }
                }
            }
            return (stored, capacity);
        }
    }
}
