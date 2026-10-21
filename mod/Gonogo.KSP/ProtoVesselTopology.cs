using System;
using System.Collections.Generic;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The part tree of an unloaded craft, read from its saved
    /// <c>ProtoPartSnapshot</c>s into the same raw rows
    /// <c>KspHost.BuildTopology</c> writes for a loaded one, so
    /// <c>Sitrep.Host.VesselPartsViewProvider</c> maps both the same way.
    ///
    /// <para>A snapshot's <c>position</c> and <c>rotation</c> are the part's
    /// <c>orgPos</c> and <c>orgRot</c>, saved as-is, so placement and axes are
    /// exact. The box is not: an unloaded part has no model of its own, so it is
    /// measured on the part's prefab, which is the default variant. Temperatures,
    /// flow rates, module states, action bindings and fuel-line targets need the
    /// live part and are left out.</para>
    /// </summary>
    internal static class ProtoVesselTopology
    {
        private struct PrefabBox
        {
            public bool HasMesh;
            public Vector3 Center;
            public Vector3 Size;
        }

        /* Main-thread only. A prefab's box never changes in a session, and measuring one walks every renderer under its model. */
        private static readonly Dictionary<string, PrefabBox> PrefabBoxes = new Dictionary<string, PrefabBox>(StringComparer.Ordinal);

        /// <summary>The craft's part rows, or null when it has no part snapshots.</summary>
        public static List<object?>? Build(ProtoVessel? proto)
        {
            var snapshots = proto?.protoPartSnapshots;
            if (snapshots == null || snapshots.Count == 0)
            {
                return null;
            }

            var list = new List<object?>(snapshots.Count);
            foreach (var pps in snapshots)
            {
                if (pps == null)
                {
                    continue;
                }

                try
                {
                    list.Add(BuildPart(pps, snapshots));
                }
                catch (Exception ex)
                {
                    GonogoLog.WarnLimited("unloaded craft topology read failed on \"" + pps.partName + "\", skipping", ex);
                }
            }

            return list;
        }

        private static Dictionary<string, object?> BuildPart(ProtoPartSnapshot pps, List<ProtoPartSnapshot> snapshots)
        {
            var info = pps.partInfo;
            var prefab = info?.partPrefab;
            var box = Measure(info?.name, prefab);

            string? parentId = null;
            if (pps.parentIdx >= 0 && pps.parentIdx < snapshots.Count)
            {
                var parent = snapshots[pps.parentIdx];
                if (parent != null && parent.flightID != 0)
                {
                    parentId = parent.flightID.ToString();
                }
            }

            var modules = new List<object?>();
            if (pps.modules != null)
            {
                foreach (var module in pps.modules)
                {
                    // The MODULE node's name is the PartModule's class name, the form a loaded part reports.
                    if (module != null && !string.IsNullOrEmpty(module.moduleName))
                    {
                        modules.Add(module.moduleName);
                    }
                }
            }

            var resources = new Dictionary<string, object?>();
            if (pps.resources != null)
            {
                foreach (var res in pps.resources)
                {
                    if (res == null || string.IsNullOrEmpty(res.resourceName))
                    {
                        continue;
                    }
                    resources[res.resourceName] = new Dictionary<string, object?>
                    {
                        ["amount"] = res.amount,
                        ["maxAmount"] = res.maxAmount,
                    };
                }
            }

            return new Dictionary<string, object?>
            {
                ["id"] = pps.flightID != 0 ? pps.flightID.ToString() : null,
                ["parentId"] = parentId,
                ["name"] = info != null ? info.name : pps.partName,
                ["title"] = info?.title,
                ["position"] = new double[] { pps.position.x, pps.position.y, pps.position.z },
                ["up"] = Vec3Array(pps.rotation * Vector3.up),
                ["forward"] = Vec3Array(pps.rotation * Vector3.forward),
                ["bounds"] = new Dictionary<string, object?>
                {
                    ["size"] = Vec3Array(box.Size),
                    ["center"] = box.HasMesh ? Vec3Array(box.Center) : null,
                },
                ["dryMass"] = (double)pps.mass,
                ["inverseStage"] = pps.inverseStageIndex,
                ["maxTemp"] = prefab != null ? prefab.maxTemp : (double?)null,
                ["skinMaxTemp"] = prefab != null && prefab.skinMaxTemp > 0 ? prefab.skinMaxTemp : (double?)null,
                ["category"] = info != null ? info.category.ToString() : null,
                ["categoryOrdinal"] = info != null ? (int)info.category : (int?)null,
                ["modules"] = modules,
                ["resources"] = resources,
            };
        }

        private static PrefabBox Measure(string? partName, Part? prefab)
        {
            if (partName == null || prefab == null)
            {
                return default;
            }

            if (PrefabBoxes.TryGetValue(partName, out var cached))
            {
                return cached;
            }

            var box = new PrefabBox();
            box.HasMesh = PartMeshBounds.TryMeasure(prefab, out box.Center, out box.Size);
            PrefabBoxes[partName] = box;
            return box;
        }

        private static double[] Vec3Array(Vector3 v) => new double[] { v.x, v.y, v.z };
    }
}
