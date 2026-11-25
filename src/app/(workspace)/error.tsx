"use client";

import { Button } from "@/components/ui";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <div className="panel stack">
      <h1>Journal unavailable</h1>
      <p>
        The workspace could not be loaded. Your saved records have not been
        changed.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
