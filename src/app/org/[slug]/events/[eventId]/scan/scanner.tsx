"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CameraIcon, CameraOffIcon, CloudUploadIcon, FlashlightIcon, KeyboardIcon, RefreshCwIcon, SearchIcon, ShieldAlertIcon, UndoIcon, WifiOffIcon } from "lucide-react";
import jsQR from "jsqr";
import { toast } from "sonner";
import { manualCheckin, overrideCheckin, scanTicket, undoCheckin, liveCounts, scannerSnapshot, syncOfflineScans, type OfflineTicket, type ScanResult, type ScannerSnapshot } from "@/lib/checkin/actions";
import { deviceId, dropQueued, enqueueScan, loadSnapshot, newRef, payloadHash, queuedScans, saveSnapshot } from "@/lib/offline-scan-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdSlot } from "@/components/ad-slot";

type LogItem = { id: number; result: string; reason: string | null; at: string; staff: string | null; code: string | null; name: string | null };

const RESULT_STYLE: Record<string, { bg: string; label: string }> = {
  valid: { bg: "bg-emerald-600", label: "VALID" }, manual: { bg: "bg-emerald-600", label: "CHECKED IN" }, override: { bg: "bg-emerald-700", label: "ADMITTED (OVERRIDE)" }, undo: { bg: "bg-sky-700", label: "UNDONE" },
  already_used: { bg: "bg-amber-600", label: "ALREADY USED" }, wrong_event: { bg: "bg-orange-700", label: "WRONG EVENT" }, wrong_day: { bg: "bg-orange-700", label: "WRONG DAY" }, refunded: { bg: "bg-red-700", label: "REFUNDED" },
  cancelled: { bg: "bg-red-700", label: "CANCELLED" }, transferred: { bg: "bg-red-700", label: "TRANSFERRED" }, invalid: { bg: "bg-red-800", label: "INVALID" },
};

/** A failed server call while the network is down (or flapping): handle the scan offline instead. */
function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const m = (e as Error)?.message ?? "";
  return e instanceof TypeError || /fetch|network|load failed/i.test(m);
}

function ticketView(t: OfflineTicket): NonNullable<ScanResult["ticket"]> {
  return { id: t.id, code: t.code, attendeeName: t.attendeeName, ticketType: t.ticketType, seatLabel: t.seatLabel, dayLabel: t.dayLabel, addons: t.addons, checkedInAt: null, checkedInBy: null, orderCode: t.orderCode, buyerEmail: t.buyerEmail };
}

function beep(ok: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    if (navigator.vibrate) navigator.vibrate(ok ? 80 : [120, 60, 120]);
  } catch { /* no audio */ }
}

