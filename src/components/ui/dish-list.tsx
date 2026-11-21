import { cn } from "@/lib/utils";

/**
 * The dishes in a menu entry, as typed by the Admin ("Poha, tea + banana"):
 * split at commas, "+" and new lines, each starting with a capital letter.
 */
export function dishesOf(items: string): string[] {
  return items
    .split(/\s*(?:,|\+|\n|;|·)\s*/)
    .map((dish) => dish.trim())
    .filter((dish) => dish.length > 0)
    .map((dish) => dish.charAt(0).toUpperCase() + dish.slice(1));
}

/** A meal's dishes as small tags. `size="md"` for the menu card. */
export function DishList({ items, size = "sm", label }: { items: string; size?: "sm" | "md"; label?: string }) {
  const dishes = dishesOf(items);
  if (dishes.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap", size === "md" ? "gap-2" : "mt-1 gap-1.5")} aria-label={label ?? "Dishes"}>
      {dishes.map((dish, i) => (
        <li
          key={`${dish}-${i}`}
          className={cn(
            "max-w-full rounded-full border border-border bg-subtle break-words text-foreground",
            size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
          )}
        >
          {dish}
        </li>
      ))}
    </ul>
  );
}
