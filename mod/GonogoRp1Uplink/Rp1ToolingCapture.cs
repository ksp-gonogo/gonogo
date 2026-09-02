using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: one tick of captured tooling data to the dict the wire carries.
    /// KSP-free, RP-1-free and side-effect-free, so it is unit-tested headless.
    /// </summary>
    public static class Rp1ToolingCapture
    {
        /// <summary>
        /// The tooling reading, or NOTHING.
        ///
        /// <para>Null rather than an empty payload when there is no editor ship or
        /// RP-1's tooling is switched off. The second is the case that earns the
        /// care: RP-1's own level lookup answers "tooled" for everything when
        /// tooling is disabled, so a payload built then would report a vehicle with
        /// nothing left to do. The channel is declared <c>absenceIsData</c> so a
        /// client is told there is no reading rather than shown a finished
        /// one.</para>
        /// </summary>
        public static Dictionary<string, object?>? Build(Rp1ToolingRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }

            var parts = new List<object?>();
            var untooled = 0;
            foreach (var part in raw.Parts)
            {
                if (part.Tooled == false)
                {
                    untooled++;
                }
                parts.Add(new Dictionary<string, object?>
                {
                    ["partTitle"] = part.PartTitle,
                    ["partId"] = part.PartId,
                    ["toolingType"] = part.ToolingType,
                    ["toolingTypeTitle"] = part.ToolingTypeTitle,
                    ["parameterSummary"] = part.ParameterSummary,
                    ["tooled"] = part.Tooled,
                    ["toolingCost"] = part.ToolingCost,
                    ["untooledSurcharge"] = part.UntooledSurcharge,
                    ["symmetryCounterparts"] = part.SymmetryCounterparts,
                    ["refittable"] = part.Refittable,
                    ["refitTargets"] = RefitTargets(part.RefitTargets),
                });
            }

            return new Dictionary<string, object?>
            {
                // RP-1's own deduplicated figure, NOT the sum of the rows: tooling
                // one part can leave another free, so the column does not add up to
                // this and a client must not try.
                ["toolAllCost"] = raw.ToolAllCost,
                ["untooledCount"] = untooled,
                ["parts"] = parts,
            };
        }

        /// <summary>
        /// The refit rows, or NOTHING. Null carries through rather than becoming an
        /// empty list, because the two say different things: null is a part the
        /// question does not apply to, empty is a part the career owns nowhere to
        /// move.
        /// </summary>
        private static List<object?>? RefitTargets(List<Rp1ToolingRefitTargetRaw>? targets)
        {
            if (targets == null)
            {
                return null;
            }
            var rows = new List<object?>();
            foreach (var target in targets)
            {
                rows.Add(new Dictionary<string, object?>
                {
                    ["diameter"] = target.Diameter,
                    ["length"] = target.Length,
                    ["rfType"] = target.RfType,
                });
            }
            return rows;
        }
    }
}
