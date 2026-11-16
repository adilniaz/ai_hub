import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Check, Copy } from "lucide-react";
import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { classNames, copyText } from "../lib/utils";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const normalizedLanguage = language.toLowerCase();
  const isHighlightable = Boolean(hljs.getLanguage(normalizedLanguage));
  const highlighted = isHighlightable
    ? hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true,
      }).value
    : escapeHtml(code);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || "text"}</span>
        <button
          aria-label={copied ? "Code copied" : "Copy code"}
          className={classNames("code-copy", copied && "is-copied")}
          type="button"
          onClick={handleCopy}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
      const className = children.props.className ?? "";
      const match = /language-([\w-]+)/.exec(className);
      const code = nodeText(children.props.children).replace(/\n$/, "");
      return <CodeBlock code={code} language={match?.[1] ?? "text"} />;
    }
    return <pre>{children}</pre>;
  },
  code({ className, children, ...props }) {
    return (
      <code className={classNames("md-inline", className)} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        rel="noreferrer noopener"
        target="_blank"
        {...props}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }) {
    return (
      <img
        alt={alt ?? ""}
        loading="lazy"
        src={src}
        {...props}
      />
    );
  },
};

interface MarkdownProps {
  content: string;
  streaming?: boolean;
}

export function Markdown({ content, streaming = false }: MarkdownProps) {
  return (
    <div className={classNames("markdown", streaming && "is-streaming")}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
