using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The part tree of a saved craft file, read from its <c>PART</c> nodes into
    /// the same raw rows <c>KspHost.BuildTopology</c> writes for a loaded craft, so
    /// <c>Sitrep.Host.VesselPartsViewProvider</c> maps every source the same way.
    ///
    /// <para>Nothing is instantiated and no craft is loaded: a part's <c>pos</c>
    /// and <c>rot</c> are its saved position and orientation in the craft's frame,
    /// the same pair a <c>ProtoPartSnapshot</c> keeps, and its box is measured on
    /// the part's prefab with the saved variant's meshes
    /// (<see cref="ProtoVesselTopology.Measure"/>). A part this install does not
    /// have is left out.</para>
    /// </summary>
    internal static class CraftFileTopology
    {
        /// <summary>The craft's part rows, or null when the file has no parts this install knows.</summary>
        public static List<object?>? Build(ConfigNode? craft)
        {
            var nodes = craft?.GetNodes("PART");
            if (nodes == null || nodes.Length == 0)
            {
                return null;
            }

            var keys = new List<string>(nodes.Length);
            var links = new List<IReadOnlyList<string>>(nodes.Length);
            foreach (var node in nodes)
            {
                keys.Add(node.GetValue("part") ?? "");
                links.Add(node.GetValues("link"));
            }
            var parents = CraftFileTree.ParentIndices(keys, links);

            var rootPosition = CraftFileTree.ParseVector(nodes[0].GetValue("pos"), 3) ?? new double[3];
            var rootRotation = CraftFileTree.ParseVector(nodes[0].GetValue("rot"), 4) ?? new double[] { 0, 0, 0, 1 };

            var list = new List<object?>(nodes.Length);
            for (var i = 0; i < nodes.Length; i++)
            {
                try
                {
                    if (BuildPart(nodes[i], i, parents[i], rootPosition, rootRotation) is { } row)
                    {
                        list.Add(row);
                    }
                }
                catch (Exception ex)
                {
                    GonogoLog.WarnLimited("craft file topology read failed on \"" + keys[i] + "\", skipping", ex);
                }
            }

            return list.Count == 0 ? null : list;
        }

        private static Dictionary<string, object?>? BuildPart(ConfigNode node, int index, int parentIndex, double[] rootPosition, double[] rootRotation)
        {
            var name = CraftFileTree.PartName(node.GetValue("part"));
            var info = string.IsNullOrEmpty(name) ? null : PartLoader.getPartInfoByName(name);
            var prefab = info?.partPrefab;
            if (info == null || prefab == null)
            {
                return null;
            }

            var position = CraftFileTree.ParseVector(node.GetValue("pos"), 3);
            var rotation = CraftFileTree.ParseVector(node.GetValue("rot"), 4);
            if (position == null || rotation == null)
            {
                return null;
            }

            /* A launched vessel reports its parts in the root part's frame, with the root at the origin, so this does too. */
            var framed = CraftFileTree.InRootFrame(
                rootRotation, position[0] - rootPosition[0], position[1] - rootPosition[1], position[2] - rootPosition[2]);
            var box = ProtoVesselTopology.Measure(info.name, prefab, VariantOf(node));
            var orientation = new Quaternion((float)rotation[0], (float)rotation[1], (float)rotation[2], (float)rotation[3]);

            var modules = new List<object?>();
            foreach (var module in node.GetNodes("MODULE"))
            {
                var moduleName = module.GetValue("name");
                if (!string.IsNullOrEmpty(moduleName))
                {
                    modules.Add(moduleName);
                }
            }

            var resources = new Dictionary<string, object?>();
            foreach (var resource in node.GetNodes("RESOURCE"))
            {
                var resourceName = resource.GetValue("name");
                if (string.IsNullOrEmpty(resourceName))
                {
                    continue;
                }
                resources[resourceName] = new Dictionary<string, object?>
                {
                    ["amount"] = Number(resource.GetValue("amount")),
                    ["maxAmount"] = Number(resource.GetValue("maxAmount")),
                };
            }

            return new Dictionary<string, object?>
            {
                ["id"] = (index + 1).ToString(CultureInfo.InvariantCulture),
                ["parentId"] = parentIndex >= 0 ? (parentIndex + 1).ToString(CultureInfo.InvariantCulture) : null,
                ["name"] = info.name,
                ["title"] = info.title,
                ["position"] = framed,
                ["up"] = InRootFrameArray(rootRotation, orientation * Vector3.up),
                ["forward"] = InRootFrameArray(rootRotation, orientation * Vector3.forward),
                ["bounds"] = new Dictionary<string, object?>
                {
                    ["size"] = Vec3Array(box.Size),
                    ["center"] = box.HasMesh ? Vec3Array(box.Center) : null,
                },
                ["dryMass"] = (double)prefab.mass + Number(node.GetValue("modMass")),
                ["inverseStage"] = (int)Number(node.GetValue("istg"), -1),
                ["maxTemp"] = (double)prefab.maxTemp,
                ["skinMaxTemp"] = prefab.skinMaxTemp > 0 ? prefab.skinMaxTemp : (double?)null,
                ["category"] = info.category.ToString(),
                ["categoryOrdinal"] = (int)info.category,
                ["modules"] = modules,
                ["resources"] = resources,
            };
        }

        /// <summary>The variant the part was saved with, from its part-variants module, or null when it has none.</summary>
        private static string? VariantOf(ConfigNode part)
        {
            foreach (var module in part.GetNodes("MODULE"))
            {
                if (module.GetValue("name") == "ModulePartVariants")
                {
                    return module.GetValue("selectedVariant");
                }
            }
            return null;
        }

        private static double Number(string? text, double fallback = 0.0) =>
            double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : fallback;

        private static double[] InRootFrameArray(double[] rootRotation, Vector3 v) =>
            CraftFileTree.InRootFrame(rootRotation, v.x, v.y, v.z);

        private static double[] Vec3Array(Vector3 v) => new double[] { v.x, v.y, v.z };
    }
}
