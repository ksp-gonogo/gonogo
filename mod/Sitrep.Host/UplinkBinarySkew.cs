using System;
using System.Reflection;

namespace Sitrep.Host
{
    /// <summary>
    /// Recognises the failures an Uplink produces when it was built against a
    /// different <c>Sitrep.Contract</c> than the one this core loaded: a call
    /// to a member whose signature changed, or a type that no longer exists.
    /// They pass the declared-version gate when the change landed inside one
    /// minor, and surface only at the first call into the changed member.
    /// </summary>
    public static class UplinkBinarySkew
    {
        /// <summary>
        /// Whether <paramref name="error"/>, or an exception it wraps, is a missing
        /// member or type. Useful for telling a mismatched Uplink build from a
        /// transient failed read. Used by <see cref="ChannelEngine.QuarantineProviderOwner"/>.
        /// </summary>
        public static bool IsSkew(Exception? error)
        {
            for (var depth = 0; error != null && depth < 8; depth++)
            {
                if (error is MissingMemberException || error is TypeLoadException)
                {
                    return true;
                }

                error = error is TargetInvocationException || error is TypeInitializationException || error is AggregateException
                    ? error.InnerException
                    : null;
            }

            return false;
        }
    }
}
