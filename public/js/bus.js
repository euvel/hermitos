/* Tiny synchronous event bus shared across HERMIT-OS subsystems. */
export class Bus {
  constructor() { this.map = new Map(); this.anySet = new Set(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.map.get(ev).delete(fn); }
  onAny(fn) { this.anySet.add(fn); return () => this.anySet.delete(fn); }   // observe all traffic (real telemetry)
  emit(ev, payload) {
    const s = this.map.get(ev); if (s) for (const fn of s) { try { fn(payload); } catch (e) { console.error(ev, e); } }
    for (const fn of this.anySet) { try { fn(ev, payload); } catch (e) { console.error(ev, e); } }
  }
}
