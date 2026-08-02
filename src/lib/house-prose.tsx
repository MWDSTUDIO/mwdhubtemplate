import React from "react";

/**
 * The house's prose, rendered — never raw asterisks in front of a
 * couple. A deliberately small hand: paragraphs, **bold**, *italic*,
 * "- " lists, "## " small headings. Everything is built as React
 * nodes, never injected HTML; what the model or Estelle writes can
 * carry no markup of its own.
 */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // bold first, then italics inside the remainder
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      out.push(<strong key={`${keyBase}-b${i}`} style={{ fontWeight: 500 }}>{part.slice(2, -2)}</strong>);
    } else {
      const italics = part.split(/(\*[^*]+\*)/g);
      italics.forEach((seg, j) => {
        if (/^\*[^*]+\*$/.test(seg)) {
          out.push(<em key={`${keyBase}-i${i}-${j}`}>{seg.slice(1, -1)}</em>);
        } else if (seg) {
          out.push(<React.Fragment key={`${keyBase}-t${i}-${j}`}>{seg}</React.Fragment>);
        }
      });
    }
  });
  return out;
}

export function HouseProse({ text, size = 16 }: { text: string; size?: number }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div style={{ fontSize: size, lineHeight: 1.65 }}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={bi} style={{ margin: "8px 0", paddingLeft: 22 }}>
              {lines.map((l, li) => (
                <li key={li} style={{ margin: "3px 0" }}>{inline(l.replace(/^\s*[-•]\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (/^##\s+/.test(lines[0]) && lines.length === 1) {
          return (
            <p key={bi} className="eyebrow" style={{ margin: "14px 0 4px" }}>
              {inline(lines[0].replace(/^##\s+/, ""), `${bi}-h`)}
            </p>
          );
        }
        return (
          <p key={bi} style={{ margin: "8px 0" }}>
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
