#!/usr/bin/env node
/**
 * Is a NuGet version nuget.org already carries a fossil of what this commit
 * would publish?
 *
 * `KspGonogo.Sitrep.Contract`'s version is Major.Minor.PackagePatch, and
 * Major.Minor is the contract's own (see Sitrep.Contract.Package.csproj). A
 * change to Sitrep.Contract.TestSupport or Sitrep.Core with no contract move
 * and no PackagePatch bump packs under the SAME version as what is already
 * published. `publish-nuget` in release.yml reads that as "no version
 * change" and skips the push, which is correct for an unchanged tree and
 * exactly wrong for a changed one: the published copy silently stops
 * matching the source it claims to be built from, and the release step
 * still reads green.
 *
 * The npm publish leg guards the equivalent case with a content diff against
 * the published tarball (`published-version-is-current.mjs`). This is that
 * check's NuGet twin, and it cannot be a byte-for-byte diff: two builds of
 * the IDENTICAL tree, at different commits, are NOT byte-identical even with
 * `-p:ContinuousIntegrationBuild=true -p:IncludeSourceRevisionInInformationalVersion=false`
 * set on both. Measured: exactly 72 bytes differ per assembly, all of
 * it build-identity metadata that SourceLink's repository map makes
 * commit-dependent even when nothing else changed:
 *
 *   - the PE header timestamp (4 bytes)
 *   - each debug-directory entry's timestamp (4 bytes each)
 *   - the CodeView entry's PDB id, a GUID (16 bytes)
 *   - the PDB checksum entry's checksum bytes (32 bytes for SHA-256)
 *   - the module's MVID, in the #GUID heap (16 bytes)
 *
 * So the comparison is NORMALISED: locate those regions by walking the real
 * PE/COFF/CLI/metadata structures (not by fixed offsets, which would not
 * survive a compiler version bump changing section layout), zero them in a
 * copy of each assembly, then compare what is left. Every other byte must
 * agree, or the content genuinely differs and the version needs to move.
 *
 * KNOWN FALSE POSITIVE, and it must stay loud rather than be suppressed: the
 * published copy was built by whatever SDK `setup-dotnet`'s floating
 * `10.0.x` resolved to at release time, which is not necessarily the SDK
 * this run has. A compiler patch that changes emitted IL reads as "content
 * changed" here. That is a correct read of the bytes and an incorrect read
 * of the source; PackagePatch gives it somewhere to go: bump PackagePatch, note why
 * in the commit, done. Silently ignoring it would let the exact silent-skip
 * bug back in through a different door.
 *
 * Usage:
 *   node scripts/nuget-fossil-check.mjs <fresh.nupkg> <published.nupkg>
 *
 * Exits 0 when every matched assembly agrees after normalisation, 1
 * otherwise (or on a structural read failure: a package this cannot even
 * parse is not a "no difference found", it is a "could not check").
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function listMembers(nupkg) {
  return execFileSync("unzip", ["-Z1", nupkg], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function unzipBinary(nupkg, member) {
  return execFileSync("unzip", ["-p", nupkg, member], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** lib/<tfm>/<file>.dll → Buffer, for every assembly the package carries. */
function readAssemblies(nupkg) {
  const assemblies = new Map();
  for (const member of listMembers(nupkg)) {
    if (/^lib\/[^/]+\/.+\.dll$/.test(member)) {
      assemblies.set(member, unzipBinary(nupkg, member));
    }
  }
  return assemblies;
}

/*
 * Everything in the PE/COFF/CLI/metadata walk below is offsets computed FROM
 * the file, never assumed fixed, so a different compiler emitting a
 * differently-sized optional header or a different section layout still
 * resolves correctly.
 */

/** [{ offset, length, label }] of every byte range this build makes
 * commit-dependent without the source changing. */
