using System;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Where an alarm's condition is read from, and whether that place is the
    /// subject's own.
    ///
    /// <para>The answer decides which reader the alarm is evaluated through, and
    /// therefore which thread it is evaluated on: the subject's own state is
    /// this tick's snapshot, taken on the main thread upstream of the reveal
    /// gate, and anywhere else is what the archive says has reached that place,
    /// read on the Courier.</para>
    ///
    /// <para><b>Identity, never a delay test.</b> "Zero delay reads the
    /// snapshot, positive delay reads the archive" is the tempting rule and it
    /// is wrong: at zero light-time the archive answers only for as long as
    /// something is subscribed, so a delay test puts a cliff at one second of
    /// light time that an operator cannot see and a widget's visibility decides.
    /// Whether a vantage IS the subject is a stable fact about the alarm.</para>
    /// </summary>
    public static class ScetAlarmVantage
    {
        /// <summary>
        /// The place <paramref name="alarm"/>'s condition is read at. An alarm
        /// naming no vantage is read at its own subject's: there is no reading
        /// "at the simulation" that is not the reading at the subject's own
        /// vantage, which is what it always was.
        /// </summary>
        public static string Of(ScetAlarm? alarm)
        {
            if (alarm == null)
            {
                return "";
            }
            return string.IsNullOrEmpty(alarm.Vantage) ? alarm.Subject ?? "" : alarm.Vantage!;
        }

        /// <summary>
        /// Whether <paramref name="alarm"/> is read off the simulation's own
        /// state rather than off what somewhere else has been told. True for
        /// every alarm at its subject craft's vantage, which is the whole of the
        /// population that predates command-centre vantages, and it is why those
        /// alarms keep reading exactly what they read before.
        /// </summary>
        public static bool IsTheSubjectsOwn(ScetAlarm? alarm) =>
            string.Equals(Of(alarm), alarm?.Subject ?? "", StringComparison.Ordinal);
    }
}
