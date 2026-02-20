import { ControllerState, IndexedControllers } from '@cards-ts/core';
import { FrameworkControllers } from '../ismcts-types.js';

export function isWaiting<Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
): boolean {
    const waiting = gameState.waiting as Record<string, unknown> | undefined;
    if (typeof waiting?.waiting === 'number') {
        return (waiting.waiting as number) > 0;
    } else if (typeof waiting?.waiting === 'object') {
        return ((waiting.waiting as unknown[]).length) > 0;
    } 
    throw new Error(`Unexpected waiting structure: ${JSON.stringify(waiting?.waiting)}`);
}

export function isWaitingForPlayer<Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    playerIndex: number,
): boolean {
    const waiting = gameState.waiting as Record<string, unknown> | undefined;
    if (typeof waiting?.waiting === 'number') {
        return (waiting.waiting as number) > 0;
    } else if (typeof waiting?.waiting === 'object') {
        return ((waiting.waiting as unknown[]).includes(playerIndex));
    } 
    throw new Error(`Unexpected waiting structure: ${JSON.stringify(waiting?.waiting)}`);
}

/**
 * Extracts the current player from waiting controller state
 * 
 * Waiting controller returns: {waiting: number | number[], responded: number[]}
 * - If waiting is an array, returns the first element
 * - If waiting is a single number N: N players must respond, find first index not in responded
 *   (generates next incrementing index starting at 0 that hasn't responded yet)
 * - If no one is waiting, returns -1
 */
export function extractWaitingPlayer(waitingState: { waiting: number | number[]; responded: number[] }): number {
    const { waiting, responded } = waitingState;
    
    if (Array.isArray(waiting)) {
        return waiting.length > 0 ? waiting[0] : -1;
    }
    
    // waiting is a number: N players need to respond (excluding those in responded)
    if (typeof waiting === 'number' && waiting > 0) {
        // Find first index (starting at 0) that hasn't responded yet
        for (let i = 0; i < waiting; i++) {
            if (!responded.includes(i)) {
                return i;
            }
        }
        // All N players have already responded
        return -1;
    }
    
    return -1;
}
