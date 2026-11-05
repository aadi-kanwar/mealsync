"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";

/** Shows a temporary password once, inside a dialog, for staff to pass on in person. */
export function TemporaryPasswordContent({ password, name }: { password: string; name: string }) {
  return (
    <DialogContent title="Temporary password" description={`Tell it to ${name} in person. It won't be shown again.`}>
      <p
        className="rounded-md border border-border bg-subtle px-4 py-3 text-center font-mono text-2xl tracking-widest select-all"
        aria-label={`Temporary password: ${password.split("").join(" ")}`}
      >
        {password}
      </p>
      <p className="text-sm text-foreground-secondary">
        They sign in with their mobile number and this password, then choose a new one.
      </p>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              toast.success("Copied.");
            } catch {
              toast.error("Couldn't copy. Please read it out instead.");
            }
          }}
        >
          <Icon icon={Copy} />
          Copy
        </Button>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
