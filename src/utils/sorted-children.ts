import { Message } from '@cards-ts/core';
import { ISMCTSNode } from '../ismcts-node.js';

/** Binary search: returns true if `key` exists in sorted numeric `keys` array. */
export function sortedHas(keys: number[], key: number): boolean {
    let lo = 0;
    let hi = keys.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (keys[mid] === key) {
            return true; 
        }
        if (keys[mid] < key) {
            lo = mid + 1; 
        } else {
            hi = mid - 1; 
        }
    }
    return false;
}

/** Insert a child into the children array maintaining sort order by lastActionKey. */
export function insertSorted<T extends Message>(children: ISMCTSNode<T>[], child: ISMCTSNode<T>): void {
    let lo = 0;
    let hi = children.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (children[mid].lastActionKey < child.lastActionKey) {
            lo = mid + 1; 
        } else {
            hi = mid; 
        }
    }
    children.splice(lo, 0, child);
}
