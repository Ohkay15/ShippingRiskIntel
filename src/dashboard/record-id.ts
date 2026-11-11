/**
 * Human-friendly record ids. Demo records use fixed UUIDs that encode their
 * synthetic id ("…000000000007" → "SH-007"); any other record shows the
 * first block of its UUID. Display only — links and lookups keep the UUID.
 */
export function displayShipmentId(id: string): string {
  const demo = id.match(/^00000000-0000-4000-8000-0*(\d{1,3})$/);
  return demo ? `SH-${demo[1]!.padStart(3, "0")}` : id.slice(0, 8).toUpperCase();
}
