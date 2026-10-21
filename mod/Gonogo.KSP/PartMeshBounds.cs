using System;
using System.Collections.Generic;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part's box in its own frame: the union of the bounds of every mesh
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
            foreach (var renderer in model.GetComponentsInChildren<MeshRenderer>(true))
            {
                var filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model)
                    || IsUnder(renderer.transform, model, hiddenByVariant))
                {
                    continue;
                }

                var bounds = filter.sharedMesh.bounds;
                var toPartFromMesh = toPart * renderer.transform.localToWorldMatrix;
                for (var i = 0; i < 8; i++)
                {
                    var corner = bounds.center + Vector3.Scale(bounds.extents, new Vector3(
                        (i & 1) == 0 ? -1f : 1f,
                        (i & 2) == 0 ? -1f : 1f,
                        (i & 4) == 0 ? -1f : 1f));
                    var p = toPartFromMesh.MultiplyPoint3x4(corner);
                    lo = Vector3.Min(lo, p);
                    hi = Vector3.Max(hi, p);
                }

                found = true;
            }

            if (!found)
            {
                return false;
            }

            center = (lo + hi) * 0.5f;
            size = hi - lo;
            return true;
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
