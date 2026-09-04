using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// The other half of the visibility question, as a scalar the sweep can
    /// root-find on: a link needs a clear line AND two ends that can hear each
    /// other, and <see cref="ChordOcclusion"/> only answers the first.
    ///
    /// <para>The elected comms backend owns the rule (see
    /// <see cref="ICommsReachModel"/>); what lives here is the arithmetic that
    /// turns its one number into something composable with a horizon margin,
    /// which is a geometry concern rather than a comms one.</para>
    ///
    /// <para><b>Metres SQUARED, matching
    /// <see cref="ChordOcclusion.HorizonMargin"/>.</b> Not a coincidence and
    /// not cosmetic: the two are combined by taking the worse of them, and a
    /// minimum over quantities in different units is meaningless. Both are
    /// therefore squared, both cross zero exactly at their own boundary, and
    /// both are smooth either side of it, which is what
    /// <see cref="IVisibilityGeometry.MarginAt"/> requires of whatever it
    /// returns. The obvious <c>maxRange - separation</c> in plain metres would
    /// work too, but mixed with a squared horizon margin the smaller term would
    /// always win on magnitude alone and the composition would report the wrong
    /// cause.</para>
    /// </summary>
    public static class RangeReach
    {
        /// <summary>
        /// Signed reach margin, metres squared:
        /// <c>maxRange^2 - separation^2</c>. Positive means the pair can hear
        /// each other, negative means they are too far apart, and zero is
        /// exactly at the limit, which counts as reaching (matching
        /// <see cref="CommsReachModels.Reaches"/> and stock's own
        /// <c>InRange</c>, both of which admit the boundary).
        ///
        /// <para>Absent rather than infinite when the model asserts no maximum:
        /// the caller gets null and applies no term at all, so a rule that does
        /// not say cannot be read as a rule that says "everywhere". A maximum of
        /// zero is a real answer and yields a margin that is negative
        /// everywhere, which is the correct "nothing reaches".</para>
        /// </summary>
        public static double? MarginAt(ICommsReachModel model, double separationMeters)
        {
            var max = model == null ? null : model.MaxRangeMeters;
            if (max == null || double.IsNaN(separationMeters) || double.IsInfinity(separationMeters))
            {
                return null;
            }
            var limit = max.Value;
            return (limit * limit) - (separationMeters * separationMeters);
        }

        /// <summary>
        /// The same margin from a maximum already resolved to a number, for a
        /// geometry that was handed the limit rather than the model. Null in,
        /// null out, on the same "asserts nothing" terms as above.
        /// </summary>
        public static double? MarginAt(double? maxRangeMeters, double separationMeters)
        {
            if (maxRangeMeters == null
                || double.IsNaN(maxRangeMeters.Value)
                || double.IsInfinity(maxRangeMeters.Value)
                || double.IsNaN(separationMeters)
                || double.IsInfinity(separationMeters))
            {
                return null;
            }
            var limit = maxRangeMeters.Value < 0.0 ? 0.0 : maxRangeMeters.Value;
            return (limit * limit) - (separationMeters * separationMeters);
        }
    }
}
