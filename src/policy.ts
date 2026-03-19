// ─── Generic WebContainer Policy / Guardrail Engine ─────────────────────────

export type PolicyAction =
  | 'file.read'
  | 'file.write'
  | 'process.spawn'
  | 'server.bind'
  | 'env.configure'
  | 'tool.use'
  | 'git.clone'
  | 'git.push';

export interface FileRule {
  pattern: string;
  allow: boolean;
}

export interface ProcessRule {
  pattern: string;
  allow: boolean;
}

export interface PortRule {
  port: number | '*';
  allow: boolean;
}

export interface ToolRule {
  name: string;
  allow: boolean;
}

export interface RuntimeLimits {
  maxFileSize: number;
  maxProcesses: number;
  maxTurns: number;
  timeoutSec: number;
}

export interface Policy {
  version: '1';
  mode: 'allow-all' | 'deny-all';
  files: { read: FileRule[]; write: FileRule[] };
  processes: ProcessRule[];
  ports: PortRule[];
  tools: ToolRule[];
  limits: RuntimeLimits;
}

export interface CheckResult {
  allowed: boolean;
  rule?: string;
  action: PolicyAction;
  subject: string;
}

export class PolicyDeniedError extends Error {
  action: PolicyAction;
  subject: string;
  rule: string;

  constructor(action: PolicyAction, subject: string, rule: string) {
    super(`Policy denied: ${action} on "${subject}" (rule: ${rule})`);
    this.name = 'PolicyDeniedError';
    this.action = action;
    this.subject = subject;
    this.rule = rule;
  }
}

// ─── PolicyEngine ────────────────────────────────────────────────────────────

export class PolicyEngine {
  private policy: Policy;

  constructor(policy?: Policy) {
    this.policy = policy ?? PolicyEngine.defaultPolicy();
  }

  loadPolicy(policy: Policy): void {
    this.policy = policy;
  }

  getPolicy(): Policy {
    return this.policy;
  }

  check(
    action: PolicyAction,
    subject: string,
    meta?: Record<string, unknown>,
  ): CheckResult {
    const p = this.policy;

    // File rules
    if (action === 'file.read') {
      for (const rule of p.files.read) {
        if (globMatch(rule.pattern, subject)) {
          return { allowed: rule.allow, rule: `file.read: ${rule.pattern}`, action, subject };
        }
      }
      return { allowed: p.mode === 'allow-all', action, subject };
    }

    if (action === 'file.write') {
      // Check size limit first
      if (meta?.size != null && typeof meta.size === 'number') {
        if (meta.size > p.limits.maxFileSize) {
          return {
            allowed: false,
            rule: `limits.maxFileSize: ${p.limits.maxFileSize}`,
            action,
            subject,
          };
        }
      }
      for (const rule of p.files.write) {
        if (globMatch(rule.pattern, subject)) {
          return { allowed: rule.allow, rule: `file.write: ${rule.pattern}`, action, subject };
        }
      }
      return { allowed: p.mode === 'allow-all', action, subject };
    }

    // Process rules
    if (action === 'process.spawn') {
      // Check process count limit
      if (meta?.activeProcesses != null && typeof meta.activeProcesses === 'number') {
        if (meta.activeProcesses >= p.limits.maxProcesses) {
          return {
            allowed: false,
            rule: `limits.maxProcesses: ${p.limits.maxProcesses}`,
            action,
            subject,
          };
        }
      }
      for (const rule of p.processes) {
        if (globMatch(rule.pattern, subject)) {
          return { allowed: rule.allow, rule: `process: ${rule.pattern}`, action, subject };
        }
      }
      return { allowed: p.mode === 'allow-all', action, subject };
    }

    // Port rules
    if (action === 'server.bind') {
      const port = Number(subject);
      for (const rule of p.ports) {
        if (rule.port === '*' || rule.port === port) {
          return { allowed: rule.allow, rule: `port: ${rule.port}`, action, subject };
        }
      }
      return { allowed: p.mode === 'allow-all', action, subject };
    }

    // Tool rules
    if (action === 'tool.use') {
      for (const rule of p.tools) {
        if (rule.name === subject || rule.name === '*') {
          return { allowed: rule.allow, rule: `tool: ${rule.name}`, action, subject };
        }
      }
      return { allowed: p.mode === 'allow-all', action, subject };
    }

    // env.configure — no specific rules, just mode
    return { allowed: p.mode === 'allow-all', action, subject };
  }

  enforce(
    action: PolicyAction,
    subject: string,
    meta?: Record<string, unknown>,
  ): CheckResult {
    const result = this.check(action, subject, meta);
    if (!result.allowed) {
      throw new PolicyDeniedError(action, subject, result.rule ?? this.policy.mode);
    }
    return result;
  }

  // ─── YAML serialization (hand-rolled, no deps) ──────────────────────────

  toYaml(): string {
    const p = this.policy;
    const lines: string[] = [];
    lines.push(`version: "1"`);
    lines.push(`mode: ${p.mode}`);

    lines.push(`files:`);
    lines.push(`  read:`);
    for (const r of p.files.read) {
      lines.push(`    - pattern: "${r.pattern}"`);
      lines.push(`      allow: ${r.allow}`);
    }
    lines.push(`  write:`);
    for (const r of p.files.write) {
      lines.push(`    - pattern: "${r.pattern}"`);
      lines.push(`      allow: ${r.allow}`);
    }

    lines.push(`processes:`);
    for (const r of p.processes) {
      lines.push(`  - pattern: "${r.pattern}"`);
      lines.push(`    allow: ${r.allow}`);
    }

    lines.push(`ports:`);
    for (const r of p.ports) {
      lines.push(`  - port: ${r.port === '*' ? '"*"' : r.port}`);
      lines.push(`    allow: ${r.allow}`);
    }

    lines.push(`tools:`);
    for (const r of p.tools) {
      lines.push(`  - name: "${r.name}"`);
      lines.push(`    allow: ${r.allow}`);
    }

    lines.push(`limits:`);
    lines.push(`  maxFileSize: ${p.limits.maxFileSize}`);
    lines.push(`  maxProcesses: ${p.limits.maxProcesses}`);
    lines.push(`  maxTurns: ${p.limits.maxTurns}`);
    lines.push(`  timeoutSec: ${p.limits.timeoutSec}`);

    return lines.join('\n') + '\n';
  }

