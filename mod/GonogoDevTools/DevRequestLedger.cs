using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;

namespace Gonogo.DevTools
{
    /// <summary>What a one-shot dev tool should do with the request file it just read.</summary>
    internal enum DevRequestDecision
    {
        /// <summary>A request this KSP session wrote and nothing has applied yet.</summary>
        Apply,

        /// <summary>This id was already applied, by this process or an earlier one. Say nothing.</summary>
        AlreadyApplied,

        /// <summary>
        /// The file was last written before this KSP process started, so it belongs to an
        /// earlier session. Refuse it once, in the result file, and never apply it.
        /// </summary>
        PredatesSession,
    }

    /// <summary>
    /// The applied-once guard for a dev tool whose request is an ACTION (teleport a craft,
    /// award science, stamp a scan, capture a fixture) rather than standing state.
    ///
    /// <para>A request cfg outlives the process that applied it, and an id held only in
    /// memory resets with the process, so every KSP start would apply whatever request was
    /// still on disk to whatever vessel happened to be active: a teleport meant for one
    /// craft lands on the next one launched. Two guards close that, and each covers a case
    /// the other cannot. The on-disk stamp remembers an id across a restart. The session
    /// rule refuses a request written before this process started, which also catches a
    /// stale request whose stamp was lost or never written.</para>
    ///
    /// <para>A stamp rather than consuming the request, because the request file is the
    /// operator's, written over SSH or through syncthing: deleting or rewriting it takes
    /// their input away and races the sync. Running the same request again stays a
    /// deliberate act: bump the id.</para>
    ///
    /// <para>No KSP or Unity types, so the decision is testable without a game.</para>
    /// </summary>
    internal sealed class DevRequestLedger
    {
        /// <summary>The sentence a refused stale request's result carries.</summary>
        internal const string PredatesSessionMessage =
            "refused: this request file was written before the running KSP session started, "
            + "so it belongs to an earlier session. Nothing was applied. Write it again with a new id to apply it now.";

        private static readonly Dictionary<string, string> ProcessApplied =
            new Dictionary<string, string>(StringComparer.Ordinal);

        private static readonly object Gate = new object();

        private static DateTime? _sessionStartUtc;

        private readonly string _stampPath;
        private readonly DateTime _sessionStartOverrideUtc;

        /// <param name="stampPath">Where this tool's applied stamp lives, one file per tool.</param>
        internal DevRequestLedger(string stampPath)
            : this(stampPath, SessionStartUtc)
        {
        }

        internal DevRequestLedger(string stampPath, DateTime sessionStartUtc)
        {
            _stampPath = stampPath;
            _sessionStartOverrideUtc = sessionStartUtc;
        }

        /// <summary>
        /// When this KSP process started. Falls back to the first time anything asked,
        /// which is plugin load and so still earlier than any request this session writes.
        /// </summary>
        internal static DateTime SessionStartUtc
        {
            get
            {
                lock (Gate)
                {
                    if (_sessionStartUtc.HasValue)
                    {
                        return _sessionStartUtc.Value;
                    }

                    DateTime start;
                    try
                    {
                        start = Process.GetCurrentProcess().StartTime.ToUniversalTime();
                    }
                    catch (Exception)
                    {
                        start = DateTime.UtcNow;
                    }

                    _sessionStartUtc = start;
                    return start;
                }
            }
        }

        internal DevRequestDecision Decide(string requestId, DateTime requestWrittenUtc)
        {
            lock (Gate)
            {
                if (ProcessApplied.TryGetValue(_stampPath, out var applied)
                    && string.Equals(applied, requestId, StringComparison.Ordinal))
                {
                    return DevRequestDecision.AlreadyApplied;
                }
            }

            if (string.Equals(ReadStampedId(), requestId, StringComparison.Ordinal))
            {
                return DevRequestDecision.AlreadyApplied;
            }

            return requestWrittenUtc < _sessionStartOverrideUtc
                ? DevRequestDecision.PredatesSession
                : DevRequestDecision.Apply;
        }

        /// <summary>
        /// <see cref="Decide"/>, then <see cref="Claim"/> unless the id was already applied:
        /// the one call a tool's poll makes.
        /// </summary>
        /// <param name="stampFailure">Why the stamp could not be written, or null.</param>
        internal DevRequestDecision Admit(string requestId, DateTime requestWrittenUtc, out string? stampFailure)
        {
            var decision = Decide(requestId, requestWrittenUtc);
            stampFailure = decision == DevRequestDecision.AlreadyApplied ? null : Claim(requestId);
            return decision;
        }

        /// <summary>
        /// Records the id as applied, in memory and on disk, BEFORE the tool acts on it: a
        /// request that throws half way must not be retried every poll, nor after a restart.
        /// A refused stale request is claimed the same way, so it is refused once rather
        /// than on every poll.
        /// </summary>
        /// <returns>
        /// The reason the stamp could not be written, or null. A failed stamp still leaves
        /// the in-memory claim, so the cost is a repeat after the NEXT restart, not now.
        /// </returns>
        internal string? Claim(string requestId)
        {
            lock (Gate)
            {
                ProcessApplied[_stampPath] = requestId;
            }

            try
            {
                var dir = Path.GetDirectoryName(_stampPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("APPLIED");
                sb.AppendLine("{");
                sb.AppendLine("\tid = " + requestId);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("\tnote = delete this file to let the request with this id fire again");
                sb.AppendLine("}");
                File.WriteAllText(_stampPath, sb.ToString());
                return null;
            }
            catch (Exception ex)
            {
                return ex.Message;
            }
        }

        /// <summary>
        /// The id an earlier claim stamped, or null. An unreadable stamp reads as null, so
        /// a filesystem hiccup falls through to the session rule rather than going quiet.
        /// </summary>
        internal string? ReadStampedId()
        {
            try
            {
                if (!File.Exists(_stampPath))
                {
                    return null;
                }

                foreach (var raw in File.ReadAllLines(_stampPath))
                {
                    var line = raw.Trim();
                    if (!line.StartsWith("id", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var eq = line.IndexOf('=');
                    if (eq < 0 || line.Substring(0, eq).Trim() != "id")
                    {
                        continue;
                    }

                    var value = line.Substring(eq + 1).Trim();
                    return value.Length == 0 ? null : value;
                }

                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Forgets every in-memory claim. Tests only: a real process never un-applies.</summary>
        internal static void ResetProcessMemoryForTests()
        {
            lock (Gate)
            {
                ProcessApplied.Clear();
            }
        }
    }
}
