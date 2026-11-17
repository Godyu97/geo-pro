"use client";

import Link from "next/link";
import messages from "@/lib/i18n/messages/fatal.json";

// The root layout (and its request locale provider) may itself have failed.
// Keep this last-resort document self-contained and readable in both languages.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="zh-CN">
      <head><title>{messages["zh-CN"].title} / {messages.en.title}</title></head>
      <body style={{ margin: 0, background: "#f5f7f6", color: "#203435", fontFamily: "Arial, sans-serif" }}>
        <main id="main-content" style={{ maxWidth: 560, margin: "12vh auto", padding: 24, lineHeight: 1.8, overflowWrap: "anywhere" }}>
          <h1 style={{ fontSize: 24 }}>
            {messages["zh-CN"].title}<br /><span lang="en">{messages.en.title}</span>
          </h1>
          <p>{messages["zh-CN"].description}<br /><span lang="en">{messages.en.description}</span></p>
          <button onClick={reset} style={{ padding: "8px 16px", font: "inherit", cursor: "pointer" }}>
            {messages["zh-CN"].reload} / <span lang="en">{messages.en.reload}</span>
          </button>
          <p><Link href="/" prefetch={false} onClick={(event) => {
            event.preventDefault();
            window.location.assign(new URL("/", window.location.origin).href);
          }} style={{ color: "#256b6b" }}>{messages["zh-CN"].home} / <span lang="en">{messages.en.home}</span></Link></p>
        </main>
      </body>
    </html>
  );
}
