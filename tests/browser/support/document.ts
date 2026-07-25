/**
 * 冒煙測試共用的最小文件外殼。
 *
 * 背景固定純白、邊界歸零，是因為 ink.ts 的墨水判準假設背景是白的，而元素截圖
 * 的邊界若被 margin 推移，重心的正規化座標就會偏掉。
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
