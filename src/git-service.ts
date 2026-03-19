// ─── GitHub API Git Service ──────────────────────────────────────────────────
// Clone repos via Trees API, push changes via Git Data API.
// Runs entirely in-browser using fetch() — no git binary needed.

export interface GitFile {
  path: string;
  content: string;
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

const API_BASE = 'https://api.github.com';

export class GitService {
  private token: string;
  private owner: string;
  private repo: string;
  private branch: string;

  constructor(token: string, owner: string, repo: string, branch = 'main') {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  /** Extract owner/repo from a GitHub URL. */
  static parseRepoUrl(url: string): RepoInfo {
    // Supports: https://github.com/owner/repo, https://github.com/owner/repo.git,
    // github.com/owner/repo, owner/repo
    const cleaned = url.trim().replace(/\.git\s*$/, '').replace(/\/+$/, '');
    const ghMatch = cleaned.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) return { owner: ghMatch[1], repo: ghMatch[2] };

    // owner/repo shorthand
    const shortMatch = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };

    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`GitHub API ${resp.status}: ${resp.statusText} — ${body.slice(0, 300)}`);
    }
    return resp.json() as Promise<T>;
  }

  /** Detect the default branch of the repo. */
  async detectDefaultBranch(): Promise<string> {
    const repo = await this.api<{ default_branch: string }>(
      `/repos/${this.owner}/${this.repo}`,
    );
    this.branch = repo.default_branch;
    return this.branch;
  }

  /** Fetch the full file tree + contents from the repo. */
  async fetchRepoTree(): Promise<GitFile[]> {
    // Get the tree SHA for the branch
    const ref = await this.api<{ object: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/ref/heads/${this.branch}`,
    );
    const commitSha = ref.object.sha;

    const commit = await this.api<{ tree: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/commits/${commitSha}`,
    );
    const treeSha = commit.tree.sha;

    // Get recursive tree
    const tree = await this.api<{
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated: boolean;
    }>(`/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`);

    // Fetch blob contents for files (skip large files > 1MB)
    const files: GitFile[] = [];
    const blobs = tree.tree.filter(
      (n) => n.type === 'blob' && (n.size ?? 0) < 1_048_576,
    );

    // Batch fetch in parallel (max 10 concurrent)
    const batchSize = 10;
    for (let i = 0; i < blobs.length; i += batchSize) {
      const batch = blobs.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (blob) => {
          try {
            const data = await this.api<{ content: string; encoding: string }>(
              `/repos/${this.owner}/${this.repo}/git/blobs/${blob.sha}`,
            );
            if (data.encoding === 'base64') {
              return { path: blob.path, content: atob(data.content.replace(/\n/g, '')) };
            }
            return { path: blob.path, content: data.content };
          } catch {
            return null; // Skip files that fail
          }
        }),
      );
      for (const r of results) {
        if (r) files.push(r);
      }
    }

    return files;
  }

  /**
   * Push file changes as a single atomic commit.
   * Creates blobs → tree → commit → updates ref.
   */
  async pushChanges(files: GitFile[], message: string): Promise<string> {
    // 1. Get current commit SHA for the branch
    const ref = await this.api<{ object: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/ref/heads/${this.branch}`,
    );
    const parentSha = ref.object.sha;

    // 2. Create blobs for each file
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const file of files) {
      const blob = await this.api<{ sha: string }>(
        `/repos/${this.owner}/${this.repo}/git/blobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
        },
      );
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    // 3. Create tree based on parent commit's tree
    const parentCommit = await this.api<{ tree: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/commits/${parentSha}`,
    );
    const newTree = await this.api<{ sha: string }>(
      `/repos/${this.owner}/${this.repo}/git/trees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: parentCommit.tree.sha,
          tree: treeEntries,
        }),
      },
    );

    // 4. Create commit
    const newCommit = await this.api<{ sha: string }>(
      `/repos/${this.owner}/${this.repo}/git/commits`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [parentSha],
        }),
      },
    );

    // 5. Update ref
    await this.api(
      `/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha }),
      },
    );

    return newCommit.sha;
  }

  get repoOwner(): string { return this.owner; }
  get repoName(): string { return this.repo; }
  get repoBranch(): string { return this.branch; }
}
