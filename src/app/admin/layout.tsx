import { requirePlatformStaff } from "@/lib/auth/guard";
import { AdminShell } from "@/components/admin-shell";

/** Platform staff area. Every page re-checks the role; the nav lives in AdminShell. */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requirePlatformStaff();
  return <AdminShell session={session}>{children}</AdminShell>;
}
