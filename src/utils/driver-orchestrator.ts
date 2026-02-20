import { Message, IndexedControllers, ControllerState, ControllerHandlerState } from '@cards-ts/core';
import { DriverFactory, GameAdapterConfig } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { CaptureDecisionStrategy } from '../strategies/capture-decision-strategy.js';
import type { DecisionStrategy } from '../strategies/decision-strategy.js';
import { deepCopyState } from './deep-copy-state.js';
import { extractWaitingPlayer } from './waiting-state-utils.js';
import { GameDriver } from './driver-types.js';
import { createGenericPlayerView } from './generic-player-view.js';

/**
 * Generic driver orchestration patterns for ISMCTS phases.
 * 
 * Each orchestration function matches the exact signature and behavior
 * expected by its calling phase (Expansion or Simulation).
 */

/**
 * Validate an action using the driver's getValidationError method.
 * Uses the same validation path as handleEvent.
 * 
 * @param driver - GameDriver instance with initialized controllers
 * @param playerIndex - Which player is making this action
 * @param action - Action to validate
 * @returns Validation error message, or undefined if valid
 */
export function validateActionWithDriver<ResponseMessage extends Message, Controllers extends IndexedControllers>(
    driver: GameDriver<ResponseMessage, Controllers>,
    playerIndex: number,
    action: ResponseMessage,
): string | undefined {
    return driver.getValidationError(playerIndex, action);
}

/**
 * Apply a single action to advance state without resuming.
 * Returns the NON-WAITING state after action for expansion.
 * 
 * PRECONDITION:
 * - gameState must be WAITING (paused at decision point)
 * 
 * POSTCONDITION:
 * - Returns NON-WAITING state (ready for simulation to resume)
 * 
 * @param gameState - Current game state (should be waiting at decision point)
 * @param action - Action to apply
 * @param playerIndex - Which player is making this action
 * @param driverFactory - Factory function to create drivers (with no-op handlers)
 * @returns New game state after applying action (non-waiting, ready for simulate)
 * @throws Error if action validation fails
 */
export function applyAction<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    action: ResponseMessage,
    playerIndex: number,
    driverFactory: DriverFactory<ResponseMessage, Controllers>,
): ControllerState<Controllers> {
    const stateCopy = deepCopyState(gameState);
    
    // Use no-op handlers (empty array) for action application
    const driver = driverFactory(stateCopy, []) as GameDriver<ResponseMessage, Controllers>;
    
    // Get validation error BEFORE calling handleEvent (getValidationError runs validation fresh)
    const validationError = driver.getValidationError(playerIndex, action);
    if (validationError) {
        throw new Error(`Action validation failed: ${validationError}`);
    }
    
    // Now apply the action with state intact
    const wasValid = driver.handleEvent(playerIndex, action, undefined);
    if (!wasValid) {
        throw new Error('Action application failed after validation passed');
    }
    
    // Return NON-WAITING state (do NOT resume - let simulation handle that)
    return driver.getState();
}

/**
 * Apply a single action and advance to next decision point.
 * Used by Expansion phase to apply one specific action and get the resulting state.
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
    const stateCopy = deepCopyState(gameState);
    
    // Use no-op handlers (empty array) for action application and resumption
    const driver = driverFactory(stateCopy, []) as GameDriver<ResponseMessage, Controllers>;
    
    // Apply the action
    const wasValid = driver.handleEvent(playerIndex, action, undefined);
    if (!wasValid) {
        throw new Error('Action validation failed during expansion');
    }
    
    // Resume to next decision point (or game end)
    driver.resume();
    
    const resultState = driver.getState();
    
    return resultState;
}

/**
 * Apply action, resume to next decision point, and capture expected response types.
 * Used by Selection phase to apply an action and learn what response types are needed next.
 * 
 * PRECONDITION:
 * - gameState must be WAITING at the current decision point
 * - playerIndex is the player making the action
 * - action is valid for this player and state
 * 
 * POSTCONDITION:
 * - Action has been applied
 * - Game state has been resumed to next decision point (or game completion)
 * - Returns new state and the response types that were captured at the decision point
 * 
 * @param gameState - Current game state (must be WAITING)
 * @param action - Action to apply
 * @param playerIndex - Player making the action
 * @param gameAdapterConfig - Configuration with driverFactory and other adapters
 * @returns { newGameState, capturedResponseTypes }
 */
