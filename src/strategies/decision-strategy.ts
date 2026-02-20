import { ControllerHandlerState, IndexedControllers, Message } from '@cards-ts/core';

/**
 * Generic Decision Strategy Interface
 * Generic over ResponseMessage type to work with any game.
 * 
 * Any AI strategy (ISMCTS, Random, Capture, etc.) implements this interface.
 * Strategies are completely game-agnostic - they work with abstract HandlerData
 * and generic response type strings.
 * 
 * The strategy's job:
 * - Analyze the game state (provided as opaque HandlerData)
 * - Choose an action from the expectedResponseTypes
 * - Return a game-specific ResponseMessage
 * 
 * The strategy does NOT:
 * - Know which game is being played
 * - Know the structure of ResponseMessage (game-specific handlers wrap responses)
 * - Import game-specific types
 */
export interface DecisionStrategy<ResponseMessage extends Message, Controllers extends IndexedControllers> {
    /**
     * Decide which action to take given the current game state and available options.
     *
     * @param handlerData - Game-specific view of current state (opaque to strategy)
     * @param expectedResponseTypes - Array of valid response type strings (e.g., ['attack-response', 'end-turn-response'])
     * @returns Game-specific ResponseMessage action, or null if no action available
     */
    getAction(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null;
}
