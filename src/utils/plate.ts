/**
 * Normalize a license plate string:
 * - uppercase
 * - strip spaces, hyphens, dots
 * - trim
 */
export function normalizePlate(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s\-\.]/g, '')
    .trim();
}

/**
 * Basic Malaysian / Singapore plate format check.
 * Accepts patterns like: ABC1234, W1234X, VEP1234, SBA1234A
 */
export function isValidPlateFormat(plate: string): boolean {
  const normalized = normalizePlate(plate);
  // Broad pattern: 1-4 letters, 1-5 digits, optional 1 trailing letter
  return /^[A-Z]{1,4}\d{1,5}[A-Z]?$/.test(normalized);
}
