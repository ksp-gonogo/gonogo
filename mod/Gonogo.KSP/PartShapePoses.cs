using System;
using System.Collections.Generic;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part's meshes compared with its shape on <c>parts.shape.&lt;key&gt;</c>:
    /// the ones that have moved, or are drawn when the shape has them hidden or the
    /// other way round, each with the matrix that carries it from the shape's place
    /// to where it stands now. This is how a deployed leg, an open bay or a turned
    /// nozzle reaches a drawing made from the shape.
    /// </summary>
    internal static class PartShapePoses
    {
        /* Further apart than this in any matrix element, metres or unitless, and a mesh has moved. */
        private const float MovedBy = 1e-4f;

        /*
         * Each kind of part's meshes as its prefab holds them, by shape key, read
         * once from the prefab's transforms. Main thread only.
         */
        private static readonly Dictionary<string, Dictionary<string, PartMesh>> Rest = new Dictionary<string, Dictionary<string, PartMesh>>(StringComparer.Ordinal);

        /// <summary>The key of <paramref name="part"/>'s shape in <paramref name="variant"/>, or null when it has no part info.</summary>
        public static string? KeyOf(Part part, string? variant) =>
            part.partInfo != null ? PartShapeWire.Key(part.partInfo.name, variant) : null;

        /// <summary>
        /// The variant a shape is measured in: the one asked for, or the prefab's
        /// own selected variant when none was named and the part has variants, so a
        /// saved row with no variant draws the part as it comes.
        /// </summary>
        public static string? VariantFor(Part prefab, string? variant) =>
            SavedPartRules.VariantName(variant, prefab.variants?.SelectedVariant?.Name);

        /// <summary>
        /// The raw <c>shapePoses</c> rows for a loaded part whose meshes are
        /// <paramref name="meshes"/>, or null when every mesh stands as its shape has
        /// it. Each row is <c>{ mesh, shown, transform }</c>, the transform twelve
        /// numbers or null when the mesh has not moved.
        /// </summary>
        public static List<object?>? Of(Part part, string key, string? variant, IReadOnlyList<PartMesh> meshes)
        {
            var rest = RestOf(part, key, variant);
            if (rest == null)
            {
                return null;
            }

            List<object?>? poses = null;
            foreach (var mesh in meshes)
            {
                if (!rest.TryGetValue(mesh.Key, out var at))
                {
                    continue;
                }

                var moved = Moved(mesh.ToPart, at.ToPart);
                if (!moved && mesh.Shown == at.Shown)
                {
                    continue;
                }

                (poses ??= new List<object?>()).Add(new Dictionary<string, object?>
                {
                    ["mesh"] = mesh.Key,
                    ["shown"] = mesh.Shown,
                    ["transform"] = moved ? Rows(mesh.ToPart * at.ToPart.inverse) : null,
                });
            }
            return poses;
        }

        /// <summary>
        /// The raw <c>shapePoses</c> rows for a part read from a save, which has no
        /// live meshes to compare: each structure a <c>ModuleStructuralNode</c> of
        /// <paramref name="prefab"/> owns, shown or hidden as the module would show
        /// it on the loaded part. <paramref name="savedNodes"/> are the part's saved
        /// <c>ModuleStructuralNode</c> modules in order, and
        /// <paramref name="attachedNodes"/> the attach nodes that have a part on
        /// them. Null when every mesh stands as the shape has it.
        /// </summary>
        public static List<object?>? Saved(Part prefab, string? variant, IReadOnlyList<ConfigNode?> savedNodes, ICollection<string> attachedNodes)
        {
            var modules = prefab.Modules?.GetModules<ModuleStructuralNode>();
            if (modules == null || modules.Count == 0)
            {
                return null;
            }

            var meshes = RestMeshes(prefab, VariantFor(prefab, variant));
            List<object?>? poses = null;
            for (var i = 0; i < modules.Count; i++)
            {
                var module = modules[i];
                var root = prefab.FindModelTransform(module.rootObject);
                if (root == null)
                {
                    continue;
                }

                var saved = i < savedNodes.Count ? savedNodes[i] : null;
                var shown = SavedPartRules.StructureShown(
                    SavedPartRules.SavedFlag(saved?.GetValue("visibilityState"), module.visibilityState),
                    module.spawnManually,
                    SavedPartRules.SavedFlag(saved?.GetValue("spawnState"), module.spawnState),
                    module.reverseVisibility,
                    module.attachNodeNames,
                    attachedNodes);
                foreach (var mesh in meshes)
                {
                    if (mesh.Shown == shown || mesh.Renderer == null || !mesh.Renderer.transform.IsChildOf(root))
                    {
                        continue;
                    }
                    (poses ??= new List<object?>()).Add(new Dictionary<string, object?>
                    {
                        ["mesh"] = mesh.Key,
                        ["shown"] = shown,
                        ["transform"] = null,
                    });
                }
            }
            return poses;
        }

        /* A prefab's meshes by part name and variant, read once a session: a saved craft is read again on every look. Main thread only. */
        private static readonly Dictionary<string, List<PartMesh>> PrefabMeshes = new Dictionary<string, List<PartMesh>>(StringComparer.Ordinal);

        private static List<PartMesh> RestMeshes(Part prefab, string? variant)
        {
            var key = (prefab.partInfo?.name ?? prefab.name) + "|" + variant;
            if (!PrefabMeshes.TryGetValue(key, out var meshes))
            {
                meshes = PartMeshBounds.Meshes(prefab, variant);
                PrefabMeshes[key] = meshes;
            }
            return meshes;
        }

        private static Dictionary<string, PartMesh>? RestOf(Part part, string key, string? variant)
        {
            if (Rest.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var prefab = part.partInfo?.partPrefab;
            if (prefab == null)
            {
                return null;
            }

            var rest = new Dictionary<string, PartMesh>(StringComparer.Ordinal);
            foreach (var mesh in PartMeshBounds.Meshes(prefab, VariantFor(prefab, variant)))
            {
                rest[mesh.Key] = mesh;
            }
            Rest[key] = rest;
            return rest;
        }

        private static bool Moved(Matrix4x4 a, Matrix4x4 b)
        {
            for (var i = 0; i < 16; i++)
            {
                if (Math.Abs(a[i] - b[i]) > MovedBy)
                {
                    return true;
                }
            }
            return false;
        }

        /* The top three rows, row by row, to the tenth of a millimetre. */
        private static double[] Rows(Matrix4x4 m) => new[]
        {
            Round(m.m00), Round(m.m01), Round(m.m02), Round(m.m03),
            Round(m.m10), Round(m.m11), Round(m.m12), Round(m.m13),
            Round(m.m20), Round(m.m21), Round(m.m22), Round(m.m23),
        };

        private static double Round(float v) => Math.Round(v, 4);
    }
}
