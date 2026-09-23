using System;
using System.Reflection;
using Strategies;

namespace Gonogo.KSP
{
    /// <summary>
    /// The two <c>private</c> fields of <c>Strategies.Strategy</c> that
    /// <c>Strategy.Activate()</c> writes and exposes no setter for, resolved once.
    ///
    /// <para>Reflection resolves at run time, so a renamed or retyped field
    /// breaks no compile. Each is therefore resolved against its exact name AND
    /// type, and a miss is a null the caller must refuse on before it writes
    /// anything; <c>StrategyPrivateFieldsMirrorTests</c> holds both against the
    /// installed <c>Assembly-CSharp</c> so a KSP build that moves one turns a
    /// test red.</para>
    /// </summary>
    internal static class StrategyPrivateFields
    {
        /// <summary><c>private bool isActive</c>, behind the public <c>IsActive</c> getter.</summary>
        public static readonly FieldInfo? IsActive = Resolve("isActive", typeof(bool));

        /// <summary><c>private double dateActivated</c>, behind the public <c>DateActivated</c> getter.</summary>
        public static readonly FieldInfo? DateActivated = Resolve("dateActivated", typeof(double));

        /// <summary>Whether both resolved, so a write can go ahead at all.</summary>
        public static bool Resolved => IsActive != null && DateActivated != null;

        /// <summary>
        /// A private instance field declared on <c>Strategy</c> itself with
        /// exactly <paramref name="type"/>, or null.
        /// </summary>
        internal static FieldInfo? Resolve(string name, Type type)
        {
            try
            {
                var field = typeof(Strategy).GetField(
                    name,
                    BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                return field != null && field.FieldType == type && !field.IsInitOnly ? field : null;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
