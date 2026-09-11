using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>What a reading attempt came back with.</summary>
    public enum ScetReadingStatus
    {
        /// <summary>
        /// Nothing to compare THIS TICK, and no statement about why. No vessel
        /// loaded yet, the alarm's craft is not the one the payload describes,
        /// the path names nothing, or the value is not a finite number.
        ///
        /// <para>Deliberately one status rather than four. An alarm that cannot
        /// be read simply does not fire, which is the same fail-safe posture the
        /// client's own list takes for a trigger it cannot evaluate, and telling
        /// the four apart would only let the roster act differently on
        /// distinctions that all mean "not now".</para>
        /// </summary>
        NotObservable,

        /// <summary>A finite number was read, and <see cref="ScetReading.Value"/> is it.</summary>
        Observed,

        /// <summary>
        /// The craft the alarm names is gone from the simulation entirely, so
        /// the condition can never be met again. Distinct from
        /// <see cref="NotObservable"/> because it is permanent and because it is
        /// something the simulation knows and the command centre does not.
        /// </summary>
        SubjectGone,
    }

    /// <summary>One attempt to read the value a threshold condition watches.</summary>
    public readonly struct ScetReading
    {
        public ScetReadingStatus Status { get; }

        /// <summary>The reading, meaningful only when <see cref="Status"/> is <see cref="ScetReadingStatus.Observed"/>.</summary>
        public double Value { get; }

        private ScetReading(ScetReadingStatus status, double value)
        {
            Status = status;
            Value = value;
        }

        public static ScetReading Observed(double value) =>
            new ScetReading(ScetReadingStatus.Observed, value);

        public static readonly ScetReading NotObservable =
            new ScetReading(ScetReadingStatus.NotObservable, 0);

        public static readonly ScetReading SubjectGone =
            new ScetReading(ScetReadingStatus.SubjectGone, 0);
    }

    /// <summary>
    /// What the roster is handed so it can evaluate a threshold: one question,
    /// "what does this craft's Topic say at this field right now".
    ///
    /// <para>The seam exists so <see cref="ScetAlarmRoster"/> stays what it is:
    /// told the clock, told the readings, deciding only what should happen. The
    /// reading itself is taken upstream of the reveal gate, which is the whole
    /// point of a SCET threshold and the only part of it that touches the
    /// game's own state.</para>
    /// </summary>
    public interface IScetStateReader
    {
        /// <summary>
        /// Read <paramref name="fieldPath"/> out of <paramref name="topic"/>'s
        /// payload, for the craft named by <paramref name="subject"/> in the
        /// <c>"vessel:&lt;guid&gt;"</c> / <c>"game"</c> vocabulary
        /// <see cref="ScetAlarm.Subject"/> uses.
        /// </summary>
        ScetReading Read(string subject, string topic, string fieldPath);
    }
}
