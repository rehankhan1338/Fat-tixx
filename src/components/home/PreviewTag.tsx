/* Small corner tag shown while the page shows sample events (no real events published yet). */
export default function PreviewTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[60] rounded-full border border-fx-yellow/45 bg-fx-red/85 px-3 py-[7px] text-[11px] font-semibold tracking-[.06em] text-fx-yellow uppercase max-[641px]:right-[10px] max-[641px]:bottom-[10px] max-[641px]:left-auto max-[641px]:px-[10px] max-[641px]:py-[5px] max-[641px]:text-[10px]">
      Preview: sample events
    </div>
  );
}
