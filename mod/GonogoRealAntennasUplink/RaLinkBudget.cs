using System;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// A pure, headlessly-tested re-derivation of RealAntennas' PUBLIC link-budget
    /// formulas (comms-uplink-design.md §4.3). RA computes margin/noise transiently
    /// inside its <c>internal</c> Burst <c>Precompute</c> job and stores it nowhere
    /// public on the live graph — so rather than reflect an unstable debug-GUI
    /// struct, this uplink RE-DERIVES the figures from RA's public static math
    /// (<c>Physics.PathLoss</c>/<c>ReceivedPower</c>/<c>NoiseSpectralDensity</c>,
    /// all documented public), fed by the public antenna properties
    /// (<c>Gain</c>/<c>TxPower</c>/<c>SymbolRate</c>/<c>Frequency</c>) read via
    /// reflection.
    ///
    /// <para>Every constant/formula here is reasoned from RA's PUBLIC constants and
    /// documented behaviour (<c>src/RealAntennasProject/Physics.cs</c>), NOT copied
    /// from RA's internal job code — the arm's-length boundary (§4.2) holds: no RA
    /// source is compiled in, no RA assembly is linked. This is a best-effort
    /// estimate, explicitly NOT a bit-for-bit match of RA's negotiated-modulation
    /// tie-break logic (§4.3: "compute its own best-effort margin rather than match
    /// RA's negotiated rate bit-for-bit").</para>
    /// </summary>
    public static class RaLinkBudget
    {
        /// <summary>Speed of light RA uses (<c>Physics.c</c>), m/s.</summary>
        public const double SpeedOfLight = 2.998e8;

        /// <summary>RA's <c>Physics.path_loss_constant</c> — <c>20*log10(4π/c)</c> in dB.</summary>
        public const double PathLossConstantDb = -147.552435289803;

        /// <summary>RA's <c>Physics.boltzmann_dBm</c> (Boltzmann constant expressed in dBm/Hz/K).</summary>
        public const double BoltzmannDbm = -228.599168683097 + 30.0;

        /// <summary>The cosmic microwave background floor temperature RA uses (<c>Physics.CMB</c>), K.</summary>
        public const double CmbTemperatureKelvin = 2.725;

        /// <summary>
        /// Free-space path loss in dB — RA's <c>Physics.PathLoss(distance, frequency)</c>
        /// verbatim in form: <c>20*log10(distance*frequency) + path_loss_constant</c>.
        /// </summary>
        public static double PathLossDb(double distanceMeters, double frequencyHz)
        {
            if (distanceMeters <= 0 || frequencyHz <= 0)
            {
                return 0.0;
            }
            return 20.0 * Math.Log10(distanceMeters * frequencyHz) + PathLossConstantDb;
        }

        /// <summary>
        /// Received power in dBm — RA's <c>Physics.ReceivedPower</c> minus the
        /// pointing-loss terms (a best-effort estimate that assumes on-target
        /// antennas): <c>txPower + txGain - pathLoss + rxGain</c>. All powers/gains
        /// in dBm/dBi.
        /// </summary>
        public static double ReceivedPowerDbm(
            double txPowerDbm, double txGainDbi, double rxGainDbi, double distanceMeters, double frequencyHz)
        {
            return txPowerDbm + txGainDbi - PathLossDb(distanceMeters, frequencyHz) + rxGainDbi;
        }

        /// <summary>
        /// Noise spectral density N0 in dBm/Hz — RA's
        /// <c>Physics.NoiseSpectralDensity(noiseTemp)</c>:
        /// <c>boltzmann_dBm + 10*log10(noiseTemp)</c>. A noise temp at/below 0 K is
        /// clamped to the CMB floor rather than producing -∞.
        /// </summary>
        public static double NoiseSpectralDensityDbm(double noiseTempKelvin)
        {
            double t = noiseTempKelvin > CmbTemperatureKelvin ? noiseTempKelvin : CmbTemperatureKelvin;
            return BoltzmannDbm + 10.0 * Math.Log10(t);
        }

        /// <summary>
        /// Link margin in dB: received power minus the noise floor for the given
        /// symbol rate minus the required Eb/N0. Classic budget
        /// <c>margin = Pr - (N0 + 10*log10(symbolRate)) - requiredEbN0</c>. A
        /// non-positive symbol rate yields a negative-infinity-safe "cannot close"
        /// margin (returns <c>double.NegativeInfinity</c>).
        /// </summary>
        public static double LinkMarginDb(
            double receivedPowerDbm,
            double noiseTempKelvin,
            double symbolRateHz,
            double requiredEbN0Db)
        {
            if (symbolRateHz <= 0)
            {
                return double.NegativeInfinity;
            }
            double n0 = NoiseSpectralDensityDbm(noiseTempKelvin);
            double noiseFloor = n0 + 10.0 * Math.Log10(symbolRateHz);
            return receivedPowerDbm - noiseFloor - requiredEbN0Db;
        }

        /// <summary>Whether a margin closes the link (≥ 0 dB).</summary>
        public static bool ClosesLink(double marginDb) => marginDb >= 0.0;

        /// <summary>
        /// Normalise a link margin (dB) to a 0..1 quality for
        /// <c>comms.linkQuality</c>. Maps a <paramref name="fullScaleDb"/>-wide
        /// window ending at 0 dB (link-close) onto [0,1]: at/below
        /// <c>-fullScaleDb</c> ⇒ 0, at/above <c>+fullScaleDb</c> ⇒ 1, linear
        /// between. Purely a display normalisation, documented as best-effort.
        /// </summary>
        public static double NormaliseQuality(double marginDb, double fullScaleDb = 20.0)
        {
            if (fullScaleDb <= 0 || double.IsNaN(marginDb))
            {
                return 0.0;
            }
            double q = (marginDb + fullScaleDb) / (2.0 * fullScaleDb);
            if (q < 0.0) return 0.0;
            if (q > 1.0) return 1.0;
            return q;
        }
    }
}
