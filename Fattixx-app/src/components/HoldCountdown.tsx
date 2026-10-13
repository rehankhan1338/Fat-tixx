import { useEffect, useState } from 'react';
import { Tag } from '@/components/ui';
import { countdown } from '@/lib/format';

/** "Reserved for 9:41" badge; calls onExpire once the hold runs out. */
export function HoldCountdown({ expiresAt, onExpire }: { expiresAt: string | null; onExpire?: () => void }) {
  const [c, setC] = useState(() => countdown(expiresAt));
  useEffect(() => {
    const id = setInterval(() => {
      const next = countdown(expiresAt);
      setC(next);
      if (next.ms === 0) { clearInterval(id); onExpire?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);
  return <Tag label={`Reserved for ${c.label}`} tone={c.ms < 120_000 ? 'yellow' : 'red'} />;
}
