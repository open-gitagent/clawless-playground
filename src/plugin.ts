// ─── Plugin Manager ─────────────────────────────────────────────────────────

import type { ClawContainerPlugin, ClawContainerSDK, TabDefinition } from './types.js';

export class PluginManager {
  private plugins: ClawContainerPlugin[] = [];

  /** Register a plugin, storing it for lifecycle dispatch. */
  register(plugin: ClawContainerPlugin): void {
    this.plugins.push(plugin);
  }

  /** Dispatch onInit to all registered plugins in order. */
  dispatchInit(cc: ClawContainerSDK): void {
    for (const p of this.plugins) p.onInit?.(cc);
  }

  /** Dispatch onReady to all registered plugins in order. */
  dispatchReady(cc: ClawContainerSDK): void {
    for (const p of this.plugins) p.onReady?.(cc);
  }

  /** Dispatch onDestroy to all registered plugins in order. */
  dispatchDestroy(cc: ClawContainerSDK): void {
    for (const p of this.plugins) p.onDestroy?.(cc);
  }

  /** Collect merged extra npm dependencies from all plugins. */
  get mergedServices(): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const p of this.plugins) {
      if (p.services) Object.assign(merged, p.services);
    }
    return merged;
  }

  /** Collect merged extra workspace files from all plugins. */
  get mergedWorkspace(): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const p of this.plugins) {
      if (p.workspace) Object.assign(merged, p.workspace);
    }
    return merged;
  }

  /** Collect merged extra env vars from all plugins. */
  get mergedEnv(): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const p of this.plugins) {
      if (p.env) Object.assign(merged, p.env);
    }
    return merged;
  }

  /** Collect all tab definitions from plugins. */
  get mergedTabs(): TabDefinition[] {
    const tabs: TabDefinition[] = [];
    for (const p of this.plugins) {
      if (p.tabs) tabs.push(...p.tabs);
    }
    return tabs;
  }
}