function computeIdentityRegions(buf) {
  const regions = [];

  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("not a PE file: missing 'MZ' at offset 0");
  }
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(
      `not a PE file: missing 'PE\\0\\0' at offset 0x${peOffset.toString(16)}`,
    );
  }

  // COFF file header, right after the 4-byte PE signature.
  const coffOffset = peOffset + 4;
  regions.push({
    offset: coffOffset + 4,
    length: 4,
    label: "PE header timestamp",
  });
  const numberOfSections = buf.readUInt16LE(coffOffset + 2);
  const sizeOfOptionalHeader = buf.readUInt16LE(coffOffset + 16);
  const optHeaderOffset = coffOffset + 20;

  /*
   * Optional header: PE32 (managed AnyCPU/x86) vs PE32+ (x64) put the data
   * directory array at a different offset because the fixed fields above it
   * differ in width (32- vs 64-bit ImageBase etc).
   */
  const magic = buf.readUInt16LE(optHeaderOffset);
  const isPE32Plus = magic === 0x20b;
  const numberOfRvaAndSizesOffset = optHeaderOffset + (isPE32Plus ? 108 : 92);
  const dataDirOffset = optHeaderOffset + (isPE32Plus ? 112 : 96);
  const numberOfRvaAndSizes = buf.readUInt32LE(numberOfRvaAndSizesOffset);

  function dataDirectory(index) {
    if (index >= numberOfRvaAndSizes) return { rva: 0, size: 0 };
    const o = dataDirOffset + index * 8;
    return { rva: buf.readUInt32LE(o), size: buf.readUInt32LE(o + 4) };
  }

  // Section table, right after the optional header, to translate RVAs.
  const sectionTableOffset = optHeaderOffset + sizeOfOptionalHeader;
  const sections = [];
  for (let i = 0; i < numberOfSections; i++) {
    const so = sectionTableOffset + i * 40;
    sections.push({
      virtualAddress: buf.readUInt32LE(so + 12),
      virtualSize: buf.readUInt32LE(so + 8),
      sizeOfRawData: buf.readUInt32LE(so + 16),
      pointerToRawData: buf.readUInt32LE(so + 20),
    });
  }
  function rvaToFileOffset(rva) {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.sizeOfRawData);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
        return s.pointerToRawData + (rva - s.virtualAddress);
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} is not inside any section`);
  }

  // Data directory 6: Debug. Each 28-byte entry can carry a timestamp, and
  // types 2 (CodeView) and 19 (PdbChecksum) carry the PDB id and checksum.
  const debug = dataDirectory(6);
  if (debug.size > 0) {
    const tableOffset = rvaToFileOffset(debug.rva);
    const entryCount = Math.floor(debug.size / 28);
    for (let i = 0; i < entryCount; i++) {
      const eo = tableOffset + i * 28;
      regions.push({
        offset: eo + 4,
        length: 4,
        label: "debug-directory timestamp",
      });
      const type = buf.readUInt32LE(eo + 12);
      const sizeOfData = buf.readUInt32LE(eo + 16);
      const pointerToRawData = buf.readUInt32LE(eo + 24);
      if (sizeOfData === 0 || pointerToRawData === 0) continue;

      if (
        type === 2 &&
        buf.toString("ascii", pointerToRawData, pointerToRawData + 4) === "RSDS"
      ) {
        // RSDS(4) + PDB id GUID(16) + age(4) + NUL-terminated path.
        regions.push({
          offset: pointerToRawData + 4,
          length: 16,
          label: "CodeView PDB id",
        });
      } else if (type === 19) {
        // PdbChecksum: NUL-terminated algorithm name, then the raw checksum.
        const dataEnd = pointerToRawData + sizeOfData;
        let nameEnd = pointerToRawData;
        while (nameEnd < dataEnd && buf[nameEnd] !== 0) nameEnd++;
        const checksumStart = nameEnd + 1;
        if (checksumStart < dataEnd) {
          regions.push({
            offset: checksumStart,
            length: dataEnd - checksumStart,
            label: "PDB checksum",
          });
        }
      }
    }
  }

  /*
   * Data directory 14: CLR (COM+2.0) header, to reach the CLI metadata root
   * and, through it, the Module table's Mvid: the GUID that names this exact
   * compilation, and the one region outside the PE header proper.
   */
  const clr = dataDirectory(14);
  if (clr.size > 0) {
    const clrOffset = rvaToFileOffset(clr.rva);
    const metadataRva = buf.readUInt32LE(clrOffset + 8);
    const metadataOffset = rvaToFileOffset(metadataRva);

    if (buf.readUInt32LE(metadataOffset) === 0x424a5342 /* 'BSJB' */) {
      const versionLength = buf.readUInt32LE(metadataOffset + 12);
      const paddedVersionLength = Math.ceil(versionLength / 4) * 4;
      let p = metadataOffset + 16 + paddedVersionLength;
      p += 2; // Flags (reserved, unused)
      const numberOfStreams = buf.readUInt16LE(p);
      p += 2;

      const streams = {};
      for (let i = 0; i < numberOfStreams; i++) {
        const streamOffset = buf.readUInt32LE(p);
        const streamSize = buf.readUInt32LE(p + 4);
        p += 8;
        let nameEnd = p;
        while (buf[nameEnd] !== 0) nameEnd++;
        const name = buf.toString("ascii", p, nameEnd);
        p += Math.ceil((nameEnd - p + 1) / 4) * 4;
        streams[name] = {
          offset: metadataOffset + streamOffset,
          size: streamSize,
        };
      }

      const guidHeap = streams["#GUID"];
      const tables = streams["#~"] ?? streams["#-"];
      if (guidHeap && tables) {
        const mvidRegion = locateModuleMvid(buf, tables, guidHeap);
        if (mvidRegion) regions.push(mvidRegion);
      }
    }
  }

  return regions;
}

/**
 * Reads the #~/#- tables stream header far enough to find the Module
 * table's single row (table 0, always first when present, and every
 * assembly has exactly one module) and its Mvid field, a heap index into
 * #GUID. Returns the 16-byte region of the GUID heap that field names, or
 * null if the structure does not match what every Roslyn-emitted assembly
 * carries (in which case the MVID is simply not zeroed, which can only make
 * this check stricter, never blind to a real difference).
 */
function locateModuleMvid(buf, tables, guidHeap) {
  const base = tables.offset;
  const heapSizes = buf.readUInt8(base + 6);
  const stringHeapIsBig = (heapSizes & 0x01) !== 0;
  const guidHeapIsBig = (heapSizes & 0x02) !== 0;

  const validLo = buf.readUInt32LE(base + 8);
  const validHi = buf.readUInt32LE(base + 12);
  // Table 0 (Module) must be present; every assembly has a module.
  if ((validLo & 0x1) === 0) return null;

  let rowCountCount = 0;
  for (let bit = 0; bit < 32; bit++) if ((validLo >>> bit) & 1) rowCountCount++;
  for (let bit = 0; bit < 32; bit++) if ((validHi >>> bit) & 1) rowCountCount++;

  const rowCountsOffset = base + 24;
  const tableDataOffset = rowCountsOffset + rowCountCount * 4;

  // Module row: Generation:u2, Name:heapIndex, Mvid:heapIndex, EncId:heapIndex, EncBaseId:heapIndex
  const nameFieldSize = stringHeapIsBig ? 4 : 2;
  const guidFieldSize = guidHeapIsBig ? 4 : 2;
  const mvidFieldOffset = tableDataOffset + 2 + nameFieldSize;
  const mvidIndex =
    guidFieldSize === 4
      ? buf.readUInt32LE(mvidFieldOffset)
      : buf.readUInt16LE(mvidFieldOffset);
  if (mvidIndex === 0) return null; // null heap index: no Mvid recorded

  const guidOffset = guidHeap.offset + (mvidIndex - 1) * 16;
  if (guidOffset + 16 > guidHeap.offset + guidHeap.size) return null;
  return { offset: guidOffset, length: 16, label: "module MVID" };
}

function zeroed(buf, regions) {
  const copy = Buffer.from(buf);
  for (const { offset, length } of regions)
    copy.fill(0, offset, offset + length);
  return copy;
}

const [freshPath, publishedPath] = process.argv.slice(2);
if (!freshPath || !publishedPath) {
  console.error(
    "usage: node scripts/nuget-fossil-check.mjs <fresh.nupkg> <published.nupkg>",
  );
  process.exit(2);
}
for (const p of [freshPath, publishedPath]) {
  if (!existsSync(p)) {
    console.error(`no such .nupkg: ${p}`);
    process.exit(2);
  }
}

const fresh = readAssemblies(freshPath);
const published = readAssemblies(publishedPath);

const allMembers = new Set([...fresh.keys(), ...published.keys()]);
const problems = [];

for (const member of [...allMembers].sort()) {
  const a = fresh.get(member);
  const b = published.get(member);
  if (!a) {
    problems.push(`${member}: published carries this, the fresh pack does not`);
    continue;
  }
  if (!b) {
    problems.push(`${member}: the fresh pack carries this, published does not`);
    continue;
  }

  let regionsA, regionsB;
  try {
    regionsA = computeIdentityRegions(a);
    regionsB = computeIdentityRegions(b);
  } catch (err) {
    problems.push(
      `${member}: could not read PE/CLI structure (${err.message})`,
    );
    continue;
  }

  const normalisedA = zeroed(a, regionsA);
  const normalisedB = zeroed(b, regionsB);
  if (!normalisedA.equals(normalisedB)) {
    const diffBytes =
      a.length === b.length
        ? countDifferingBytes(normalisedA, normalisedB)
        : "different lengths";
    problems.push(
      `${member}: content differs after normalising build identity (${diffBytes} bytes differ)`,
    );
  }
}

function countDifferingBytes(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

if (problems.length > 0) {
  console.error(
    `\nThe version already on nuget.org is a FOSSIL of what this commit would publish:\n` +
      problems.map((p) => `  ✗ ${p}`).join("\n") +
      `\n\nThe published copy no longer matches this source, but the version has not moved, ` +
      `so the release cannot ship the difference under it. Bump PackagePatch in ` +
      `mod/Sitrep.Contract.Package/Sitrep.Contract.Package.csproj (and PackagePatchForContract ` +
      `if it drifted) and re-run.\n\n` +
      `If nothing in mod/Sitrep.Contract, mod/Sitrep.Contract.TestSupport or mod/Sitrep.Core ` +
      `actually changed, this may be the known false positive: the published copy was built by ` +
      `an earlier SDK than this run's (setup-dotnet floats on 10.0.x), and a compiler patch can ` +
      `change emitted IL with no source change at all. That is still a real content difference ` +
      `in the bytes, and still needs a PackagePatch bump to ship; note the SDK versions in the ` +
      `commit that bumps it.\n`,
  );
  process.exit(1);
}

console.log(
  `${allMembers.size} assembl${allMembers.size === 1 ? "y" : "ies"} matched and agree with the ` +
    `published copy once build identity (PE timestamp, debug-directory timestamps, PDB id, PDB ` +
    `checksum, module MVID) is normalised out. The skip is a real one: nothing shipped differs.`,
);
