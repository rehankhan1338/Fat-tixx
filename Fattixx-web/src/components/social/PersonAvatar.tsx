/* A person's round photo, or their initials on the brand tint when they have none. */

import { cx } from "@/components/ui/styles";

export default function PersonAvatar({ src, name, initials, size = 40, className, ring = false }: { src: string | null; name: string; initials: string; size?: number; className?: string; ring?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  const cls = cx("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-fx-red/10 font-semibold text-fx-red", ring && "ring-2 ring-fx-ivory", className);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- uploaded image, already resized to WebP
    return <img src={src} alt={name} width={size} height={size} style={style} className={cx(cls, "object-cover")} loading="lazy" />;
  }
  return (
    <span role="img" aria-label={name} style={style} className={cls}>
      {initials}
    </span>
  );
}
