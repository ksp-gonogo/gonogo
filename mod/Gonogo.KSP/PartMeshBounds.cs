using System;
using System.Collections.Generic;
using System.Linq;
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
        /// As above, and <paramref name="hull"/> is the part's silhouette: one
        /// piece of points (see <see cref="HullPoints"/>) per visible mesh, each
        /// as x, y, z triples in part-local metres. A mesh whose renderer is
        /// disabled or whose transform is switched off, such as an engine's
        /// shroud while nothing is mounted below it, is in the box and not in
        /// the hull, since it is not in the picture. It is <c>null</c> unless
        /// every visible mesh was measured from its vertices, since bounds
        /// corners say nothing a box does not.
        /// </summary>
        public static bool TryMeasure(Part part, string? variantName, out Vector3 center, out Vector3 size, out MeasurePath path, out double[][]? hull)
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
            var uses = new List<PartBox.Use>();
            foreach (var renderer in model.GetComponentsInChildren<MeshRenderer>(true))
            {
                var filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model)
                    || IsUnder(renderer.transform, model, hiddenByVariant))
                {
                    continue;
                }

                var mesh = filter.sharedMesh;
                var toPartFromMesh = ToPart(renderer.transform, part.transform);
                var piece = Pieces.Piece(
                    renderer,
                    mesh,
                    toPartFromMesh,
                    () => MeshPiece.Measure(VerticesOf(mesh), mesh.bounds, toPartFromMesh, () => CandidatesOf(mesh)));
                uses.Add(new PartBox.Use(piece, IsShown(renderer, model)));
            }

            return PartBox.TryAssemble(uses, out center, out size, out path, out hull);
        }

        /*
         * A mesh and its carry into the part's frame stand still while the part
         * flies, so each renderer's piece is measured once and reused until either
         * changes: walking every vertex again on every sample is most of the cost
         * of a vessel's topology.
         */
        private static readonly MeshPieceMemo<MeshRenderer> Pieces = new MeshPieceMemo<MeshRenderer>();

        /// <summary>
        /// The matrix carrying <paramref name="mesh"/>'s local space into
        /// <paramref name="part"/>'s, composed from the local transforms between them,
        /// or from their world matrices if <paramref name="part"/> is not above it.
        /// </summary>
        private static Matrix4x4 ToPart(Transform mesh, Transform part)
        {
            var chain = new List<(Vector3, Quaternion, Vector3)>();
            for (var at = mesh; at != null; at = at.parent)
            {
                if (at == part)
                {
                    return PartBox.ToPart(chain);
                }
                chain.Add((at.localPosition, at.localRotation, at.localScale));
            }
            return part.worldToLocalMatrix * mesh.localToWorldMatrix;
        }

        /// <summary>Whether the mesh is drawn: its renderer is on and every transform from it up to the model is switched on.</summary>
        private static bool IsShown(Renderer renderer, Transform model)
        {
            if (!renderer.enabled)
            {
                return false;
            }

            for (var t = renderer.transform; t != null && t != model.parent; t = t.parent)
            {
                if (!t.gameObject.activeSelf)
                {
                    return false;
                }
            }

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
