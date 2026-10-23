"use client";

/*
 * The event's Seating tab (reserved seating, plan 5.7.3–5.7.13): choose an approved map, create pricing tiers, select
 * seats (one by one or a whole section by clicking its name) and assign them to a tier, take them off sale or block
 * them. Sold seats and seats in a buyer's cart never change; a sold ticket can be moved to a free seat of the same tier.
 */

import { useActionState, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { attachSeatMap, createSeatTier, detachSeatMap, moveTicketSeat, updateEventSeats, updateTierColor } from "@/lib/seating/actions";
import { ACCESSIBILITY, SEAT_STATUS_LABEL, TIER_COLORS, type Drawing, type SeatStatus } from "@/lib/seating/layout";
import { formatCents } from "@/lib/money";
import { SeatMapCanvas, SeatSwatch, type CanvasSeat } from "@/components/seating/SeatMapCanvas";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Section } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ManagedSeatView = {
  id: number; x: number; y: number; label: string; section: string; access: string | null; tier: number | null; status: SeatStatus; blockReason: string | null;
  ticketId: number | null; ticketCode: string | null; holder: string | null; orderCode: string | null;
};
export type TierView = { id: number; name: string; color: string | null; priceCents: number; seats: number; available: number; held: number; sold: number; blocked: number };

export function SeatingPanel({ orgSlug, eventId, currency, upsell, maps, seating }: {
  orgSlug: string; eventId: number; currency: string;
  /** shown instead of the map picker when the organization is not on Pro */
  upsell: ReactNode | null;
  maps: { id: number; label: string }[];
  seating: { mapName: string; drawing: Drawing; seats: ManagedSeatView[]; tiers: TierView[]; unassigned: number; sold: number; held: number } | null;
}) {
  const base = { org: orgSlug, event_id: eventId };
  if (!seating) return <ChooseMap base={base} orgSlug={orgSlug} maps={maps} upsell={upsell} />;
  return <ManageSeats base={base} currency={currency} seating={seating} />;
}

