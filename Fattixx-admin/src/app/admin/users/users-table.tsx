"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { createPlatformUser, getUserOrders, revokePlatformRole, sendPasswordLinkToUser, setUserStatus, type ActionState, type UserOrderView } from "@/lib/admin/actions";
import { formatCents } from "@/lib/money";
import { deleteUser, updateUser } from "@/lib/admin/crud-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { InviteLinkNotice } from "@/components/invite-link-notice";
import { RoleBadge, StatusBadge, EmptyState, formatDate } from "@/components/shared";

export interface UserView { id: number; email: string; name: string; status: string; has_password: number; last_login_at: string | null; created_at: string; platform_roles: string | null; org_count: number; order_count: number }

export function NewPlatformUserDialog() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createPlatformUser, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><PlusIcon /> Add platform staff</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add platform staff</DialogTitle><DialogDescription>Support and Finance are least-privilege alternatives to sharing Super Admin access.</DialogDescription></DialogHeader>
        {state?.ok ? (
          <div className="space-y-4">
            <FormStatus state={state} successText={state.message} />
            {state.link ? <InviteLinkNotice link={state.link} /> : null}
            <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <FormStatus state={state} />
            <TextField label="Name" id="pu-name" name="name" required autoFocus />
            <TextField label="Email" id="pu-email" name="email" type="email" required />
            <SelectField label="Role" id="pu-role" name="role" defaultValue="support" options={[
              { value: "support", label: "Support — order lookup, resend tickets, edit attendee details" },
              { value: "finance", label: "Finance — refunds, disputes, payouts, tax reports" },
              { value: "super_admin", label: "Super Admin — full platform control" },
            ]} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton pendingText="Adding…">Add</SubmitButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, open, onOpenChange }: { user: UserView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await updateUser(prev, fd);
    if (r?.ok) { toast.success("User updated"); onOpenChange(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit user</DialogTitle><DialogDescription>Changing the email also updates the buyer email on their orders.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="user_id" value={user.id} />
          <TextField label="Name" id={`eu-name-${user.id}`} name="name" required defaultValue={user.name} autoFocus />
          <TextField label="Email" id={`eu-email-${user.id}`} name="email" type="email" required defaultValue={user.email} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserOrdersDialog({ user, open, onOpenChange }: { user: UserView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [orders, setOrders] = useState<UserOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUserOrders(user.id)
      .then((r) => { if (cancelled) return; if (r.error) setError(r.error); else setOrders(r.orders ?? []); })
      .catch(() => { if (!cancelled) setError("Could not load orders."); });
    return () => { cancelled = true; };
  }, [user.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Orders by {user.name}</DialogTitle>
          <DialogDescription>{user.email}{orders ? ` · ${orders.length} order${orders.length === 1 ? "" : "s"}` : ""}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p>
          : !orders ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Loading orders…</div>
          : orders.length === 0 ? <EmptyState title="No orders" description="This account has not placed any orders yet." />
          : (
            <div className="-mx-4 max-h-[60vh] overflow-auto px-4">
              <Table>
                <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Date</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell><span className="font-mono text-xs">{o.code}</span>{o.source !== "online" ? <Badge variant="outline" className="ml-2 text-[10px]">{o.source.replace("_", " ")}</Badge> : null}</TableCell>
                      <TableCell className="max-w-56"><span className="block truncate">{o.event_title}</span><span className="block truncate text-xs text-muted-foreground">{o.org_name}</span></TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{o.ticket_count}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(o.total_cents, o.currency)}{o.refunded_cents ? <span className="block text-xs text-destructive">−{formatCents(o.refunded_cents, o.currency)}</span> : null}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(o.date)}</TableCell>
                      <TableCell className="text-right"><Button variant="outline" size="sm" render={<Link href={`/org/${o.org_slug}/orders/${o.code}`} />}>View order details</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

export function UsersTable({ users, currentUserId, canManage = true }: { users: UserView[]; currentUserId: number; canManage?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserView | null>(null);
  const [viewingOrders, setViewingOrders] = useState<UserView | null>(null);
  async function run(fn: (fd: FormData) => Promise<ActionState>, fields: Record<string, string | number>, okText: string) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    const r = await fn(fd);
    if (r?.error) toast.error(r.error); else { toast.success(okText); if (r?.link) setLink(r.link); }
  }
  if (users.length === 0) return <EmptyState title="No users found" />;
  return (
    <div className="space-y-4">
      {link ? <InviteLinkNotice link={link} message="Password link created and recorded in the email outbox." /> : null}
      <Table>
        <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Platform roles</TableHead><TableHead>Orgs</TableHead><TableHead>Orders</TableHead><TableHead>Status</TableHead><TableHead>Last sign-in</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {users.map((u) => {
            const roles = u.platform_roles ? u.platform_roles.split(",") : [];
            const isSelf = u.id === currentUserId;
            return (
              <TableRow key={u.id}>
                <TableCell><span className="font-medium">{u.name}</span>{isSelf ? <Badge variant="outline" className="ml-2 text-[10px]">you</Badge> : null}<span className="block text-xs text-muted-foreground">{u.email}</span></TableCell>
                <TableCell className="space-x-1">{roles.length ? roles.map((r) => <RoleBadge key={r} role={r} />) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="tabular-nums">{u.org_count}</TableCell>
                <TableCell className="tabular-nums">
                  {Number(u.order_count) > 0
                    ? <button type="button" onClick={() => setViewingOrders(u)} className="cursor-pointer rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View ${u.order_count} orders by ${u.name}`}>{u.order_count}</button>
                    : <span className="text-muted-foreground">0</span>}
                </TableCell>
                <TableCell>{u.has_password ? <StatusBadge status={u.status} /> : <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">No password yet</Badge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.last_login_at ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canManage ? <DropdownMenuItem onClick={() => setEditing(u)}>Edit name & email</DropdownMenuItem> : null}
                      <DropdownMenuItem onClick={() => run(sendPasswordLinkToUser, { user_id: u.id }, "Password link created")}>{u.has_password ? "Send password reset link" : "Send set-password link"}</DropdownMenuItem>
                      {canManage ? roles.map((r) => <DropdownMenuItem key={r} onClick={() => run(revokePlatformRole, { user_id: u.id, role: r }, "Role removed")}>Remove {r.replace("_", " ")} role</DropdownMenuItem>) : null}
                      {canManage && !isSelf ? (
                        <>
                          <DropdownMenuSeparator />
                          {u.status === "active"
                            ? <DropdownMenuItem onClick={() => run(setUserStatus, { user_id: u.id, status: "suspended" }, "User suspended")}>Suspend user</DropdownMenuItem>
                            : <DropdownMenuItem onClick={() => run(setUserStatus, { user_id: u.id, status: "active" }, "User reactivated")}>Reactivate user</DropdownMenuItem>}
                          {roles.includes("super_admin")
                            ? <DropdownMenuItem disabled>Super Admins cannot be deleted</DropdownMenuItem>
                            : <DropdownMenuItem variant="destructive" onClick={() => { if (confirm(`Delete ${u.name} (${u.email}) permanently? Their organization memberships and sessions are removed; orders they bought are kept under their email.`)) void run(deleteUser, { user_id: u.id }, "User deleted"); }}>Delete user</DropdownMenuItem>}
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {editing ? <EditUserDialog key={editing.id} user={editing} open onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
      {viewingOrders ? <UserOrdersDialog key={viewingOrders.id} user={viewingOrders} open onOpenChange={(o) => { if (!o) setViewingOrders(null); }} /> : null}
    </div>
  );
}
