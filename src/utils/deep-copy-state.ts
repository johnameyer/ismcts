import { Serializable } from '@cards-ts/core';

/**
 * Deep copies game state for ISMCTS determinization.
 * 
 * DETERMINIZATION PURPOSE:
 * Creates independent copies of game state for each ISMCTS iteration.
 * This ensures that determinization (resolving hidden information) remains
 * consistent throughout a single iteration while allowing different
 * determinizations across iterations.
 * 
 * COPY BEHAVIOR:
 * - Uses JSON serialization for deep copying
 * - Copies all state data including controller state
 * - Does not copy controller method instances (they are recreated)
 * - Preserves all game state structure and relationships
 * 
 * USAGE IN ISMCTS:
 * - Called at the start of each iteration to create determinized state
 * - Ensures Selection, Expansion, and Simulation phases use consistent state
 * - Prevents cross-iteration state contamination
 * 
 * @param state - The game state to deep copy (typically ControllerState<Controllers>)
 * @returns Deep copy of the state with all data preserved but no method references
 */
export function deepCopyState<T extends Serializable>(state: T): T {    
    return JSON.parse(JSON.stringify(state));
}
