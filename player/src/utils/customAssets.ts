// Asset endpoints have no extension; explicitly select Pixi's image parser.
export function customBackground(name: string): string | undefined {
  if (!name.startsWith('asset_') && !name.startsWith('gallery_')) return undefined;
  if (name.startsWith('gallery_')) return `/api/custom-adv/gallery/assets/${encodeURIComponent(name)}`;
  const base = new URLSearchParams(location.search).get('assets');
  if (!base) throw new Error('缺少自定义背景资源地址。');
  const url = new URL(base, location.href);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/background/${encodeURIComponent(name)}.png`;
  return url.href;
}

export function customAudio(kind: 'bgm' | 'se' | 'voice', name: string): string | undefined {
  if (!name.startsWith('asset_')) return undefined;
  const base = new URLSearchParams(location.search).get('assets');
  if (!base) throw new Error('缺少自定义音频资源地址。');
  const url = new URL(base, location.href);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${kind}/${encodeURIComponent(name)}.mp3`;
  return url.href;
}
