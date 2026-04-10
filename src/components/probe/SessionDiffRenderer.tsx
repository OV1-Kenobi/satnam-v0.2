/**
 * SessionDiffRenderer — Code diff viewer
 *
 * Features:
 * - Line-number gutters
 * - Added (green) / Removed (red) / Context (gray) line highlighting
 * - File path header with language detection from extension
 * - CSS-only syntax highlighting (keywords, strings, comments, numbers, functions)
 * - Collapsible hunks
 *
 * Spec §8.2 — No external syntax highlighting libraries.
 */

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import {
  FileDiff,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Copy,
  CheckCheck,
  Code2,
  FileCode,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffLineType = 'added' | 'removed' | 'context' | 'hunk';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  /** Line number in the old file (null for added lines) */
  oldLineNum?: number | null;
  /** Line number in the new file (null for removed lines) */
  newLineNum?: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  language?: string;
  hunks: DiffHunk[];
  /** Shorthand stat: added/removed line counts */
  additions?: number;
  deletions?: number;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', json: 'JSON', md: 'Markdown',
  css: 'CSS', html: 'HTML', sh: 'Shell', toml: 'TOML', yaml: 'YAML',
  yml: 'YAML', sql: 'SQL', graphql: 'GraphQL', proto: 'Protobuf',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? 'Text';
}

// ---------------------------------------------------------------------------
// CSS-only syntax highlighting — NO external libraries
// Applies simple regex-based token coloring via React spans.
// ---------------------------------------------------------------------------

