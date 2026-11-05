using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class LoadedApproachTests
    {
        [Fact]
        public void The_straight_line_figure_is_analytic_and_a_blend_keeps_the_orbit_models_kind()
        {
            var line = LoadedApproach.Solve(new[] { 8.0, 0.0, 0.0 }, new[] { -0.2, 0.0, 0.0 }, 500.0);
            Assert.Equal(Sitrep.Contract.TrajectoryKind.Analytic, line!.TrajectoryKind);
            var orbit = new Sitrep.Contract.ClosestApproach { Time = 900.0, Distance = 3.0, TrajectoryKind = Sitrep.Contract.TrajectoryKind.Integrated };
            var blend = LoadedApproach.Combine(new[] { 2250.0, 0.0, 0.0 }, new[] { -1.0, 0.0, 0.0 }, 500.0, orbit);
            Assert.Equal(Sitrep.Contract.TrajectoryKind.Integrated, blend!.TrajectoryKind);
        }

        [Fact]
        public void A_head_on_closure_meets_at_zero_after_range_over_speed()
        {
            var ca = LoadedApproach.Solve(new[] { 8.0, 0.0, 0.0 }, new[] { -0.2, 0.0, 0.0 }, 500.0);
            Assert.NotNull(ca);
            Assert.Equal(540.0, ca!.Time, 6);
            Assert.Equal(0.0, ca.Distance, 6);
        }

        [Fact]
        public void A_sideways_offset_is_the_miss_distance()
        {
            var ca = LoadedApproach.Solve(new[] { 8.0, 0.3, 0.0 }, new[] { -0.2, 0.0, 0.0 }, 0.0);
            Assert.Equal(0.3, ca!.Distance, 6);
            Assert.Equal(40.0, ca.Time, 6);
        }

        [Fact]
        public void A_pair_that_is_not_closing_reports_now()
        {
            var ca = LoadedApproach.Solve(new[] { 8.0, 0.0, 0.0 }, new[] { 0.1, 0.0, 0.0 }, 12.0);
            Assert.Equal(12.0, ca!.Time, 6);
            Assert.Equal(8.0, ca.Distance, 6);
        }

        [Fact]
        public void Unknown_inputs_leave_the_orbit_model_figure_as_it_is()
        {
            var orbit = new Sitrep.Contract.ClosestApproach { Time = 900.0, Distance = 50.0 };
            Assert.Same(orbit, LoadedApproach.Combine(null, new[] { 0.0, 0.0, 0.0 }, 0.0, orbit));
            Assert.Same(orbit, LoadedApproach.Combine(new[] { double.NaN, 0.0, 0.0 }, new[] { 0.0, 0.0, 0.0 }, 0.0, orbit));
            Assert.Null(LoadedApproach.Combine(null, null, 0.0, null));
        }

        [Fact]
        public void The_figure_passes_from_the_line_to_the_orbit_model_without_a_step()
        {
            var orbit = new Sitrep.Contract.ClosestApproach { Time = 900.0, Distance = 50.0 };
            var velocity = new[] { -1.0, 0.0, 0.0 };
            var justInside = LoadedApproach.Combine(new[] { 2000.0, 0.0, 0.0 }, velocity, 0.0, orbit)!;
            var justOutside = LoadedApproach.Combine(new[] { 2000.01, 0.0, 0.0 }, velocity, 0.0, orbit)!;
            Assert.Equal(justInside.Time, justOutside.Time, 1);
            Assert.Equal(justInside.Distance, justOutside.Distance, 1);
            var half = LoadedApproach.Combine(new[] { 2250.0, 0.0, 0.0 }, velocity, 0.0, orbit)!;
            Assert.Equal((2250.0 + 900.0) / 2, half.Time, 6);
            Assert.Equal(25.0, half.Distance, 6);
            Assert.Same(orbit, LoadedApproach.Combine(new[] { 2500.0, 0.0, 0.0 }, velocity, 0.0, orbit));
        }

        [Fact]
        public void The_recorded_docking_run_reads_steady_where_the_orbit_model_swung_between_26_and_1055_metres()
        {
            // ut, relative position xyz, relative velocity xyz: every 25th vessel.target sample of the rig run.
            var samples = new[]
            {
                new[] { 396.82, 20.8608, 0.2724, -13.9254, -0.10558, -0.00308, 0.08025 },
                new[] { 421.82, 16.2743, 0.2548, -10.8402, -0.11069, -0.00936, 0.10015 },
                new[] { 446.82, 13.1718, 0.2204, -8.7257, -0.09253, -0.01575, 0.09342 },
                new[] { 471.82, 10.0159, 0.1799, -6.5984, -0.13437, 0.00960, 0.10094 },
                new[] { 496.82, 6.9261, 0.1301, -4.5445, -0.13957, 0.01614, 0.10600 },
                new[] { 521.82, 3.7629, 0.0745, -2.4576, -0.15485, -0.01275, 0.08299 },
                new[] { 546.82, 0.9466, 0.0166, -0.6192, -0.04020, 0.01414, 0.02243 },
            };
            foreach (var s in samples)
            {
                var wild = new Sitrep.Contract.ClosestApproach { Time = s[0] + 2300.0, Distance = 850.0 };
                var ca = LoadedApproach.Combine(new[] { s[1], s[2], s[3] }, new[] { s[4], s[5], s[6] }, s[0], wild)!;
                Assert.InRange(ca.Distance, 0.0, 4.0);
                Assert.InRange(ca.Time - s[0], 0.0, 200.0);
            }
        }

        [Fact]
        public void A_windowed_velocity_keeps_the_figure_steady_where_the_reported_velocity_wobbled()
        {
            // 30 consecutive vessel.target samples of a docked approach, 17 m down to 11 m: ut, position xyz, reported velocity xyz.
            var samples = new[]
            {
                new[] { 762.28, 16.9882, 0.1660, -12.1904, -0.16998, -0.01016, 0.15034 },
                new[] { 763.28, 16.8238, 0.1716, -12.0746, -0.16255, 0.00374, 0.09260 },
                new[] { 764.28, 16.6590, 0.1683, -11.9589, -0.14716, -0.02290, 0.10199 },
                new[] { 765.28, 16.4933, 0.1657, -11.8384, -0.14770, 0.00002, 0.13581 },
                new[] { 766.28, 16.3322, 0.1667, -11.7180, -0.17304, 0.02644, 0.14640 },
                new[] { 767.28, 16.1701, 0.1692, -11.6013, -0.18290, 0.01337, 0.12108 },
                new[] { 768.28, 16.0035, 0.1674, -11.4864, -0.16566, -0.01271, 0.07609 },
                new[] { 769.28, 15.8384, 0.1727, -11.3644, -0.13834, 0.00692, 0.11447 },
                new[] { 770.28, 15.6743, 0.1700, -11.2435, -0.16901, -0.01329, 0.12850 },
                new[] { 771.28, 15.5115, 0.1668, -11.1275, -0.19520, -0.00324, 0.11493 },
                new[] { 772.28, 15.3472, 0.1673, -11.0136, -0.17882, 0.02357, 0.10398 },
                new[] { 773.28, 15.1820, 0.1700, -10.8942, -0.14143, 0.01696, 0.11016 },
                new[] { 774.28, 15.0191, 0.1721, -10.7740, -0.12954, -0.00982, 0.12623 },
                new[] { 775.28, 14.8534, 0.1685, -10.6583, -0.18700, -0.01321, 0.11471 },
                new[] { 776.28, 14.6894, 0.1672, -10.5340, -0.15627, 0.01319, 0.14653 },
                new[] { 777.28, 14.5261, 0.1702, -10.4181, -0.13923, 0.03375, 0.10206 },
                new[] { 778.28, 14.3529, 0.1707, -10.2993, -0.16715, -0.01614, 0.08499 },
                new[] { 779.28, 14.1845, 0.1671, -10.1790, -0.15306, 0.01021, 0.11649 },
                new[] { 780.28, 14.0246, 0.1728, -10.0574, -0.15786, 0.00334, 0.13267 },
                new[] { 781.28, 13.8634, 0.1676, -9.9360, -0.18026, 0.01670, 0.12459 },
                new[] { 782.28, 13.6954, 0.1689, -9.8217, -0.19959, 0.02027, 0.09771 },
                new[] { 783.28, 13.5252, 0.1678, -9.7061, -0.17826, -0.02324, 0.11514 },
                new[] { 784.28, 13.3664, 0.1630, -9.5818, -0.12965, 0.00020, 0.12615 },
                new[] { 785.28, 13.2014, 0.1661, -9.4626, -0.15053, 0.00685, 0.10854 },
                new[] { 786.28, 13.0374, 0.1719, -9.3481, -0.17988, 0.00668, 0.11338 },
                new[] { 787.28, 12.8746, 0.1675, -9.2256, -0.15122, -0.02013, 0.13011 },
                new[] { 788.28, 12.7106, 0.1650, -9.1082, -0.18839, -0.01354, 0.12406 },
                new[] { 789.28, 12.5455, 0.1666, -8.9915, -0.20538, -0.01346, 0.11200 },
                new[] { 790.28, 12.3813, 0.1675, -8.8748, -0.14016, 0.03012, 0.12351 },
                new[] { 791.28, 12.2209, 0.1684, -8.7568, -0.16830, 0.00347, 0.10663 },
            };
            var track = new ApproachTrack();
            var orbit = new Sitrep.Contract.ClosestApproach { Time = 9999.0, Distance = 800.0 };
            double? previousTime = null;
            var reportedWorst = 0.0;
            for (var i = 0; i < samples.Length; i++)
            {
                var s = samples[i];
                var position = new[] { s[1], s[2], s[3] };
                track.Add("t", s[0], position);
                reportedWorst = System.Math.Max(reportedWorst, LoadedApproach.Combine(position, new[] { s[4], s[5], s[6] }, s[0], orbit)!.Distance);
                var velocity = track.Velocity();
                if (velocity == null)
                {
                    continue;
                }
                var ca = LoadedApproach.Combine(position, velocity, s[0], orbit)!;
                Assert.InRange(ca.Distance, 0.0, 0.4);
                if (previousTime != null)
                {
                    Assert.InRange(System.Math.Abs(ca.Time - previousTime.Value), 0.0, 3.0);
                }
                previousTime = ca.Time;
            }
            Assert.True(reportedWorst > 0.8, "the reported velocity alone moved the miss by under a metre: " + reportedWorst);
        }

        [Fact]
        public void The_window_starts_again_after_a_gap_a_new_target_or_a_step_back()
        {
            var track = new ApproachTrack();
            for (var i = 0; i < 6; i++)
            {
                track.Add("a", 100.0 + i, new[] { 10.0 - 0.2 * i, 0.0, 0.0 });
            }
            Assert.NotNull(track.Velocity());
            track.Add("b", 106.0, new[] { 5.0, 0.0, 0.0 });
            Assert.Null(track.Velocity());
            for (var i = 1; i < 6; i++)
            {
                track.Add("b", 106.0 + i, new[] { 5.0 - 0.2 * i, 0.0, 0.0 });
            }
            Assert.Equal(-0.2, track.Velocity()![0], 6);
            track.Add("b", 130.0, new[] { 1.0, 0.0, 0.0 });
            Assert.Null(track.Velocity());
        }
    }
}
