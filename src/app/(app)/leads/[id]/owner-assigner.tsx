"use client";

import { useState, useTransition } from "react";
import { changeLeadOwner } from "../actions";

type Owner = { id: string; name: string; role: string };

export function OwnerAssigner({ leadId, ownerId, owners }: { leadId: string; ownerId: string; owners: Owner[] }) {
  const [selected, setSelected] = useState(ownerId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function assign() {
    setError(null);
    startTransition(async () => {
      const result = await changeLeadOwner(leadId, selected);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="lead-owner" className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Owner</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="lead-owner"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={pending}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>{owner.name} · {owner.role}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={assign}
          disabled={pending || selected === ownerId}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {pending ? "Assigning…" : "Assign"}
        </button>
        {error && <p role="alert" className="basis-full text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
