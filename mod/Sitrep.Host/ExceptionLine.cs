using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Renders an exception as one line: its type, its message and the first
    /// stack frame, so a log line that starts with the mod's prefix carries the
    /// whole fault.
    /// </summary>
    public static class ExceptionLine
    {
        /// <summary>
        /// The type, message and first frame of <paramref name="ex"/> (and of
        /// each inner exception, joined with " <- "), with line breaks folded
        /// to spaces and absolute paths cut down by <see cref="PathRedactor"/>. A null
        /// exception renders as an empty string.
        /// </summary>
        public static string Describe(Exception ex)
        {
            if (ex == null)
            {
                return "";
            }

            var text = new System.Text.StringBuilder();
            for (Exception e = ex; e != null; e = e.InnerException)
            {
                if (text.Length > 0)
                {
                    text.Append(" <- ");
                }

                text.Append(e.GetType().Name).Append(": ").Append(PathRedactor.Redact(OneLine(SafeMessage(e))));
                string frame = FirstFrame(SafeStackTrace(e));
                if (frame.Length > 0)
                {
                    text.Append(" at ").Append(frame);
                }
            }

            return text.ToString();
        }

        private static string SafeMessage(Exception e)
        {
            try
            {
                return e.Message;
            }
            catch
            {
                return "(message unreadable)";
            }
        }

        private static string SafeStackTrace(Exception e)
        {
            try
            {
                return e.StackTrace;
            }
            catch
            {
                return "";
            }
        }

        private static string FirstFrame(string stackTrace)
        {
            if (string.IsNullOrEmpty(stackTrace))
            {
                return "";
            }

            string first = stackTrace.Split('\n')[0].Trim();
            if (first.StartsWith("at ", StringComparison.Ordinal))
            {
                first = first.Substring(3);
            }

            // The source location after " in " is an absolute build path.
            int location = first.IndexOf(" in ", StringComparison.Ordinal);
            return location > 0 ? first.Substring(0, location) : first;
        }

        private static string OneLine(string text)
        {
            return string.IsNullOrEmpty(text)
                ? ""
                : text.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');
        }
    }
}
