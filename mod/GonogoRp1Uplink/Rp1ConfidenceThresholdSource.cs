using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Confidence as something a SCET alarm can watch, so an operator can warp
    /// and be stopped the moment they can commit to the next Program.
    ///
    /// <para><b>Why an alarm and not a readout.</b> Confidence is the currency a
    /// Program costs, and it accrues over months of game time that an operator
    /// spends warping. Watching it from the ground means reading a number that is
    /// a light-time old and acting a poll interval later, by which point the warp
    /// has carried the clock past whatever was worth stopping for. A SCET
    /// threshold is evaluated inside the simulation and halts the warp on the tick
    /// the condition matches.</para>
    ///
    /// <para><b>RP-1's own fund target does not cover this.</b>
    /// <c>rp1.fundTarget.set</c> warps toward a FUNDS figure and is RP-1's own
    /// mechanism; there is no equivalent for Confidence, and no way at all to ask
    /// for one of the six comparisons a threshold offers.</para>
    ///
    /// <para><b>Read live, not from the last publish.</b> The builder runs on the
    /// capture, on the main thread, in the tick the alarm is decided in, so it
    /// takes the reading itself rather than answering off whatever
    /// <c>rp1.confidence</c> last put on the wire. A cached figure would be a
    /// reading from an earlier tick wearing a current answer's clothes, which is
    /// the exact staleness the whole SCET arm exists to avoid.</para>
    /// </summary>
    internal sealed class Rp1ConfidenceThresholdSource : IScetThresholdSources
    {
        /// <summary>
        /// The Topic, which is the one <c>rp1.confidence</c> already publishes, so
        /// an operator arms against the number they are reading on screen and the
        /// field path is the one the wire uses.
        /// </summary>
        internal const string Topic = "rp1.confidence";

        private readonly Func<Rp1ConfidenceRaw?> _read;

        internal Rp1ConfidenceThresholdSource(Func<Rp1ConfidenceRaw?> read) =>
            _read = read ?? throw new ArgumentNullException(nameof(read));

        public string ProviderId => "rp1";

        public IReadOnlyList<ScetThresholdSource> Sources() => new[]
        {
            new ScetThresholdSource { Topic = Topic, Build = Build },
        };

        /// <summary>
        /// The same shape <c>Rp1ScCapture.BuildConfidence</c> puts on the wire,
        /// plus the provenance stamp a threshold reading is accepted on.
        ///
        /// <para>Null whenever RP-1's Confidence scenario is not live, which reads
        /// as "not now" and never fires. Deliberately not a zero: a career that has
        /// spent its Confidence genuinely sits at 0, and an alarm for
        /// "confidence &lt; 10" would otherwise fire on a save that has no
        /// Confidence system at all.</para>
        ///
        /// <para>The subject is <c>"game"</c> because Confidence belongs to the
        /// save rather than to anything flying: there is one of it, and switching
        /// vessels cannot change which one is read.</para>
        /// </summary>
        private object? Build(KspSnapshot? snapshot)
        {
            Rp1ConfidenceRaw? confidence;
            try
            {
                confidence = _read();
            }
            catch (Exception)
            {
                // The reflection walk is arm's-length by licence and by design, so
                // a shape RP-1 changed is a reading this tick does not have rather
                // than an exception that takes the whole alarm capture with it.
                return null;
            }

            if (confidence == null)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["confidence"] = confidence.Confidence,
                ["earned"] = confidence.Earned,
                ["meta"] = new Dictionary<string, object?>
                {
                    ["source"] = "game",
                    ["quality"] = Quality.Loaded,
                },
            };
        }
    }
}
