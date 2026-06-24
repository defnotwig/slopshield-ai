"use client";

import React from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";

interface CodeViewerProps {
  code: string;
  language?: string;
  height?: string;
}

export function CodeViewer({
  code,
  language = "typescript",
  height = "300px",
}: CodeViewerProps) {
  const { theme } = useTheme();

  return (
    <div className="border border-border rounded-sm overflow-hidden w-full font-mono text-sm shadow-inner bg-muted/40">
      <Editor
        height={height}
        language={language}
        value={code}
        theme={theme === "dark" ? "vs-dark" : "light"}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily:
            "JetBrains Mono, Menlo, Monaco, Consolas, Courier New, monospace",
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          contextmenu: false,
          folding: true,
          wordWrap: "on",
        }}
        loading={
          <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground py-12">
            Loading Monaco Editor...
          </div>
        }
      />
    </div>
  );
}
