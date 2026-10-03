/* Logo or initials block, shared by the public header, auth pages and the panel sidebar. */
export function BrandMark({ name, logoUrl, size = "md" }: { name: string; logoUrl: string | null; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-8 w-8 text-sm" : "h-9 w-9 text-base";
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "FT";
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} className={`${size === "lg" ? "h-12" : size === "sm" ? "h-8" : "h-9"} w-auto max-w-40 object-contain`} />;
  }
  return <span className={`flex ${box} shrink-0 items-center justify-center rounded-xl bg-primary font-black text-primary-foreground`}>{initials}</span>;
}
