using System.Collections.Generic;
using System.Text;

namespace Gonogo.KSP
{
    /// <summary>
    /// Tallies which data each part of one craft scan was measured from, and
    /// writes the single KSP.log line that says so. Used by the vessel parts scan
    /// so a rig run can tell a vertex measurement from a mesh-bounds fallback.
    /// </summary>
    internal sealed class BoundsPathReport
    {
        private const int NamesShown = 12;

        private readonly int[] counts = new int[4];
        private readonly List<string> fallbacks = new List<string>();

        /// <summary>Records that <paramref name="partName"/> was measured by <paramref name="path"/>.</summary>
        public void Add(string partName, MeasurePath path)
        {
            counts[(int)path]++;
            if ((path == MeasurePath.MeshBounds || path == MeasurePath.Mixed) && !fallbacks.Contains(partName))
            {
                fallbacks.Add(partName);
            }
        }

        /// <summary>The log line for <paramref name="craft"/>, naming the parts that fell back to mesh bounds.</summary>
        public string Line(string craft)
        {
            var text = new StringBuilder();
            text.Append("bounds paths for \"").Append(craft).Append("\": vertices ").Append(counts[(int)MeasurePath.Vertices]);
            text.Append(", meshBounds ").Append(counts[(int)MeasurePath.MeshBounds]);
            text.Append(", mixed ").Append(counts[(int)MeasurePath.Mixed]);
            text.Append(", none ").Append(counts[(int)MeasurePath.None]);
            if (fallbacks.Count > 0)
            {
                text.Append(" (not from vertices: ");
                for (var i = 0; i < fallbacks.Count && i < NamesShown; i++)
                {
                    text.Append(i == 0 ? "" : ", ").Append(fallbacks[i]);
                }

                text.Append(fallbacks.Count > NamesShown ? ", ...)" : ")");
            }

            return text.ToString();
        }
    }
}
