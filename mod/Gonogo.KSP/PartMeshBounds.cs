using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part's box in its own frame: the union of the vertices of every mesh
    /// under the part's <c>model</c> transform, active or not, so an engine's
    /// hidden shroud still counts. A parachute's canopy is left out, since its
    /// deploy animation scales it far past the part.
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
            return TryMeasure(part, variantName, out center, out size, out path, null);
        }

        /// <summary>
        /// As above, and every mesh the walk measured is added to
        /// <paramref name="meshes"/> when it is given, with its key, its carry into
        /// the part's frame and whether it is drawn, for comparing the part's
        /// meshes with its shape.
        /// </summary>
        public static bool TryMeasure(Part part, string? variantName, out Vector3 center, out Vector3 size, out MeasurePath path, List<PartMesh>? meshes)
        {
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
            HashSet<string>? hiddenByVariant;
            using (SampleTiming.Part("topo.mesh.variant"))
            {
                hiddenByVariant = Excluded(part, variantName);
            }
            MeshRenderer[] renderers;
            using (SampleTiming.Part("topo.mesh.renderers"))
            {
                renderers = model.GetComponentsInChildren<MeshRenderer>(true);
            }
            var timing = SampleTiming.Enabled;
            var measuredBefore = Pieces.Measured;
            long carryTicks = 0;
            var pieces = new List<MeshPiece>();
            using (SampleTiming.Part("topo.mesh.walk"))
            {
                foreach (var renderer in renderers)
                {
                    var filter = renderer.GetComponent<MeshFilter>();
                    if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model)
                        || IsUnder(renderer.transform, model, hiddenByVariant))
                    {
                        continue;
                    }

                    var mesh = filter.sharedMesh;
                    var carryStarted = timing ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
                    var toPartFromMesh = ToPart(renderer.transform, part.transform);
                    if (timing)
                    {
                        carryTicks += System.Diagnostics.Stopwatch.GetTimestamp() - carryStarted;
                    }
                    var piece = Pieces.Piece(
                        renderer,
                        mesh,
                        toPartFromMesh,
                        () => MeshPiece.Measure(VerticesOf(mesh), mesh.bounds, toPartFromMesh));
                    pieces.Add(piece);
                    meshes?.Add(new PartMesh(KeyOf(renderer.transform, model), renderer, mesh, toPartFromMesh, IsShown(renderer, model)));
                }
            }
            if (timing)
            {
                SampleTiming.Add("topo.mesh.carry", carryTicks);
                SampleTiming.Count("topo.mesh.renderers", renderers.Length);
                SampleTiming.Count("topo.mesh.measured", Pieces.Measured - measuredBefore);
            }

            using (SampleTiming.Part("topo.mesh.assemble"))
            {
                return PartBox.TryAssemble(pieces, out center, out size, out path);
            }
        }

        /// <summary>
        /// The meshes of <paramref name="part"/>'s model that <paramref name="variantName"/>
        /// keeps, in model order, each with its key, its carry into the part's
        /// frame and whether it is drawn. Reads transforms only, never a mesh's
        /// vertices.
        /// </summary>
        public static List<PartMesh> Meshes(Part part, string? variantName)
        {
            var result = new List<PartMesh>();
            var model = part.transform.Find("model");
            if (model == null)
            {
                return result;
            }

            var hiddenByVariant = Excluded(part, variantName);
            foreach (var renderer in model.GetComponentsInChildren<MeshRenderer>(true))
            {
                var filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model)
                    || IsUnder(renderer.transform, model, hiddenByVariant))
                {
                    continue;
                }
                result.Add(new PartMesh(
                    KeyOf(renderer.transform, model),
                    renderer,
                    filter.sharedMesh,
                    ToPart(renderer.transform, part.transform),
                    IsShown(renderer, model)));
            }
            return result;
        }

        /* A transform's place in its model never changes, so each renderer's key is worked out once. */
        private static readonly ConditionalWeakTable<Transform, string> Keys = new();

        /// <summary>
        /// The mesh's name within its part: the transform names from below the
        /// model down to the mesh joined by <c>/</c>, each followed by <c>#2</c>,
        /// <c>#3</c> and so on when an earlier sibling already has that name.
        /// A part and its prefab give the same key for the same mesh, since a part
        /// is a copy of its prefab's hierarchy.
        /// </summary>
        internal static string KeyOf(Transform mesh, Transform model)
        {
            if (Keys.TryGetValue(mesh, out var cached))
            {
                return cached;
            }

            var names = new List<string>();
            for (var at = mesh; at != null && at != model; at = at.parent)
            {
                var seen = 1;
                var parent = at.parent;
                if (parent != null)
                {
                    for (var i = 0; i < parent.childCount; i++)
                    {
                        var sibling = parent.GetChild(i);
                        if (sibling == at)
                        {
                            break;
                        }
                        if (sibling.name == at.name)
                        {
                            seen++;
                        }
                    }
                }
                names.Add(seen > 1 ? at.name + "#" + seen : at.name);
            }
            names.Reverse();
            var key = string.Join("/", names);
            Keys.Add(mesh, key);
            return key;
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
        internal static Matrix4x4 ToPart(Transform mesh, Transform part)
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

        internal static Vector3[]? VerticesOf(Mesh mesh)
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
        /// The names of the transforms left out of the part's box: those the
        /// selected variant switches off and any parachute canopy.
        /// </summary>
        private static HashSet<string>? Excluded(Part part, string? variantName)
        {
            var canopies = new List<string?>();
            foreach (var module in part.Modules)
            {
                if (module is ModuleParachute chute)
                {
                    canopies.Add(chute.canopyName);
                }
            }
            return VariantMeshRule.WithCanopies(HiddenByVariant(part, variantName), canopies);
        }

        /// <summary>
        /// The names of the transforms the selected variant switches off. A
        /// transform some variant controls and the selected one does not mention
        /// keeps the state it has on the part.
        /// </summary>
        internal static HashSet<string>? HiddenByVariant(Part part, string? variantName)
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

    /// <summary>One mesh of a part as the part holds it now.</summary>
    internal readonly struct PartMesh
    {
        public PartMesh(string key, MeshRenderer renderer, Mesh mesh, Matrix4x4 toPart, bool shown)
        {
            Key = key;
            Renderer = renderer;
            Mesh = mesh;
            ToPart = toPart;
            Shown = shown;
        }

        /// <summary>The mesh's name within its part (see <see cref="PartMeshBounds.KeyOf"/>).</summary>
        public string Key { get; }

        public MeshRenderer Renderer { get; }

        public Mesh Mesh { get; }

        /// <summary>The matrix carrying the mesh's own frame into its part's.</summary>
        public Matrix4x4 ToPart { get; }

        /// <summary>Whether the part draws the mesh now.</summary>
        public bool Shown { get; }
    }
}
