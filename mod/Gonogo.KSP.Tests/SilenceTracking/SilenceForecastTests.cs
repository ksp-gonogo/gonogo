using System;
using System.Collections.Generic;
using Gonogo.KSP.SilenceTracking;
using Gonogo.KSP.Tests.Comms;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// The ground's forecast for each craft, handed from the silence capture to
    /// the engine, where the home centre judges the craft by it: once when the
    /// craft is first read, and again only when it changes.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class SilenceForecastTests
    {
        private const double Ut = 500.0;

        private static readonly Guid CraftId = new Guid("22222222-0000-0000-0000-000000000000");

        private static SignalDelayConfig DelayOn() => new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static SilenceTracker Tracker() =>
            new SilenceTracker((sample, onsetUt) => new SilenceDeadline(1_000.0, SilenceDeadlineBasis.PolicyCeiling));

        private sealed class Recorded : ICraftForecastWriter
        {
            public List<(string VesselId, CraftForecast Forecast)> Forecasts { get; } = new List<(string, CraftForecast)>();

            public void RecordCraftForecast(string vesselId, CraftForecast forecast, double ut) => Forecasts.Add((vesselId, forecast));
        }

        private static Vessel Craft(bool grounded) => UnityStandIns.Craft(
            CraftId,
            UnityStandIns.Link(connected: true, UnityStandIns.Hop(1_000.0, endsAtHome: grounded)));

        [Fact]
        public void AForecastIsHandedOverWhenTheGroundLosesACraftAndClearedWhenItHearsItAgain()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var recorded = new Recorded();
            var forecasts = new SilenceForecasts(recorded);
            var tracker = Tracker();

            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(tracker, new List<Vessel> { Craft(true) }, Ut));
            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(tracker, new List<Vessel> { Craft(true) }, Ut + 1.0));
            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(tracker, new List<Vessel> { Craft(false) }, Ut + 2.0));
            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(tracker, new List<Vessel> { Craft(false) }, Ut + 3.0));
            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(tracker, new List<Vessel> { Craft(true) }, Ut + 4.0));

            Assert.Equal(3, recorded.Forecasts.Count);
            Assert.All(recorded.Forecasts, f => Assert.Equal(CraftId.ToString(), f.VesselId));
            Assert.Null(recorded.Forecasts[0].Forecast.DeadlineUt);
            var lost = recorded.Forecasts[1].Forecast;
            Assert.Equal("vessel:" + CraftId, lost.Id);
            Assert.Equal(Ut + 2.0, lost.OnsetUt);
            Assert.Equal(Ut + 2.0 + 1_000.0, lost.DeadlineUt);
            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, lost.Basis);
            Assert.Null(recorded.Forecasts[2].Forecast.DeadlineUt);
        }

        [Fact]
        public void ANewTrackerSaysEveryForecastAgain()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var recorded = new Recorded();
            var forecasts = new SilenceForecasts(recorded);

            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(Tracker(), new List<Vessel> { Craft(true) }, Ut));
            forecasts.HandleSilenceOnCourier(forecasts.CaptureSilence(Tracker(), new List<Vessel> { Craft(true) }, Ut + 1.0));

            Assert.Equal(2, recorded.Forecasts.Count);
        }
    }
}
