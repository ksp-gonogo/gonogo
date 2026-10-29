using System.Collections.Generic;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// A procedural fairing's shell as a part row's raw <c>fairing</c> entry:
    /// its pivot and axis carried into the part's own frame and its rings
    /// (<see cref="FairingRings"/>). Null for a part with no
    /// <c>ModuleProceduralFairing</c>.
    /// </summary>
    internal static class FairingShellRead
    {
        /// <summary>The shell of a loaded part, from its fairing module's live sections, which the module clears when it jettisons the shell.</summary>
        public static Dictionary<string, object?>? Live(Part part)
        {
            var module = part.Modules?.GetModule<ModuleProceduralFairing>();
            if (module == null)
            {
                return null;
            }

            var sections = new List<KeyValuePair<double, double>>();
            if (module.xSections != null)
            {
                foreach (var section in module.xSections)
                {
                    if (section != null)
                    {
                        sections.Add(new KeyValuePair<double, double>(section.h, section.r));
                    }
                }
            }

            return Wire(part, module, sections);
        }

        /// <summary>
        /// The shell of a saved part, from the <c>XSECTION</c> nodes of its saved
        /// fairing module (<paramref name="saved"/>, null when the save holds
        /// none, which is a fairing with no shell), with the pivot, axis,
        /// capRadius and noseTip of the module on <paramref name="prefab"/>.
        /// </summary>
        public static Dictionary<string, object?>? Saved(ConfigNode? saved, Part? prefab)
        {
            var module = prefab?.Modules?.GetModule<ModuleProceduralFairing>();
            if (prefab == null || module == null)
            {
                return null;
            }

            var sections = new List<KeyValuePair<double, double>>();
            var nodes = saved?.GetNodes("XSECTION");
            if (nodes != null)
            {
                foreach (var node in nodes)
                {
                    if (FairingRings.Parse(node.GetValue("h"), node.GetValue("r")) is { } section)
                    {
                        sections.Add(section);
                    }
                }
            }

            return Wire(prefab, module, sections);
        }

        /// <summary>The saved fairing module among a craft file's <c>MODULE</c> nodes, or null.</summary>
        public static ConfigNode? SavedModule(IEnumerable<ConfigNode>? modules)
        {
            if (modules == null)
            {
                return null;
            }
            foreach (var module in modules)
            {
                if (module?.GetValue("name") == nameof(ModuleProceduralFairing))
                {
                    return module;
                }
            }
            return null;
        }

        private static Dictionary<string, object?> Wire(Part part, ModuleProceduralFairing module, List<KeyValuePair<double, double>> sections)
        {
            var rings = FairingRings.Of(sections, module.capRadius, module.noseTip);
            var pivot = module.pivot;
            var axis = module.axis;

            /* The module builds its panels under the part's model transform, in that transform's frame, so the pivot and axis are carried from there into the part's own, and a scaled model scales the rings with it. */
            var model = part.transform.Find("model");
            if (model != null)
            {
                pivot = part.transform.InverseTransformPoint(model.TransformPoint(module.pivot));
                axis = part.transform.InverseTransformVector(model.TransformVector(module.axis));
                var before = module.axis.magnitude;
                var scale = before > 1e-6f ? axis.magnitude / before : 1f;
                if (Mathf.Abs(scale - 1f) > 1e-4f)
                {
                    for (var i = 0; i < rings.Count; i++)
                    {
                        rings[i] *= scale;
                    }
                }
            }
            if (axis.sqrMagnitude > 1e-12f)
            {
                axis = axis.normalized;
            }

            return new Dictionary<string, object?>
            {
                ["pivot"] = new double[] { pivot.x, pivot.y, pivot.z },
                ["axis"] = new double[] { axis.x, axis.y, axis.z },
                ["rings"] = rings.ToArray(),
            };
        }
    }
}
