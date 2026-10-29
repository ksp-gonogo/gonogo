using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The rate changes the game made after one warp request, in order, each
    /// with the reason KSP's own limit check gave when it ran below the rung
    /// asked for. KSP re-checks an on-rails warp every physics frame and lowers
    /// it at once when the vessel's altitude, periapsis or acceleration no
    /// longer allows the rung, so one read-back some seconds later cannot say
    /// whether the request was held, or when and why it was lowered.
    /// </summary>
    internal sealed class WarpTrace
    {
        private readonly List<Step> _steps = new List<Step>();

        public WarpTrace(int requestedIndex)
        {
            RequestedIndex = requestedIndex;
        }

        public int RequestedIndex { get; }

        /// <summary>The craft as it was when the warp was asked for, or null when not read.</summary>
        public CraftState? AtRequest { get; set; }

        public IReadOnlyList<Step> Steps => _steps;

        /// <summary>
        /// Adds one rate change. <paramref name="reason"/> is KSP's name for why
        /// its limit check ran below the request, or null when it did not.
        /// </summary>
        public void Record(double secondsSinceRequest, int index, float rate, string? reason, CraftState? craft = null)
        {
            _steps.Add(new Step(secondsSinceRequest, index, rate, reason, craft));
        }

        /// <summary>The highest rung the game ran at after the request, or -1 before any change.</summary>
        public int PeakIndex
        {
            get
            {
                var peak = -1;
                foreach (var step in _steps)
                {
                    if (step.Index > peak)
                    {
                        peak = step.Index;
                    }
                }
                return peak;
            }
        }

        /// <summary>
        /// What the request came to: whether the game ran the rung asked for and
        /// still did when read back, and in words when it reached it, how long it
        /// held it, and why the game lowered it.
        /// </summary>
        /// <param name="finalIndex">The rung the game runs at when read back.</param>
        public (bool Ok, string Message) Verdict(int finalIndex)
        {
            if (finalIndex == RequestedIndex)
            {
                return (true, "held the requested rung");
            }

            var reached = -1;
            for (var i = 0; i < _steps.Count; i++)
            {
                if (_steps[i].Index >= RequestedIndex)
                {
                    reached = i;
                    break;
                }
            }

            if (reached < 0)
            {
                var limited = LastReason();
                return (false, "never reached " + RequestedIndex + ": the game ran at most " + PeakIndex
                    + ", now " + finalIndex + Because(limited, LastCraft()) + Charge(LastCraft()));
            }

            var lowering = -1;
            for (var i = reached + 1; i < _steps.Count; i++)
            {
                if (_steps[i].Index < RequestedIndex)
                {
                    lowering = i;
                    break;
                }
            }

            if (lowering < 0)
            {
                return (false, "reached " + RequestedIndex + " but the game now runs at " + finalIndex
                    + " with no rate change recorded");
            }

            var held = _steps[lowering].AtSeconds - _steps[reached].AtSeconds;
            return (false, "reached " + RequestedIndex + ", held it " + Seconds(held) + ", then the game lowered it to "
                + _steps[lowering].Index + " at " + Seconds(_steps[lowering].AtSeconds)
                + Because(_steps[lowering].Reason, _steps[lowering].Craft) + Charge(_steps[lowering].Craft));
        }

        /// <summary>Every change as "+1.9s 7 (61255x)" with its reason when it has one, for the result file.</summary>
        public string Describe()
        {
            var sb = new StringBuilder();
            foreach (var step in _steps)
            {
                if (sb.Length > 0)
                {
                    sb.Append("; ");
                }
                sb.Append('+').Append(Seconds(step.AtSeconds)).Append(' ').Append(step.Index)
                    .Append(" (").Append(step.Rate.ToString("0.##", CultureInfo.InvariantCulture)).Append("x)");
                if (step.Reason != null)
                {
                    sb.Append(" ").Append(step.Reason);
                }
            }
            return sb.ToString();
        }

        /// <summary>KSP's name for a limit check outcome, in words.</summary>
        public static string ReasonWords(string status)
        {
            switch (status)
            {
                case "NOT_IN_ATMOSPHERE": return "the vessel is in or about to enter the atmosphere";
                case "NOT_UNDER_ACCELERATION": return "the vessel is under acceleration";
                case "NOT_WHILE_MOVING_OVER_SURFACE": return "the vessel is moving over the surface";
                case "NOT_WHILE_ABOUT_TO_CRASH": return "the altitude limit for that rung";
                case "NOT_WHILE_ON_A_LADDER": return "a kerbal is on a ladder";
                case "ORBIT_EVENT_IMMINENT": return "an orbit transition is imminent";
                default: return status;
            }
        }

        private string? LastReason()
        {
            for (var i = _steps.Count - 1; i >= 0; i--)
            {
                if (_steps[i].Reason != null)
                {
                    return _steps[i].Reason;
                }
            }
            return null;
        }

        private CraftState? LastCraft()
        {
            for (var i = _steps.Count - 1; i >= 0; i--)
            {
                if (_steps[i].Craft != null)
                {
                    return _steps[i].Craft;
                }
            }
            return null;
        }

        private static string Because(string? reason, CraftState? craft)
        {
            if (reason == null)
            {
                return ", lowered by something other than the game's own limits (for example another mod)";
            }

            var words = ": " + ReasonWords(reason);
            var altitudeReason = reason == "NOT_IN_ATMOSPHERE" || reason == "NOT_WHILE_ABOUT_TO_CRASH";
            if (altitudeReason && craft != null && craft.Altitude.HasValue && craft.LimitAltitude.HasValue)
            {
                words += " (craft at " + Metres(craft.Altitude.Value) + ", limit for the requested rung "
                    + Metres(craft.LimitAltitude.Value) + ")";
            }
            return words;
        }

        private string Charge(CraftState? atDrop)
        {
            var request = ChargeWords(AtRequest);
            var drop = ChargeWords(atDrop);
            if (request == null && drop == null)
            {
                return "";
            }
            return "; electric charge at request " + (request ?? "unknown") + ", at drop " + (drop ?? "unknown");
        }

        private static string? ChargeWords(CraftState? craft)
        {
            if (craft == null || !craft.Charge.HasValue || !craft.ChargeMax.HasValue)
            {
                return null;
            }
            return craft.Charge.Value.ToString("0.#", CultureInfo.InvariantCulture) + " of "
                + craft.ChargeMax.Value.ToString("0.#", CultureInfo.InvariantCulture);
        }

        private static string Metres(double value)
        {
            return value.ToString("0", CultureInfo.InvariantCulture) + " m";
        }

        private static string Seconds(double value)
        {
            return value.ToString("0.0", CultureInfo.InvariantCulture) + "s";
        }

        internal readonly struct Step
        {
            public Step(double atSeconds, int index, float rate, string? reason, CraftState? craft)
            {
                Craft = craft;
                AtSeconds = atSeconds;
                Index = index;
                Rate = rate;
                Reason = reason;
            }

            public double AtSeconds { get; }

            public int Index { get; }

            public float Rate { get; }

            public string? Reason { get; }

            public CraftState? Craft { get; }
        }

        /// <summary>
        /// The active craft's altitude, the altitude limit of the requested
        /// rung, and its electric charge, each null when it could not be read.
        /// </summary>
        internal sealed class CraftState
        {
            public CraftState(double? altitude, double? limitAltitude, double? charge, double? chargeMax)
            {
                Altitude = altitude;
                LimitAltitude = limitAltitude;
                Charge = charge;
                ChargeMax = chargeMax;
            }

            public double? Altitude { get; }

            public double? LimitAltitude { get; }

            public double? Charge { get; }

            public double? ChargeMax { get; }
        }
    }
}
