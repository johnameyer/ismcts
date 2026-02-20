import { ControllerState, ControllerHandlerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';

/**
 * Pocket-TCG specific game completion utilities.
 * These functions check game end conditions and calculate rewards.
 */

/**
 * Checks if a player has any field cards (creatures).
 */
function playerHasFieldCards(gameState: ControllerState<Controllers>, playerIndex: number): boolean {
    const field = (gameState).field;
    
    if (!field || !field.creatures || !Array.isArray(field.creatures)) {
        return false;
    }
    
    const playerCreatures = field.creatures[playerIndex];
    if (!Array.isArray(playerCreatures)) {
        return false;
    }
    
    return playerCreatures.length > 0;
}

/**
 * Checks if a game has ended based on points, completion flag, or field cards.
 * A game is considered ended when:
 * - Either player has 3+ points, OR
 * - The completed flag is set, OR
 * - Either player has no field cards (out of creatures = loss)
 * 
 * @param gameState - The game state to check
 * @returns true if the game has ended
 */
export function isGameEnded(gameState: ControllerState<Controllers>): boolean {
    const state = gameState;
    const points = (state.points as number[]) || [ 0, 0 ];
    const isCompleted = state.completed || false;
    
    // Check for point-based win
    if (points[0] >= 3 || points[1] >= 3 || isCompleted) {
        return true;
    }
    
    // Check for elimination (no field cards)
    const player0HasCards = playerHasFieldCards(gameState, 0);
    const player1HasCards = playerHasFieldCards(gameState, 1);
    
    return !player0HasCards || !player1HasCards;
}

/**
 * Checks if a game is completed (via completion flag).
 * 
 * @param gameState - The game state to check
 * @returns true if the completed flag is set
 */
export function isGameCompleted(gameState: ControllerState<Controllers>): boolean {
    return ((gameState).completed as boolean) || false;
}

/**
 * Checks if either player has won by reaching 3 points.
 * 
 * @param gameState - The game state to check
 * @returns true if either player has 3+ points
 */
export function hasPlayerWon(gameState: ControllerState<Controllers>): boolean {
    const state = gameState;
    const points = (state.points as number[]) || [ 0, 0 ];
    return points[0] >= 3 || points[1] >= 3;
}

/**
 * Gets the winning player index, or -1 if no winner yet.
 * 
 * @param gameState - The game state to check
 * @returns Player index (0 or 1) if there's a winner, -1 otherwise
 */
export function getWinner(gameState: ControllerState<Controllers>): number {
    const state = gameState;
    const points = (state.points as number[]) || [ 0, 0 ];
    if (points[0] >= 3) {
        return 0; 
    }
    if (points[1] >= 3) {
        return 1; 
    }
    return -1;
}

/**
 * Calculates the outcome from a specific player's perspective.
 * Handles both point-based wins (3+ points) and elimination wins (opponent out of creatures).
 * 
 * @param gameState - The game state to evaluate
 * @param playerIndex - The player to evaluate from (0 or 1)
 * @returns 1.0 for win, 0.0 for loss, 0.5 for draw
 */
export function getRewardForPlayer(gameState: ControllerState<Controllers>, playerIndex: number): number {
    const state = gameState;
    const points = (state.points as number[]) || [ 0, 0 ];
    
    // Check for elimination FIRST (no field cards = loss)
    const player0HasCards = playerHasFieldCards(gameState, 0);
    const player1HasCards = playerHasFieldCards(gameState, 1);
    
    if (!player0HasCards && !player1HasCards) {
        return 0.5; // Both eliminated simultaneously (draw)
    } else if (!player0HasCards) {
        return playerIndex === 0 ? 0.0 : 1.0; // Player 0 eliminated
    } else if (!player1HasCards) {
        return playerIndex === 1 ? 0.0 : 1.0; // Player 1 eliminated
    }
    
    // Check for point-based win
    if (points[0] > points[1]) {
        return playerIndex === 0 ? 1.0 : 0.0;
    } else if (points[1] > points[0]) {
        return playerIndex === 1 ? 1.0 : 0.0;
    }
    
    // Points are tied and both have creatures
    return 0.5; // Draw
}

/**
 * Calculates the timeout/incomplete game reward from a player's perspective.
 * Used when game times out before completion (incomplete game).
 * 
 * Reward scale:
 * - 0.7 if ahead (more points than opponent)
 * - 0.5 if tied (same points as opponent)
 * - 0.3 if behind (fewer points than opponent)
 * 
 * @param gameState - The game state to evaluate
 * @param playerIndex - The player to evaluate from (0 or 1)
 * @returns 0.3 for behind, 0.5 for tied, 0.7 for ahead
 */
export function getTimeoutReward(gameState: ControllerState<Controllers> | ControllerHandlerState<Controllers>, playerIndex: number): number {
    const state = gameState;
    const points = (state.points as number[]) || [ 0, 0 ];
    
    if (playerIndex === 0) {
        if (points[0] < points[1]) {
            return 0.3; // Behind
        } else if (points[0] > points[1]) {
            return 0.7; // Ahead
        }
    } else {
        if (points[1] < points[0]) {
            return 0.3; // Behind
        } else if (points[1] > points[0]) {
            return 0.7; // Ahead
        }
    }
    
    return 0.5; // Tied
}
