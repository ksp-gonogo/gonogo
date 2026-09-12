using System.Collections.Generic;
using System.Globalization;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// ConfigNode round-trip for <see cref="RaChainRegister"/>: one child node per
    /// chained antenna, one grandchild per entry.
    ///
    /// <para><see cref="Load"/> restores INTO the caller's existing register
    /// rather than replacing it, so the scenario module can hold one register for
    /// the process and have OnLoad fill that same instance, which is what lets a
    /// command handler registered once at startup keep writing to the register the
    /// current save is in.</para>
    ///
    /// <para><b>The walk position goes in the save with the chain.</b> Without it
    /// a reload during an outage would restart the walk at the preferred target,
    /// which is the one already known not to be working, and would do it by
    /// slewing off whichever entry the craft had just settled on.</para>
    ///
    /// <para>Every value is written in invariant culture. A comma decimal
    /// separator would turn one coordinate into two values and the entry would
    /// load pointing somewhere else, the same hazard the target node itself
    /// carries.</para>
    /// </summary>
    internal static class RaChainPersistence
    {
        private const string RootNodeName = "REALANTENNAS_TARGET_CHAINS";
        private const string ChainNodeName = "CHAIN";
        private const string StepNodeName = "STEP";

        public static void Save(RaChainRegister register, ConfigNode node)
        {
            if (register == null || node == null)
            {
                return;
            }

            var root = node.AddNode(RootNodeName);
            foreach (var pair in register.Entries)
            {
                var chain = root.AddNode(ChainNodeName);
                chain.AddValue("antenna", pair.Key);
                if (pair.Value.RequestedSettleSeconds != null)
                {
                    chain.AddValue("settleSeconds", Text(pair.Value.RequestedSettleSeconds.Value));
                }
                if (pair.Value.Walk.ActiveStep != null)
                {
                    chain.AddValue("activeStep", pair.Value.Walk.ActiveStep.Value.ToString(CultureInfo.InvariantCulture));
                }
                if (pair.Value.Walk.LastAppliedUt != null)
                {
                    chain.AddValue("lastAppliedUt", Text(pair.Value.Walk.LastAppliedUt.Value));
                }
                chain.AddValue("laps", pair.Value.Walk.Laps.ToString(CultureInfo.InvariantCulture));

                foreach (var step in pair.Value.Steps)
                {
                    var stepNode = chain.AddNode(StepNodeName);
                    stepNode.AddValue("mode", step.Mode ?? "");
                    AddIfSet(stepNode, "vesselId", step.VesselId);
                    AddIfSet(stepNode, "bodyName", step.BodyName);
                    AddIfSet(stepNode, "latitude", step.Latitude);
                    AddIfSet(stepNode, "longitude", step.Longitude);
                    AddIfSet(stepNode, "altitude", step.Altitude);
                    AddIfSet(stepNode, "azimuth", step.Azimuth);
                    AddIfSet(stepNode, "elevation", step.Elevation);
                    AddIfSet(stepNode, "forward", step.Forward);
                }
            }
        }

        /// <summary>
        /// Reads the node back if it is there. A save from before this existed, or
        /// a new game, has none and the register is left as it was.
        ///
        /// <para>A chain whose node will not parse is SKIPPED rather than
        /// throwing. The cost of dropping one is that one antenna stops falling
        /// back, and the cost of throwing is the whole module's OnLoad, which
        /// would take every other chain with it.</para>
        /// </summary>
        public static void Load(RaChainRegister register, ConfigNode node)
        {
            var root = node?.GetNode(RootNodeName);
            if (register == null || root == null)
            {
                return;
            }

            foreach (var chain in root.GetNodes(ChainNodeName))
            {
                var antennaId = chain.GetValue("antenna");
                if (string.IsNullOrEmpty(antennaId))
                {
                    continue;
                }

                var steps = new List<RealAntennasTargetStepArgs>();
                foreach (var stepNode in chain.GetNodes(StepNodeName))
                {
                    var mode = stepNode.GetValue("mode");
                    if (string.IsNullOrEmpty(mode))
                    {
                        continue;
                    }
                    steps.Add(new RealAntennasTargetStepArgs
                    {
                        Mode = mode,
                        VesselId = Read(stepNode, "vesselId"),
                        BodyName = Read(stepNode, "bodyName"),
                        Latitude = ReadDouble(stepNode, "latitude"),
                        Longitude = ReadDouble(stepNode, "longitude"),
                        Altitude = ReadDouble(stepNode, "altitude"),
                        Azimuth = ReadDouble(stepNode, "azimuth"),
                        Elevation = ReadDouble(stepNode, "elevation"),
                        Forward = ReadDouble(stepNode, "forward"),
                    });
                }

                register.Restore(
                    antennaId,
                    steps,
                    ReadDouble(chain, "settleSeconds"),
                    ReadInt(chain, "activeStep"),
                    ReadDouble(chain, "lastAppliedUt"),
                    ReadInt(chain, "laps") ?? 0);
            }
        }

        private static void AddIfSet(ConfigNode node, string key, string? value)
        {
            if (!string.IsNullOrEmpty(value))
            {
                node.AddValue(key, value);
            }
        }

        /// <summary>
        /// Writes a nullable only when it has a value, so a field the mode does
        /// not read comes back absent rather than as a zero the plan would treat
        /// as a coordinate somebody asked for.
        /// </summary>
        private static void AddIfSet(ConfigNode node, string key, double? value)
        {
            if (value != null)
            {
                node.AddValue(key, Text(value.Value));
            }
        }

        private static string Text(double value) => value.ToString("R", CultureInfo.InvariantCulture);

        private static string? Read(ConfigNode node, string key)
        {
            var text = node.GetValue(key);
            return string.IsNullOrEmpty(text) ? null : text;
        }

        private static double? ReadDouble(ConfigNode node, string key)
        {
            var text = node.GetValue(key);
            if (string.IsNullOrEmpty(text))
            {
                return null;
            }
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                ? value
                : (double?)null;
        }

        private static int? ReadInt(ConfigNode node, string key)
        {
            var text = node.GetValue(key);
            if (string.IsNullOrEmpty(text))
            {
                return null;
            }
            return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
                ? value
                : (int?)null;
        }
    }
}
