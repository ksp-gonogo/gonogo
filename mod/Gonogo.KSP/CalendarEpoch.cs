using System;
using System.Globalization;
using System.Reflection;

namespace Gonogo.KSP
{
    /// <summary>
    /// Reads the real-world instant UT 0 corresponds to off whatever date
    /// formatter the running game installed, as an ISO-8601 UTC string, or
    /// <c>null</c> when there is no such instant.
    ///
    /// <para><b>Why reflection.</b> <c>IDateTimeFormatter</c> declares the
    /// LENGTH of a minute, hour, day and year and nothing about which day it
    /// is. Implementations that model a real calendar (RSSTimeFormatter,
    /// Kronometer) build every string by adding the UT to a <c>DateTime</c>
    /// they hold privately, and that field is not on the interface. RP-1
    /// reaches for it the same way and for the same reason
    /// (<c>RP0.RP0DTUtils.TryGetEpoch</c>), which is the closest thing to a
    /// convention this corner of the ecosystem has; matching its rules exactly
    /// is what makes this work against formatters nobody here has heard of.
    /// </para>
    ///
    /// <para><b>Named <c>epoch</c> first, then a lone candidate.</b> A single
    /// unambiguous <c>DateTime</c> field is taken even under another name,
    /// because a formatter that has exactly one has only one thing it could
    /// be. Two or more and this refuses rather than guesses: an anchor picked
    /// by coin toss renders every date on the board wrong while still looking
    /// like a date.</para>
    ///
    /// <para><b>Kept free of KSP types</b> so it is testable headlessly
    /// against a stand-in formatter, the same discipline as
    /// <c>CommNetOcclusion</c> and <c>PlanOwner</c>. The caller passes
    /// <c>KSPUtil.dateTimeFormatter</c> as a plain <c>object</c>; nothing here
    /// needs to know the interface exists.</para>
    /// </summary>
    internal static class CalendarEpoch
    {
        private const BindingFlags FieldFlags =
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        /// <summary>
        /// The formatter's epoch as <c>yyyy-MM-ddTHH:mm:ssZ</c>, or
        /// <c>null</c> for the stock formatter and anything else that holds no
        /// single unambiguous <c>DateTime</c>.
        ///
        /// <para>Never throws. A formatter whose field access is refused by
        /// the runtime is a reason to publish no epoch, not a reason to break
        /// the <c>time</c> capture that carries warp and pause beside
        /// it.</para>
        /// </summary>
        internal static string? Read(object? formatter)
        {
            if (formatter == null)
            {
                return null;
            }

            try
            {
                var field = FindEpochField(formatter.GetType());
                if (field == null)
                {
                    return null;
                }

                var value = field.GetValue(formatter);
                if (!(value is DateTime epoch))
                {
                    return null;
                }

                // Stated as UTC whatever the formatter's own DateTimeKind says.
                // A wall-clock instant with no zone is one a client is free to
                // shift by its own offset, and an epoch shifted by the hours
                // between the operator's desk and Greenwich is an anchor that
                // moves house to house.
                return DateTime.SpecifyKind(epoch, DateTimeKind.Utc)
                    .ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static FieldInfo? FindEpochField(Type type)
        {
            var named = type.GetField("epoch", FieldFlags);
            if (named != null && named.FieldType == typeof(DateTime))
            {
                return named;
            }

            FieldInfo? only = null;
            foreach (var candidate in type.GetFields(FieldFlags))
            {
                if (candidate.FieldType != typeof(DateTime))
                {
                    continue;
                }

                if (only != null)
                {
                    return null;
                }

                only = candidate;
            }

            return only;
        }
    }
}
