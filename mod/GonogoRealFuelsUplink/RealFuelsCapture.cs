using System.Collections.Generic;

namespace GonogoRealFuelsUplink
{
    /// <summary>
    /// Pure mappers: turn the reflected RealFuels readings into the
    /// <c>realfuels.engines</c> and <c>realfuels.boiloff</c> dicts. KSP-free and
    /// side-effect-free, so both the ignition semantics and the boiloff unit
    /// conversion are unit-tested headless.
    ///
    /// <para>This is where RealFuels' two traps are unpicked, and it is
    /// deliberately the only place either rule is written down.</para>
    /// </summary>
    public static class RealFuelsCapture
    {
        /// <summary>Tonnes to kilograms, for the boiloff rate.</summary>
        private const double KilogramsPerTonne = 1000.0;

        /// <summary>
        /// True when the engine can be relit without limit.
        /// <c>ModuleEnginesRF.GetUllageIgnition</c> asks this first and asks it
        /// this way: the game-wide switch being off makes every budget moot, and
        /// any negative count is RealFuels' unlimited sentinel rather than a
        /// deficit.
        /// </summary>
        public static bool? IgnitionsUnlimited(int? ignitions, bool? ignitionsLimited)
        {
            if (ignitions == null || ignitionsLimited == null)
            {
                return null;
            }
            return !ignitionsLimited.Value || ignitions.Value < 0;
        }

        /// <summary>
        /// True when the engine will light only on a launch clamp.
        ///
        /// <para>The reading is <c>ignitions == 0</c>, and it is a state rather
        /// than an exhausted budget: <c>IgnitionUpdate</c> refuses the light
        /// outright unless the vessel has a clamp attached, so there is no
        /// in-flight relight to be had at all. It survives to the live module
        /// only for a part whose config sets <c>literalZeroIgnitions</c>,
        /// because <c>ConfigIgnitions</c> rewrites every other configured zero to
        /// the unlimited sentinel on the way in.</para>
        /// </summary>
        public static bool? GroundIgnitionOnly(int? ignitions, bool? ignitionsLimited)
        {
            if (ignitions == null || ignitionsLimited == null)
            {
                return null;
            }
            return ignitionsLimited.Value && ignitions.Value == 0;
        }

        /// <summary>
        /// Boiloff as a RATE in kg/s, from the mass RealFuels accumulated and the
        /// interval it accumulated over.
        ///
        /// <para>RealFuels' <c>BoiloffMassRate</c> is not one: its base
        /// accumulation multiplies by the interval before adding, so the property
        /// holds tonnes over the physics frame just past. Dividing by the same
        /// interval RealFuels was handed is what makes the published field's name
        /// true. A non-positive or missing interval yields null, because a mass
        /// over an unknown time is not a rate of zero.</para>
        /// </summary>
        public static double? BoiloffRateKgPerSecond(double? boiloffMassTons, double? intervalSeconds)
        {
            if (boiloffMassTons == null || intervalSeconds == null || intervalSeconds.Value <= 0.0)
            {
                return null;
            }
            return boiloffMassTons.Value * KilogramsPerTonne / intervalSeconds.Value;
        }

        /// <summary>Builds the <c>realfuels.engines</c> payload. Null raw means
        /// the vessel could not be read at all, and yields a null engine list
        /// rather than an empty one.</summary>
        public static Dictionary<string, object?> BuildEngines(RealFuelsVesselRaw? raw)
        {
            if (raw == null)
            {
                return new Dictionary<string, object?>
                {
                    ["ignitionsLimited"] = null,
                    ["ullageSimulated"] = null,
                    ["engines"] = null,
                };
            }

            var rows = new List<Dictionary<string, object?>>(raw.Engines.Count);
            foreach (var e in raw.Engines)
            {
                rows.Add(new Dictionary<string, object?>
                {
                    ["partId"] = e.PartId,
                    ["partName"] = e.PartName,
                    ["ignitionsRemaining"] = e.Ignitions,
                    ["ignitionsUnlimited"] = IgnitionsUnlimited(e.Ignitions, raw.IgnitionsLimited),
                    ["groundIgnitionOnly"] = GroundIgnitionOnly(e.Ignitions, raw.IgnitionsLimited),
                    ["literalZeroIgnitions"] = e.LiteralZeroIgnitions,
                    ["ullageModelled"] = e.UllageModelled,
                    ["ullageStability"] = e.UllageStability,
                    ["ignitionProbability"] = e.IgnitionProbability,
                    ["pressureFed"] = e.PressureFed,
                    ["feedPressureOk"] = e.FeedPressureOk,
                    ["ratedBurnTimeSeconds"] = e.RatedBurnTimeSeconds,
                    ["ratedContinuousBurnTimeSeconds"] = e.RatedContinuousBurnTimeSeconds,
                    ["predictedMaximumResiduals"] = e.PredictedMaximumResiduals,
                });
            }

            return new Dictionary<string, object?>
            {
                ["ignitionsLimited"] = raw.IgnitionsLimited,
                ["ullageSimulated"] = raw.UllageSimulated,
                ["engines"] = rows,
            };
        }

        /// <summary>Builds the <c>realfuels.boiloff</c> payload.</summary>
        public static Dictionary<string, object?> BuildBoiloff(RealFuelsBoiloffRaw? raw)
        {
            if (raw == null)
            {
                return new Dictionary<string, object?>
                {
                    ["boiloffRate"] = null,
                    ["cryogenicTankCount"] = null,
                };
            }
            return new Dictionary<string, object?>
            {
                ["boiloffRate"] = BoiloffRateKgPerSecond(raw.BoiloffMassTons, raw.IntervalSeconds),
                ["cryogenicTankCount"] = raw.CryogenicTankCount,
            };
        }
    }
}
