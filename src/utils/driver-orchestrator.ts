import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { DriverFactory } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import type { DecisionStrategy } from '../strategies/decision-strategy.js';

/**
 * Generic driver orchestration patterns for ISMCTS phases.
 *
 * GameContext (game-context.ts) now owns the selection/expansion driver
 * lifecycle - applyAction/resumeAndCapture reuse one driver per tree-depth
 * level instead of building a fresh one per call, which is what
 * validateActionWithDriver, the standalone applyAction, applyActionResumeAndCapture,
 * and getGameStateAndWaitingPlayer used to do. Those four had zero remaining
 * callers (confirmed via repo-wide grep) once GameContext took over and were
 * removed as dead code - keeping them around risked a future caller reaching
 * for the slower non-driver-reusing pattern by mistake.
 *
 * What's left here is what's still actually used outside GameContext:
 * - applyActionAndResume: the heuristic "would this action win immediately"
 *   check in adapter.ts, which builds its own short-lived driver per
 *   candidate action (not part of the main selection/expansion/simulation
 *   loop, so not folded into GameContext).
 * - simulateToCompletion: the rollout phase's own driver, which needs
 *   different (random-decision) handlers than GameContext's
 *   capture-handler-equipped driver, so it can't reuse a GameContext either.
 */

/**
 * Apply a single action and advance to next decision point.
 * Used by the "guaranteed immediate win" heuristic check in adapter.ts to
 * apply one candidate action and see if it ends the game.
 *
 * PRECONDITION:
 * - gameState must be WAITING (paused at decision point)
 *
 * POSTCONDITION:
 * - Returns NON-WAITING state (ready for simulation)
 *
 * @param gameState - Current game state (should be waiting at decision point)
 * @param action - Action to apply
 * @param playerIndex - Which player is making this action
 * @param driverFactory - Factory function to create drivers (with no-op handlers)
 * @returns New game state after applying action and resuming
 * @throws Error if action validation fails or game already ended
 */
export function applyActionAndResume<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    action: ResponseMessage,
    playerIndex: number,
    driverFactory: DriverFactory<ResponseMessage, Controllers>,
): ControllerState<Controllers> {
    // driverFactory (withDeepCopyWrapper) copies state internally
    const driver = driverFactory(gameState, []);

    // Apply the action
    const wasValid = driver.handleEvent(playerIndex, action, undefined);
    if (!wasValid) {
        throw new Error('Action validation failed during expansion');
    }

    // Resume to next decision point (or game end)
    driver.resume();

    /*
     * getRawState() instead of getState(): the caller (adapter.ts's
     * findGuaranteedImmediateWinningAction) only reads isGameEnded/
     * getRewardForPlayer off the result to decide whether this candidate
     * action wins immediately - nothing clones this state forward, and
     * (same reasoning as GameContext's fix) pocket-tcg never needs
     * reconstruct()'s type-restoration.
     */
    return driver.getRawState();
}

/**
 * Run game to completion with random decision making.
 * Used by Simulation phase to play out from a non-waiting state to completion.
 *
 * PRECONDITION:
 * - gameState must be NON-WAITING (post-action state, ready for resume)
 *
 * POSTCONDITION:
 * - Plays game to completion or timeout
 * - Returns final game state for reward calculation
 *
 * @param gameState - Current game state (must NOT be waiting)
 * @param createRandomStrategy - Factory to create RandomDecisionStrategy
 * @param createHandler - Factory to wrap strategy in a game handler
 * @param driverFactory - Factory function to create drivers
 * @param maxDepth - Maximum depth/moves before timeout (default 50)
 * @returns Final game state after simulation completes or times out
 */
export function simulateToCompletion<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    createRandomStrategy: () => DecisionStrategy<ResponseMessage, Controllers>,
    // TODO properly type
    createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => unknown,
    driverFactory: DriverFactory<ResponseMessage, Controllers>,
    maxDepth: number,
): ControllerState<Controllers> {
    // driverFactory (withDeepCopyWrapper) copies state internally
    const randomStrategy = createRandomStrategy();
    const randomHandler = createHandler(randomStrategy);
    const handlers = [ randomHandler, randomHandler ] as unknown[];
    const driver = driverFactory(gameState, handlers);

    let moveCount = 0;
    /*
     * Process auto-phases (knockouts, etc.) even if not initially waiting
     * Call resume() at least once to ensure state machine processes auto-phases
     * Then loop while waiting on player for actual game decisions
     */
    driver.handleSyncResponses();
    driver.resume();
    moveCount++;

    while (driver.isWaitingOnPlayer() && moveCount < maxDepth) {
        driver.handleSyncResponses();
        driver.resume();
        moveCount++;
    }

    // getRawState() instead of getState(): the caller (simulation.ts's
    // simulate()) only reads specific fields via isRoundEnded/getRoundReward/
    // getTimeoutReward to compute a scalar reward - nothing clones this
    // forward or needs typed instances restored.
    return driver.getRawState();
}