const KEYWORDS_TS = /\b(const|let|var|function|class|interface|type|enum|import|export|default|from|return|if|else|for|while|do|switch|case|break|continue|throw|try|catch|finally|new|this|super|extends|implements|async|await|of|in|null|undefined|true|false|void|never|any|string|number|boolean|object|unknown|readonly|static|public|private|protected|abstract)\b/g;
const KEYWORDS_PY = /\b(def|class|import|from|return|if|elif|else|for|while|with|as|pass|break|continue|raise|try|except|finally|lambda|yield|global|nonlocal|True|False|None|and|or|not|in|is|del|assert)\b/g;
const KEYWORDS_RS = /\b(fn|let|mut|const|pub|use|mod|impl|struct|enum|trait|where|self|Self|super|crate|if|else|match|for|while|loop|return|break|continue|true|false|None|Some|Ok|Err|async|await|move|ref)\b/g;
const STRING_REGEX = /(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g;
const COMMENT_SINGLE = /\/\/[^\n]*/g;
const COMMENT_HASH = /#[^\n]*/g;
const COMMENT_MULTI = /\/\*[\s\S]*?\*\//g;
const NUMBER_REGEX = /\b(\d+\.?\d*(?:[eE][+-]?\d+)?n?)\b/g;
const FUNCTION_REGEX = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g;

interface Token {
  text: string;
  cls: string;
}

function tokenizeLine(line: string, lang: string): Token[] {
  // We'll build a list of [start, end, cls] ranges then render
  type Range = { start: number; end: number; cls: string };
  const ranges: Range[] = [];

  const keywordRe =
    lang === 'Python' ? KEYWORDS_PY :
    lang === 'Rust'   ? KEYWORDS_RS :
    KEYWORDS_TS;

  const commentRe = lang === 'Python' ? COMMENT_HASH : COMMENT_SINGLE;

  // Apply patterns (order matters — later patterns win within same range for simplicity)
  const applyRegex = (re: RegExp, cls: string) => {
    const fresh = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = fresh.exec(line)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls });
    }
  };

  applyRegex(STRING_REGEX,  'text-green-400');
  applyRegex(commentRe,     'text-slate-500 italic');
  applyRegex(COMMENT_MULTI, 'text-slate-500 italic');
  applyRegex(NUMBER_REGEX,  'text-yellow-400');
  applyRegex(FUNCTION_REGEX,'text-blue-300');
  applyRegex(keywordRe,     'text-purple-400');

  if (ranges.length === 0) {
    return [{ text: line, cls: '' }];
  }

  // Sort by start, then end descending (wider ranges first)
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  // Non-overlapping selection: greedily pick ranges
  const selected: Range[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    selected.push(r);
    cursor = r.end;
  }

  // Build token list
  const tokens: Token[] = [];
  let pos = 0;
  for (const r of selected) {
    if (r.start > pos) tokens.push({ text: line.slice(pos, r.start), cls: '' });
    tokens.push({ text: line.slice(r.start, r.end), cls: r.cls });
    pos = r.end;
  }
  if (pos < line.length) tokens.push({ text: line.slice(pos), cls: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// DiffLineRow
// ---------------------------------------------------------------------------

function DiffLineRow({
  line,
  language,
}: {
  line: DiffLine;
  language: string;
  lineIdx: number;
}) {
  const content = line.content
    .replace(/^\+/, '')  // strip git +/- prefix
    .replace(/^-/, '');

  const tokens = tokenizeLine(content, language);

  const rowCls = clsx(
    'flex text-[11px] font-mono leading-5 group',
    line.type === 'added'   && 'bg-green-950/40',
    line.type === 'removed' && 'bg-red-950/40',
  );

  const oldNumStr = line.oldLineNum != null ? String(line.oldLineNum) : '';
  const newNumStr = line.newLineNum != null ? String(line.newLineNum) : '';

  const sigil =
    line.type === 'added'   ? '+' :
    line.type === 'removed' ? '-' :
    ' ';

  const sigilCls =
    line.type === 'added'   ? 'text-green-500' :
    line.type === 'removed' ? 'text-red-500'   :
    'text-slate-700';

  const textCls =
    line.type === 'added'   ? 'text-green-300' :
    line.type === 'removed' ? 'text-red-300'   :
    'text-slate-400';

  return (
    <div className={rowCls} aria-label={`${line.type} line`}>
      {/* Old line number */}
      <span
        className="text-slate-600 text-right pr-2 pl-3 select-none w-10 flex-shrink-0 border-r border-slate-800"
        aria-hidden="true"
      >
        {oldNumStr}
      </span>
      {/* New line number */}
      <span
        className="text-slate-600 text-right pr-2 pl-2 select-none w-10 flex-shrink-0 border-r border-slate-800"
        aria-hidden="true"
      >
        {newNumStr}
      </span>
      {/* Sigil */}
      <span className={clsx('px-1.5 select-none flex-shrink-0', sigilCls)} aria-hidden="true">
        {sigil}
      </span>
      {/* Code */}
      <span className={clsx('flex-1 px-1 overflow-hidden whitespace-pre', textCls)}>
        {tokens.map((token, i) => (
          <span key={i} className={token.cls || undefined}>{token.text}</span>
        ))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HunkBlock — collapsible group of diff lines
// ---------------------------------------------------------------------------

function HunkBlock({
  hunk,
  language,
  defaultExpanded = true,
}: {
  hunk: DiffHunk;
  language: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const addedCount = hunk.lines.filter(l => l.type === 'added').length;
  const removedCount = hunk.lines.filter(l => l.type === 'removed').length;

  return (
    <div className="border-b border-slate-800 last:border-0">
      {/* Hunk header */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse hunk' : 'Expand hunk'}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
      >
        {expanded
          ? <ChevronDown size={12} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
          : <ChevronRight size={12} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
        }
        <span className="font-mono text-[10px] text-slate-500 flex-1 truncate">{hunk.header}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {addedCount > 0 && (
            <span className="text-[9px] text-green-400 flex items-center gap-0.5">
              <Plus size={9} aria-hidden="true" />
              {addedCount}
            </span>
          )}
          {removedCount > 0 && (
            <span className="text-[9px] text-red-400 flex items-center gap-0.5">
              <Minus size={9} aria-hidden="true" />
              {removedCount}
            </span>
          )}
        </div>
      </button>

      {/* Lines */}
      {expanded && (
        <div>
          {hunk.lines.map((line, idx) => (
            <DiffLineRow
              key={idx}
              line={line}
              language={language}
              lineIdx={idx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileHeader
// ---------------------------------------------------------------------------

function FileHeader({
  file,
  onCopy,
  copied,
}: {
  file: DiffFile;
  onCopy: () => void;
  copied: boolean;
}) {
  const language = file.language ?? detectLanguage(file.newPath || file.oldPath);
  const isRenamed = file.oldPath !== file.newPath;
  const displayPath = file.newPath || file.oldPath;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 border-b border-slate-700"
      aria-label="File header"
    >
      <FileCode size={13} className="text-slate-400 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm text-slate-300 truncate block">
          {isRenamed ? (
            <>
              <span className="text-red-400">{file.oldPath}</span>
              <span className="text-slate-500 mx-1">→</span>
              <span className="text-green-400">{file.newPath}</span>
            </>
          ) : (
            displayPath
          )}
        </span>
      </div>

      {/* Language badge */}
      <span className="text-[10px] text-slate-500 bg-slate-700 px-2 py-0.5 rounded font-mono flex-shrink-0">
        {language}
      </span>

      {/* Stats */}
      {(file.additions !== undefined || file.deletions !== undefined) && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {file.additions !== undefined && file.additions > 0 && (
            <span className="text-[11px] text-green-400 font-mono">+{file.additions}</span>
          )}
          {file.deletions !== undefined && file.deletions > 0 && (
            <span className="text-[11px] text-red-400 font-mono">-{file.deletions}</span>
          )}
        </div>
      )}

      {/* Copy button */}
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy diff"
        className="p-1 text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
      >
        {copied ? <CheckCheck size={12} className="text-green-400" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileDiffBlock
// ---------------------------------------------------------------------------

function FileDiffBlock({ file }: { file: DiffFile }) {
  const [copied, setCopied] = useState(false);
  const language = file.language ?? detectLanguage(file.newPath || file.oldPath);

  const handleCopy = useCallback(async () => {
    const text = file.hunks
      .map(h => [h.header, ...h.lines.map(l => l.content)].join('\n'))
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [file]);

  return (
    <div
      className="rounded-xl border border-slate-800 overflow-hidden"
      role="region"
      aria-label={`Diff for ${file.newPath || file.oldPath}`}
    >
      <FileHeader file={file} onCopy={handleCopy} copied={copied} />
      <div className="overflow-x-auto bg-slate-950">
        {file.hunks.map((hunk, idx) => (
          <HunkBlock
            key={idx}
            hunk={hunk}
            language={language}
            defaultExpanded
          />
        ))}
        {file.hunks.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-600">
            No changes in this file
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionDiffRenderer — main export
// ---------------------------------------------------------------------------

export interface SessionDiffRendererProps {
  files: DiffFile[];
  /** Optional: raw unified diff string to parse */
  rawDiff?: string;
  title?: string;
  className?: string;
}

/**
 * Parse a unified diff string into DiffFile[] for rendering.
 * Handles the common `--- a/file` / `+++ b/file` / `@@` header format.
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine;

    if (line.startsWith('--- ')) {
      const oldPath = line.replace(/^--- (a\/)?/, '').trim();
      if (currentFile) files.push(currentFile);
      currentFile = { oldPath, newPath: '', hunks: [], additions: 0, deletions: 0 };
      currentHunk = null;
      continue;
    }

    if (line.startsWith('+++ ') && currentFile) {
      currentFile.newPath = line.replace(/^\+\+\+ (b\/)?/, '').trim();
      continue;
    }

    if (line.startsWith('@@') && currentFile) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLineNum = parseInt(match[1] ?? '0', 10);
        newLineNum = parseInt(match[2] ?? '0', 10);
        currentHunk = { header: line, lines: [] };
        currentFile.hunks.push(currentHunk);
      }
      continue;
    }

    if (!currentFile || !currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        content: line,
        oldLineNum: null,
        newLineNum: newLineNum++,
      });
      currentFile.additions = (currentFile.additions ?? 0) + 1;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'removed',
        content: line,
        oldLineNum: oldLineNum++,
        newLineNum: null,
      });
      currentFile.deletions = (currentFile.deletions ?? 0) + 1;
    } else {
      currentHunk.lines.push({
        type: 'context',
        content: line,
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  if (currentFile) files.push(currentFile);
  return files;
}

export default function SessionDiffRenderer({
  files: propFiles,
  rawDiff,
  title,
  className,
}: SessionDiffRendererProps) {
  const files = rawDiff ? parseUnifiedDiff(rawDiff) : propFiles;

  const totalAdditions = files.reduce((s, f) => s + (f.additions ?? 0), 0);
  const totalDeletions = files.reduce((s, f) => s + (f.deletions ?? 0), 0);

  if (files.length === 0) {
    return (
      <div className={clsx('rounded-xl bg-slate-900 border border-slate-800 p-8 text-center', className)}>
        <FileDiff size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
        <p className="text-sm text-slate-500">No diff to display</p>
      </div>
    );
  }

  return (
    <div className={clsx('space-y-3', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 size={15} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">
            {title ?? 'Session Diff'}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-500">{files.length} file{files.length !== 1 ? 's' : ''}</span>
          {totalAdditions > 0 && (
            <span className="text-green-400 font-mono">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400 font-mono">-{totalDeletions}</span>
          )}
        </div>
      </div>

      {/* Files */}
      <div className="space-y-3" role="list" aria-label="Changed files">
        {files.map((file, idx) => (
          <div key={idx} role="listitem">
            <FileDiffBlock file={file} />
          </div>
        ))}
      </div>
    </div>
  );
}


