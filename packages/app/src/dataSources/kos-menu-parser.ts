export interface KosCpu {
  number: number;
  vesselName: string;
  partType: string;
  tagname: string;
}

export interface KosMenuState {
  cpus: KosCpu[];
  waitingForSelection: boolean;
}

// Matches: " [1]   no    0     Untitled Space Craft (KAL9000(name 1))".
// Tagname group is allowed to be empty so two unrenamed KAL9000 cores
// on the same vessel both parse — KSP defaults the kOS name tag to an
// empty string when the player hasn't set one, and kOS renders that
// as the bare inner pair `()`. The previous `[^)]+` was non-empty and
// silently dropped both rows, leaving the compute session waiting on a
// selection that never came (the live "kOS reconnect loop" symptom).
const CPU_ROW_RE = /\[(\d+)\]\s+\S+\s+\d+\s+(.+?)\s+\(([^(]+)\(([^)]*)\)\)/;

export function parseKosMenu(text: string): KosMenuState | null {
  if (!text.includes("Vessel Name (CPU tagname)")) return null;

  const cpus: KosCpu[] = [];
  for (const line of text.split("\n")) {
    const match = CPU_ROW_RE.exec(line);
    if (match) {
      cpus.push({
        number: Number.parseInt(match[1], 10),
        vesselName: match[2].trim(),
        partType: match[3],
        tagname: match[4],
      });
    }
  }

  return { cpus, waitingForSelection: cpus.length > 0 };
}

export function parseListChanged(text: string): boolean {
  return text.includes("--(List of CPU's has Changed)--");
}
