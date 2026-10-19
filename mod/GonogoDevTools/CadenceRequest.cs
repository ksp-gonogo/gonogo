using System;
using System.Collections.Generic;
using System.Globalization;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The topic rates and report interval a cadence request file names, parsed
    /// apart from the game so a malformed line is refused whole and with a reason.
    /// </summary>
    internal sealed class CadenceRequest
    {
        private CadenceRequest(List<(string Topic, double Hz)> rates, double? reportSeconds, bool reset)
        {
            Rates = rates;
            ReportSeconds = reportSeconds;
            Reset = reset;
        }

        /// <summary>The <c>rate = &lt;topic&gt; &lt;hz&gt;</c> lines, in file order.</summary>
        public IReadOnlyList<(string Topic, double Hz)> Rates { get; }

        /// <summary>Seconds between report lines, zero to stop them, or null to leave the interval alone.</summary>
        public double? ReportSeconds { get; }

        /// <summary>True when every earlier override is cleared before these rates apply.</summary>
        public bool Reset { get; }

        /// <summary>
        /// Parses the values of the request's <c>rate</c> keys and its optional
        /// <c>report</c> and <c>reset</c> keys. Returns null with the reason in
        /// <paramref name="error"/> when any value is malformed or the request asks
        /// for nothing at all.
        /// </summary>
        public static CadenceRequest? TryParse(string[] rateValues, string? report, string? reset, out string? error)
        {
            var rates = new List<(string, double)>();
            foreach (var raw in rateValues)
            {
                var parts = raw.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length != 2
                    || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var hz))
                {
                    error = "rate '" + raw + "' is not '<topic> <hz>'";
                    return null;
                }
                rates.Add((parts[0], hz));
            }

            double? reportSeconds = null;
            if (!string.IsNullOrWhiteSpace(report))
            {
                if (!double.TryParse(report, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) || seconds < 0)
                {
                    error = "report '" + report + "' is not a number of seconds, 0 or more";
                    return null;
                }
                reportSeconds = seconds;
            }

            var clear = string.Equals(reset?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
            if (rates.Count == 0 && reportSeconds == null && !clear)
            {
                error = "the request names no rate, report or reset";
                return null;
            }

            error = null;
            return new CadenceRequest(rates, reportSeconds, clear);
        }
    }
}
