using System;

namespace GonogoTelemetry
{
    /// <summary>
    /// Small shared helpers used across the Api classes. Currently just
    /// the float-rounding helpers that absorb single-precision noise
    /// before values hit the JSON wire (e.g. KSP returns 0.04 funds-cost
    /// as 0.0400000018998981 because internal storage is float; the
    /// dashboard widget reads doubles, so the noise survives intact
    /// without server-side rounding).
    /// </summary>
    internal static class Util
    {
        /// Round a double to 4 decimal places. Cheap, allocation-free.
        /// 4dp covers funds (whole numbers), mass (e.g. 0.04 t), and
        /// science values (1.5 sci) without introducing new precision
        /// loss vs. KSP's float-internal math.
        public static double R4(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return value;
            return Math.Round(value, 4);
        }

        /// Same as R4 but for floats — KSP returns single-precision in
        /// many places. Promotes to double after rounding so JSON
        /// serialisation matches existing wire shape.
        public static double R4(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return value;
            return Math.Round((double)value, 4);
        }
    }
}
