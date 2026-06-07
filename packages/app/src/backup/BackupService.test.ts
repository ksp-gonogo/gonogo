import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyBackup,
  BACKUP_VERSION,
  BackupValidationError,
  buildBackup,
  isBackupKey,
  validateBackup,
} from "./BackupService";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("isBackupKey", () => {
  it("accepts all three gonogo separators", () => {
    expect(isBackupKey("gonogo:dashboard:main", false)).toBe(true);
    expect(isBackupKey("gonogo.settings", false)).toBe(true);
    // gonogo- prefix is matched, but the only such key is transient (below).
    expect(isBackupKey("gonogo.alarms.list", false)).toBe(true);
  });

  it("rejects non-gonogo keys", () => {
    expect(isBackupKey("LOG_LEVEL", false)).toBe(false);
    expect(isBackupKey("LOG_TAGS", false)).toBe(false);
    expect(isBackupKey("gonogofoo", false)).toBe(false);
    expect(isBackupKey("other", false)).toBe(false);
  });

  it("excludes transient keys regardless of identity opt-in", () => {
    for (const k of [
      "gonogo.logs.ringBuffer",
      "gonogo.scene-banner.lastSeen",
      "gonogo-station-host-id",
    ]) {
      expect(isBackupKey(k, false)).toBe(false);
      expect(isBackupKey(k, true)).toBe(false);
    }
  });

  it("gates per-device-instance identity keys on the opt-in flag", () => {
    for (const k of ["gonogo.station.key", "gonogo.station.peer-id"]) {
      expect(isBackupKey(k, false)).toBe(false);
      expect(isBackupKey(k, true)).toBe(true);
    }
  });

  it("always includes the station name (a label, not identity)", () => {
    expect(isBackupKey("gonogo.station.name", false)).toBe(true);
  });

  it("includes the host share code by default (a portable address, not identity)", () => {
    expect(isBackupKey("gonogo-host-share-code", false)).toBe(true);
  });
});

describe("buildBackup", () => {
  it("captures gonogo keys and excludes transient + identity by default", () => {
    localStorage.setItem("gonogo:dashboard:main", "{layout}");
    localStorage.setItem("gonogo.settings", "{}");
    localStorage.setItem("gonogo.station.name", "Booster");
    localStorage.setItem("gonogo.station.key", "abc-123");
    localStorage.setItem("gonogo.station.peer-id", "station-abc");
    localStorage.setItem("gonogo.logs.ringBuffer", "[...]");
    localStorage.setItem("gonogo-station-host-id", "XK3F");
    localStorage.setItem("LOG_TAGS", "*");

    const backup = buildBackup();

    expect(backup.metadata.version).toBe(BACKUP_VERSION);
    expect(typeof backup.metadata.exportedAt).toBe("string");
    expect(backup.data).toEqual({
      "gonogo:dashboard:main": "{layout}",
      "gonogo.settings": "{}",
      "gonogo.station.name": "Booster",
    });
  });

  it("includes identity keys when opted in", () => {
    localStorage.setItem("gonogo.settings", "{}");
    localStorage.setItem("gonogo.station.key", "abc-123");
    localStorage.setItem("gonogo.station.peer-id", "station-abc");

    const backup = buildBackup({ includeIdentity: true });

    expect(backup.data).toEqual({
      "gonogo.settings": "{}",
      "gonogo.station.key": "abc-123",
      "gonogo.station.peer-id": "station-abc",
    });
  });

  it("captures dynamically-named scene/scope keys", () => {
    localStorage.setItem("gonogo:dashboard:main:launch", "{}");
    localStorage.setItem("gonogo.serial.devices.main", "[]");
    localStorage.setItem("gonogo.kos.cpus.main", "{}");

    const backup = buildBackup();

    expect(Object.keys(backup.data).sort()).toEqual([
      "gonogo.kos.cpus.main",
      "gonogo.serial.devices.main",
      "gonogo:dashboard:main:launch",
    ]);
  });
});

describe("validateBackup", () => {
  it("accepts a well-formed payload", () => {
    const payload = {
      metadata: { version: 1, exportedAt: "2026-06-07T00:00:00.000Z" },
      data: { "gonogo.settings": "{}" },
    };
    expect(validateBackup(payload)).toEqual(payload);
  });

  it("rejects a non-object", () => {
    expect(() => validateBackup(null)).toThrow(BackupValidationError);
    expect(() => validateBackup("nope")).toThrow(BackupValidationError);
  });

  it("rejects a wrong version", () => {
    expect(() =>
      validateBackup({ metadata: { version: 99 }, data: {} }),
    ).toThrow(/version/i);
  });

  it("rejects a missing data section", () => {
    expect(() => validateBackup({ metadata: { version: 1 } })).toThrow(
      BackupValidationError,
    );
  });

  it("rejects non-string data values", () => {
    expect(() =>
      validateBackup({
        metadata: { version: 1 },
        data: { "gonogo.x": 42 },
      }),
    ).toThrow(BackupValidationError);
  });
});

describe("applyBackup (replace mode)", () => {
  it("round-trips build -> apply", () => {
    localStorage.setItem("gonogo:dashboard:main", "{a}");
    localStorage.setItem("gonogo.settings", "{b}");
    const backup = buildBackup();

    localStorage.clear();
    applyBackup(backup);

    expect(localStorage.getItem("gonogo:dashboard:main")).toBe("{a}");
    expect(localStorage.getItem("gonogo.settings")).toBe("{b}");
  });

  it("overwrites existing keys present in the backup", () => {
    localStorage.setItem("gonogo.settings", "{old}");
    const backup = {
      metadata: { version: 1, exportedAt: "x" },
      data: { "gonogo.settings": "{new}" },
    };

    applyBackup(backup);

    expect(localStorage.getItem("gonogo.settings")).toBe("{new}");
  });

  it("leaves keys absent from the backup untouched (per-key, not wipe)", () => {
    localStorage.setItem("gonogo.notes.v1", "keep-me");
    const backup = {
      metadata: { version: 1, exportedAt: "x" },
      data: { "gonogo.settings": "{new}" },
    };

    applyBackup(backup);

    expect(localStorage.getItem("gonogo.notes.v1")).toBe("keep-me");
    expect(localStorage.getItem("gonogo.settings")).toBe("{new}");
  });
});
