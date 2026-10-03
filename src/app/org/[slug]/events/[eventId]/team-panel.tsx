"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setEventMember } from "@/lib/events/actions";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoleBadge, EmptyState } from "@/components/shared";

export interface EventMemberView { user_id: number; name: string; email: string; role: string; assigned: boolean }

export function EventTeamPanel({ orgSlug, eventId, members }: { orgSlug: string; eventId: number; members: EventMemberView[] }) {
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(members, (state, upd: { user_id: number; assigned: boolean }) => state.map((m) => (m.user_id === upd.user_id ? { ...m, assigned: upd.assigned } : m)));

  if (members.length === 0) return <EmptyState title="No organizers or staff yet" description="Add them under Team, then assign them to this event." />;

  return (
    <Table>
      <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Assigned to this event</TableHead></TableRow></TableHeader>
      <TableBody>
        {optimistic.map((m) => (
          <TableRow key={m.user_id}>
            <TableCell><span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.email}</span></TableCell>
            <TableCell><RoleBadge role={m.role} /></TableCell>
            <TableCell className="text-right">
              <Switch checked={m.assigned} onCheckedChange={(checked) => start(async () => {
                setOptimistic({ user_id: m.user_id, assigned: checked });
                const fd = new FormData(); fd.set("org", orgSlug); fd.set("event_id", String(eventId)); fd.set("user_id", String(m.user_id)); fd.set("assigned", checked ? "1" : "0");
                const r = await setEventMember(fd);
                if (r?.error) toast.error(r.error); else toast.success(checked ? `${m.name} assigned` : `${m.name} unassigned`);
              })} aria-label={`Assign ${m.name}`} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
