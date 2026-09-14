using System;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// A bound two-body conic, evaluated the way the game's own solver does.
    ///
    /// <para>Here rather than taken from the propagation library on purpose: this
    /// project may reference <c>Sitrep.Contract</c> and its own contract slice and
    /// nothing else of the repo, the same rule the Uplink it tests lives under.
    /// The evaluator is checked rather than trusted: fed the active craft's own
    /// elements it reproduces the first point of the trajectory arc the mod
    /// published on the rig to a nanometre.</para>
    ///
    /// <para><b>One declaration, shared by every suite that measures a departure.</b>
    /// It was nested inside the craft-bound suite, and a second suite measuring
    /// BODIES against a second transcription of it would have two evaluators agreeing
    /// with themselves and nothing comparing them. A copy of a measured thing is the
    /// one kind of duplication that cannot be caught by reading either half.</para>
    /// </summary>
    internal readonly struct Conic
    {
        public Conic(
            double sma, double ecc, double incDegrees, double lanDegrees,
            double argPeDegrees, double meanAnomalyAtEpoch, double epoch, double mu)
        {
            Sma = sma;
            Ecc = ecc;
            IncDegrees = incDegrees;
            LanDegrees = lanDegrees;
            ArgPeDegrees = argPeDegrees;
            MeanAnomalyAtEpoch = meanAnomalyAtEpoch;
            Epoch = epoch;
            Mu = mu;
        }

        public double Sma { get; }

        public double Ecc { get; }

        public double IncDegrees { get; }

        public double LanDegrees { get; }

        public double ArgPeDegrees { get; }

        public double MeanAnomalyAtEpoch { get; }

        public double Epoch { get; }

        public double Mu { get; }

        /// <summary>The period this conic implies: <c>2*pi*sqrt(a^3/mu)</c>.</summary>
        public double CycleSeconds => 2.0 * Math.PI * Math.Sqrt(Sma * Sma * Sma / Mu);

        public Sitrep.Contract.Vector3d At(double ut)
        {
            var n = Math.Sqrt(Mu / (Sma * Sma * Sma));
            var mean = MeanAnomalyAtEpoch + n * (ut - Epoch);
            mean %= 2.0 * Math.PI;
            if (mean < 0.0) mean += 2.0 * Math.PI;

            var eccentric = Ecc < 0.8 ? mean : Math.PI;
            for (var i = 0; i < 80; i++)
            {
                var delta = (eccentric - Ecc * Math.Sin(eccentric) - mean)
                            / (1.0 - Ecc * Math.Cos(eccentric));
                eccentric -= delta;
                if (Math.Abs(delta) < 1e-15) break;
            }

            var xp = Sma * (Math.Cos(eccentric) - Ecc);
            var yp = Sma * Math.Sqrt(1.0 - Ecc * Ecc) * Math.Sin(eccentric);

            var lan = LanDegrees * Math.PI / 180.0;
            var argPe = ArgPeDegrees * Math.PI / 180.0;
            var inc = IncDegrees * Math.PI / 180.0;
            double co = Math.Cos(lan), so = Math.Sin(lan);
            double cw = Math.Cos(argPe), sw = Math.Sin(argPe);
            double ci = Math.Cos(inc), si = Math.Sin(inc);

            return new Sitrep.Contract.Vector3d(
                (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp,
                (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp,
                (sw * si) * xp + (cw * si) * yp);
        }

        /// <summary>
        /// The same conic seen from the other end: where the PRIMARY is, in this
        /// body's frame. A local copy because a lambda in a struct may not close
        /// over <c>this</c>.
        /// </summary>
        public Func<double, Sitrep.Contract.Vector3d> Inverted
        {
            get
            {
                var self = this;
                return ut =>
                {
                    var v = self.At(ut);
                    return new Sitrep.Contract.Vector3d(-v.X, -v.Y, -v.Z);
                };
            }
        }
    }

    /// <summary>
    /// The stock system as the rig gave it on 2026-09-05, off the running game's own
    /// <c>system.bodies</c> frame: each body's conic about its primary, and the
    /// gravitational parameters the producer's gravity model names them with.
    ///
    /// <para>Nothing here is invented geometry, and nothing here is rounded. It is
    /// shared rather than transcribed per suite for the reason on <see cref="Conic"/>.</para>
    /// </summary>
    internal static class RigGeometry
    {
        public const double SunMu = 1172332794832490000.0;
        public const double KerbinMu = 3531600000000.0;
        public const double MunMu = 65138397520.7807;
        public const double MinmusMu = 1765800026.31247;
        public const double JoolMu = 282528004209995.0;
        public const double LaytheMu = 1962000029236.08;
        public const double VallMu = 207481499473.751;
        public const double BopMu = 2486834944.41491;
        public const double TyloMu = 2825280042099.95;
        public const double PolMu = 721702080.0;

        public const int Sun = 0;
        public const int Kerbin = 1;
        public const int Mun = 2;
        public const int Minmus = 3;
        public const int Jool = 8;
        public const int Laythe = 9;
        public const int Vall = 10;
        public const int Bop = 11;
        public const int Tylo = 12;
        public const int Pol = 14;

        /// <summary>The instant every element set below was sampled at.</summary>
        public const double SampleUt = 161619.050122945;

        public static readonly Conic KerbinAboutSun = new Conic(
            13574792864.0935, 0.00191207977794452, 5.11287023511102e-05, 285.453836300293,
            154.797228764872, 3.42157698647726, 161657.810122925, SunMu);

        public static readonly Conic MunAboutKerbin = new Conic(
            12306624.24893, 0.018861681759181, 0.000503878054494123, 273.295095333987,
            331.766780134565, 0.0135118494392138, 161657.810122925, KerbinMu);

        public static readonly Conic MinmusAboutKerbin = new Conic(
            49364659.9958564, 0.0537570971779703, 6.11004281600018, 165.759009218609,
            87.2604590349987, 0.921012269437993, 161657.810122925, KerbinMu);

        public static readonly Conic JoolAboutSun = new Conic(
            69066973794.4695, 0.0539625384264022, 1.30160530585606, 141.987715982986,
            0.246382324649402, 0.105160543337695, 161657.810122925, SunMu);

        public static readonly Conic LaytheAboutJool = new Conic(
            27414350.3567754, 0.00649391277840101, 0.000102251534510788, 186.449111393951,
            75.9480272714625, 0.462415252868674, 161657.810122925, JoolMu);

        public static readonly Conic VallAboutJool = new Conic(
            51017049.5095503, 0.05914181504899, 0.000836984897413598, 179.079077066066,
            82.0296072811935, 5.70881950103746, 161657.810122925, JoolMu);

        public static readonly Conic BopAboutJool = new Conic(
            142678061.712467, 0.226213622622806, 164.747541988762, 100.791671148785,
            25.6821618039991, 2.52410973131585, 161657.810122925, JoolMu);

        public static readonly Conic TyloAboutJool = new Conic(
            90322670.5554466, 0.00913955096636274, 0.0251455953592476, 89.2454827357844,
            200.420705590049, 2.78843388486583, 161657.810122925, JoolMu);

        public static readonly Conic PolAboutJool = new Conic(
            181831928.904955, 0.154166587143448, 4.2399199055553, 92.0194719855218,
            16.0389921944997, 2.03058128609828, 161657.810122925, JoolMu);
    }
}