export function applyActionResumeAndCapture<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    action: ResponseMessage,
    playerIndex: number,
    gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
): { newGameState: ControllerState<Controllers>, capturedResponseTypes: (ResponseMessage['type'])[] } {
    const stateCopy = deepCopyState(gameState);
    
    // Create capture strategy to record response types at decision point
    const captureStrategy = new CaptureDecisionStrategy(gameAdapterConfig);
    
    // Create handler that uses capture strategy
    const captureHandler = gameAdapterConfig.createHandler(captureStrategy);
    
    // Create driver with capture handler for both players
    const driver = gameAdapterConfig.driverFactory(stateCopy, [ captureHandler, captureHandler ]) as GameDriver<ResponseMessage, Controllers>;
    
    // Apply the action
    const wasValid = driver.handleEvent(playerIndex, action, undefined);
    if (!wasValid) {
        throw new Error('Action validation failed during applyActionResumeAndCapture');
    }
    
    // Resume to next decision point (capture handler will record response types)
    driver.resume();
    
    // Extract captured response types from the capture strategy
    const capturedResponseTypes = captureStrategy.getCapturedResponseTypes();
    
    return {
        newGameState: driver.getState(),
        capturedResponseTypes: capturedResponseTypes as (ResponseMessage['type'])[],
    };
}

/**
 * Get game state, waiting player, and player view information.
 * Abstraction for inspecting state during selection phase.
 * 
 * When waiting.waiting is:
 * - A number N: N players must respond (not including those in responded array)
 * - An array: Players listed in array must respond
 * 
 * PRECONDITION:
 * - gameState must be WAITING (paused at decision point)
 * 
 * POSTCONDITION:
 * - Returns extracted game state, current waiting player index, and handlerData for that player
 * 
 * @param gameState - Current game state (must be waiting)
 * @param driverFactory - Factory function to create drivers (with no-op handlers)
 * @returns Object with extracted game state, waiting player index, and handlerData for legal action generation
 * @throws Error if game state cannot be read or waiting player is invalid
 */
export function getGameStateAndWaitingPlayer<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers>(
    gameState: ControllerState<Controllers>,
    driverFactory: DriverFactory<ResponseMessage, Controllers>,
): { state: ControllerState<Controllers>, waitingPlayer: number, handlerData: ControllerHandlerState<Controllers> } {
    const stateCopy = deepCopyState(gameState);
    const driver = driverFactory(stateCopy, []) as GameDriver<ResponseMessage, Controllers>;
    
    const waitingState = driver.gameState.controllers.waiting.get();
    
    // Use existing utility to extract waiting player (handles both number and array cases)
    const waitingPlayer = extractWaitingPlayer(waitingState);
    
    // Create player view for legal action generation
    const handlerData = createGenericPlayerView(driver.gameState.controllers, waitingPlayer);
    
    return {
        state: stateCopy,
        waitingPlayer,
        handlerData,
    };
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
    const stateCopy = deepCopyState(gameState);
    
    // Create random strategy and wrap it in handlers for both players
    const randomStrategy = createRandomStrategy();
    const randomHandler = createHandler(randomStrategy);
    const handlers = [ randomHandler, randomHandler ] as unknown[];
    
    // Create driver with random handlers and run until completion or timeout
    const driver = driverFactory(stateCopy, handlers) as GameDriver<ResponseMessage, Controllers>;
    
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
    
    return driver.getState();
}
