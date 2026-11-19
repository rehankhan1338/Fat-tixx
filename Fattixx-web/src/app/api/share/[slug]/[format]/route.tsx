import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ImageResponse } from 'next/og';
import { getPublicEventBySlug } from '@/lib/events/queries';
import { isSpacesUrl, isSafeUploadPath, UPLOAD_ROOT } from '@/lib/uploads';
import { formatEventDate } from '@/lib/tz';

/**
 * "Share that you're going" images (Social & Community 11.8), made from the event's 4:5 cover:
 *   /api/share/<slug>/story  1080 × 1920 for Instagram Stories (9:16)
 *   /api/share/<slug>/post   1200 × 630 for other apps
 * The event name, date and an "I'm going" line. Private events need their link key, like the event page.
 */
export const runtime = 'nodejs';

const RED = '#A8121A';
const DEEP = '#6E0A10';
const IVORY = '#F5F1EA';
const YELLOW = '#FFD23F';

async function coverDataUrl(stored: string | null, width: number): Promise<string | null> {
  if (!stored) return null;
  try {
    let buf: Buffer;
    if (isSpacesUrl(stored)) {
      const res = await fetch(stored);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    } else if (isSafeUploadPath(stored)) {
      buf = await readFile(path.join(UPLOAD_ROOT, stored));
    } else return null;
    // Satori can't read WebP: re-encode as JPEG, sized for the card.
    const jpg = await sharp(buf).resize({ width, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; format: string }> }) {
  const { slug, format } = await params;
  if (format !== 'story' && format !== 'post') return new Response('Not found', { status: 404 });
  const e = await getPublicEventBySlug(slug);
  if (!e || !['published', 'postponed', 'completed'].includes(e.status)) return new Response('Not found', { status: 404 });
  const key = new URL(req.url).searchParams.get('key');
  if (e.visibility === 'private' && (!e.private_key || key !== e.private_key)) return new Response('Not found', { status: 404 });

  const when = formatEventDate(new Date(e.starts_at), e.timezone);
  const where = e.venue_name ? [e.venue_name, e.venue_city].filter(Boolean).join(', ') : e.online_url ? 'Online event' : '';
  const story = format === 'story';
  const cover = await coverDataUrl(e.image_path ?? e.org_logo, story ? 840 : 480);
  const title = e.title.length > 80 ? `${e.title.slice(0, 77)}…` : e.title;
  const headers = { 'Cache-Control': 'public, max-age=600, s-maxage=3600', 'Content-Disposition': `inline; filename="${e.slug}-${format}.png"` };

  if (story) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: `linear-gradient(180deg, ${RED} 0%, ${DEEP} 100%)`, color: IVORY, padding: '120px 90px 100px' }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, letterSpacing: 6, color: YELLOW }}>I’M GOING</div>
          <div style={{ display: 'flex', marginTop: 60, width: 840, height: 1050, borderRadius: 40, overflow: 'hidden', background: 'rgba(255,255,255,.08)' }}>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- rendered to PNG, not HTML
              <img src={cover} width={840} height={1050} style={{ width: 840, height: 1050, objectFit: 'cover' }} />
            ) : (
              <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: 72, fontWeight: 700, padding: 60, textAlign: 'center' }}>{title}</div>
            )}
          </div>
          <div style={{ display: 'flex', marginTop: 56, fontSize: 64, fontWeight: 700, lineHeight: 1.1, textAlign: 'center', justifyContent: 'center' }}>{title}</div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 38, opacity: 0.9, textAlign: 'center' }}>{when}</div>
          {where ? <div style={{ display: 'flex', marginTop: 10, fontSize: 34, opacity: 0.8, textAlign: 'center' }}>{where}</div> : null}
          <div style={{ display: 'flex', marginTop: 'auto', fontSize: 32, color: YELLOW }}>Get tickets on Fattixx</div>
        </div>
      ),
      { width: 1080, height: 1920, headers },
    );
  }
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: RED, color: IVORY }}>
        <div style={{ display: 'flex', width: 504, height: 630, background: DEEP }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- rendered to PNG, not HTML
            <img src={cover} width={504} height={630} style={{ width: 504, height: 630, objectFit: 'cover' }} />
          ) : (
            <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', padding: 48, fontSize: 56, fontWeight: 700, color: YELLOW, textAlign: 'center' }}>{e.org_name}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 60px', flex: 1 }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 4, color: YELLOW }}>I’M GOING</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 52, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 28, opacity: 0.9 }}>{when}</div>
          {where ? <div style={{ display: 'flex', marginTop: 8, fontSize: 26, opacity: 0.8 }}>{where}</div> : null}
          <div style={{ display: 'flex', marginTop: 40, fontSize: 24, color: YELLOW }}>Get tickets on Fattixx</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers },
  );
}
