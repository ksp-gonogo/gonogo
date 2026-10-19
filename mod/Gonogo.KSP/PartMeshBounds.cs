using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A part's box in its own frame: the union of the bounds of every mesh
    /// under the part's <c>model</c> transform, active or not, so an engine's
    /// hidden shroud still counts and a deploy animation changes nothing.
    /// </summary>
    internal static class PartMeshBounds
    {
        /// <summary>
        /// The box's centre and size in part-local metres, or <c>false</c> when
        /// the part has no model or its model has no mesh.
        /// </summary>
        public static bool TryMeasure(Part part, out Vector3 center, out Vector3 size)
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
            var toPart = part.transform.worldToLocalMatrix;
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var found = false;
            foreach (var renderer in model.GetComponentsInChildren<MeshRenderer>(true))
            {
                var filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null || BelongsToAnotherPart(renderer.transform, model))
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
