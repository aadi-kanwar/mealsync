import { cn } from "@/lib/utils";

/**
 * The app's name: "Dine", with "by Livoza" beneath. Text for now; replaced
 * by the Livoza logo artwork once the logo file is added to the project.
 */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className={cn("font-serif text-primary-text", size === "lg" ? "text-2xl" : "text-xl")}>Dine</span>
      <span className="mt-0.5 text-xs tracking-widest text-foreground-secondary uppercase">by Livoza</span>
    </span>
  );
}

/** A small uppercase section label with a leading dash, as on livoza.org ("— THE ROOMS"). */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-xs font-medium tracking-widest text-primary-text uppercase", className)}>
      — {children}
    </span>
  );
}
