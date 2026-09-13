export interface SrtCue {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
}

const srtCache = new Map<string, SrtCue[]>();

const parseTimestamp = (str: string): number => {
  if (!str) return 0;
  const cleaned = str.replace(',', '.').trim();
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return 0;
};

export const parseSrt = (content: string): SrtCue[] => {
  if (!content) return [];
  const cues: SrtCue[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');

    let arrowIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        arrowIndex = i;
        break;
      }
    }
    if (arrowIndex === -1) continue;

    const timeLine = lines[arrowIndex];
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    if (!startStr || !endStr) continue;

    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);
    if (isNaN(start) || isNaN(end) || end <= start) continue;

    const textLines = lines.slice(arrowIndex + 1).map(l => l.trim()).filter(Boolean);
    const text = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '') // remove html tags like <i>, <b>, <font>
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');

    if (text) {
      cues.push({
        id: cues.length + 1,
        start,
        end,
        text
      });
    }
  }

  return cues;
};

export const fetchAndParseSrt = async (url: string): Promise<SrtCue[]> => {
  if (!url) return [];
  if (srtCache.has(url)) {
    return srtCache.get(url)!;
  }

  let text = '';
  try {
    // 1. Try direct fetch
    const directRes = await fetch(url);
    if (directRes.ok) {
      text = await directRes.text();
    }
  } catch (err) {
    // Network / CORS failure, proceed to proxy
  }

  if (!text || (!text.includes('-->') && !text.includes('00:'))) {
    try {
      // 2. Try proxy with format=raw
      const proxyUrl = `/api/subtitle?url=${encodeURIComponent(url)}&format=raw`;
      const proxyRes = await fetch(proxyUrl);
      if (proxyRes.ok) {
        text = await proxyRes.text();
      }
    } catch (err) {
      console.warn('[srtParser] Proxy fetch failed:', err);
    }
  }

  if (!text) {
    try {
      // 3. Fallback without format parameter
      const fallbackUrl = `/api/subtitle?url=${encodeURIComponent(url)}`;
      const fbRes = await fetch(fallbackUrl);
      if (fbRes.ok) {
        text = await fbRes.text();
      }
    } catch (e) {}
  }

  if (!text) return [];

  const cues = parseSrt(text);
  if (cues.length > 0) {
    srtCache.set(url, cues);
  }
  return cues;
};
