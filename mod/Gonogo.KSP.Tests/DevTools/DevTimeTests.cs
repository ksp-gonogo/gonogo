using System;
using System.Collections.Generic;
using System.IO;
using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// The time dev tool's request parsing, its refusals and the sun elevation maths,
    /// all of which run without a game. The case that matters is a rig run asking for a
    /// time of day: a request that goes backwards or repeats an id changes nothing.
    /// </summary>
    public sealed class DevTimeTests : IDisposable
    {
        private readonly string _dir;

        public DevTimeTests()
        {
            _dir = Path.Combine(Path.GetTempPath(), "dev-time-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            DevRequestLedger.ResetProcessMemoryForTests();
        }

        public void Dispose()
        {
            DevRequestLedger.ResetProcessMemoryForTests();
            Directory.Delete(_dir, recursive: true);
        }

        private static TimeRequest? Parse(out string? error, params (string Key, string Value)[] pairs)
        {
            var map = new Dictionary<string, string>();
            foreach (var (key, value) in pairs)
            {
                map[key] = value;
            }
            return TimeRequest.Parse(k => map.TryGetValue(k, out var v) ? v : null, out error);
        }

        [Fact]
        public void A_setut_request_parses_to_that_universal_time()
        {
            var request = Parse(out var error, ("setut", "1234567.5"));

            Assert.Null(error);
            Assert.Equal(1234567.5, request!.SetUt);
            Assert.False(request.SunElevation);
        }

        [Fact]
        public void A_sunelev_request_without_a_position_uses_the_vessel()
        {
            var request = Parse(out var error, ("sunelev", "true"));

            Assert.Null(error);
            Assert.True(request!.SunElevation);
            Assert.Null(request.Latitude);
            Assert.Null(request.Longitude);
        }

        [Fact]
        public void A_sunelev_request_with_a_position_carries_it()
        {
            var request = Parse(out var error, ("sunelev", "true"), ("lat", "9.45"), ("lon", "-172.11"));

            Assert.Null(error);
            Assert.Equal(9.45, request!.Latitude);
            Assert.Equal(-172.11, request.Longitude);
        }

        [Fact]
        public void Setut_and_sunelev_together_ask_for_both()
        {
            var request = Parse(out var error, ("setut", "100"), ("sunelev", "true"));

            Assert.Null(error);
            Assert.Equal(100.0, request!.SetUt);
            Assert.True(request.SunElevation);
        }

        [Theory]
        [InlineData("setut", "soon")]
        [InlineData("setut", "-5")]
        [InlineData("setut", "NaN")]
        [InlineData("sunelev", "maybe")]
        public void A_malformed_value_is_refused_with_a_reason(string key, string value)
        {
            var request = Parse(out var error, (key, value));

            Assert.Null(request);
            Assert.Contains(key, error);
        }

        [Fact]
        public void A_request_that_asks_for_nothing_is_refused()
        {
            Assert.Null(Parse(out var error));
            Assert.Contains("nothing to do", error);
        }

        [Fact]
        public void Lat_without_lon_is_refused()
        {
            Assert.Null(Parse(out var error, ("sunelev", "true"), ("lat", "10")));
            Assert.Contains("both or neither", error);
        }

        [Fact]
        public void A_latitude_past_the_pole_is_refused()
        {
            Assert.Null(Parse(out var error, ("sunelev", "true"), ("lat", "91"), ("lon", "0")));
            Assert.Contains("lat", error);
        }

        [Fact]
        public void A_position_without_sunelev_is_refused()
        {
            Assert.Null(Parse(out var error, ("setut", "100"), ("lat", "10"), ("lon", "0")));
            Assert.Contains("sunelev", error);
        }

        [Fact]
        public void Going_back_in_time_is_refused_with_a_reason()
        {
            var reason = TimeRequest.RefuseBackwards(nowUt: 5000.0, targetUt: 4999.0);

            Assert.NotNull(reason);
            Assert.Contains("earlier than the current UT 5000", reason);
        }

        [Theory]
        [InlineData(5000.0)]
        [InlineData(5000.5)]
        public void Staying_put_or_going_forward_is_allowed(double target)
        {
            Assert.Null(TimeRequest.RefuseBackwards(nowUt: 5000.0, targetUt: target));
        }

        [Fact]
        public void A_repeated_id_is_not_applied_again()
        {
            var ledger = new DevRequestLedger(Path.Combine(_dir, "time-applied.cfg"), DateTime.UtcNow.AddHours(-1));
            var written = DateTime.UtcNow;

            Assert.Equal(DevRequestDecision.Apply, ledger.Admit("t-1", written, out _));
            Assert.Equal(DevRequestDecision.AlreadyApplied, ledger.Admit("t-1", written, out _));
            Assert.Equal(DevRequestDecision.Apply, ledger.Admit("t-2", written, out _));
        }

        [Fact]
        public void A_request_written_before_the_session_is_refused()
        {
            var ledger = new DevRequestLedger(Path.Combine(_dir, "time-applied.cfg"), DateTime.UtcNow);

            Assert.Equal(
                DevRequestDecision.PredatesSession,
                ledger.Admit("t-1", DateTime.UtcNow.AddHours(-2), out _));
        }

        [Fact]
        public void The_result_reports_the_achieved_time_and_unknown_for_what_was_not_asked()
        {
            var text = TimeResult.Render(
                "t-1", ok: true, "ok", requestedUt: 600.0, achievedUt: 600.25,
                sunElevationDegrees: null, latitude: null, longitude: null, body: null,
                new DateTime(2026, 10, 19, 12, 0, 0, DateTimeKind.Utc));

            Assert.Contains("applied = t-1", text);
            Assert.Contains("ok = True", text);
            Assert.Contains("requestedUt = 600", text);
            Assert.Contains("achievedUt = 600.25", text);
            Assert.Contains("sunElevationDeg = unknown", text);
            Assert.Contains("body = unknown", text);
        }

        [Fact]
        public void The_result_carries_the_elevation_and_position()
        {
            var text = TimeResult.Render(
                "t-2", ok: true, "ok", requestedUt: null, achievedUt: 1000.0,
                sunElevationDegrees: 41.23456, latitude: 9.45, longitude: -172.11, body: "Kerbin",
                DateTime.UtcNow);

            Assert.Contains("sunElevationDeg = 41.2346", text);
            Assert.Contains("lat = 9.45", text);
            Assert.Contains("lon = -172.11", text);
            Assert.Contains("body = Kerbin", text);
        }

        [Fact]
        public void The_sun_overhead_is_ninety_degrees()
        {
            Assert.Equal(90.0, SunElevation.Degrees(0, 0, 1, 0, 0, 5), 9);
        }

        [Fact]
        public void The_sun_on_the_horizon_is_zero_degrees()
        {
            Assert.Equal(0.0, SunElevation.Degrees(0, 0, 1, 7, 0, 0), 9);
        }

        [Fact]
        public void The_sun_behind_the_body_is_minus_ninety_degrees()
        {
            Assert.Equal(-90.0, SunElevation.Degrees(0, 0, 1, 0, 0, -3), 9);
        }

        [Fact]
        public void The_sun_thirty_degrees_up_reads_thirty_degrees()
        {
            var half = Math.Sqrt(3) / 2;
            Assert.Equal(30.0, SunElevation.Degrees(0, 0, 1, half, 0, 0.5), 9);
        }

        [Fact]
        public void A_direction_with_no_length_has_no_elevation()
        {
            Assert.True(double.IsNaN(SunElevation.Degrees(0, 0, 0, 1, 0, 0)));
            Assert.True(double.IsNaN(SunElevation.Degrees(0, 0, 1, 0, 0, 0)));
        }

        [Fact]
        public void A_point_under_the_sun_is_overhead_and_its_antipode_is_at_night()
        {
            var sun = (X: 1.0, Y: 0.0, Z: 0.0);
            var here = SunElevation.Up(0, 0, 0);
            var opposite = SunElevation.Up(0, 180, 0);

            Assert.Equal(90.0, SunElevation.Degrees(here.X, here.Y, here.Z, sun.X, sun.Y, sun.Z), 9);
            Assert.Equal(-90.0, SunElevation.Degrees(opposite.X, opposite.Y, opposite.Z, sun.X, sun.Y, sun.Z), 9);
        }

        [Fact]
        public void Longitude_ninety_degrees_from_the_sun_is_on_the_horizon()
        {
            var up = SunElevation.Up(0, 90, 0);

            Assert.Equal(0.0, SunElevation.Degrees(up.X, up.Y, up.Z, 1, 0, 0), 9);
        }

        [Fact]
        public void The_body_turning_carries_a_point_out_of_the_sun()
        {
            var noon = SunElevation.Up(0, 0, 0);
            var later = SunElevation.Up(0, 0, 90);
            var halfTurn = SunElevation.Up(0, 0, 180);

            Assert.Equal(90.0, SunElevation.Degrees(noon.X, noon.Y, noon.Z, 1, 0, 0), 9);
            Assert.Equal(0.0, SunElevation.Degrees(later.X, later.Y, later.Z, 1, 0, 0), 9);
            Assert.Equal(-90.0, SunElevation.Degrees(halfTurn.X, halfTurn.Y, halfTurn.Z, 1, 0, 0), 9);
        }

        [Fact]
        public void A_point_at_the_pole_sees_an_equatorial_sun_on_the_horizon()
        {
            var pole = SunElevation.Up(90, 0, 0);

            Assert.Equal(0.0, SunElevation.Degrees(pole.X, pole.Y, pole.Z, 1, 0, 0), 9);
        }

        [Fact]
        public void A_sun_in_the_equatorial_plane_at_latitude_sixty_stands_thirty_degrees_up()
        {
            var up = SunElevation.Up(60, 0, 0);

            Assert.Equal(30.0, SunElevation.Degrees(up.X, up.Y, up.Z, 1, 0, 0), 9);
        }
    }
}
