/**
 * A small, dependency-free Markdown renderer.
 *
 * Deliberately not `marked` + a sanitizer: the content comes from a language
 * model, and rendering to React elements instead of raw HTML means there is no
 * path to injected markup at all. Covers what saved pages actually use —
 * headings, lists, task checkboxes, tables, code, quotes, links, emphasis.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/* ------------------------------ inline ------------------------------ */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE);

  parts.forEach((part, i) => {
    if (!part) return;
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
      return;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
      return;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      out.push(<code key={key}>{part.slice(1, -1)}</code>);
      return;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      const internal = href.startsWith("/");
      // Only http(s) and internal routes — no javascript: or data: hrefs.
      if (internal) {
        out.push(
          <Link key={key} href={href} className="text-arc underline underline-offset-2">
            {label}
          </Link>
        );
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
        return;
      }
      out.push(<span key={key}>{label}</span>);
      return;
    }
    out.push(<span key={key}>{part}</span>);
  });

  return out;
}

/* ------------------------------ blocks ------------------------------ */

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableSep = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

export function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-edge bg-abyss/70 p-3 text-[0.8rem] leading-relaxed"
        >
          <code className="font-mono">{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      if (depth <= 2) blocks.push(<h2 key={key++}>{content}</h2>);
      else blocks.push(<h3 key={key++}>{content}</h3>);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-5 border-edge" />);
      i++;
      continue;
    }

    // table
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="-mx-1 overflow-x-auto">
          <table>
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{renderInline(h, `th${key}-${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{renderInline(row[ci] ?? "", `td${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key++}>{renderInline(body.join(" "), `q${key}`)}</blockquote>);
      continue;
    }

    // task list — rendered as real checkboxes you can tick while cooking/lifting
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: { checked: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i])!;
        items.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-3 space-y-2 list-none pl-0">
          {items.map((item, ii) => (
            <TaskItem key={ii} defaultChecked={item.checked} text={item.text} idx={ii} />
          ))}
        </ul>
      );
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([-*+]|\d+[.)]|#{1,4}\s|>|```)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    if (para.length) {
      blocks.push(<p key={key++}>{renderInline(para.join(" "), `p${key}`)}</p>);
    } else {
      i++;
    }
  }

  return <div className="prose-jarvis">{blocks}</div>;
}

/* Checkboxes are interactive but intentionally not persisted — they reset on
   reload, which is what you want for "today's sets". */
function TaskItem({ defaultChecked, text, idx }: { defaultChecked: boolean; text: string; idx: number }) {
  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        id={`task-${idx}`}
        className="mt-1 size-4 shrink-0 accent-[var(--color-arc)]"
      />
      <label htmlFor={`task-${idx}`} className="cursor-pointer select-none">
        {renderInline(text, `task-${idx}`)}
      </label>
    </li>
  );
}
