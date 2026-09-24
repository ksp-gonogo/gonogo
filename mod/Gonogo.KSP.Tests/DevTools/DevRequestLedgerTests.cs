using System;
using System.IO;
using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// The applied-once guard for the one-shot dev tools. The case it exists for is a KSP
    /// restart with a request still on disk: without it, a teleport meant for one craft
    /// lands on whichever craft is active next, the moment it spawns.
    /// </summary>
    public sealed class DevRequestLedgerTests : IDisposable
    {
        private static readonly DateTime SessionStart = new DateTime(2026, 9, 24, 18, 0, 0, DateTimeKind.Utc);

        private readonly string _dir;
        private readonly string _stampPath;

        public DevRequestLedgerTests()
        {
            _dir = Path.Combine(Path.GetTempPath(), "dev-request-ledger-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            _stampPath = Path.Combine(_dir, "teleport-applied.cfg");
            DevRequestLedger.ResetProcessMemoryForTests();
        }

        public void Dispose()
        {
            DevRequestLedger.ResetProcessMemoryForTests();
            Directory.Delete(_dir, recursive: true);
        }

        [Fact]
        public void A_request_written_this_session_is_applied()
        {
            var ledger = new DevRequestLedger(_stampPath, SessionStart);

            Assert.Equal(DevRequestDecision.Apply, ledger.Decide("t-1", SessionStart.AddMinutes(5)));
        }

        [Fact]
        public void A_claimed_request_is_not_applied_again_in_the_same_process()
        {
            var ledger = new DevRequestLedger(_stampPath, SessionStart);
            ledger.Claim("t-1");

            Assert.Equal(DevRequestDecision.AlreadyApplied, ledger.Decide("t-1", SessionStart.AddMinutes(5)));
        }

        [Fact]
        public void A_request_applied_by_an_earlier_process_is_not_applied_after_a_restart()
        {
            new DevRequestLedger(_stampPath, SessionStart).Claim("t-1");

            DevRequestLedger.ResetProcessMemoryForTests();
            var afterRestart = new DevRequestLedger(_stampPath, SessionStart.AddHours(2));

            Assert.Equal(DevRequestDecision.AlreadyApplied, afterRestart.Decide("t-1", SessionStart.AddMinutes(5)));
        }

        [Fact]
        public void A_request_written_before_the_session_started_is_refused_even_with_no_stamp()
        {
            var ledger = new DevRequestLedger(_stampPath, SessionStart);

            Assert.Equal(DevRequestDecision.PredatesSession, ledger.Decide("t-1", SessionStart.AddSeconds(-1)));
        }

        [Fact]
        public void A_refused_stale_request_is_refused_once_rather_than_on_every_poll()
        {
            var ledger = new DevRequestLedger(_stampPath, SessionStart);
            Assert.Equal(DevRequestDecision.PredatesSession, ledger.Decide("t-1", SessionStart.AddSeconds(-1)));
            ledger.Claim("t-1");

            Assert.Equal(DevRequestDecision.AlreadyApplied, ledger.Decide("t-1", SessionStart.AddSeconds(-1)));
        }

        [Fact]
        public void A_new_id_after_a_claim_is_applied()
        {
            var ledger = new DevRequestLedger(_stampPath, SessionStart);
            ledger.Claim("t-1");

            Assert.Equal(DevRequestDecision.Apply, ledger.Decide("t-2", SessionStart.AddMinutes(9)));
        }

        [Fact]
        public void A_garbled_stamp_falls_through_to_the_session_rule_rather_than_going_quiet()
        {
            File.WriteAllText(_stampPath, "not a config node at all");
            var ledger = new DevRequestLedger(_stampPath, SessionStart);

            Assert.Null(ledger.ReadStampedId());
            Assert.Equal(DevRequestDecision.Apply, ledger.Decide("t-1", SessionStart.AddMinutes(1)));
            Assert.Equal(DevRequestDecision.PredatesSession, ledger.Decide("t-1", SessionStart.AddMinutes(-1)));
        }

        [Fact]
        public void The_stamp_reads_back_the_format_the_currency_probe_already_wrote()
        {
            File.WriteAllText(_stampPath, "APPLIED\n{\n\tid = currency-42\n\ttime = 2026-09-20T10:00:00Z\n}\n");

            Assert.Equal("currency-42", new DevRequestLedger(_stampPath, SessionStart).ReadStampedId());
        }

        [Fact]
        public void Ledgers_for_different_tools_do_not_share_a_claim()
        {
            var teleport = new DevRequestLedger(_stampPath, SessionStart);
            var stamp = new DevRequestLedger(Path.Combine(_dir, "scanstamp-applied.cfg"), SessionStart);
            teleport.Claim("same-id");

            Assert.Equal(DevRequestDecision.Apply, stamp.Decide("same-id", SessionStart.AddMinutes(1)));
        }
    }
}