export function Scanner({ orgSlug, event, initialCounts, initialLog, snapshot, perms, multiDay = false }: {
  orgSlug: string; event: { id: number; title: string; when: string; venue: string | null; ageRestriction: number | null };
  initialCounts: { total: number; used: number }; initialLog: LogItem[]; snapshot: ScannerSnapshot; perms: { canOverride: boolean; canUndo: boolean }; multiDay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef<{ payload: string; at: number }>({ payload: "", at: 0 });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [counts, setCounts] = useState(initialCounts);
  const [log, setLog] = useState<LogItem[]>(initialLog);
  const [snap, setSnap] = useState<ScannerSnapshot>(snapshot);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [manual, setManual] = useState("");
  const [q, setQ] = useState("");
  const [online, setOnline] = useState(true);
  const [pending, start] = useTransition();
  const [reasonDialog, setReasonDialog] = useState<null | { kind: "override" | "undo"; ticketId: number; name: string }>(null);
  const [reason, setReason] = useState("");
  const snapRef = useRef(snap);
  const countsRef = useRef(counts);
  useEffect(() => { snapRef.current = snap; }, [snap]);
  useEffect(() => { countsRef.current = counts; }, [counts]);
  const list = snap.tickets;

  const applyResult = useCallback((r: ScanResult, code?: string) => {
    setResult(r);
    setCounts(r.counts);
    beep(["valid", "manual", "override", "undo"].includes(r.result));
    setLog((l) => [{ id: Date.now(), result: r.result, reason: null, at: new Date().toISOString(), staff: "you", code: r.ticket?.code ?? code ?? null, name: r.ticket?.attendeeName ?? null }, ...l].slice(0, 30));
    if (r.ticket) {
      const admitted = ["valid", "manual", "override"].includes(r.result);
      setSnap((sn) => ({ ...sn, tickets: sn.tickets.map((a) => (a.id === r.ticket!.id ? { ...a, status: r.result === "undo" ? "valid" : admitted ? "used" : a.status, lastDateId: admitted ? sn.activeDateId : a.lastDateId } : a)) }));
    }
  }, []);

  // --- Offline support: keep the downloaded list fresh and flush queued check-ins -------------
  const refreshSnapshot = useCallback(async () => {
    try {
      const fresh = await scannerSnapshot(orgSlug, event.id);
      // Check-ins made on this device that have not synced yet stay applied on top of the server copy.
      const pendingIds = new Set((await queuedScans(event.id)).map((x) => x.ticketId));
      const local = new Map(snapRef.current.tickets.map((t) => [t.id, t]));
      fresh.tickets = fresh.tickets.map((t) => (pendingIds.has(t.id) && local.get(t.id)?.status === "used" ? { ...t, status: "used", lastDateId: local.get(t.id)!.lastDateId } : t));
      setSnap(fresh); await saveSnapshot(fresh); setOnline(true);
      return true;
    } catch (e) { if (isNetworkError(e)) setOnline(false); return false; }
  }, [orgSlug, event.id]);

  const sync = useCallback(async () => {
    const items = await queuedScans(event.id);
    setQueued(items.length);
    if (!items.length) return;
    setSyncing(true);
    try {
      const r = await syncOfflineScans(orgSlug, event.id, deviceId(), items.map(({ ref, ticketId, kind, at }) => ({ ref, ticketId, kind, at })));
      await dropQueued(items.map((i) => i.ref));
      setQueued(0); setCounts(r.counts); setOnline(true);
      const n = r.synced;
      if (r.conflicts.length) {
        toast.warning(`${n} offline check-ins synced · ${r.conflicts.length} flagged as conflicts`, { description: r.conflicts.slice(0, 3).map((c) => `${c.code}: ${c.reason}`).join("\n"), duration: 15000 });
      } else toast.success(`${n} offline check-in${n === 1 ? "" : "s"} synced`);
    } catch (e) { if (isNetworkError(e)) setOnline(false); else toast.error((e as Error).message); }
    finally { setSyncing(false); }
  }, [orgSlug, event.id]);

  useEffect(() => {
    // Persist the list this page arrived with; prefer a newer stored copy if this render is stale.
    void (async () => {
      const stored = await loadSnapshot(event.id);
      if (stored && Date.parse(stored.generatedAt) > Date.parse(snapshot.generatedAt)) setSnap(stored); else await saveSnapshot(snapshot);
      await sync();
    })();
    // Lets the scanner page itself reopen without a connection.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/scan-sw.js").catch(() => {});
  }, [event.id, snapshot, sync]);

  /** Validate a scan against the downloaded list and queue the check-in for sync. */
  const offlineCheck = useCallback(async (match: { payload?: string; ticketId?: number }, kind: "valid" | "manual"): Promise<ScanResult> => {
    const sn = snapRef.current;
    const c = { ...countsRef.current };
    let t: OfflineTicket | undefined;
    if (match.ticketId != null) t = sn.tickets.find((x) => x.id === match.ticketId);
    else if (match.payload) {
      const p = match.payload.trim();
      if (p.startsWith("FTX1.")) {
        const h = await payloadHash(p);
        const code = p.split(".")[1];
        t = sn.tickets.find((x) => x.code === code && (h === null || x.h === h));
      } else if (/^[A-Z0-9]{12}$/i.test(p)) t = sn.tickets.find((x) => x.code === p.toUpperCase());
    }
    if (!t) return { result: "invalid", counts: c, message: "Not on this event's downloaded list (offline)." };
    const view = ticketView(t);
    if (["refunded", "cancelled", "transferred"].includes(t.status)) return { result: t.status as ScanResult["result"], ticket: view, counts: c, message: `Ticket was ${t.status} (offline list).` };
    const isPass = t.dateId == null;
    if (!isPass && sn.activeDateId != null && t.dateId !== sn.activeDateId) return { result: "wrong_day", ticket: view, counts: c, message: `This ticket is for ${t.dayLabel ?? "another day"} (offline).` };
    const usedToday = t.status === "used" && (!isPass || sn.activeDateId == null || t.lastDateId === sn.activeDateId);
    if (usedToday) return { result: "already_used", ticket: view, counts: c, message: "Already checked in (offline list)." };
    await enqueueScan({ ref: newRef(), ticketId: t.id, kind, at: new Date().toISOString(), eventId: event.id });
    setQueued((n) => n + 1);
    const next = t.status === "valid" ? { ...c, used: c.used + 1 } : c;
    return { result: kind, ticket: view, ageRestriction: sn.ageRestriction, counts: next, message: "Admitted offline. Will sync when the connection returns." };
  }, [event.id]);

  const submitPayload = useCallback((payload: string) => {
    const now = Date.now();
    if (lastScanRef.current.payload === payload && now - lastScanRef.current.at < 4000) return; // debounce same code
    lastScanRef.current = { payload, at: now };
    start(async () => {
      if (!navigator.onLine) { setOnline(false); applyResult(await offlineCheck({ payload }, "valid"), payload); return; }
      try { applyResult(await scanTicket(orgSlug, event.id, payload), payload); }
      catch (e) {
        if (isNetworkError(e)) { setOnline(false); applyResult(await offlineCheck({ payload }, "valid"), payload); }
        else toast.error((e as Error).message);
      }
    });
  }, [applyResult, offlineCheck, orgSlug, event.id]);

  // Camera loop
  useEffect(() => {
    if (!cameraOn) return;
    let raf = 0; let cancelled = false;
    (async () => {
      try {
        // Browsers only expose the camera on HTTPS (or localhost); over plain http mediaDevices is undefined.
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error(window.isSecureContext ? "This browser has no camera access. Use manual search below." : "The camera needs a secure (https://) connection. Open the scanner from the https address, or use manual search below.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current!; video.srcObject = stream; await video.play();
        const canvas = canvasRef.current!; const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          if (cancelled) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth, h = video.videoHeight;
            if (w && h) {
              canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
              if (code?.data) submitPayload(code.data);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as Error).name;
        setCameraError(
          name === "NotAllowedError" ? "Camera permission was denied. Allow camera access for this site in the browser settings, then try again."
          : name === "NotFoundError" ? "No camera found on this device."
          : name === "NotReadableError" ? "The camera is in use by another app. Close it and try again."
          : (e as Error).message || "Camera unavailable",
        );
        setCameraOn(false);
      }
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [cameraOn, submitPayload]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { toast.error("This camera has no flashlight control."); }
  }

  useEffect(() => {
    const on = () => { setOnline(true); void sync().then(refreshSnapshot); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const iv = setInterval(() => {
      if (navigator.onLine) liveCounts(orgSlug, event.id).then((c) => { setCounts(c); setOnline(true); }).catch((e) => { if (isNetworkError(e)) setOnline(false); });
    }, 15000);
    // Pick up new sales, refunds and transfers, and flush anything queued.
    const iv2 = setInterval(() => { if (navigator.onLine) void sync().then(refreshSnapshot); }, 60000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(iv); clearInterval(iv2); };
  }, [orgSlug, event.id, sync, refreshSnapshot]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return list.filter((a) => [a.attendeeName, a.buyerName, a.buyerEmail, a.orderCode, a.code].some((v) => v?.toLowerCase().includes(n))).slice(0, 25);
  }, [list, q]);

  function runManual(ticketId: number) {
    start(async () => {
      if (!navigator.onLine) { setOnline(false); applyResult(await offlineCheck({ ticketId }, "manual")); return; }
      try { applyResult(await manualCheckin(orgSlug, event.id, ticketId)); }
      catch (e) {
        if (isNetworkError(e)) { setOnline(false); applyResult(await offlineCheck({ ticketId }, "manual")); }
        else toast.error((e as Error).message);
      }
    });
  }
  function runReasoned() {
    if (!reasonDialog) return;
    const { kind, ticketId } = reasonDialog;
    start(async () => {
      try { applyResult(kind === "override" ? await overrideCheckin(orgSlug, event.id, ticketId, reason) : await undoCheckin(orgSlug, event.id, ticketId, reason)); setReasonDialog(null); setReason(""); }
      catch (e) { toast.error(isNetworkError(e) ? "Overrides and undo need a connection so they can be logged on the server." : (e as Error).message); }
    });
  }

  const style = result ? RESULT_STYLE[result.result] ?? RESULT_STYLE.invalid : null;
  const pct = counts.total ? Math.round((counts.used / counts.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-3 sm:space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-semibold break-words sm:text-xl">{event.title}</h1>
            <p className="mt-0.5 text-xs break-words text-muted-foreground sm:text-sm">{event.when}{event.venue ? ` · ${event.venue}` : ""}</p>
            {event.ageRestriction ? <Badge variant="outline" className="mt-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300">{event.ageRestriction}+ · check ID</Badge> : null}
          </div>
          <div className="shrink-0 text-right"><p className="text-xl font-semibold tabular-nums sm:text-2xl">{counts.used}<span className="text-sm text-muted-foreground"> / {counts.total}</span></p><p className="text-xs text-muted-foreground">checked in · {online ? "live" : "this device"}</p></div>
        </div>
        {!online || queued ? (
          <div className="flex flex-wrap items-center gap-2">
            {!online ? <Badge variant="destructive"><WifiOffIcon className="size-3" /> Offline<span className="hidden sm:inline">: scanning from the downloaded list</span></Badge> : null}
            {queued ? <Button size="sm" variant="outline" disabled={syncing || !online} onClick={() => void sync()}><CloudUploadIcon /> {queued} to sync</Button> : null}
          </div>
        ) : null}
        <Progress value={pct} className="h-2" />
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardContent className="space-y-3">
            <div className="relative aspect-square max-h-[60vh] w-full overflow-hidden rounded-xl bg-black sm:aspect-video">
              <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? "" : "hidden"}`} muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraOn ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
                  <CameraOffIcon className="size-8" />
                  <p className="max-w-sm">{cameraError ? `Camera error: ${cameraError}` : "Camera is off"}</p>
                  <Button onClick={() => { setCameraError(null); setCameraOn(true); }}><CameraIcon /> Start camera</Button>
                </div>
              ) : (
                <>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="aspect-square h-[65%] max-h-60 rounded-2xl border-2 border-primary/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" /></div>
                  <div className="absolute top-2 right-2 flex gap-2">
                    <Button variant="secondary" size="icon" className="size-10 bg-black/60 text-white hover:bg-black/80" onClick={toggleTorch} aria-label={torch ? "Light off" : "Light on"}><FlashlightIcon /></Button>
                    <Button variant="secondary" size="icon" className="size-10 bg-black/60 text-white hover:bg-black/80" onClick={() => setCameraOn(false)} aria-label="Stop camera"><CameraOffIcon /></Button>
                  </div>
                </>
              )}
            </div>
            {result && style ? (
              <div className={`rounded-xl ${style.bg} p-3 text-white sm:p-4`} role="status" aria-live="assertive">
                <p className="text-xl font-black tracking-wide sm:text-2xl">{style.label}</p>
                {result.ticket ? <p className="text-sm break-words">{result.ticket.attendeeName ?? result.ticket.buyerEmail} · {result.ticket.ticketType}{result.ticket.dayLabel ? ` · ${result.ticket.dayLabel}` : ""}{result.ticket.seatLabel ? ` · ${result.ticket.seatLabel}` : ""}</p> : null}
                <p className="text-sm break-words opacity-90">{result.message}</p>
                {result.ticket?.addons ? <p className="mt-1 text-sm font-semibold break-words">Add-ons: {result.ticket.addons}</p> : null}
                {result.ageRestriction ? <p className="mt-1 text-sm font-semibold">Check ID: {result.ageRestriction}+ event</p> : null}
                <div className="mt-2 flex flex-wrap gap-2 empty:hidden">
                  {result.ticket && !["valid", "manual", "override"].includes(result.result) && result.result !== "undo" && perms.canOverride && online ? (
                    <Button size="sm" variant="secondary" onClick={() => setReasonDialog({ kind: "override", ticketId: result.ticket!.id, name: result.ticket!.attendeeName ?? result.ticket!.code })}><ShieldAlertIcon /> Admit anyway (override)</Button>
                  ) : null}
                  {result.ticket && ["valid", "manual", "override", "already_used"].includes(result.result) && perms.canUndo && online ? (
                    <Button size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => setReasonDialog({ kind: "undo", ticketId: result.ticket!.id, name: result.ticket!.attendeeName ?? result.ticket!.code })}><UndoIcon /> Undo</Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { submitPayload(manual.trim()); setManual(""); } }}>
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ticket code or QR text" aria-label="Ticket code" autoCapitalize="characters" autoComplete="off" className="min-w-0 flex-1 font-mono uppercase" />
              <Button type="submit" variant="secondary" disabled={pending}><KeyboardIcon /> Check</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Attendee search & recent scans</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="search">
              <TabsList className="w-full"><TabsTrigger value="search" className="flex-1"><SearchIcon className="size-3.5" /> Search</TabsTrigger><TabsTrigger value="log" className="flex-1">Recent</TabsTrigger></TabsList>
              <TabsContent value="search" className="space-y-2 pt-3">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, order or ticket code" aria-label="Search attendees" autoComplete="off" />
                <ul className="max-h-[50vh] space-y-1 overflow-auto lg:max-h-96 text-sm">
                  {q.trim().length >= 2 && filtered.length === 0 ? <li className="py-4 text-center text-muted-foreground">No matches in {list.length} tickets.</li> : null}
                  {filtered.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{a.attendeeName ?? a.buyerName ?? a.buyerEmail}</p><p className="truncate text-xs text-muted-foreground">{a.ticketType}{a.dayLabel ? ` · ${a.dayLabel}` : ""}{a.seatLabel ? ` · ${a.seatLabel}` : ""} · <span className="font-mono">{a.code}</span> · {a.orderCode}</p></div>
                      {!["valid", "used"].includes(a.status)
                        ? <Badge variant="outline" className="border-red-500/40 text-red-700 dark:text-red-300">{a.status}</Badge>
                        : a.status === "used" && !multiDay
                          ? <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">checked in</Badge>
                          : <Button size="sm" className="shrink-0" variant={a.status === "used" ? "outline" : "default"} disabled={pending} onClick={() => runManual(a.id)}>{a.status === "used" ? "Check in (pass)" : "Check in"}</Button>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{list.length} tickets on this device · updated {new Date(snap.generatedAt).toLocaleTimeString()}</span>
                  <Button size="sm" variant="ghost" disabled={!online} onClick={() => void refreshSnapshot().then((ok) => { if (ok) toast.success("Ticket list updated"); })}><RefreshCwIcon /> Refresh</Button>
                </div>
              </TabsContent>
              <TabsContent value="log" className="pt-3">
                <ul className="max-h-[50vh] space-y-1 overflow-auto lg:max-h-96 text-xs">
                  {log.length === 0 ? <li className="py-4 text-center text-muted-foreground">No scans yet.</li> : null}
                  {log.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
                      <span className="min-w-0 truncate">{new Date(l.at).toLocaleTimeString()} · <span className="font-mono">{l.code ?? "—"}</span> {l.name ? `· ${l.name}` : ""}{l.reason ? ` · ${l.reason}` : ""}</span>
                      <Badge variant="outline" className={["valid", "manual", "override"].includes(l.result) ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : l.result === "undo" ? "border-sky-500/40 text-sky-700 dark:text-sky-300" : "border-red-500/40 text-red-700 dark:text-red-300"}>{l.result.replace("_", " ")}</Badge>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {online ? <AdSlot placement="checkin_dashboard" eventId={event.id} /> : null}

      <Dialog open={!!reasonDialog} onOpenChange={(o) => { if (!o) { setReasonDialog(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reasonDialog?.kind === "override" ? "Override check-in" : "Undo check-in"}</DialogTitle>
            <DialogDescription>{reasonDialog?.kind === "override" ? `Admit ${reasonDialog?.name} although the ticket did not scan as valid. ` : `Mark ${reasonDialog?.name} as not checked in. `}This is logged with your name, the time and the reason.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required for overrides)" rows={3} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReasonDialog(null)}>Cancel</Button>
            <Button variant={reasonDialog?.kind === "override" ? "destructive" : "default"} disabled={pending || (reasonDialog?.kind === "override" && reason.trim().length < 3)} onClick={runReasoned}>{reasonDialog?.kind === "override" ? "Admit & log override" : "Undo check-in"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
