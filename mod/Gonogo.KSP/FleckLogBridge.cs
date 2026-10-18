using System;
using Sitrep.Host;
using Sitrep.Vendor.Fleck;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Carries the WebSocket server's own messages (listener restarts, failed
    /// sends, application errors) into KSP.log. The server writes to the
    /// console by default, which KSP does not capture.
    /// </summary>
    internal static class FleckLogBridge
    {
        private const string StartedMessage = "Server started at";

        private static readonly LogLimiter Limiter = new LogLimiter();

        public static void Install()
        {
            FleckLog.Level = LogLevel.Info;
            FleckLog.LogAction = Write;
        }

        /// <summary>The leading words of a server message, so a message that embeds an address or a count still shares one limiter key.</summary>
        private static string FirstWords(string message)
        {
            string[] words = message.Split(new[] { ' ' }, 4, StringSplitOptions.RemoveEmptyEntries);
            return string.Join(" ", words, 0, Math.Min(3, words.Length));
        }

        private static void Write(LogLevel level, string message, Exception? ex)
        {
            // The server's own start line names the bind address; the plugin's
            // Started line reports the port instead.
            if (level < LogLevel.Info || message.StartsWith(StartedMessage, StringComparison.Ordinal))
            {
                return;
            }

            if (!Limiter.ShouldLog(level + ":" + ex?.GetType().Name + ":" + FirstWords(message), out int held))
            {
                return;
            }

            string line = PathRedactor.Redact(LogLimiter.Compose(message, held)) + (ex == null ? "" : ": " + ExceptionLine.Describe(ex));
            switch (level)
            {
                case LogLevel.Error:
                    GonogoLog.Error("transport", line);
                    break;
                case LogLevel.Warn:
                    GonogoLog.Warn("transport", line);
                    break;
                default:
                    GonogoLog.Info("transport", line);
                    break;
            }
        }
    }
}
