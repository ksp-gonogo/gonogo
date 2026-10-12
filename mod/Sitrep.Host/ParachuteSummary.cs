using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// One parachute as the game reports it: how far it has opened, how safe
    /// the game rates opening it now, and the height above the ground at which
    /// it opens fully.
    /// </summary>
    public readonly struct ParachuteReading
    {
        /// <summary><c>stowed</c> / <c>armed</c> / <c>semi-deployed</c> / <c>deployed</c> / <c>cut</c>.</summary>
        public string Deployment { get; }

        /// <summary><c>safe</c> / <c>risky</c> / <c>unsafe</c>, or null where the game gives no rating.</summary>
        public string? Safety { get; }

        /// <summary>Metres above the ground or the sea at which it opens fully, or null where the game reports none.</summary>
        public double? FullDeployAltitude { get; }

        public ParachuteReading(string deployment, string? safety, double? fullDeployAltitude)
        {
            Deployment = deployment;
            Safety = safety;
            FullDeployAltitude = fullDeployAltitude;
        }
    }

    /// <summary>
    /// The craft's parachutes folded into the three <c>vessel.landing</c>
    /// fields a descent is read by: how far they have opened, whether opening
    /// the rest is safe, and the height they open fully at.
    /// </summary>
    public static class ParachuteSummary
    {
        /// <summary>How far along each deployment is: the furthest along speaks for the craft.</summary>
        private static int Stage(string deployment)
        {
            switch (deployment)
            {
                case "stowed":
                    return 0;
                case "armed":
                    return 1;
                case "semi-deployed":
                    return 2;
                case "deployed":
                    return 3;
                default:
                    return -1;
            }
        }

        /// <summary>How bad each rating is: the worst speaks for the craft.</summary>
        private static int Danger(string? safety)
        {
            switch (safety)
            {
                case "safe":
                    return 0;
                case "risky":
                    return 1;
                case "unsafe":
                    return 2;
                default:
                    return -1;
            }
        }

        /// <summary>
        /// The fields for these parachutes. <c>parachuteDeployment</c> is the
        /// furthest along among those not cut, <c>"cut"</c> when every one is,
        /// and <c>"none"</c> for a craft with none. <c>parachuteDeploySafety</c>
        /// is the worst rating among those not yet open. <c>parachuteFullDeployAltitude</c>
        /// is the greatest height among those armed or semi-deployed, since that
        /// one opens first. A field nothing speaks for is null.
        /// </summary>
        public static Dictionary<string, object?> Fields(IReadOnlyList<ParachuteReading> chutes)
        {
            string? furthest = null;
            int furthestStage = -1;
            string? worst = null;
            int worstDanger = -1;
            double? opensAt = null;
            bool anyCut = false;
            foreach (var chute in chutes)
            {
                if (chute.Deployment == "cut")
                {
                    anyCut = true;
                    continue;
                }
                int stage = Stage(chute.Deployment);
                if (stage > furthestStage)
                {
                    furthestStage = stage;
                    furthest = chute.Deployment;
                }
                if (stage <= 1 && Danger(chute.Safety) > worstDanger)
                {
                    worstDanger = Danger(chute.Safety);
                    worst = chute.Safety;
                }
                if ((stage == 1 || stage == 2) && chute.FullDeployAltitude.HasValue
                    && (!opensAt.HasValue || chute.FullDeployAltitude.Value > opensAt.Value))
                {
                    opensAt = chute.FullDeployAltitude.Value;
                }
            }
            string deployment = furthest ?? (anyCut ? "cut" : "none");
            return new Dictionary<string, object?>
            {
                ["parachuteDeployment"] = deployment,
                ["parachuteDeploySafety"] = worst,
                ["parachuteFullDeployAltitude"] = opensAt,
            };
        }
    }
}
