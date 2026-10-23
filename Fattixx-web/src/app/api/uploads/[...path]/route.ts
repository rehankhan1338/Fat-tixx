import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_ROOT, isSafeUploadPath } from '@/lib/uploads';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join('/');
  if (!isSafeUploadPath(rel)) return new Response('Not found', { status: 404 });
  try {
    const data = await readFile(path.join(UPLOAD_ROOT, rel));
    return new Response(data, {
      headers: {
        'Content-Type': rel.endsWith('.pdf') ? 'application/pdf' : 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
