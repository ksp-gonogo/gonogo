export interface AvcVersionNumber {
  MAJOR: number;
  MINOR: number;
  PATCH: number;
}

export interface AvcVersionFile {
  NAME: string;
  VERSION: AvcVersionNumber;
  KSP_VERSION: AvcVersionNumber;
  KSP_VERSION_MIN: AvcVersionNumber;
  KSP_VERSION_MAX: AvcVersionNumber;
}

export const GAME_VERSIONS: {
  KSP_VERSION: string;
  KSP_VERSION_MIN: string;
  KSP_VERSION_MAX: string;
};
export function avcVersion(name: string, version: string): AvcVersionFile;
