import type { MealType } from "@convex/lib/validators";

/**
 * The weekly menus as an Excel file: one sheet per menu ("Menu A", "Menu B"),
 * days down the side (Monday to Sunday), meals across the top. The same
 * layout is downloaded (filled with the saved menus) and read back.
 */

export type MenuGrid = Record<string, string>; // "weekday:mealType" -> dishes (weekday 0 = Sunday)

// Monday first, as on a menu chart.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LABELS = ["A", "B"] as const;
const MAX_ITEMS_LENGTH = 200;

const cellKey = (weekday: number, mealType: MealType) => `${weekday}:${mealType}`;

const loadExcel = async () => (await import("exceljs")).default;

/** The Excel file for both menus. */
export async function menuWorkbook(
  grids: Record<"A" | "B", MenuGrid>,
  meals: readonly { mealType: MealType; name: string }[],
): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const book = new ExcelJS.Workbook();
  book.creator = "Dine";
  for (const label of LABELS) {
    const sheet = book.addWorksheet(`Menu ${label}`);
    sheet.columns = [{ header: "Day", width: 14 }, ...meals.map((m) => ({ header: m.name, width: 32 }))];
    sheet.getRow(1).font = { bold: true };
    for (const weekday of WEEKDAYS) {
      sheet.addRow([DAY_NAMES[weekday], ...meals.map((m) => grids[label][cellKey(weekday, m.mealType)] ?? "")]);
    }
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    sheet.eachRow((row) => (row.alignment = { vertical: "top", wrapText: true }));
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // Rich text, hyperlinks and formula results.
    const v = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return text(v.text);
    if (v.result !== undefined) return text(v.result);
    return "";
  }
  return String(value);
}

const normalise = (s: string) => s.trim().toLowerCase();

/**
 * Reads both menus from an Excel file in the downloaded layout. Rows are
 * matched by day name (Mon or Monday), columns by meal name, so order
 * doesn't matter. Throws an Error with a plain message when it can't.
 */
export async function readMenuWorkbook(
  file: File,
  meals: readonly { mealType: MealType; name: string }[],
): Promise<Record<"A" | "B", MenuGrid>> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel file (.xlsx). Download the template to see the layout.");
  if (file.size > 2_000_000) throw new Error("That file is too big for a menu (over 2 MB).");
  const ExcelJS = await loadExcel();
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("That file couldn't be opened as an Excel file.");
  }
  const result = { A: {} as MenuGrid, B: {} as MenuGrid };
  for (const label of LABELS) {
    const sheet =
      book.worksheets.find((s) => normalise(s.name).replace(/\s+/g, " ") === `menu ${label.toLowerCase()}`) ??
      book.worksheets[LABELS.indexOf(label)];
    if (sheet === undefined) throw new Error(`The file has no "Menu ${label}" sheet.`);
    // Which column holds which meal, from the header row.
    const columns = new Map<number, MealType>();
    sheet.getRow(1).eachCell((cell, col) => {
      const meal = meals.find((m) => normalise(m.name) === normalise(text(cell.value)) || m.mealType === normalise(text(cell.value)));
      if (meal) columns.set(col, meal.mealType);
    });
    if (columns.size === 0) {
      throw new Error(`"${sheet.name}" has no meal names in its first row (${meals.map((m) => m.name).join(", ")}).`);
    }
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const day = normalise(text(row.getCell(1).value));
      if (day === "") return;
      const weekday = DAY_NAMES.findIndex((d) => d.toLowerCase() === day || d.slice(0, 3).toLowerCase() === day.slice(0, 3));
      if (weekday === -1) throw new Error(`"${sheet.name}", row ${rowNumber}: "${text(row.getCell(1).value)}" isn't a day of the week.`);
      for (const [col, mealType] of columns) {
        const dishes = text(row.getCell(col).value).trim().replace(/\s+/g, " ");
        if (dishes.length > MAX_ITEMS_LENGTH) {
          throw new Error(`"${sheet.name}", ${DAY_NAMES[weekday]}: keep each meal under ${MAX_ITEMS_LENGTH} characters.`);
        }
        result[label][cellKey(weekday, mealType)] = dishes;
      }
    });
  }
  return result;
}

/** Saves a file to the person's device. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
