using System;
using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The wiring, not the gate. Every other conformance test calls the gate
    /// directly, so all of them pass whether or not anything in the Uplink ever
    /// invokes it, which is how a gate ships inert.
    /// </summary>
    public class PrincipiaConformanceChannelTests
    {
        [Fact]
        public void TheUplinkDeclaresAChannelForItsConformanceVerdict()
        {
            // Without a declaration nothing is published, however well the gate
            // works: the operator's only view of whether their Principia is vetted
            // is this channel existing.
            var uplink = new PrincipiaUplink();

            var conformance = uplink.Manifest.Channels.FirstOrDefault(
                c => c.Topic == PrincipiaUplink.ConformanceTopic);

            Assert.NotNull(conformance);
        }

        [Fact]
        public void TheVerdictIsTrueNowRatherThanDelayed()
        {
            // Which files are on the operator's own machine is a ground-side fact.
            // Delaying it would mean someone who just installed Principia could not
            // be told their build was unvetted until light-time had passed.
            var uplink = new PrincipiaUplink();

            var conformance = uplink.Manifest.Channels.FirstOrDefault(
                c => c.Topic == PrincipiaUplink.ConformanceTopic);

            Assert.Equal(DelayRole.TrueNow, conformance!.Delay);
        }

        [Fact]
        public void CapturingSaysNothingUntilThereIsAVerdictToGive()
        {
            // A read taken while Principia is still loading finds nothing mapped, and
            // that is not a verdict about the install. Returning a report here would
            // latch "Principia is not loaded" about a game that is about to load it,
            // and the cache would make it permanent.
            var uplink = new PrincipiaUplink();

            var captured = uplink.CaptureConformanceOnMain(null);

            Assert.Null(captured);
        }

        [Fact]
        public void WhatIsPublishedIsAShapeTheWireWriterCanActuallyEMIT()
        {
            // The live game refused this channel and took the WHOLE uplink down with
            // it: plan, settings, flight plan and every plan command, because the
            // mapper threw on an unsupported CLR type and an uplink fail-soft is
            // all-or-nothing.
            //
            // The writer emits a hand-written set of CORE contract types. An
            // Uplink's own contract type is not among them and never will be, so the
            // only shape that crosses the boundary is a dictionary, which is what
            // the other three channels here already publish.
            //
            // The core wire-coverage gate cannot catch this: it scans
            // typeof(CommsDelay).Assembly, which is Sitrep.Contract, so no Uplink's
            // contract types are ever looked at. That is why the check lives here.
            var uplink = new PrincipiaUplink();
            var published = new List<object?>();
            uplink.PublishConformanceForTests(
                new PrincipiaConformanceReport
                {
                    State = PrincipiaConformance.Conformant,
                    Variant = PrincipiaBinaryVariant.X64AvxFma,
                    InterfaceExports = 170,
                },
                published.Add);

            Assert.Single(published);
            Assert.IsType<Dictionary<string, object?>>(published[0]);
        }

        [Fact]
        public void ThePublishedShapeCarriesEveryFieldOfTheReport()
        {
            // Flattening by hand means a field can be added to the report and
            // silently never reach a client. The count is the cheap guard.
            var uplink = new PrincipiaUplink();
            var published = new List<object?>();
            uplink.PublishConformanceForTests(new PrincipiaConformanceReport(), published.Add);

            var flat = (Dictionary<string, object?>)published[0]!;
            var fields = typeof(PrincipiaConformanceReport).GetProperties().Length;
            Assert.Equal(fields, flat.Count);
        }

        [Fact]
        public void ThePublisherIsNotFedSomethingThatIsNotAReport()
        {
            // The courier hands back whatever the capture returned, including null on
            // a tick that had nothing to say.
            var uplink = new PrincipiaUplink();

            uplink.HandleConformanceOnCourier(null);
            uplink.HandleConformanceOnCourier("not a report");
        }
    }
}
