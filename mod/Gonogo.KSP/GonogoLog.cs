using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The only writer of the plugin's lines to KSP.log, and the only owner of
    /// the "[Gonogo] " prefix: no other code in the shipped mod calls
    /// <c>Debug.Log</c>. A subsystem passes a short tag and the line reads
    /// "[Gonogo] tag: message". An exception is folded onto that one line
    /// (type, message, first frame). The first time a call site reports an
    /// exception, the full stack trace follows on a second prefixed line.
    /// </summary>
    internal static class GonogoLog
    {
        private const string Prefix = "[Gonogo] ";

        private static readonly LogLimiter Limiter = new LogLimiter();
        private static readonly HashSet<string> TracedSites = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>An informational line from the subsystem named <paramref name="tag"/>.</summary>
        public static void Info(string tag, string message)
        {
            Emit(LogType.Log, Compose(tag, message));
        }

        /// <summary>A warning from the subsystem named <paramref name="tag"/>.</summary>
        public static void Warn(string tag, string message)
        {
            Emit(LogType.Warning, Compose(tag, message));
        }

        /// <summary>An error from the subsystem named <paramref name="tag"/>.</summary>
        public static void Error(string tag, string message)
        {
            Emit(LogType.Error, Compose(tag, message));
        }

        /// <summary>A warning about <paramref name="ex"/>, logged every time it fires.</summary>
        public static void Warn(
            string message,
            Exception ex,
            [CallerFilePath] string file = "",
            [CallerLineNumber] int line = 0)
        {
            Write(LogType.Warning, message, ex, SiteKey(file, line), limited: false);
        }

        /// <summary>An error about <paramref name="ex"/>, logged every time it fires.</summary>
        public static void Error(
            string message,
            Exception ex,
            [CallerFilePath] string file = "",
            [CallerLineNumber] int line = 0)
        {
            Write(LogType.Error, message, ex, SiteKey(file, line), limited: false);
        }

        /// <summary>
        /// A warning from a call site that can fire every tick: the first
        /// occurrence in full, then at most one line a minute carrying how many
        /// were held back. Each call site is limited on its own, so a site that
        /// loops over parts shares one budget across all of them.
        /// </summary>
        public static void WarnLimited(
            string message,
            Exception? ex = null,
            [CallerFilePath] string file = "",
            [CallerLineNumber] int line = 0)
        {
            Write(LogType.Warning, message, ex, SiteKey(file, line), limited: true);
        }

        /// <summary>As <see cref="WarnLimited"/>, at error level.</summary>
        public static void ErrorLimited(
            string message,
            Exception? ex = null,
            [CallerFilePath] string file = "",
            [CallerLineNumber] int line = 0)
        {
            Write(LogType.Error, message, ex, SiteKey(file, line), limited: true);
        }

        /// <summary>
        /// Carries a diagnostic from the host or from an Uplink to KSP.log as a
        /// warning, with the install and home folders taken out of it.
        /// </summary>
        public static void Sink(string message)
        {
            Emit(LogType.Warning, Compose(null, message));
        }

        private static string Compose(string? tag, string message)
        {
            string head = string.IsNullOrEmpty(tag) ? Prefix : Prefix + tag + ": ";
            return head + PathRedactor.Redact(message);
        }

        private static void Write(LogType type, string message, Exception? ex, string site, bool limited)
        {
            int held = 0;
            // The exception type joins the key so two different faults at one
            // site each get their first line.
            if (limited && !Limiter.ShouldLog(site + ex?.GetType().Name, out held))
            {
                return;
            }

            string line = LogLimiter.Compose(message, held);
            if (ex != null)
            {
                line += ": " + ExceptionLine.Describe(ex);
            }

            Emit(type, Prefix + PathRedactor.Redact(line));

            if (ex != null && FirstTraceFor(site))
            {
                Emit(type, Prefix + PathRedactor.Redact("trace of the line above (" + site + "): " + OneLine(ex.ToString())));
            }
        }

        private static bool FirstTraceFor(string site)
        {
            lock (TracedSites)
            {
                return TracedSites.Add(site);
            }
        }

        private static void Emit(LogType type, string text)
        {
            if (type == LogType.Error)
            {
                Debug.LogError(text);
            }
            else if (type == LogType.Warning)
            {
                Debug.LogWarning(text);
            }
            else
            {
                Debug.Log(text);
            }
        }

        private static string OneLine(string text)
        {
            return text.Replace("\r\n", " | ").Replace('\n', '|').Replace('\r', '|');
        }

        private static string SiteKey(string file, int line)
        {
            return Path.GetFileName(file) + ":" + line;
        }
    }
}
