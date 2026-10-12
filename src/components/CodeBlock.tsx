import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1']);
const LABEL: Record<string, string> = {
  bash: 'AWS CLI · Bash',
  sh: 'Shell',
  shell: 'Shell',
  console: 'Shell',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  python: 'Python',
  py: 'Python',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  sql: 'SQL',
  text: 'Text',
};

/** Colours one shell line: prompt, comments, the command words, --flags and quoted strings. */
function shellLine(line: string, key: number): ReactNode {
  if (/^\s*#/.test(line)) return <span key={key} className="tok-comment">{line}</span>;
  const parts: ReactNode[] = [];
  let rest = line;
  const prompt = rest.match(/^(\s*\$ )/);
  if (prompt) {
    parts.push(<span key="p" className="tok-prompt">{prompt[1]}</span>);
    rest = rest.slice(prompt[1].length);
  }
  // The leading command words (e.g. "aws ec2 run-instances") up to the first flag or argument value.
  const cmd = rest.match(/^(\s*(?:aws|sam|kubectl|docker|eksctl|curl|ssh|chmod|sudo|yum|dnf|apt|echo|cat|export|cd|ls|mkdir|python3?|pip3?|npm|node|git|zip|unzip|jq)\b(?:\s+[a-z0-9][a-z0-9-]*){0,2})/);
  if (cmd) {
    parts.push(<span key="c" className="tok-command">{cmd[1]}</span>);
    rest = rest.slice(cmd[1].length);
  }
  const re = /("(?:[^"\\]|\\.)*"|'[^']*'|--?[A-Za-z][\w-]*|\s#.*$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(rest))) {
    if (m.index > last) parts.push(rest.slice(last, m.index));
    const t = m[0];
    const cls = t.trimStart().startsWith('#') ? 'tok-comment' : t.startsWith('-') ? 'tok-flag' : 'tok-string';
    parts.push(<span key={`t${i++}`} className={cls}>{t}</span>);
    last = m.index + t.length;
  }
  if (last < rest.length) parts.push(rest.slice(last));
  return <span key={key}>{parts}</span>;
}

/**
 * Text to copy: only the "$ " prompts are removed. Comment lines stay, because a "#!/bin/bash"
 * shebang or a comment inside a heredoc is part of what the learner pastes (e.g. EC2 user data).
 */
function copyText(code: string, shell: boolean): string {
  if (!shell) return code;
  return code
    .split('\n')
    .map((l) => l.replace(/^(\s*)\$ /, '$1'))
    .join('\n');
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const language = (lang || 'text').toLowerCase();
  const shell = SHELL.has(language);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(code, shell));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context); the text is still selectable.
    }
  };
  const lines = code.split('\n');
  return (
    <div className="code-block">
      <div className="code-block__head">
        <span className="code-block__lang">{LABEL[language] ?? language}</span>
        <button type="button" className={`code-block__copy${copied ? ' is-copied' : ''}`} onClick={copy} aria-label={shell ? 'Copy command' : 'Copy code'}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied to clipboard' : ''}
        </span>
      </div>
      <pre>
        <code className={`language-${language}`}>
          {shell
            ? lines.map((l, i) => (
                <span key={i}>
                  {shellLine(l, i)}
                  {i < lines.length - 1 ? '\n' : ''}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}
