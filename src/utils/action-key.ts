import { Message } from '@cards-ts/core';

const keyCache = new WeakMap<Message, number>();

function hashN(h: number, n: number): number {
    return (Math.imul(h, 33) ^ n) >>> 0;
}

function hashS(h: number, s: string): number {
    for (let i = 0; i < s.length; i++) {
        h = hashN(h, s.charCodeAt(i));
    }
    return h;
}

function hashVal(h: number, v: unknown): number {
    if (typeof v === 'number') {
        return hashN(h, v); 
    }
    if (typeof v === 'string') {
        return hashS(h, v); 
    }
    if (typeof v === 'boolean') {
        return hashN(h, v ? 1 : 0); 
    }
    if (Array.isArray(v)) {
        h = hashN(h, v.length);
        for (const item of v) {
            h = hashVal(h, item); 
        }
        return h;
    }
    if (v !== null && typeof v === 'object') {
        for (const k of Object.keys(v).sort()) {
            h = hashS(h, k);
            h = hashVal(h, (v as Record<string, unknown>)[k]);
        }
    }
    return h;
}

/**
 * Returns a stable numeric hash for an action.
 * Excludes `components` (display-only) so keys reflect game semantics only.
 * Cached per object instance via WeakMap; nodes benefit since they're persistent.
 */
export function getActionKey(action: Message): number {
    const cached = keyCache.get(action);
    if (cached !== undefined) {
        return cached; 
    }
    let h = 5381;
    const a = action as Record<string, unknown>;
    for (const k of Object.keys(a)
        .filter(k => k !== 'components')
        .sort()) {
        h = hashS(h, k);
        h = hashVal(h, a[k]);
    }
    keyCache.set(action, h);
    return h;
}

/**
 * Returns true if two actions are semantically equal (same game content).
 * Hash excludes `components` (display-only), so this is game-semantic equality.
 * 32-bit collision probability is ~1/4B per pair — negligible for ISMCTS fan-out sizes.
 */
export function actionsEqual(a: Message, b: Message): boolean {
    return getActionKey(a) === getActionKey(b);
}
