using System;
using Gonogo.KSP;
using Xunit;
using V = Sitrep.Contract.Vector3d;

namespace Gonogo.KSP.Tests
{
    public class TargetOrbitFrameTests
    {
        private const double Mu = 3.5316e12;
        private const double OrbitRadius = 700_000.0;

        private static double Speed => Math.Sqrt(Mu / OrbitRadius);

        /// <summary>A craft on a circular equatorial orbit at <paramref name="angle"/> radians, in a right-handed frame with z north.</summary>
        private static (V Position, V Velocity) OnCircle(double angle) => (
            new V(OrbitRadius * Math.Cos(angle), OrbitRadius * Math.Sin(angle), 0.0),
            new V(-Speed * Math.Sin(angle), Speed * Math.Cos(angle), 0.0));

        private static V ToWorld(V rightHanded) => new V(rightHanded.X, rightHanded.Z, rightHanded.Y);

        /// <summary>A rotation of the world frame about its up axis, as the game's scene axes turn with the body.</summary>
        private static V Turned(V world, double angle) => new V(
            world.X * Math.Cos(angle) + world.Z * Math.Sin(angle),
            world.Y,
            -world.X * Math.Sin(angle) + world.Z * Math.Cos(angle));

        private static (V Position, V Velocity) Split(V position, V velocity, V targetPosition, V targetVelocity) =>
            TargetOrbitFrame.FromWorld(
                ToWorld(position), ToWorld(velocity),
                ToWorld(targetPosition - position), ToWorld(targetVelocity - velocity))!.Value;

        [Fact]
        public void Two_craft_in_the_same_orbit_at_a_fixed_range_read_no_closing_velocity()
        {
            var chaser = OnCircle(0.0);
            var target = OnCircle(399.0 / OrbitRadius);
            var raw = (target.Velocity - chaser.Velocity).Magnitude();
            Assert.True(raw > 0.8, "the raw difference is the orbit's turn times the range: " + raw);

            var split = Split(chaser.Position, chaser.Velocity, target.Position, target.Velocity);

            Assert.Equal(0.0, split.Velocity.Magnitude(), 9);
            Assert.Equal(399.0, split.Position.Y, 0);
            Assert.True(split.Position.X < 0.0, "a target ahead on the same circle sits slightly below the chaser's height");
            Assert.Equal(0.0, split.Position.Z, 9);
        }

        [Fact]
        public void A_pure_radial_offset_reads_radial_only()
        {
            var chaser = OnCircle(0.6);
            var above = chaser.Position * ((OrbitRadius + 250.0) / OrbitRadius);

            var split = Split(chaser.Position, chaser.Velocity, above, chaser.Velocity);

            Assert.Equal(250.0, split.Position.X, 9);
            Assert.Equal(0.0, split.Position.Y, 9);
            Assert.Equal(0.0, split.Position.Z, 9);
        }

        [Fact]
        public void A_target_north_of_a_prograde_orbit_reads_positive_normal()
        {
            var chaser = OnCircle(0.0);
            var north = chaser.Position + new V(0.0, 0.0, 40.0);

            var split = Split(chaser.Position, chaser.Velocity, north, chaser.Velocity);

            Assert.Equal(40.0, split.Position.Z, 9);
        }

        [Fact]
        public void Scene_axes_turning_with_the_body_or_holding_still_give_the_same_frame()
        {
            var chaser = OnCircle(1.1);
            var target = OnCircle(1.1 + 1200.0 / OrbitRadius);
            var targetVelocity = target.Velocity + new V(0.3, -0.2, 0.5);

            var still = TargetOrbitFrame.FromWorld(
                ToWorld(chaser.Position), ToWorld(chaser.Velocity),
                ToWorld(target.Position - chaser.Position), ToWorld(targetVelocity - chaser.Velocity))!.Value;
            const double Turn = 2.4;
            var turning = TargetOrbitFrame.FromWorld(
                Turned(ToWorld(chaser.Position), Turn), Turned(ToWorld(chaser.Velocity), Turn),
                Turned(ToWorld(target.Position - chaser.Position), Turn), Turned(ToWorld(targetVelocity - chaser.Velocity), Turn))!.Value;

            Assert.Equal(still.Position.X, turning.Position.X, 9);
            Assert.Equal(still.Position.Y, turning.Position.Y, 9);
            Assert.Equal(still.Position.Z, turning.Position.Z, 9);
            Assert.Equal(still.Velocity.X, turning.Velocity.X, 9);
            Assert.Equal(still.Velocity.Y, turning.Velocity.Y, 9);
            Assert.Equal(still.Velocity.Z, turning.Velocity.Z, 9);
            Assert.NotEqual(0.0, still.Velocity.Z);
        }

        [Fact]
        public void A_craft_moving_straight_up_defines_no_frame()
        {
            var position = new V(OrbitRadius, 0.0, 0.0);
            var velocity = new V(100.0, 0.0, 0.0);

            Assert.Null(TargetOrbitFrame.FromWorld(position, velocity, new V(1.0, 0.0, 0.0), new V()));
        }
    }
}
