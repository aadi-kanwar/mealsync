"use client";

import { Building2 } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { DEFAULT_TIMEZONE } from "@convex/lib/time";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { useMe } from "./session";

const STORAGE_KEY = "dine-property";

export type StaffProperty = { propertyId: Id<"properties">; name: string; timezone: string };

type Scope = {
  /** Every property this staff member can see. */
  properties: StaffProperty[];
  /** The property chosen, or null for "All properties". Always set when there's only one. */
  current: StaffProperty | null;
  choose: (propertyId: Id<"properties"> | null) => void;
  /** The argument every staff query and mutation takes. */
  arg: { propertyId?: Id<"properties"> };
  /** The chosen property's timezone (the first property's for "All"). */
  timezone: string;
};

const ScopeContext = createContext<Scope | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Holds which property the staff screens show. Kept on this device between visits. */
export function PropertyScopeProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const properties = useMemo(() => me?.staff?.properties ?? [], [me]);
  const [chosen, setChosen] = useState<string | null | undefined>(() =>
    typeof window === "undefined" ? undefined : readStored(),
  );
  const choose = useCallback((propertyId: Id<"properties"> | null) => {
    setChosen(propertyId);
    try {
      if (propertyId === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, propertyId);
    } catch {
      // Private mode etc.: the choice lasts for this visit only.
    }
  }, []);
  const value = useMemo<Scope>(() => {
    const current =
      properties.length === 1 ? properties[0] : (properties.find((p) => p.propertyId === chosen) ?? null);
    return {
      properties,
      current,
      choose,
      arg: current ? { propertyId: current.propertyId } : {},
      timezone: current?.timezone ?? properties[0]?.timezone ?? DEFAULT_TIMEZONE,
    };
  }, [properties, chosen, choose]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function usePropertyScope(): Scope {
  const scope = useContext(ScopeContext);
  if (scope === null) throw new Error("usePropertyScope must be used inside PropertyScopeProvider");
  return scope;
}

/** The header's property switcher. Hidden for staff with a single property. */
export function PropertyPicker({ className }: { className?: string }) {
  const { properties, current, choose } = usePropertyScope();
  if (properties.length <= 1) return null;
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor="property-picker" className="sr-only">
        Property
      </label>
      <NativeSelect
        id="property-picker"
        className="h-10 min-h-10 max-w-48 truncate rounded-full py-0 pl-4 text-base font-medium sm:max-w-56 md:text-sm"
        value={current?.propertyId ?? ""}
        onChange={(e) => choose(e.target.value === "" ? null : (e.target.value as Id<"properties">))}
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.propertyId} value={p.propertyId}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * For screens about one property (menu, settings): shows the screen for the
 * chosen property, or asks to choose one when "All properties" is selected.
 */
export function RequireOneProperty({ what, children }: { what: string; children: (property: StaffProperty) => React.ReactNode }) {
  const { properties, current, choose } = usePropertyScope();
  if (current !== null) return <>{children(current)}</>;
  return (
    <Card className="max-w-xl">
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Icon icon={Building2} className="mt-0.5 text-foreground-secondary" />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Choose a property</h2>
            <p className="text-sm text-foreground-secondary">{what} is set for each property separately.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {properties.map((p) => (
            <Button key={p.propertyId} variant="secondary" onClick={() => choose(p.propertyId)}>
              {p.name}
            </Button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
