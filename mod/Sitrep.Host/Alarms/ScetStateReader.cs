using System;
using System.Collections.Generic;
using System.Globalization;
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

    /// <summary>
    /// Getting a provenance stamp and a number out of one wire payload.
    ///
    /// <para>Shared because the two readers differ ONLY in where the payload
    /// came from: <see cref="SnapshotScetStateReader"/> builds it from this
    /// tick's snapshot, <see cref="RevealedScetStateReader"/> takes the one the
    /// archive says a vantage has been told. What a payload MEANS once you hold
    /// it is the same question either way, and two copies of this walk would be
    /// two chances for a SCET alarm and its command-vantage twin to disagree for
    /// a reason that has nothing to do with delay.</para>
    /// </summary>
    internal static class ScetPayload
    {
        /// <summary>
        /// The payload's own provenance stamp, which is the ONLY thing that
        /// stops an alarm armed against one craft answering off another's
        /// readings after the player switches vessels. A payload that does not
        /// say who it is about is not an answer to a question that names a
        /// craft.
        /// </summary>
        internal static string? ReadSource(IDictionary<string, object?> root) =>
            root.TryGetValue("meta", out var raw)
                && raw is IDictionary<string, object?> meta
                && meta.TryGetValue("source", out var source)
                    ? source as string
                    : null;

        /// <summary>
        /// Walk a dotted path to a finite number, or null for anything else.
        ///
        /// <para>A bool or a string at the end of the path is a miss rather than
        /// a coercion. A threshold is a comparison between two numbers, and
        /// turning <c>true</c> into 1 would let an operator arm "landed &gt; 0.5"
        /// and get an alarm whose meaning nothing on screen explains.</para>
        /// </summary>
        internal static double? ReadNumber(IDictionary<string, object?> root, string fieldPath)
        {
            object? current = root;
            var from = 0;
            while (from <= fieldPath.Length)
            {
                var dot = fieldPath.IndexOf('.', from);
                var segment = dot < 0
                    ? fieldPath.Substring(from)
                    : fieldPath.Substring(from, dot - from);
                if (segment.Length == 0
                    || current is not IDictionary<string, object?> node
                    || !node.TryGetValue(segment, out current))
                {
                    return null;
                }
                if (dot < 0)
                {
                    break;
                }
                from = dot + 1;
            }

            return AsFiniteNumber(current);
        }

        private static double? AsFiniteNumber(object? value)
        {
            double number;
            switch (value)
            {
                case double d: number = d; break;
                case float f: number = f; break;
                case int i: number = i; break;
                case long l: number = l; break;
                case short s: number = s; break;
                case byte b: number = b; break;
                case decimal m: number = (double)m; break;
                // An enum reaches the wire as its integer, and a threshold on one
                // is a legitimate way to ask "has the situation changed".
                case Enum e: number = Convert.ToDouble(e, CultureInfo.InvariantCulture); break;
                default: return null;
            }
            return double.IsNaN(number) || double.IsInfinity(number) ? null : number;
        }
    }
}
