import React, { useState } from 'react';

export type FormatType = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'spoiler' | 'link';

export const FORMAT_TOKENS: Record<FormatType, { open: string; close: string }> = {
  bold:      { open: '**', close: '**' },
  italic:    { open: '*',  close: '*'  },
  underline: { open: '__', close: '__' },
  strike:    { open: '~~', close: '~~' },
  code:      { open: '`',  close: '`'  },
  spoiler:   { open: '||', close: '||' },
  link:      { open: '[',  close: ']'  },
};

export function applyFormat(
  text: string,
  start: number,
  end: number,
  fmt: FormatType,
  url?: string,
): { newText: string; newStart: number; newEnd: number } {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);

  let inserted: string;
  if (fmt === 'link') {
    inserted = `[${selected}](${url ?? ''})`;
  } else {
    const { open, close } = FORMAT_TOKENS[fmt];
    inserted = `${open}${selected}${close}`;
  }

  return {
    newText: before + inserted + after,
    newStart: start,
    newEnd: start + inserted.length,
  };
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'bold'; children: Segment[] }
  | { type: 'italic'; children: Segment[] }
  | { type: 'underline'; children: Segment[] }
  | { type: 'strike'; children: Segment[] }
  | { type: 'code'; content: string }
  | { type: 'spoiler'; children: Segment[] }
  | { type: 'link'; href: string; children: Segment[] }
  | { type: 'mention'; content: string };

function parseRichText(text: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;

  while (i < text.length) {
    // mention
    if (text[i] === '@' && i + 1 < text.length && /\S/.test(text[i + 1])) {
      const end = text.slice(i).search(/\s|$/);
      const word = text.slice(i, i + (end === -1 ? text.length - i : end));
      segments.push({ type: 'mention', content: word });
      i += word.length;
      continue;
    }

    // bold **
    if (text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2);
      if (close !== -1) {
        segments.push({ type: 'bold', children: parseRichText(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // italic *  (single, not double)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const close = text.indexOf('*', i + 1);
      if (close !== -1 && text[close + 1] !== '*') {
        segments.push({ type: 'italic', children: parseRichText(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    // underline __
    if (text.startsWith('__', i)) {
      const close = text.indexOf('__', i + 2);
      if (close !== -1) {
        segments.push({ type: 'underline', children: parseRichText(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // strikethrough ~~
    if (text.startsWith('~~', i)) {
      const close = text.indexOf('~~', i + 2);
      if (close !== -1) {
        segments.push({ type: 'strike', children: parseRichText(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // code `
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        segments.push({ type: 'code', content: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    // spoiler ||
    if (text.startsWith('||', i)) {
      const close = text.indexOf('||', i + 2);
      if (close !== -1) {
        segments.push({ type: 'spoiler', children: parseRichText(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // link [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const href = text.slice(closeBracket + 2, closeParen);
          const label = text.slice(i + 1, closeBracket);
          segments.push({ type: 'link', href, children: parseRichText(label) });
          i = closeParen + 1;
          continue;
        }
      }
    }

    // plain text — accumulate until next potential token
    const nextSpecial = findNextSpecial(text, i + 1);
    const plain = text.slice(i, nextSpecial);
    if (plain) {
      const last = segments[segments.length - 1];
      if (last && last.type === 'text') {
        last.content += plain;
      } else {
        segments.push({ type: 'text', content: plain });
      }
    }
    i = nextSpecial;
  }

  return segments;
}

function findNextSpecial(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === '@' || c === '*' || c === '_' || c === '~' || c === '`' || c === '|' || c === '[') return j;
  }
  return text.length;
}

function SpoilerSpan({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setRevealed(false); }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => { e.stopPropagation(); }}
        className="cursor-pointer rounded px-0.5 select-text"
        style={{ background: 'rgba(255,255,255,0.18)' }}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setRevealed(true); }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setRevealed(true); }}
      className="spoiler-wrap cursor-pointer select-none"
    >
      {/* Hidden text — occupies exact layout space but invisible */}
      <span className="spoiler-text">{children}</span>
      {/* Animated overlay — same size as the text */}
      <span className="spoiler-anim" aria-hidden="true" />
    </span>
  );
}

function renderSegments(segments: Segment[], isMine: boolean, keyPrefix = ''): React.ReactNode {
  return segments.map((seg, idx) => {
    const key = `${keyPrefix}${idx}`;
    switch (seg.type) {
      case 'text':
        return <span key={key}>{seg.content}</span>;
      case 'mention':
        return (
          <span key={key} className="font-bold underline decoration-dotted underline-offset-2 bg-white/20 rounded px-0.5 py-px">
            {seg.content}
          </span>
        );
      case 'bold':
        return <strong key={key}>{renderSegments(seg.children, isMine, key + '-')}</strong>;
      case 'italic':
        return <em key={key}>{renderSegments(seg.children, isMine, key + '-')}</em>;
      case 'underline':
        return <u key={key}>{renderSegments(seg.children, isMine, key + '-')}</u>;
      case 'strike':
        return <s key={key}>{renderSegments(seg.children, isMine, key + '-')}</s>;
      case 'code':
        return (
          <code key={key} className="font-mono text-[0.85em] rounded px-1 py-0.5"
            style={{ background: isMine ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.12)' }}>
            {seg.content}
          </code>
        );
      case 'spoiler':
        return (
          <SpoilerSpan key={key}>
            {renderSegments(seg.children, isMine, key + '-')}
          </SpoilerSpan>
        );
      case 'link':
        return (
          <a key={key}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-current underline-offset-2 opacity-90 hover:opacity-100"
            onClick={e => e.stopPropagation()}
          >
            {renderSegments(seg.children, isMine, key + '-')}
          </a>
        );
    }
  });
}

export function RichText({ text, isMine }: { text: string; isMine: boolean }) {
  const segments = parseRichText(text);
  return <>{renderSegments(segments, isMine)}</>;
}
