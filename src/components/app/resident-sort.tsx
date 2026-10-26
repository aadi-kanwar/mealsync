import { NativeSelect } from "@/components/ui/native-select";

export type SortKey = "room-asc" | "room-desc" | "name-asc" | "name-desc";

const OPTIONS: Array<[SortKey, string]> = [
  ["room-asc", "Room (low to high)"],
  ["room-desc", "Room (high to low)"],
  ["name-asc", "Name (A to Z)"],
  ["name-desc", "Name (Z to A)"],
];

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Sorts people by room (numbers in order: 9 before 10) or by name, either way round. */
export function sortPeople<T extends { displayName: string; roomNumber: string }>(rows: readonly T[], key: SortKey): T[] {
  const sorted = [...rows].sort((a, b) =>
    key.startsWith("room")
      ? compare(a.roomNumber, b.roomNumber) || compare(a.displayName, b.displayName)
      : compare(a.displayName, b.displayName) || compare(a.roomNumber, b.roomNumber),
  );
  return key.endsWith("desc") ? sorted.reverse() : sorted;
}

/** Keeps people whose name or room contains `term` (any case). */
export function matchesSearch(row: { displayName: string; roomNumber: string }, term: string): boolean {
  const t = term.trim().toLowerCase();
  return t === "" || row.displayName.toLowerCase().includes(t) || row.roomNumber.toLowerCase().includes(t);
}

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (value: SortKey) => void }) {
  return (
    <div className="sm:w-56">
      <NativeSelect aria-label="Sort by" value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        {OPTIONS.map(([key, label]) => (
          <option key={key} value={key}>
            Sort: {label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
