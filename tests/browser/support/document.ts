/**
 * The minimal document shell shared by the smoke tests.
 *
 * The background is fixed pure white and the margins zeroed, because ink.ts's ink criterion
 * assumes a white background, and if an element screenshot's bounds were displaced by a
 * margin the normalized coordinates of the centroid would be off.
 */
export function documentWith(body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}
