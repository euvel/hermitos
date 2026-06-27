/* Tiny synchronous event bus shared across HERMIT-OS subsystems. */
export class Bus {
  constructor() { this.map = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.map.get(ev).delete(fn); }
  emit(ev, payload) { const s = this.map.get(ev); if (s) for (const fn of s) { try { fn(payload); } catch (e) { console.error(ev, e); } } }
}
