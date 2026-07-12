using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Covers the F1 capture-on-main / handle-on-Courier seam
    /// (<see cref="IUplinkHost.AddSampledSource"/>): the capture runs on the
    /// tick (main-loop) thread, its exact opaque result is carried to and
    /// handed to the handle on the Courier thread, and a throwing capture
    /// degrades only its own owning uplink — every other source and the rest
    /// of the tick keep running.
    /// </summary>
    public class SampledSourceTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        [Fact]
        public void CaptureRunsOnTickThreadHandleRunsOnCourierAndReceivesExactCapture()
        {
            var capturePayload = new object();
            int captureThreadId = 0;
            int handleThreadId = 0;
            int samplerThreadId = 0;
            object? handleReceived = null;

            var uplink = new RecordingUplink(
                "sampled.thread",
                capture: _ =>
                {
                    captureThreadId = Thread.CurrentThread.ManagedThreadId;
                    return capturePayload;
                },
                handle: value =>
                {
                    handleThreadId = Thread.CurrentThread.ManagedThreadId;
                    handleReceived = value;
                },
                onSample: () => samplerThreadId = Thread.CurrentThread.ManagedThreadId);

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(uplink);
            engine.Start();

            var testThreadId = Thread.CurrentThread.ManagedThreadId;
            engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

            // Handle got the EXACT object the capture returned (reference identity).
            Assert.Same(capturePayload, handleReceived);

            // Capture ran on the caller's (main-loop) thread — synchronously
            // inside TickAndWait, before the job crossed to the Courier.
            Assert.Equal(testThreadId, captureThreadId);

            // Handle ran on a DIFFERENT thread (the Courier) — the same one an
            // ordinary ISnapshotSampler runs on.
            Assert.NotEqual(captureThreadId, handleThreadId);
            Assert.Equal(samplerThreadId, handleThreadId);
        }

        [Fact]
        public void AThrowingCaptureDegradesOnlyItsOwnUplinkAndTheTickContinues()
        {
            int throwingCaptureCalls = 0;
            int throwingHandleCalls = 0;
            int healthyHandleCalls = 0;
            object? healthyReceived = null;
            var healthyPayload = new object();

            var throwing = new RecordingUplink(
                "sampled.throwing",
                capture: _ =>
                {
                    throwingCaptureCalls++;
                    throw new InvalidOperationException("boom");
                },
                handle: _ => throwingHandleCalls++);

            var healthy = new RecordingUplink(
                "sampled.healthy",
                capture: _ => healthyPayload,
                handle: value =>
                {
                    healthyHandleCalls++;
                    healthyReceived = value;
                });

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(throwing);
            engine.RegisterUplink(healthy);
            engine.Start();

            engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

            // The throwing capture's handle never ran; the healthy one did,
            // with its exact captured payload — the tick completed for it.
            Assert.Equal(0, throwingHandleCalls);
            Assert.Equal(1, healthyHandleCalls);
            Assert.Same(healthyPayload, healthyReceived);

            // Its owning uplink went Unavailable; the healthy one stayed up.
            Assert.False(engine.AvailabilityOf("sampled.throwing").IsAvailable);
            Assert.True(engine.AvailabilityOf("sampled.healthy").IsAvailable);

            var throwingCallsAfterFirstTick = throwingCaptureCalls;

            // Second tick: the throwing source no longer even captures (it was
            // disabled main-side); the healthy one keeps going.
            engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

            Assert.Equal(throwingCallsAfterFirstTick, throwingCaptureCalls);
            Assert.Equal(2, healthyHandleCalls);
        }

        [Fact]
        public void ARegistrationThatAddsASampledSourceThenThrowsDisablesThatCaptureForever()
        {
            int captureCalls = 0;

            // Register adds a sampled source, THEN throws. Fix #4: the catch
            // must route through MarkUplinkUnavailable so the already-registered
            // source's Disabled flag is set — otherwise RunCaptures (which gates
            // only on source.Disabled, not _availability) keeps invoking the
            // half-initialised capture every tick forever.
            var failing = new RecordingUplink(
                "sampled.regfail",
                capture: _ =>
                {
                    captureCalls++;
                    return new object();
                },
                handle: _ => { },
                throwInRegister: true);

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(failing);
            engine.Start();

            Assert.False(engine.AvailabilityOf("sampled.regfail").IsAvailable);

            engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
            engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

            // The capture never ran on either tick — the source was disabled
            // by the registration-failure path, not left live.
            Assert.Equal(0, captureCalls);
        }

        private sealed class RecordingUplink : ISitrepUplink, ISnapshotSampler
        {
            private readonly Func<KspSnapshot?, object?> _capture;
            private readonly Action<object?> _handle;
            private readonly Action? _onSample;
            private readonly bool _throwInRegister;

            public RecordingUplink(
                string id,
                Func<KspSnapshot?, object?> capture,
                Action<object?> handle,
                Action? onSample = null,
                bool throwInRegister = false)
            {
                _capture = capture;
                _handle = handle;
                _onSample = onSample;
                _throwInRegister = throwInRegister;
                Manifest = new UplinkManifest { Id = id, Version = "1.0.0" };
            }

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                host.AddSampledSource(_capture, _handle);
                if (_onSample != null)
                {
                    host.AddSampler(this);
                }
                if (_throwInRegister)
                {
                    throw new InvalidOperationException("register boom (after AddSampledSource)");
                }
            }

            public void Sample(KspSnapshot snapshot) => _onSample?.Invoke();
        }
    }
}
