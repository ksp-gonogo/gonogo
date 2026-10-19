using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Gonogo.DevTools
{
    /// <summary>
    /// What a <c>TIME</c> request node asks for, parsed apart from the game so a malformed
    /// request is refused whole and with a reason.
    /// </summary>
    internal sealed class TimeRequest
    {
        private TimeRequest(double? setUt, bool sunElevation, double? latitude, double? longitude)
        {
            SetUt = setUt;
            SunElevation = sunElevation;
            Latitude = latitude;
            Longitude = longitude;
        }

        /// <summary>The universal time to move to, or null when the request only reads.</summary>
        public double? SetUt { get; }

        /// <summary>True when the sun's elevation is to be reported, after any move in time.</summary>
        public bool SunElevation { get; }

        /// <summary>Degrees north, or null to use the active vessel's position.</summary>
        public double? Latitude { get; }

        /// <summary>Degrees east, or null to use the active vessel's position.</summary>
        public double? Longitude { get; }

        /// <summary>
        /// Reads the <c>setut</c>, <c>sunelev</c>, <c>lat</c> and <c>lon</c> values. <c>lat</c>
        /// and <c>lon</c> come as a pair or not at all, and are only meaningful with
        /// <c>sunelev</c>.
        /// </summary>
        /// <param name="get">The node's value for a key, or null when the key is absent.</param>
        /// <param name="error">Why the request was refused, or null.</param>
        public static TimeRequest? Parse(Func<string, string?> get, out string? error)
        {
            var rawSetUt = get("setut");
            var rawSunElev = get("sunelev");
            var rawLat = get("lat");
            var rawLon = get("lon");
            error = null;

            double? setUt = null;
            if (!string.IsNullOrWhiteSpace(rawSetUt))
            {
                if (!TryNumber(rawSetUt, out var ut) || ut < 0)
                {
                    error = "invalid 'setut' '" + rawSetUt + "', expected a universal time in seconds";
                    return null;
                }
                setUt = ut;
            }

            if (!TryFlag(rawSunElev, out var sunElev))
            {
                error = "invalid 'sunelev' '" + rawSunElev + "', expected true or false";
                return null;
            }

            if (!setUt.HasValue && !sunElev)
            {
                error = "nothing to do: give 'setut' and/or 'sunelev = true'";
                return null;
            }

            var hasLat = !string.IsNullOrWhiteSpace(rawLat);
            var hasLon = !string.IsNullOrWhiteSpace(rawLon);
            if (hasLat != hasLon)
            {
                error = "'lat' and 'lon' go together: give both or neither";
                return null;
            }

            double? lat = null;
            double? lon = null;
            if (hasLat)
            {
                if (!sunElev)
                {
                    error = "'lat' and 'lon' only apply with 'sunelev = true'";
                    return null;
                }
                if (!TryNumber(rawLat, out var parsedLat) || parsedLat < -90 || parsedLat > 90)
                {
                    error = "invalid 'lat' '" + rawLat + "', expected degrees from -90 to 90";
                    return null;
                }
                if (!TryNumber(rawLon, out var parsedLon))
                {
                    error = "invalid 'lon' '" + rawLon + "', expected degrees";
                    return null;
                }
                lat = parsedLat;
                lon = parsedLon;
            }

            return new TimeRequest(setUt, sunElev, lat, lon);
        }

        /// <summary>
        /// Why moving to <paramref name="targetUt"/> is refused, or null when it is allowed.
        /// Game time only moves forward: going back would run vessels, contracts and
        /// the save's own clocks against themselves.
        /// </summary>
        public static string? RefuseBackwards(double nowUt, double targetUt)
        {
            return targetUt < nowUt
                ? "refused: setut " + Number(targetUt) + " is earlier than the current UT " + Number(nowUt)
                    + ", and game time only moves forward. Nothing was changed."
                : null;
        }

        private static bool TryFlag(string? raw, out bool value)
        {
            value = false;
            if (string.IsNullOrWhiteSpace(raw))
            {
                return true;
            }

            var text = raw!.Trim();
            value = string.Equals(text, "true", StringComparison.OrdinalIgnoreCase);
            return value || string.Equals(text, "false", StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryNumber(string? raw, out double value)
        {
            return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                && !double.IsNaN(value) && !double.IsInfinity(value);
        }

        internal static string Number(double value)
        {
            return value.ToString("R", CultureInfo.InvariantCulture);
        }
    }

    /// <summary>The <c>RESULT</c> node a time request answers with.</summary>
    internal static class TimeResult
    {
        /// <summary>
        /// Renders the result file. <c>requestedUt</c> is what was asked, and <c>achievedUt</c>
        /// is the universal time the game was reading when the result was written;
        /// <c>unknown</c> stands in for any figure the request did not ask for or the
        /// game could not give.
        /// </summary>
        public static string Render(
            string id, bool ok, string message, double? requestedUt, double? achievedUt,
            double? sunElevationDegrees, double? latitude, double? longitude, string? body, DateTime timeUtc)
        {
            var sb = new StringBuilder();
            sb.AppendLine("RESULT");
            sb.AppendLine("{");
            sb.AppendLine("\tapplied = " + id);
            sb.AppendLine("\tok = " + (ok ? "True" : "False"));
            sb.AppendLine("\trequestedUt = " + Figure(requestedUt, "R"));
            sb.AppendLine("\tachievedUt = " + Figure(achievedUt, "R"));
            sb.AppendLine("\tsunElevationDeg = " + Figure(sunElevationDegrees, "F4"));
            sb.AppendLine("\tlat = " + Figure(latitude, "R"));
            sb.AppendLine("\tlon = " + Figure(longitude, "R"));
            sb.AppendLine("\tbody = " + (string.IsNullOrEmpty(body) ? "unknown" : body));
            sb.AppendLine("\tmessage = " + message);
            sb.AppendLine("\ttime = " + timeUtc.ToString("O", CultureInfo.InvariantCulture));
            sb.AppendLine("}");
            return sb.ToString();
        }

        private static string Figure(double? value, string format)
        {
            return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value)
                ? value.Value.ToString(format, CultureInfo.InvariantCulture)
                : "unknown";
        }
    }
}
