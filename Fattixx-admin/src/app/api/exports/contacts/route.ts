// Same handler as the main app (src/app/api/exports/contacts/route.ts); the console serves it on its own origin.
export { GET } from "@/app/api/exports/contacts/route";
export const dynamic = "force-dynamic";
