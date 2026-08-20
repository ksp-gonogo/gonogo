using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// <see cref="IGateArguments"/> over whatever a dispatch actually carried.
    ///
    /// <para>Command args reach the engine in two shapes. Off the wire they are
    /// the decoded generic bag (see <c>EnvelopeCodec.ParseCommandRequest</c>), a
    /// dictionary keyed by wire name. From an in-process dispatch they are the
    /// uplink's own typed args object. Both have to answer the same question, so
    /// this handles both rather than making requirement authors care which
    /// arrived.</para>
    /// </summary>
    internal sealed class GateArguments : IGateArguments
    {
        /// <summary>
        /// The addressability bag: nothing is known, so every
        /// argument-dependent requirement abstains. A real object rather than a
        /// null so no evaluator ever needs a null check, which would be the
        /// abstention arithmetic leaking out of the host.
        /// </summary>
        internal static readonly GateArguments None = new GateArguments(null);

        private readonly object _args;

        internal GateArguments(object args)
        {
            _args = args;
        }

        public bool TryGet(string path, out object value)
        {
            value = null;
            if (_args == null || string.IsNullOrEmpty(path)) return false;

            if (_args is IDictionary<string, object> bag)
            {
                return bag.TryGetValue(path, out value) && value != null;
            }

            // A typed args object: look the property up BY NAME rather than
            // enumerating. GetProperties() materialises every property's
            // attributes, and on the netstandard2.0 contract that means
            // resolving Reinforced.Typings, which is deliberately never
            // deployed: the exact throw that aborted every delayed dispatch
            // until 2026-08-20. A targeted lookup reads no attributes at all.
            var property = _args.GetType().GetProperty(
                path,
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property == null) return false;
            value = property.GetValue(_args, null);
            return value != null;
        }
    }
}
