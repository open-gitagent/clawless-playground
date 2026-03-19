import * as monaco from 'monaco-editor';

// ─── Extension → Monaco language ID ──────────────────────────────────────────
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  html: 'html', htm: 'html',
  css: 'css',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', svg: 'xml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sh: 'shell', bash: 'shell',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini', conf: 'ini',
  vue: 'html',
  svelte: 'html',
};

const THEME_NAME = 'clawchef-dark';

let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
const models = new Map<string, monaco.editor.ITextModel>();

// ─── Theme ───────────────────────────────────────────────────────────────────
export function initMonacoTheme(): void {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#161b22',
      'editor.foreground': '#e6edf3',
      'editorLineNumber.foreground': '#8b949e',
      'editorLineNumber.activeForeground': '#e6edf3',
      'editor.lineHighlightBackground': '#21262d',
      'editorWidget.background': '#161b22',
      'editorWidget.border': '#30363d',
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function langFromFilename(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Create the single editor instance (call once when the first tab opens). */
export function createEditorInstance(container: HTMLElement): void {
  if (editorInstance) return;
  editorInstance = monaco.editor.create(container, {
    theme: THEME_NAME,
    readOnly: false,
    automaticLayout: true,
    minimap: { enabled: false },
    contextmenu: false,
    fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
    fontSize: 12,
    lineHeight: 1.6 * 12,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    padding: { top: 12, bottom: 12 },
  });
}

/** Create or reuse a model for a file, then switch the editor to it. */
export function openFileModel(filePath: string, filename: string, content: string): void {
  if (!editorInstance) return;

  let model = models.get(filePath);
  if (!model) {
    const lang = langFromFilename(filename);
    model = monaco.editor.createModel(content, lang);
    models.set(filePath, model);
  }

  editorInstance.setModel(model);
}

/** Get the current content of a file's model. */
export function getModelContent(filePath: string): string {
  const model = models.get(filePath);
  return model ? model.getValue() : '';
}

/** Dispose a single file model (when closing a tab). */
export function closeFileModel(filePath: string): void {
  const model = models.get(filePath);
  if (model) {
    model.dispose();
    models.delete(filePath);
  }
}

/** Dispose the editor instance and all models. */
export function disposeAll(): void {
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
  for (const model of models.values()) model.dispose();
  models.clear();
}
