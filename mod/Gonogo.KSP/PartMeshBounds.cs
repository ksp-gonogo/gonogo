using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part's box in its own frame: the union of the vertices of every mesh
    /// under the part's <c>model</c> transform, active or not, so an engine's
    /// hidden shroud still counts and a deploy animation changes nothing.
    ///
    /// <para>A part with variants carries every variant's meshes under its model
    /// and hides the ones the selected variant does not use, so a part's box is
    /// measured with the selected variant's hidden meshes left out. Without that
    /// a short variant is drawn as long as the longest one.</para>
    /// </summary>
    internal static class PartMeshBounds
    {
        /// <summary>
        /// The box's centre and size in part-local metres, or <c>false</c> when
        /// the part has no model or its model has no mesh. <paramref name="variantName"/>
        /// is the selected variant, or null or unknown for a part without variants.
        /// </summary>
        public static bool TryMeasure(Part part, string? variantName, out Vector3 center, out Vector3 size)
        {
            return TryMeasure(part, variantName, out center, out size, out _);
        }

        /// <summary>
        /// As <see cref="TryMeasure(Part, string?, out Vector3, out Vector3)"/>, and
        /// <paramref name="path"/> says whether the box came from mesh vertices or
        /// from mesh bounds.
        /// </summary>
        public static bool TryMeasure(Part part, string? variantName, out Vector3 center, out Vector3 size, out MeasurePath path)
        {
            return TryMeasure(part, variantName, out center, out size, out path, out _);
        }

        /// <summary>
        /// As above, and <paramref name="hull"/> is the part's silhouette points
        /// (see <see cref="HullPoints"/>) as x, y, z triples in part-local metres.
        /// It is <c>null</c> unless every mesh was measured from its vertices,
        /// since bounds corners say nothing a box does not.
        /// </summary>
        public static bool TryMeasure(Part part, string? variantName, out Vector3 center, out Vector3 size, out MeasurePath path, out double[]? hull)
        {
            hull = null;
            path = MeasurePath.None;
            center = Vector3.zero;
            size = Vector3.zero;
            var model = part.transform.Find("model");
            if (model == null)
            {
                return false;
            }

            /*
             * Parts attached to this one are children of its transform, siblings
             * of `model`, so the walk stays below `model`. Part.prefabSize and
             * Part.GetComponentsInChildren both sweep those children in, along
             * with particle renderers, and prefabSize also changes between the
             * pad and flight for the same part.
             */
            var hiddenByVariant = HiddenByVariant(part, variantName);
            var toPart = part.transform.worldToLocalMatrix;
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var found = false;
            var fromVertices = 0;
            var fromBounds = 0;
            var tracker = new HullPoints.Tracker();
            foreach (var renderer in model.GetComponentsInChildren<MeshRenderer>(true))
            {
                var filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model)
                    || IsUnder(renderer.transform, model, hiddenByVariant))
                {
                    continue;
                }

                var toPartFromMesh = toPart * renderer.transform.localToWorldMatrix;
                var used = MeshExtent.Grow(VerticesOf(filter.sharedMesh), filter.sharedMesh.bounds, toPartFromMesh, ref lo, ref hi);
                if (used == MeasurePath.Vertices)
                {
                    fromVertices++;
                    tracker.Add(CandidatesOf(filter.sharedMesh), toPartFromMesh);
                }
                else
                {
                    fromBounds++;
                }

                found = true;
            }

            if (!found)
            {
                return false;
            }

            path = fromBounds == 0 ? MeasurePath.Vertices : fromVertices == 0 ? MeasurePath.MeshBounds : MeasurePath.Mixed;
            hull = fromBounds == 0 ? tracker.ToTriples() : null;
            center = (lo + hi) * 0.5f;
            size = hi - lo;
            return true;
        }

        /*
         * A mesh's vertices never change, so they are copied out once per mesh;
         * `Mesh.vertices` allocates a new array on every call. A mesh that is
         * not readable is remembered as null and measured by its bounds.
         */
        private static readonly ConditionalWeakTable<Mesh, Vector3[]?> VertexCache = new();

        private static readonly ConditionalWeakTable<Mesh, Vector3[]> CandidateCache = new();

        private static Vector3[] CandidatesOf(Mesh mesh)
        {
            if (CandidateCache.TryGetValue(mesh, out var cached))
            {
                return cached;
            }

            var candidates = HullPoints.Candidates(VerticesOf(mesh) ?? Array.Empty<Vector3>());
            CandidateCache.Add(mesh, candidates);
            return candidates;
        }

        private static Vector3[]? VerticesOf(Mesh mesh)
        {
            if (VertexCache.TryGetValue(mesh, out var cached))
            {
                return cached;
            }

            Vector3[]? vertices = null;
            if (mesh.isReadable)
            {
                vertices = mesh.vertices;
                if (vertices.Length == 0)
                {
                    vertices = null;
                }
            }

            VertexCache.Add(mesh, vertices);
            return vertices;
        }

        /// <summary>
        /// The names of the transforms the selected variant switches off. A
        /// transform some variant controls and the selected one does not mention
        /// keeps the state it has on the part.
        /// </summary>
        private static HashSet<string>? HiddenByVariant(Part part, string? variantName)
        {
            if (string.IsNullOrEmpty(variantName))
            {
                return null;
            }

            var module = part.FindModuleImplementing<ModulePartVariants>();
            if (module == null || module.variantList == null)
            {
                return null;
            }

            PartVariant? selected = null;
            foreach (var variant in module.variantList)
            {
                if (variant != null && variant.Name == variantName)
                {
                    selected = variant;
                }
            }
            if (selected == null)
            {
                return null;
            }

            var model = part.transform.Find("model");
            var others = new List<IReadOnlyDictionary<string, bool>>();
            foreach (var variant in module.variantList)
            {
                if (variant != null && variant != selected)
                {
                    others.Add(Listed(variant));
                }
            }

            return VariantMeshRule.Hidden(
                Listed(selected),
                others,
                name =>
                {
                    if (model == null)
                    {
                        return true;
                    }
                    foreach (var transform in model.GetComponentsInChildren<Transform>(true))
                    {
                        if (transform.name == name && !transform.gameObject.activeSelf)
                        {
                            return false;
                        }
                    }
                    return true;
                });
        }

        private static Dictionary<string, bool> Listed(PartVariant variant)
        {
            var listed = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var info in variant.InfoGameObjects)
            {
                listed[info.Name] = info.Status;
            }
            return listed;
        }

        private static bool IsUnder(Transform t, Transform model, HashSet<string>? names)
        {
            if (names == null || names.Count == 0)
            {
                return false;
            }

            for (var at = t; at != null && at != model; at = at.parent)
            {
                if (names.Contains(at.name))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool BelongsToAnotherPart(Transform t, Transform model)
        {
            for (var at = t; at != null && at != model; at = at.parent)
            {
                if (at.GetComponent<Part>() != null)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
