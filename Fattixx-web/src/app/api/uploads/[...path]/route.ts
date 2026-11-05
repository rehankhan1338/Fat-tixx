import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SPREADSHEET_TYPES, UPLOAD_ROOT, isSafeUploadPath, type SpreadsheetExt } from '@/lib/uploads';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join('/');
  if (!isSafeUploadPath(rel)) return new Response('Not found', { status: 404 });
  try {
    const data = await readFile(path.join(UPLOAD_ROOT, rel));
    const sheet = SPREADSHEET_TYPES[rel.split('.').pop() as SpreadsheetExt];
    return new Response(data, {
      headers: {
        'Content-Type': sheet ?? (rel.endsWith('.pdf') ? 'application/pdf' : 'image/webp'),
        ...(sheet ? { 'Content-Disposition': 'attachment' } : {}),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
