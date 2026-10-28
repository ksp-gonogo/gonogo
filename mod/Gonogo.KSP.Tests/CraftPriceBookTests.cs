using System;
using System.Collections.Generic;
using System.IO;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public sealed class CraftPriceBookTests : IDisposable
    {
        private readonly string _folder = Path.Combine(Path.GetTempPath(), "craft-price-book-" + Guid.NewGuid().ToString("N"));

        private string BookFile => Path.Combine(_folder, "craft-prices.txt");

        public void Dispose()
        {
            if (Directory.Exists(_folder))
            {
                Directory.Delete(_folder, true);
            }
        }

        private CraftPriceBook Book(params string[] craftOnDisk)
        {
            var present = new HashSet<string>(craftOnDisk);
            return new CraftPriceBook(BookFile, fileExists: present.Contains);
        }

        private static readonly string Parts = CraftPriceBook.Fingerprint(
            new[] { new KeyValuePair<string, double>("mk1pod.v2", 600), new KeyValuePair<string, double>("fuelTankSmall", 150) },
            new[] { "SomeModuleMod 3.19.0" });

        [Fact]
        public void APriceIsAnsweredOnTheNextLaunchForTheSameFileVersionAndParts()
        {
            Book("Ships/VAB/Kcvid2.craft").Put("Ships/VAB/Kcvid2.craft", 100, Parts, 2875.5);

            Assert.True(Book("Ships/VAB/Kcvid2.craft").TryGet("Ships/VAB/Kcvid2.craft", 100, Parts, out var cost));
            Assert.Equal(2875.5, cost);
        }

        [Fact]
        public void ACraftPricedUnderAnotherPartsSetOrAnotherFileVersionIsNotAnswered()
        {
            var book = Book("Ships/VAB/Kcvid2.craft");
            book.Put("Ships/VAB/Kcvid2.craft", 100, Parts, 2875.5);

            Assert.False(book.TryGet("Ships/VAB/Kcvid2.craft", 100, "another parts set", out _));
            Assert.False(book.TryGet("Ships/VAB/Kcvid2.craft", 101, Parts, out _));
        }

        [Fact]
        public void ACraftThatCouldNotBePricedIsRememberedAsSuch()
        {
            Book("Ships/SPH/Broken.craft").Put("Ships/SPH/Broken.craft", 7, Parts, null);

            Assert.True(Book("Ships/SPH/Broken.craft").TryGet("Ships/SPH/Broken.craft", 7, Parts, out var cost));
            Assert.Null(cost);
        }

        [Fact]
        public void APriceForACraftNoLongerOnDiskIsDroppedWhenTheBookIsWritten()
        {
            Book("a.craft", "b.craft").Put("a.craft", 1, Parts, 10);
            Book("b.craft").Put("b.craft", 1, Parts, 20);

            var later = Book("a.craft", "b.craft");
            Assert.False(later.TryGet("a.craft", 1, Parts, out _));
            Assert.True(later.TryGet("b.craft", 1, Parts, out _));
        }

        [Fact]
        public void AnUnreadableLineIsSkippedAndTheRestAnswered()
        {
            Directory.CreateDirectory(_folder);
            File.WriteAllText(BookFile, "not a price\n12\t" + Parts + "\t40\tgood.craft\nx\ty\tz\tbad.craft\n");

            var book = Book("good.craft");
            Assert.True(book.TryGet("good.craft", 12, Parts, out var cost));
            Assert.Equal(40, cost);
            Assert.False(book.TryGet("bad.craft", 0, "y", out _));
        }

        [Fact]
        public void TheFingerprintMovesWithAPartCostOrAnAssemblyVersionAndNotWithOrder()
        {
            var pod = new KeyValuePair<string, double>("mk1pod.v2", 600);
            var tank = new KeyValuePair<string, double>("fuelTankSmall", 150);

            Assert.Equal(Parts, CraftPriceBook.Fingerprint(new[] { tank, pod }, new[] { "SomeModuleMod 3.19.0" }));
            Assert.NotEqual(Parts, CraftPriceBook.Fingerprint(new[] { pod, new KeyValuePair<string, double>("fuelTankSmall", 175) }, new[] { "SomeModuleMod 3.19.0" }));
            Assert.NotEqual(Parts, CraftPriceBook.Fingerprint(new[] { pod, tank }, new[] { "SomeModuleMod 3.20.0" }));
        }
    }
}
