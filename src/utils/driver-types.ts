import { Message, IndexedControllers, ControllerState, GenericGameState } from '@cards-ts/core';
import { HandlerProxy } from '../ismcts-types.js';

/**
 * Game simulation driver for ISMCTS algorithm phases.
 * Used by Selection, Expansion, Simulation, and Backpropagation phases.
 * Generic over ResponseMessage and Controllers to work with any game.
 */
export interface GameDriver<ResponseMessage extends Message, Controllers extends IndexedControllers> {
    /**
     * Current game state with controllers (waiting, completed, state).
     * 
     * Pattern - Controller Access:
     * - gameState.controllers.waiting: Identifies which players are waiting for input
     * - gameState.controllers.completed: Tracks if game is finished
     * - gameState.controllers.state: Current game state enum
     * 
     * Used in Selection phase to determine whose turn it is, and in Backpropagation
     * to identify which player created each node (for negamax perspective).
     */
    gameState: GenericGameState<Controllers>;

    /**
     * Handler proxy for queuing decisions during simulation.
     * 
     * Pattern - Sync Response Queuing:
     * - Queue decisions via handlerProxy methods (e.g., queueSyncResponse)
     * - Process queued decisions with handleSyncResponses()
     * - Enables automatic progression without async operations
     * 
     * Used in Simulation phase with RandomHandler to inject automatic decisions.
     */
    handlerProxy: HandlerProxy<ResponseMessage, Controllers>;

    /**
     * Check if game is waiting for player input.
     * 
     * Pattern - State Machine Pausing:
     * - resume() advances until this returns true (waiting for input)
     * - Returns false when game is completed or in auto-play state machine phases
     * 
     * Used in all phases to detect decision points and game completion.
     */
    isWaitingOnPlayer(): boolean;

    /**
     * Get current controller state snapshot.
     * 
     * Pattern - State Analysis:
     * - Returns state enum or object for game-specific state queries
     * - Use with gameState.controllers.state for full state context
     * 
     * Used in Selection phase for UCB1 scoring and Expansion for creating nodes.
     */
    getState(): ControllerState<Controllers>;

    /**
     * Advance game state machine to next decision point.
     * 
     * Pattern - State Machine Progression:
     * - Runs internal transitions until isWaitingOnPlayer() returns true or game ends
     * - Multiple resume() calls may occur per player action (2-10+ due to effect processing)
     * - Does not process player decisions; handleEvent() is used for that
     * 
     * Used in Simulation phase in loops: resume() -> handleSyncResponses() -> repeat.
     */
    resume(): void;

    /**
     * Apply a player decision to the game state.
     * 
     * Pattern - Decision Application:
     * - Validates ResponseMessage against game rules before merging
     * - Returns true if message was accepted, false if validation failed
     * - Automatically calls internal state machine transitions
     * 
     * Used in Selection phase to execute chosen action, and in Expansion after creating nodes.
     */
    handleEvent(position: number, message: ResponseMessage | undefined, data: unknown): boolean;

    /**
     * Process queued synchronous responses from handlers.
     * 
     * Pattern - Sync Response Processing:
     * - Reads queued responses from handlerProxy
     * - Calls handleEvent() for each queued response
     * - Enables deterministic simulation without async/await
     * 
     * Used in Simulation phase to process RandomHandler decisions in loops.
     */
    handleSyncResponses(): void;

    /**
     * Check if a message would be valid before applying it.
     * 
     * Pattern - Pre-validation:
     * - Returns undefined if message is valid
     * - Returns error string if message is invalid (helps with debugging)
     * - Does not modify game state
     * 
     * Used in Legal Actions Generator to validate candidate actions before returning.
     */
    getValidationError(position: number, message: ResponseMessage): string | undefined;
}
