using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace Sitrep.Host.Hosting
{
    /// <summary>One remote station the holder has approved, as the record keeps it.</summary>
    public sealed class ApprovedStationRecord
    {
        public ApprovedStationRecord(string credential, string name, long approvedAtUnixMs, long lastSeenUnixMs = 0)
        {
            Credential = credential;
            Name = name;
            ApprovedAtUnixMs = approvedAtUnixMs;
            LastSeenUnixMs = lastSeenUnixMs;
        }

        /// <summary>The secret the station presents to the host. It is never published.</summary>
        public string Credential { get; }

        public string Name { get; }

        public long ApprovedAtUnixMs { get; }

        /// <summary>When the host last found the station's credential approved, or zero when it never has since it was approved.</summary>
        public long LastSeenUnixMs { get; }

        /// <summary>The later of when the station was approved and when it was last seen: how recently it was in use.</summary>
        public long LastUsedUnixMs => Math.Max(ApprovedAtUnixMs, LastSeenUnixMs);
    }

    /// <summary>What the record keeps across a game restart.</summary>
    public sealed class HostRecordSaved
    {
        /// <summary>The join code, or null before one was minted.</summary>
        public string? Code { get; set; }

        /// <summary>The token of the last screen to hold the role, or null.</summary>
        public string? LastHolderToken { get; set; }

        /// <summary>How many times the role has been granted, across game restarts.</summary>
        public long Generation { get; set; }

        public List<ApprovedStationRecord> Stations { get; set; } = new List<ApprovedStationRecord>();
    }

    /// <summary>Where <see cref="HostRecord"/> keeps what must outlast the game. A failed save is the store's to report; the record's state in memory stays in force.</summary>
    public interface IHostRecordStore
    {
        HostRecordSaved Load();

        void Save(HostRecordSaved saved);
    }

    /// <summary>The intervals the record works to, in seconds.</summary>
    public sealed class HostRecordTimings
    {
        /// <summary>How often the holder is asked to send a heartbeat.</summary>
        public double HeartbeatSeconds { get; set; } = 5.0;

        /// <summary>How long after the last heartbeat or a disconnect the role is freed.</summary>
        public double GraceSeconds { get; set; } = 15.0;

        /// <summary>How long, from the first connection after a restart, only the last holder's token may claim.</summary>
        public double RestartSeconds { get; set; } = 30.0;

        /// <summary>How many approved stations the record keeps. Approving past it drops the ones used least recently.</summary>
        public int MaxStations { get; set; } = 64;

        /// <summary>How long an approved station may go unused before approving another drops it, in seconds (about six months).</summary>
        public double StationIdleSeconds { get; set; } = 15_552_000.0;

        /// <summary>How stale a station's last-seen time may be before seeing it again writes a fresh one, in seconds.</summary>
        public double SeenResolutionSeconds { get; set; } = 3600.0;
    }

    /// <summary>What a claim or a heartbeat found.</summary>
    public readonly struct HostRoleOutcome
    {
        public HostRoleOutcome(bool holds, string? holderId, long generation = 0)
        {
            Holds = holds;
            HolderId = holderId;
            Generation = generation;
        }

        /// <summary>Whether the caller's token holds the role after the call.</summary>
        public bool Holds { get; }

        /// <summary>The public id of whoever holds the role, or null when nobody does.</summary>
        public string? HolderId { get; }

        /// <summary>How many times the role has been granted so far, this grant included when the caller holds it.</summary>
        public long Generation { get; }
    }

    /// <summary>
    /// The record of which screen hosts: one holder at a time, kept by a token
    /// the screen keeps for itself, with the join code and the approved remote
    /// stations beside it.
    ///
    /// <para>Pure state. It reads the time through the two functions it is
    /// given and the file through <see cref="IHostRecordStore"/>, so it holds no
    /// game type and a test runs it without waiting. Every call is made on the
    /// Courier thread, one at a time, which is what makes a claim that arrives
    /// beside another unable to win with it.</para>
    ///
    /// <para>A holder is freed <see cref="HostRecordTimings.GraceSeconds"/> after
    /// its last heartbeat or the close of the connection it last spoke on,
    /// whichever came later. A claim with the same token inside that time takes
    /// the role straight back. A claim with any other token is refused while the
    /// holder's connection is open and granted once it has closed, since a holder
    /// that reloads comes back with its own token and one that does not has gone.</para>
    /// </summary>
    public sealed class HostRecord
    {
        /// <summary>The characters a join code is made of: no 0, O, 1, I or L.</summary>
        public const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        /// <summary>How many characters a join code has.</summary>
        public const int CodeLength = 6;

        private const int NameLimit = 64;

        private readonly IHostRecordStore _store;
        private readonly Func<double> _nowSeconds;
        private readonly Func<long> _nowUnixMs;
        private readonly Func<string> _mintCode;
        private readonly HostRecordSaved _saved;

        private string? _holderToken;
        private string? _holderConnection;
        private double _deadline;
        private bool _holderAway;
        private double? _restartUntil;

        public HostRecord(
            IHostRecordStore store,
            Func<double> nowSeconds,
            Func<long> nowUnixMs,
            Func<string>? mintCode = null,
            HostRecordTimings? timings = null)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _nowSeconds = nowSeconds ?? throw new ArgumentNullException(nameof(nowSeconds));
            _nowUnixMs = nowUnixMs ?? throw new ArgumentNullException(nameof(nowUnixMs));
            _mintCode = mintCode ?? MintCode;
            Timings = timings ?? new HostRecordTimings();
            _saved = store.Load() ?? new HostRecordSaved();
        }

        public HostRecordTimings Timings { get; }

        /// <summary>Whether a screen holds the role now, in grace or not.</summary>
        public bool Held => _holderToken != null;

        /// <summary>Whether the holder's connection is closed and it is inside the grace.</summary>
        public bool HolderAway => _holderToken != null && _holderAway;

        /// <summary>The public id of the holder, or null when the role is free.</summary>
        public string? HolderId => _holderToken == null ? null : PublicId(_holderToken);

        /// <summary>The stations the holder has approved, oldest first.</summary>
        public IReadOnlyList<ApprovedStationRecord> Stations => _saved.Stations;

        /// <summary>
        /// The join code, minted the first time anything asks for it and kept in
        /// the store from then on.
        /// </summary>
        public string Code
        {
            get
            {
                if (_saved.Code == null || !IsCodeForm(_saved.Code))
                {
                    _saved.Code = _mintCode();
                    Persist();
                }

                return _saved.Code;
            }
        }

        /// <summary>
        /// A short id that names a secret without revealing it: what the record
        /// publishes in place of a token or a credential.
        /// </summary>
        public static string PublicId(string secret)
        {
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(secret));
            var sb = new StringBuilder(16);
            for (var i = 0; i < 8; i++)
            {
                sb.Append(hash[i].ToString("x2"));
            }

            return sb.ToString();
        }

        /// <summary>Whether <paramref name="text"/> has the form of a join code.</summary>
        public static bool IsCodeForm(string text)
        {
            if (text.Length != CodeLength)
            {
                return false;
            }

            foreach (var c in text)
            {
                if (CodeAlphabet.IndexOf(c) < 0)
                {
                    return false;
                }
            }

            return true;
        }

        /// <summary>A fresh join code from the platform's cryptographic source.</summary>
        public static string MintCode()
        {
            var bytes = new byte[CodeLength];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }

            // 32 divides 256, so every byte maps to one character with no bias.
            var sb = new StringBuilder(CodeLength);
            foreach (var b in bytes)
            {
                sb.Append(CodeAlphabet[b % CodeAlphabet.Length]);
            }

            return sb.ToString();
        }

        /// <summary>
        /// Note that a connection exists. The first one after the record was
        /// built opens the restart window, in which only the last holder's token
        /// may claim.
        /// </summary>
        public void NoteConnection()
        {
            if (_restartUntil == null)
            {
                _restartUntil = _saved.LastHolderToken == null ? 0.0 : _nowSeconds() + Timings.RestartSeconds;
            }
        }

        /// <summary>Free the role if its grace has run out. Safe to call at any time.</summary>
        public bool Expire()
        {
            if (_holderToken != null && _nowSeconds() >= _deadline)
            {
                ClearHolder();
                return true;
            }

            return false;
        }

        /// <summary>
        /// Ask for the role. Granted when nobody holds it, when the token is the
        /// holder's own (a reload), or when the holder's connection has closed;
        /// refused otherwise, with the holder's id.
        /// Every grant raises the generation by one.
        /// </summary>
        public HostRoleOutcome Claim(string token, string connectionId)
        {
            NoteConnection();
            Expire();
            if (_holderToken != null)
            {
                if (!string.Equals(_holderToken, token, StringComparison.Ordinal) && !_holderAway)
                {
                    return new HostRoleOutcome(false, HolderId, _saved.Generation);
                }

                TakeOrKeep(token, connectionId);
                return new HostRoleOutcome(true, HolderId, _saved.Generation);
            }

            if (_nowSeconds() < _restartUntil
                && _saved.LastHolderToken != null
                && !string.Equals(_saved.LastHolderToken, token, StringComparison.Ordinal))
            {
                return new HostRoleOutcome(false, PublicId(_saved.LastHolderToken), _saved.Generation);
            }

            TakeOrKeep(token, connectionId);
            return new HostRoleOutcome(true, HolderId, _saved.Generation);
        }

        /// <summary>
        /// The holder is still there. A token that is not the holder's is told it
        /// does not hold the role, which is how a screen that was cut off past the
        /// grace learns to step down.
        /// </summary>
        public HostRoleOutcome Heartbeat(string token, string connectionId)
        {
            Expire();
            if (_holderToken != null && string.Equals(_holderToken, token, StringComparison.Ordinal))
            {
                _holderConnection = connectionId;
                _holderAway = false;
                _deadline = _nowSeconds() + Timings.GraceSeconds;
                return new HostRoleOutcome(true, HolderId, _saved.Generation);
            }

            return new HostRoleOutcome(false, HolderId, _saved.Generation);
        }

        /// <summary>Give the role up at once. False when the token does not hold it.</summary>
        public bool Release(string token)
        {
            Expire();
            if (!Holds(token))
            {
                return false;
            }

            ClearHolder();
            return true;
        }

        /// <summary>A connection closed. If it was the holder's, the grace starts now.</summary>
        public void ConnectionClosed(string connectionId)
        {
            if (_holderToken != null
                && string.Equals(_holderConnection, connectionId, StringComparison.Ordinal))
            {
                _holderAway = true;
                _deadline = _nowSeconds() + Timings.GraceSeconds;
            }
        }

        /// <summary>Mint a new join code. False when the token does not hold the role.</summary>
        public bool RegenerateCode(string token)
        {
            Expire();
            if (!Holds(token))
            {
                return false;
            }

            string next;
            do
            {
                next = _mintCode();
            }
            while (string.Equals(next, _saved.Code, StringComparison.Ordinal));

            _saved.Code = next;
            Persist();
            return true;
        }

        /// <summary>Approve a station, or rename one already approved. False when the token does not hold the role.</summary>
        public bool ApproveStation(string token, string credential, string name)
        {
            Expire();
            if (!Holds(token) || string.IsNullOrEmpty(credential))
            {
                return false;
            }

            var shown = (name ?? string.Empty).Trim();
            if (shown.Length > NameLimit)
            {
                shown = shown.Substring(0, NameLimit);
            }

            var at = _saved.Stations.FindIndex(s => string.Equals(s.Credential, credential, StringComparison.Ordinal));
            if (at < 0)
            {
                _saved.Stations.Add(new ApprovedStationRecord(credential, shown, _nowUnixMs(), _nowUnixMs()));
                DropUnusedStations();
            }
            else
            {
                var kept = _saved.Stations[at];
                _saved.Stations[at] = new ApprovedStationRecord(credential, shown, kept.ApprovedAtUnixMs, kept.LastSeenUnixMs);
            }

            Persist();
            return true;
        }

        /// <summary>
        /// Revoke the station <paramref name="stationId"/> names. False when the
        /// token does not hold the role; true when it does, whether or not the
        /// station was still approved.
        /// </summary>
        public bool RevokeStation(string token, string stationId)
        {
            Expire();
            if (!Holds(token))
            {
                return false;
            }

            if (_saved.Stations.RemoveAll(s => string.Equals(PublicId(s.Credential), stationId, StringComparison.Ordinal)) > 0)
            {
                Persist();
            }

            return true;
        }

        /// <summary>
        /// The approved station a credential belongs to, or null when it is not
        /// approved. Finding one notes that it is in use, so the stations dropped
        /// when the list is full are the ones nobody has used.
        /// </summary>
        public ApprovedStationRecord? FindStation(string credential)
        {
            var at = _saved.Stations.FindIndex(s => string.Equals(s.Credential, credential, StringComparison.Ordinal));
            if (at < 0)
            {
                return null;
            }

            var station = _saved.Stations[at];
            var now = _nowUnixMs();
            if (now - station.LastUsedUnixMs >= (long)(Timings.SeenResolutionSeconds * 1000))
            {
                station = new ApprovedStationRecord(station.Credential, station.Name, station.ApprovedAtUnixMs, now);
                _saved.Stations[at] = station;
                Persist();
            }

            return station;
        }

        /// <summary>Whether the token is the holder's, after the grace has been applied.</summary>
        public bool HoldsRole(string token)
        {
            Expire();
            return Holds(token);
        }

        private bool Holds(string token) =>
            _holderToken != null && string.Equals(_holderToken, token, StringComparison.Ordinal);

        private void TakeOrKeep(string token, string connectionId)
        {
            _holderToken = token;
            _holderConnection = connectionId;
            _holderAway = false;
            _deadline = _nowSeconds() + Timings.GraceSeconds;
            _saved.Generation++;
            _saved.LastHolderToken = token;
            Persist();
        }

        /*
         * A station that clears its browser's storage mints a new credential and
         * is approved again, and nothing else ever removes the old one, so the
         * list would only grow. Stations idle past StationIdleSeconds go first, then
         * the least recently used until the list fits MaxStations.
         */
        private void DropUnusedStations()
        {
            var idleBefore = _nowUnixMs() - (long)(Timings.StationIdleSeconds * 1000.0);
            _saved.Stations.RemoveAll(s => s.LastUsedUnixMs < idleBefore);
            while (_saved.Stations.Count > Timings.MaxStations)
            {
                var oldest = 0;
                for (var i = 1; i < _saved.Stations.Count; i++)
                {
                    if (_saved.Stations[i].LastUsedUnixMs < _saved.Stations[oldest].LastUsedUnixMs)
                    {
                        oldest = i;
                    }
                }

                _saved.Stations.RemoveAt(oldest);
            }
        }

        private void ClearHolder()
        {
            _holderToken = null;
            _holderConnection = null;
            _holderAway = false;
        }

        private void Persist() => _store.Save(_saved);
    }
}
