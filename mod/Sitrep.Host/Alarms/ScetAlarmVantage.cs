using System;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Whether an alarm may be armed where it says, and when not, which refusal
    /// the operator is owed.
    ///
    /// <para>The two refusals are separate because they are different claims. One
    /// says the simulation knows its places and this is not among them; the other
    /// says the simulation does not know its places yet. A single refusal would
    /// have to pick one of those to say, and saying the first during a scene load
    /// is a statement the simulation has not earned.</para>
    /// </summary>
    public enum ScetVantageVerdict
    {
        /// <summary>The alarm can be evaluated where it names.</summary>
        Armable,

        /// <summary>Command centres are known, and this vantage is not one of them.</summary>
        NoSuchPlace,

        /// <summary>No command centre is known at all yet, so nothing can be said about this one.</summary>
        NoPlacesKnown,
    }

    /// <summary>
    /// Where an alarm's condition is read from, whether that place is the
    /// subject's own, and whether it is a place at all.
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
        /// What an arm is ABOUT, with the contract's default applied. Empty is
        /// read as <c>"game"</c>, the token for anything the whole simulation
        /// shares.
        /// </summary>
        public static string SubjectOf(ScetAlarmArmArgs? args) =>
            string.IsNullOrEmpty(args?.Subject) ? "game" : args!.Subject!;

        /// <summary>
        /// Where an arm will be READ, with an empty vantage resolved to its
        /// subject.
        ///
        /// <para>Here rather than at each caller because the arm is validated in
        /// one place and stored in another, and a vantage that resolved
        /// differently in the two would be checked against a place the roster
        /// never held.</para>
        /// </summary>
        public static string Of(ScetAlarmArmArgs? args)
        {
            var subject = SubjectOf(args);
            return string.IsNullOrEmpty(args?.Vantage) ? subject : args!.Vantage!;
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

        /// <summary>
        /// Whether an alarm read at <paramref name="vantage"/> about
        /// <paramref name="subject"/> can be evaluated at all, and when it
        /// cannot, which refusal it is.
        ///
        /// <para>A vantage nothing corresponds to reads nothing and never comes
        /// due, and an operator cannot tell that apart from a condition that has
        /// not been met. So it is refused at arm rather than left to sit, which
        /// is the posture an unaddressable Topic already gets.</para>
        ///
        /// <para><paramref name="selectable"/> is the simulation's answer about
        /// the place, and its NULL means the simulation does not yet know what
        /// places exist: the set is empty until the first tick, and at the main
        /// menu where no game is loaded. That refuses too, but as its own
        /// verdict: accepting there would arm an alarm that reads nothing and
        /// that nothing will ever re-check, which is the silent failure this
        /// whole check exists to remove, while refusing it as "no such place"
        /// would state something the simulation has not established.</para>
        ///
        /// <para>Asked ONCE, when the arm is requested, and never again. A
        /// crewed centre stops being one the moment its crew leaves, and
        /// re-asking would kill a standing alarm for a reason the operator never
        /// acted on. The engine holds a command's own vantage to the same rule.</para>
        /// </summary>
        public static ScetVantageVerdict VerdictFor(string? vantage, string? subject, bool? selectable)
        {
            // Its own subject reads the tick's snapshot and asks the ledger
            // nothing, so there is no place here to get wrong. This is the whole
            // population that predates command-centre vantages, and an arm naming
            // no vantage resolves to it, so the check only ever bites an arm that
            // named a place of its own.
            if (string.Equals(vantage ?? "", subject ?? "", StringComparison.Ordinal))
            {
                return ScetVantageVerdict.Armable;
            }
            if (selectable == null)
            {
                return ScetVantageVerdict.NoPlacesKnown;
            }
            return selectable.Value ? ScetVantageVerdict.Armable : ScetVantageVerdict.NoSuchPlace;
        }
    }
}