  static fromYaml(yaml: string): Policy {
    const p = PolicyEngine.defaultPolicy();

    const get = (key: string): string | undefined => {
      const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return m?.[1]?.trim().replace(/^["']|["']$/g, '');
    };

    const ver = get('version');
    if (ver && ver !== '1') throw new Error(`Unsupported policy version: ${ver}`);

    const mode = get('mode');
    if (mode === 'allow-all' || mode === 'deny-all') p.mode = mode;

    // Parse limits
    const maxFileSize = get('maxFileSize');
    if (maxFileSize) p.limits.maxFileSize = Number(maxFileSize);
    const maxProcesses = get('maxProcesses');
    if (maxProcesses) p.limits.maxProcesses = Number(maxProcesses);
    const maxTurns = get('maxTurns');
    if (maxTurns) p.limits.maxTurns = Number(maxTurns);
    const timeoutSec = get('timeoutSec');
    if (timeoutSec) p.limits.timeoutSec = Number(timeoutSec);

    // Parse list sections
    p.files.read = parseFileRules(yaml, 'read');
    p.files.write = parseFileRules(yaml, 'write');
    p.processes = parsePatternRules(yaml, 'processes');
    p.ports = parsePortRules(yaml);
    p.tools = parseToolRules(yaml);

    return p;
  }

  static defaultPolicy(): Policy {
    return {
      version: '1',
      mode: 'allow-all',
      files: { read: [], write: [] },
      processes: [],
      ports: [],
      tools: [],
      limits: {
        maxFileSize: 10_485_760,
        maxProcesses: 10,
        maxTurns: 50,
        timeoutSec: 120,
      },
    };
  }
}

// ─── Glob matcher (~30 lines, no deps) ────────────────────────────────────────

function globMatch(pattern: string, subject: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(subject);
}

function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches any depth
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++; // skip trailing /
      } else {
        // * matches single segment (no /)
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(c!)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

// ─── YAML parsing helpers ─────────────────────────────────────────────────────

function parseFileRules(yaml: string, section: 'read' | 'write'): FileRule[] {
  const rules: FileRule[] = [];
  // Find the section within files:
  const sectionRegex = new RegExp(`^\\s{2}${section}:\\s*$`, 'm');
  const match = sectionRegex.exec(yaml);
  if (!match) return rules;

  const after = yaml.slice(match.index + match[0].length);
  const itemRegex = /^\s{4}-\s+pattern:\s*"([^"]*)"\s*\n\s+allow:\s*(true|false)/gm;
  let m;
  while ((m = itemRegex.exec(after)) !== null) {
    // Stop if we hit a less-indented line (next section)
    const beforeMatch = after.slice(0, m.index);
    if (/^\S/m.test(beforeMatch.split('\n').slice(1).join('\n'))) break;
    rules.push({ pattern: m[1], allow: m[2] === 'true' });
  }
  return rules;
}

function parsePatternRules(yaml: string, section: string): ProcessRule[] {
  const rules: ProcessRule[] = [];
  const sectionRegex = new RegExp(`^${section}:\\s*$`, 'm');
  const match = sectionRegex.exec(yaml);
  if (!match) return rules;

  const after = yaml.slice(match.index + match[0].length);
  const lines = after.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next top-level key
    if (/^\S/.test(line) && line.trim() !== '') break;
    const pm = line.match(/^\s+-\s+pattern:\s*"([^"]*)"/);
    if (pm && i + 1 < lines.length) {
      const am = lines[i + 1].match(/^\s+allow:\s*(true|false)/);
      if (am) rules.push({ pattern: pm[1], allow: am[1] === 'true' });
    }
  }
  return rules;
}

function parsePortRules(yaml: string): PortRule[] {
  const rules: PortRule[] = [];
  const match = /^ports:\s*$/m.exec(yaml);
  if (!match) return rules;

  const after = yaml.slice(match.index + match[0].length);
  const lines = after.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break;
    const pm = line.match(/^\s+-\s+port:\s*("?\*?"?|\d+)/);
    if (pm && i + 1 < lines.length) {
      const am = lines[i + 1].match(/^\s+allow:\s*(true|false)/);
      if (am) {
        const portVal = pm[1].replace(/"/g, '');
        rules.push({
          port: portVal === '*' ? '*' : Number(portVal),
          allow: am[1] === 'true',
        });
      }
    }
  }
  return rules;
}

function parseToolRules(yaml: string): ToolRule[] {
  const rules: ToolRule[] = [];
  const match = /^tools:\s*$/m.exec(yaml);
  if (!match) return rules;

  const after = yaml.slice(match.index + match[0].length);
  const lines = after.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break;
    const nm = line.match(/^\s+-\s+name:\s*"([^"]*)"/);
    if (nm && i + 1 < lines.length) {
      const am = lines[i + 1].match(/^\s+allow:\s*(true|false)/);
      if (am) rules.push({ name: nm[1], allow: am[1] === 'true' });
    }
  }
  return rules;
}
