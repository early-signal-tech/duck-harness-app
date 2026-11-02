// Markdown (tables included) for answers and documents. Raw HTML in the text is not
// rendered, and web links open in the default browser instead of replacing the app's
// page. With `anchors`, headings get ids (GitHub style: "## 3. Header bar" becomes
// "3-header-bar") and "#..." links scroll to them, so a document's contents work.

import { openUrl } from "@tauri-apps/plugin-opener";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** A heading's id, as GitHub makes it: lowercase, punctuation dropped, spaces to dashes. */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/ /g, "-");
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

interface Props {
  text: string;
  anchors?: boolean;
  /** Links that aren't web or in-page links (another file in the repo, say). */
  onLocalLink?: (href: string) => void;
}

export function Markdown({ text, anchors = false, onLocalLink }: Props) {
  const heading = (Tag: "h1" | "h2" | "h3" | "h4") =>
    ({ children }: { children?: ReactNode }) => (
      <Tag id={anchors ? slugify(textOf(Children.toArray(children))) : undefined}>{children}</Tag>
    );

  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        className={href && !/^(https?:|#)/.test(href) ? "local-link" : undefined}
        onClick={(e) => {
          e.preventDefault();
          if (!href) return;
          if (/^https?:/.test(href)) openUrl(href).catch(() => {});
          else if (href.startsWith("#")) {
            const target = document.getElementById(decodeURIComponent(href.slice(1)));
            target?.scrollIntoView({ block: "start", behavior: "smooth" });
          } else onLocalLink?.(href);
        }}
      >
        {children}
      </a>
    ),
    ...(anchors ? { h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4") } : {}),
  };

  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
