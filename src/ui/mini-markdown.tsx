import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A deliberately small markdown renderer for assistant replies: paragraphs,
 * "- " bullet lists, **bold**, _italic_, `code` and [links](url). Builds
 * React nodes (never raw HTML), and only follows relative or http(s) links,
 * so model output cannot inject markup or script URLs.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<!\w)_[^_\s][^_]*?_(?!\w))/g;

function safeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${n++}`;
    if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = m ? safeHref(m[2]!) : null;
      if (m && href) {
        out.push(
          href.startsWith("/") ? (
            <Link key={key} href={href}>
              {m[1]}
            </Link>
          ) : (
            <a key={key} href={href} target="_blank" rel="noreferrer">
              {m[1]}
            </a>
          )
        );
      } else {
        out.push(m ? m[1] : token);
      }
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      const k = `p-${blocks.length}`;
      blocks.push(<p key={k}>{renderInline(paragraph.join(" "), k)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const k = `ul-${blocks.length}`;
      blocks.push(
        <ul key={k}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item, `${k}-${i}`)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]!);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return <div className="md">{blocks}</div>;
}
