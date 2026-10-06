export function checkZip(options: { zip: string; folder: string }): string[];
export function checkNetkan(options: {
  netkan: string;
  netkanSchema: string;
  ckanSchema: string;
}): string[];
export function main(argv: string[]): number;
export function selfTest(
  check?: (options: { zip: string; folder: string }) => string[],
): string[];
