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
        /// be read simply does not fire, and telling the four apart would only
        /// let the roster act differently on distinctions that all mean "not
        /// now".</para>
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

        /// <summary>
        /// <paramref name="topic"/>'s whole payload, when it is about
        /// <paramref name="subject"/>; null when there is none to read or it is
        /// about something else. For a condition that needs more than one number
        /// out of a payload, under the same provenance rule
        /// <see cref="Read"/> applies.
        /// </summary>
        IDictionary<string, object?>? ReadPayload(string subject, string topic);
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

        /// <summary>
        /// Whether one objective of one active contract is in
        /// <paramref name="target"/>, read out of a <c>career.status</c> payload.
        ///
        /// <para>Three answers, the same three the client's own matcher gives.
        /// Null when the list could not be read at all, which is a different
        /// claim from an empty one. False when the contract is not active or has
        /// no objective of that title, which is a fact about the career, and
        /// for an objective whose state is not a number. True only on the
        /// ordinal, never the name, so a renamed state cannot silently stop an
        /// alarm matching.</para>
        /// </summary>
        internal static bool? MatchContractParameter(
            IDictionary<string, object?> career, string contractId, string parameterTitle, KspParameterState target)
        {
            if (!career.TryGetValue("contracts", out var rawContracts)
                || rawContracts is not IDictionary<string, object?> contracts
                || !contracts.TryGetValue("active", out var rawActive)
                || rawActive is not IEnumerable<object?> active)
            {
                return null;
            }
            foreach (var rawContract in active)
            {
                if (rawContract is not IDictionary<string, object?> contract
                    || !contract.TryGetValue("id", out var id)
                    || !string.Equals(id as string, contractId, StringComparison.Ordinal))
                {
                    continue;
                }
                if (!contract.TryGetValue("parameters", out var rawParameters)
                    || rawParameters is not IEnumerable<object?> parameters)
                {
                    return null;
                }
                foreach (var rawParameter in parameters)
                {
                    if (rawParameter is not IDictionary<string, object?> parameter
                        || !parameter.TryGetValue("title", out var title)
                        || !string.Equals(title as string, parameterTitle, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    parameter.TryGetValue("stateOrdinal", out var ordinal);
                    return AsFiniteNumber(ordinal) is { } state && state == (int)target;
                }
                return false;
            }
            return false;
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
