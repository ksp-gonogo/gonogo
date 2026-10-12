using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// The <c>alarm.scet</c> roster as one session may receive it: an alarm armed
    /// at another command centre keeps its id, who armed it and where it has got
    /// to, and loses what it watches. See <see cref="ScetAlarm.Withheld"/>.
    /// </summary>
    public static class ScetRosterRedaction
    {
        /// <summary>
        /// The <see cref="ChannelDeclaration.ViewerFilter"/> for the roster
        /// channel. A payload that is not a list of alarms passes through.
        /// </summary>
        public static object ForViewer(object payload, ViewerContext viewer)
        {
            if (!(payload is IEnumerable<ScetAlarm> alarms))
            {
                return payload;
            }

            var rows = new List<ScetAlarm>();
            foreach (var alarm in alarms)
            {
                rows.Add(IsWithheldFrom(alarm, viewer.Vantage) ? Redacted(alarm) : alarm);
            }
            return rows;
        }

        /// <summary>
        /// Whether a session at <paramref name="vantage"/> is kept from what
        /// <paramref name="alarm"/> watches: every alarm armed elsewhere, except
        /// one on universal time.
        /// </summary>
        public static bool IsWithheldFrom(ScetAlarm alarm, string vantage) =>
            alarm.Condition?.Kind != ScetAlarmConditionKind.Time
            && alarm.ArmedBy != vantage;

        private static ScetAlarm Redacted(ScetAlarm alarm) => new ScetAlarm
        {
            Id = alarm.Id,
            ArmedBy = alarm.ArmedBy,
            State = alarm.State,
            FiredAtUt = alarm.FiredAtUt,
            Withheld = true,
            Name = "",
            Vantage = "",
            Subject = "",
            Condition = null,
            OnFire = new List<ScetAlarmAction>(),
            ActsOn = "",
        };
    }
}
