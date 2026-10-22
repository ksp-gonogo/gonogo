using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// How an item that a call names with several arguments is written down: a part and
    /// an experiment, say, rather than one id. The gate report calls such an item's
    /// argument the names joined with <see cref="ArgumentSeparator"/>, and its value the
    /// values joined with <see cref="ValueSeparator"/>, both in the order the requirement
    /// lists its needs.
    /// </summary>
    /// <category>Commands</category>
    public static class GateItemKey
    {
        /// <summary>Joins the argument names of an item that is named by more than one.</summary>
        public const char ArgumentSeparator = '+';

        /// <summary>Joins the values of an item that is named by more than one. A control character, so no id contains it.</summary>
        public const char ValueSeparator = '\u001f';

        /// <summary>The argument the gate report keys <paramref name="needs"/> under: the one need itself, or the names joined.</summary>
        public static string ArgumentOf(IReadOnlyList<string> needs) =>
            string.Join(ArgumentSeparator.ToString(), needs);

        /// <summary>The value that names the item whose needs have these <paramref name="values"/>, in the order of the needs.</summary>
        public static string ValueOf(params string[] values) =>
            string.Join(ValueSeparator.ToString(), values);

        /// <summary>
        /// The arguments a call naming this item would carry: each name of
        /// <paramref name="argument"/> with its part of <paramref name="value"/>. An item
        /// with fewer values than names is given only the ones it has.
        /// </summary>
        public static Dictionary<string, object> Arguments(string argument, string value)
        {
            var names = argument.Split(ArgumentSeparator);
            var values = value.Split(ValueSeparator);
            var bag = new Dictionary<string, object>();
            for (var i = 0; i < names.Length && i < values.Length; i++)
            {
                bag[names[i]] = values[i];
            }
            return bag;
        }
    }
}