function Hidden({ fields }: { fields: Record<string, string | number> }) {
  return <>{Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

function ChooseMap({ base, orgSlug, maps, upsell }: { base: { org: string; event_id: number }; orgSlug: string; maps: { id: number; label: string }[]; upsell: ReactNode | null }) {
  const [state, action] = useActionState(attachSeatMap, undefined);
  return (
    <Section title="Reserved seating" description="Sell numbered seats from a map: buyers pick their exact seat on the event page.">
      {upsell ?? (maps.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no approved seat maps yet. <Link href={`/org/${orgSlug}/seating`} className="underline">Use one from the Venue Library or request a map</Link>.</p>
      ) : (
        <form action={action} className="flex max-w-2xl flex-wrap items-end gap-3">
          <FormStatus state={state} successText={state?.message} />
          <Hidden fields={base} />
          <SelectField label="Seat map" id="seating-map" name="map_id" options={maps.map((m) => ({ value: String(m.id), label: m.label }))} className="min-w-64 flex-1" />
          <SubmitButton pendingText="Adding seats…">Use this map</SubmitButton>
          <p className="basis-full text-xs text-muted-foreground">The event gets its own copy of the seats, so later changes to the map never move a seat someone bought. <Link href={`/org/${orgSlug}/seating`} className="underline">Manage seat maps</Link></p>
        </form>
      ))}
    </Section>
  );
}

function ManageSeats({ base, currency, seating }: { base: { org: string; event_id: number }; currency: string; seating: NonNullable<Parameters<typeof SeatingPanel>[0]["seating"]> }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState<ManagedSeatView | null>(null);
  const [tierId, setTierId] = useState(seating.tiers[0] ? String(seating.tiers[0].id) : "");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [tierState, tierAction] = useActionState(createSeatTier, undefined);
  const tierById = useMemo(() => new Map(seating.tiers.map((t, i) => [t.id, { ...t, color: t.color ?? TIER_COLORS[i % TIER_COLORS.length] }])), [seating.tiers]);
  const seatById = useMemo(() => new Map(seating.seats.map((s) => [s.id, s])), [seating.seats]);

  const run = (fn: (fd: FormData) => Promise<{ error?: string; ok?: boolean; message?: string } | undefined>, fields: Record<string, string | number>, after?: () => void) => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, String(v));
    const r = await fn(fd);
    if (r?.error) toast.error(r.error);
    else { if (r?.message) toast.success(r.message); after?.(); }
  });

  const clickSeat = (id: number) => {
    const seat = seatById.get(id);
    if (!seat) return;
    if (moving) {
      if (seat.id === moving.id) { setMoving(null); return; }
      run(moveTicketSeat, { ticket_id: moving.ticketId!, seat_id: seat.id }, () => { setMoving(null); setSel(new Set()); });
      return;
    }
    setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const selectSection = (name: string) => {
    const ids = seating.seats.filter((s) => s.section === name).map((s) => s.id);
    setSel((cur) => {
      const all = ids.every((i) => cur.has(i));
      const n = new Set(cur);
      for (const i of ids) { if (all) n.delete(i); else n.add(i); }
      return n;
    });
  };
  const selectWhere = (pred: (s: ManagedSeatView) => boolean) => setSel(new Set(seating.seats.filter(pred).map((s) => s.id)));

  const seats: CanvasSeat[] = seating.seats.map((s) => {
    const tier = s.tier ? tierById.get(s.tier) : undefined;
    const look = moving && moving.id === s.id ? "marked" : sel.has(s.id) ? "marked" : s.status === "sold" || s.status === "held" ? "taken" : s.status === "blocked" ? "blocked" : s.status === "unassigned" ? "off" : "open";
    const accessLabel = ACCESSIBILITY.find((a) => a.value === s.access)?.label;
    return {
      id: s.id, x: s.x, y: s.y, color: tier?.color ?? "#ffffff", look, access: (s.access as CanvasSeat["access"]) ?? null, clickable: true,
      title: [s.label, tier?.name ?? "Not for sale", accessLabel, SEAT_STATUS_LABEL[s.status], s.blockReason, s.holder ? `${s.holder} (${s.ticketCode})` : null].filter(Boolean).join(" · "),
    };
  });

  const picked = [...sel].map((id) => seatById.get(id)).filter((s): s is ManagedSeatView => !!s);
  const lockedCount = picked.filter((s) => s.status === "sold" || s.status === "held").length;
  const oneSold = picked.length === 1 && picked[0].status === "sold" && picked[0].ticketId ? picked[0] : null;
  const ids = picked.map((s) => s.id).join(",");
  const clear = () => setSel(new Set());

  return (
    <div className="space-y-6">
      <Section
        title={`Seating: ${seating.mapName}`}
        description={`${seating.seats.length} seats · ${seating.sold} sold · ${seating.held} in buyers' carts · ${seating.unassigned} not for sale`}
        actions={seating.sold || seating.held ? null : (
          <ConfirmButton action={detachSeatMap} fields={base} title="Remove the seat map from this event?" description="Every seat and its tier and block settings are removed. The pricing tiers stay (with no seats) until you delete them on the Ticket types tab." confirmText="Remove map" variant="outline" successText="Seat map removed">Remove map</ConfirmButton>
        )}
      >
        <Table>
          <TableHeader><TableRow><TableHead>Pricing tier</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">In carts</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Blocked</TableHead></TableRow></TableHeader>
          <TableBody>
            {seating.tiers.map((t) => {
              const color = tierById.get(t.id)!.color;
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <input type="color" aria-label={`${t.name} colour`} defaultValue={color} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                        onBlur={(e) => { const v = e.target.value; if (v.toLowerCase() !== color.toLowerCase()) run(updateTierColor, { tier_id: t.id, color: v }); }} />
                      <span className="font-medium">{t.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{t.priceCents ? formatCents(t.priceCents, currency) : "Free"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.seats}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.available}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.held}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.sold}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.blocked}</TableCell>
                </TableRow>
              );
            })}
            {seating.unassigned ? <TableRow><TableCell className="text-muted-foreground">Not for sale (no tier)</TableCell><TableCell /><TableCell className="text-right tabular-nums">{seating.unassigned}</TableCell><TableCell colSpan={4} /></TableRow> : null}
          </TableBody>
        </Table>
        <form action={tierAction} className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
          <Hidden fields={base} />
          <TextField label="New tier" id="tier-name" name="name" placeholder="e.g. Orchestra" required maxLength={120} className="min-w-48 flex-1" />
          <TextField label="Price ($)" id="tier-price" name="price" inputMode="decimal" placeholder="45.00" className="w-28" />
          <div className="grid gap-1.5"><label htmlFor="tier-color" className="text-sm font-medium">Colour</label><input id="tier-color" name="color" type="color" defaultValue={TIER_COLORS[seating.tiers.length % TIER_COLORS.length]} className="h-9 w-12 cursor-pointer rounded border" /></div>
          <SubmitButton variant="outline" pendingText="Adding…">Add tier</SubmitButton>
          <p className="basis-full text-xs text-muted-foreground">Sales window, per-order limits and presale codes for a tier are on the Ticket types tab. Prices are shown to buyers with fees included.</p>
          <div className="basis-full"><FormStatus state={tierState} successText={tierState?.message} /></div>
        </form>
      </Section>

      <Section title="Seats" description="Click seats to select them, or click a section's name to select the whole section. Sold seats and seats in a buyer's cart keep their tier and can't be blocked.">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Button type="button" size="xs" variant="outline" onClick={() => selectWhere(() => true)}>Select all</Button>
          <Button type="button" size="xs" variant="outline" onClick={() => selectWhere((s) => s.status === "unassigned")}>Select not for sale</Button>
          <Button type="button" size="xs" variant="outline" onClick={() => selectWhere((s) => s.status === "blocked")}>Select blocked</Button>
          <Button type="button" size="xs" variant="ghost" onClick={clear} disabled={!sel.size}>Clear selection</Button>
          <span className="text-muted-foreground">{sel.size ? `${sel.size} selected${lockedCount ? ` (${lockedCount} sold or held, left as they are)` : ""}` : "Nothing selected"}</span>
        </div>

        {moving ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <span>Moving <strong>{moving.ticketCode}</strong> ({moving.holder}) from {moving.label}. Click a free seat of the same tier.</span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
          </div>
        ) : sel.size ? (
          <div className="mb-3 grid gap-3 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-end gap-2">
              {seating.tiers.length ? (
                <>
                  <NativeSelect aria-label="Pricing tier" value={tierId} onChange={(e) => setTierId(e.target.value)} className="h-8 min-w-40">
                    {seating.tiers.map((t) => <NativeSelectOption key={t.id} value={String(t.id)}>{t.name} · {t.priceCents ? formatCents(t.priceCents, currency) : "Free"}</NativeSelectOption>)}
                  </NativeSelect>
                  <Button type="button" size="sm" disabled={pending || !tierId} onClick={() => run(updateEventSeats, { op: "assign", tier_id: tierId, seat_ids: ids }, clear)}>Assign to tier</Button>
                </>
              ) : <span className="text-muted-foreground">Add a pricing tier above to put seats on sale.</span>}
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(updateEventSeats, { op: "unassign", seat_ids: ids }, clear)}>Take off sale</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input aria-label="Block reason (optional)" placeholder="Reason, e.g. sound desk (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} className="h-8 max-w-72" />
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(updateEventSeats, { op: "block", reason, seat_ids: ids }, clear)}>Block</Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(updateEventSeats, { op: "unblock", seat_ids: ids }, clear)}>Unblock</Button>
            </div>
            {oneSold ? (
              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <span><strong>{oneSold.label}</strong>: {oneSold.holder ?? "ticket holder"} · ticket {oneSold.ticketCode} · order {oneSold.orderCode}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => { setMoving(oneSold); setSel(new Set()); }}>Move to another seat</Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <SeatMapCanvas drawing={seating.drawing} seats={seats} onSeat={(id) => clickSeat(Number(id))} onLabel={(name) => selectSection(name)} label="Event seat map" />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {seating.tiers.map((t) => <li key={t.id} className="flex items-center gap-1.5"><SeatSwatch look="open" color={tierById.get(t.id)!.color} /> {t.name}</li>)}
          <li className="flex items-center gap-1.5"><SeatSwatch look="off" /> Not for sale</li>
          <li className="flex items-center gap-1.5"><SeatSwatch look="taken" /> Sold or in a cart</li>
          <li className="flex items-center gap-1.5"><SeatSwatch look="blocked" /> Blocked</li>
          <li className="flex items-center gap-1.5"><SeatSwatch look="marked" color="#ffffff" /> Selected</li>
          {ACCESSIBILITY.map((a) => <li key={a.value} className="flex items-center gap-1.5"><SeatSwatch look="open" color="#71717a" access={a.value} /> {a.label}</li>)}
        </ul>
      </Section>
    </div>
  );
}
