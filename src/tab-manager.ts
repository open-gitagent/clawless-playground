// ─── Custom Tab Manager ─────────────────────────────────────────────────────

import type { TabDefinition } from './types.js';
import type { UIManager } from './ui.js';

export class TabManager {
  private ui: UIManager;
  private customTabs = new Map<string, { tabEl: HTMLElement; contentEl: HTMLDivElement }>();

  constructor(ui: UIManager) {
    this.ui = ui;
  }

  /** Add a custom tab to the UI. Delegates to UIManager's addCustomTab. */
  addTab(def: TabDefinition): void {
    this.ui.addCustomTab(def);
    // Track the elements so we can remove them later
    const contentEl = document.getElementById(`custom-tab-${def.id}`) as HTMLDivElement | null;
    const tabEl = document.querySelector(`[data-custom-tab-id="${def.id}"]`) as HTMLElement | null;
    if (contentEl && tabEl) {
      this.customTabs.set(def.id, { tabEl, contentEl });
    }
  }

  /** Remove a custom tab from the UI. */
  removeTab(id: string): void {
    this.ui.removeCustomTab(id);
    this.customTabs.delete(id);
  }
}
