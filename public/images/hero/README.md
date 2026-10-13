# Hero assets

| File | Scene | Dimensions | Source file size |
| --- | --- | --- | --- |
| `go-out.webp` | Guests enjoying an event | 1672 × 941 | 1,270,406 bytes |
| `throw-one.webp` | Organizers preparing the venue | 1672 × 941 | 1,841,820 bytes |

These are the latest supplied photographs, stored as lossless WebP files with their original framing. Together they are approximately 3.1 MB. Text, buttons and navigation are separate HTML elements.

The hero uses static `next/image` imports, responsive image optimization at quality 85, blur placeholders and initial preloading. The delivered image size depends on the viewport and negotiated format; the sizes above describe the source assets.

Both photos fill the entire desktop hero before their panels are clipped, keeping the crop steady as the divider moves. Mobile panels use separate focal positions. When replacing these files, preserve matching dimensions, camera position and venue framing; exact background continuity may require retouching against a shared background plate.
