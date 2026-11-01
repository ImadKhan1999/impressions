import { parse as parseCsv } from 'csv-parse/sync';
import type { ImportReject } from '@impressions/shared';
import { normalizeUrl } from './normalize.js';

export interface ParsedUrl {
  line: number;
  url: string;
  domain: string;
  label: string | null;
  tags: string[];
}

export interface ParseResult {
  format: 'txt' | 'csv';
  totalLines: number;
  entries: ParsedUrl[];
  rejects: ImportReject[];
  duplicatesInFile: number;
}

/** Decodes a text file honouring BOMs (UTF-8, UTF-16 LE/BE as saved by Windows Notepad). */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  // Heuristic for BOM-less UTF-16 LE: many zero bytes at odd offsets.
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let zeros = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) zeros++;
  if (sample.length > 8 && zeros > sample.length / 4) return buf.toString('utf16le');
  return buf.toString('utf8');
}

const URL_HEADER = /^(url|urls|link|links|href|address|website|landing ?page|target|destination)$/i;
const LABEL_HEADER = /^(label|name|title|description|campaign|note|notes)$/i;
const TAGS_HEADER = /^(tags?|labels|category|categories|group)$/i;

function detectDelimiter(firstLine: string): string {
  const counts: [string, number][] = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ',';
}

export function detectFormat(filename: string | undefined, text: string): 'txt' | 'csv' {
  const ext = filename?.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'txt' || ext === 'list') return 'txt';
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return /[,;\t]/.test(first) && first.split(/[,;\t]/).some((c) => URL_HEADER.test(c.trim().replace(/^"|"$/g, '')))
    ? 'csv'
    : 'txt';
}

const splitTags = (s: string | undefined) =>
  (s ?? '')
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((t) => t.slice(0, 40));

function accept(
  out: ParseResult,
  seen: Set<string>,
  line: number,
  raw: string,
  label: string | null,
  tags: string[],
  maxRejects: number,
) {
  const n = normalizeUrl(raw);
  if (!n.ok) {
    if (out.rejects.length < maxRejects) out.rejects.push({ line, value: raw.slice(0, 300), reason: n.reason });
    return false;
  }
  if (seen.has(n.url)) {
    out.duplicatesInFile++;
    return true;
  }
  seen.add(n.url);
  out.entries.push({ line, url: n.url, domain: n.domain, label: label ? label.slice(0, 300) : null, tags });
  return true;
}

export interface ParseOptions {
  filename?: string;
  format?: 'txt' | 'csv';
  /** Cap on rejects returned in detail (all are counted). */
  maxRejects?: number;
}

export function parseUrlFile(input: Buffer | string, opts: ParseOptions = {}): ParseResult & { rejectedTotal: number } {
  const text = typeof input === 'string' ? input : decodeText(input);
  const format = opts.format ?? detectFormat(opts.filename, text);
  const maxRejects = opts.maxRejects ?? 500;
  const out: ParseResult = { format, totalLines: 0, entries: [], rejects: [], duplicatesInFile: 0 };
  const seen = new Set<string>();
  let rejectedTotal = 0;
  const track = (ok: boolean) => {
    if (!ok) rejectedTotal++;
  };

  if (format === 'txt') {
    const lines = text.split(/\r\n|\n|\r/);
    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      out.totalLines++;
      // "url  optional label" — first token is the URL, the rest is a label.
      const m = /^(\S+)(?:\s+(.+))?$/.exec(line)!;
      track(accept(out, seen, idx + 1, m[1]!, m[2]?.trim() ?? null, [], maxRejects));
    });
    return { ...out, rejectedTotal };
  }

  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  let rows: string[][];
  try {
    rows = parseCsv(text, {
      delimiter,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch (e) {
    out.rejects.push({ line: 0, value: '', reason: `CSV could not be parsed: ${(e as Error).message}` });
    return { ...out, rejectedTotal: 1 };
  }
  if (rows.length === 0) return { ...out, rejectedTotal };

  const header = rows[0]!.map((c) => c.trim());
  const hasHeader = header.some((c) => URL_HEADER.test(c));
  let urlCol = 0;
  let labelCol = -1;
  let tagsCol = -1;
  if (hasHeader) {
    urlCol = header.findIndex((c) => URL_HEADER.test(c));
    labelCol = header.findIndex((c) => LABEL_HEADER.test(c));
    tagsCol = header.findIndex((c) => TAGS_HEADER.test(c));
  } else {
    // Without a header, use the first column that looks like a URL in the first row.
    const guess = header.findIndex((c) => normalizeUrl(c).ok);
    urlCol = guess >= 0 ? guess : 0;
    labelCol = header.length > 1 ? (urlCol === 0 ? 1 : 0) : -1;
  }

  rows.forEach((row, idx) => {
    if (hasHeader && idx === 0) return;
    const value = row[urlCol]?.trim() ?? '';
    if (!value || value.startsWith('#')) return;
    out.totalLines++;
    const label = labelCol >= 0 ? row[labelCol]?.trim() || null : null;
    const tags = tagsCol >= 0 ? splitTags(row[tagsCol]) : [];
    track(accept(out, seen, idx + 1, value, label, tags, maxRejects));
  });
  return { ...out, rejectedTotal };
}
