import { ClawContainer } from './sdk.js';

// ─── Boot sequence ───────────────────────────────────────────────────────────

const cc = new ClawContainer('#app');
cc.start().catch(console.error);

// Expose SDK globally for console access and external scripts
(window as any).clawcontainer = cc;
