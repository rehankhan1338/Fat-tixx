"use client";

import { useActionState, useState } from "react";
import { PlusIcon, MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { addOrgMember, updateOrgMember, removeOrgMember, resendMemberInvite, type ActionState } from "@/lib/orgs/actions";
import type { MemberRow } from "@/lib/admin/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckField, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { InviteLinkNotice } from "@/components/invite-link-notice";
import { RoleBadge, StatusBadge, formatDate, EmptyState } from "@/components/shared";

const ROLE_OPTIONS = [
  { value: "org_admin", label: "Organization Admin — full control of this organization" },
  { value: "organizer", label: "Organizer — creates and runs events" },
  { value: "staff", label: "Staff / Scanner — check-in only" },
];

function PermissionFields({ role, member }: { role: string; member?: MemberRow }) {
  if (role === "org_admin") return <p className="text-xs text-muted-foreground">Organization Admins can do everything in this organization.</p>;
  return (
    <div className="grid gap-2">
      {role === "organizer" ? <CheckField id="all_events" name="all_events" label="Access every event" hint="Otherwise only events they created or are assigned to." defaultChecked={!!member?.all_events} /> : null}
      {role === "organizer" ? <CheckField id="can_refund" name="can_refund" label="Can issue refunds" defaultChecked={!!member?.can_refund} /> : null}
      <CheckField id="can_override_checkin" name="can_override_checkin" label="Can override check-in" hint="Admit a ticket that scans as used or invalid. Every override is logged with a reason." defaultChecked={!!member?.can_override_checkin} />
      <CheckField id="can_undo_checkin" name="can_undo_checkin" label="Can undo a check-in" defaultChecked={!!member?.can_undo_checkin} />
    </div>
  );
}

export function AddMemberDialog({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("organizer");
  const [state, action] = useActionState(addOrgMember, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><PlusIcon /> Add team member</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add team member</DialogTitle><DialogDescription>Roles apply to this organization only.</DialogDescription></DialogHeader>
        {state?.ok ? (
          <div className="space-y-4">
            <FormStatus state={state} successText={state.message} />
            {state.link ? <InviteLinkNotice link={state.link} /> : null}
            <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <FormStatus state={state} />
            <input type="hidden" name="org" value={orgSlug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Name" id="name" name="name" required maxLength={120} autoFocus />
              <TextField label="Email" id="email" name="email" type="email" required />
            </div>
            <SelectField label="Role" id="role" name="role" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} />
            <PermissionFields role={role} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton pendingText="Adding…">Add member</SubmitButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ orgSlug, member, open, onOpenChange }: { orgSlug: string; member: MemberRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [role, setRole] = useState<string>(member.role);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await updateOrgMember(prev, fd);
    if (r?.ok) { toast.success("Member updated"); onOpenChange(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit {member.name}</DialogTitle><DialogDescription>{member.email}</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="user_id" value={member.user_id} />
          <SelectField label="Role" id={`role-${member.user_id}`} name="role" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} />
          <PermissionFields role={role} member={member} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamTable({ orgSlug, members, currentUserId }: { orgSlug: string; members: MemberRow[]; currentUserId: number }) {
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function run(fn: (fd: FormData) => Promise<ActionState>, fields: Record<string, string | number>, okText: string) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    const r = await fn(fd);
    if (r?.error) toast.error(r.error);
    else { toast.success(okText); if (r?.link) setInviteLink(r.link); }
  }

  if (members.length === 0) return <EmptyState title="No team members yet" description="Add an Organization Admin, Organizers and door staff." action={<AddMemberDialog orgSlug={orgSlug} />} />;

  return (
    <div className="space-y-4">
      {inviteLink ? <InviteLinkNotice link={inviteLink} message="A new password link was created (also recorded in the email outbox)." /> : null}
      <Table>
        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Permissions</TableHead><TableHead>Account</TableHead><TableHead>Last sign-in</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.user_id}>
              <TableCell><span className="font-medium">{m.name}</span>{m.user_id === currentUserId ? <Badge variant="outline" className="ml-2 text-[10px]">you</Badge> : null}<span className="block text-xs text-muted-foreground">{m.email}</span></TableCell>
              <TableCell><RoleBadge role={m.role} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {m.role === "org_admin" ? "Everything" : [m.all_events ? "all events" : "assigned events", m.can_refund ? "refunds" : null, m.can_override_checkin ? "override" : null, m.can_undo_checkin ? "undo" : null].filter(Boolean).join(" · ")}
              </TableCell>
              <TableCell>{m.has_password ? <StatusBadge status={m.status} /> : <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Invite pending</Badge>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(m.last_login_at)}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(m)}>Edit role & permissions</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => run(resendMemberInvite, { org: orgSlug, user_id: m.user_id }, "Password link created")}>{m.has_password ? "Send password reset link" : "Resend invitation"}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => { if (confirm(`Remove ${m.name} from this organization? Their access ends immediately.`)) void run(removeOrgMember, { org: orgSlug, user_id: m.user_id }, "Member removed"); }}>Remove from organization</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing ? <EditMemberDialog key={editing.user_id} orgSlug={orgSlug} member={editing} open onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
    </div>
  );
}
