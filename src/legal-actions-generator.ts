import { ControllerState, ControllerHandlerState, Message, IndexedControllers } from '@cards-ts/core';
import { ActionsGenerator, DriverFactory } from './adapter-config.js';
import { validateActionWithDriver } from './utils/driver-orchestrator.js';

/**
 * Legal Actions Generator for ISMCTS
 * 
 * Generates all legal actions available to a player in a given game state.
 * Used by ISMCTS Selection and Expansion phases to determine which actions
 * are valid in the current determinization.
 * 
 * PRECONDITION (generateLegalActions method):
 * - handlerData.turn identifies the player whose actions should be generated
 * - handlerData represents this specific player's view (information visible to them)
 * - All generated actions must be valid for handlerData.turn player
 * - expectedResponseTypes filters to only relevant action types for current phase
 * 
 * POSTCONDITION (generateLegalActions method):
 * - Returns array of ResponseMessage actions valid for handlerData.turn
 * - All returned actions pass validation (tested against game driver)
 * - All returned actions match one of the expectedResponseTypes
 * - No actions from other players should be generated
 * 
 * ACTION GENERATION PROCESS:
 * 1. Check for pending target selection (takes priority)
 * 2. Generate all possible action types (creatures, evolution, supporters, etc.) via ActionsGenerator
 * 3. Validate each action against current game state using DriverFactory
 * 4. Return only actions that pass validation
 * 
 * VALIDATION APPROACH:
 * - Uses injected DriverFactory to create a game driver for testing
 * - Uses getValidationError() to check if action would be accepted
 * - Filters out actions that fail validation
 * - Suppresses validation messages during testing to avoid console spam
 * 
 * DETERMINIZATION AWARENESS:
 * - Actions are generated based on information visible to the current player
 * - Uses HandlerData (player view) rather than full game state
 * - Ensures ISMCTS only considers actions the player could legally make
 */
export class LegalActionsGenerator<ResponseMessage extends Message, Controllers extends IndexedControllers, Handlers = unknown> {
    constructor(
        private actionsGenerator: ActionsGenerator<ResponseMessage, Controllers>,
        private driverFactory: DriverFactory<ResponseMessage, Controllers, Handlers>,
        private reconstructGameState: (handlerData: ControllerHandlerState<Controllers>) => ControllerState<Controllers>,
        private handlers: Handlers[] = [],
    ) {}

    /**
     * Generates all legal actions available to the current player.
     * 
     * PRECONDITION:
     * - handlerData.turn is the player whose actions should be generated
     * - All actions will be generated for handlerData.turn only (NOT other players)
     * 
     * POSTCONDITION:
     * - All returned actions are for handlerData.turn player
     * - All actions pass validation and match expectedResponseTypes
     * 
     * ACTION PRIORITY:
     * 1. Actions matching the expected response types
     * 2. End turn (always available as fallback if in expectedResponseTypes)
     * 
     * VALIDATION PROCESS:
     * - Generates candidate actions based on visible game state via ActionsGenerator
     * - Filters to only include actions with expected response types
     * - Tests each action using temporary game driver via DriverFactory
     * - Returns only actions that pass validation
     * 
     * DETERMINIZATION HANDLING:
     * - Uses HandlerData (player's view) to generate actions
     * - Only considers information visible to the current player
     * - Ensures actions are legal in this specific determinization
     * 
     * @param handlerData - The player's view of the game state (handlerData.turn = player ID)
     * @param expectedResponseTypes - Array of response type strings to filter results (e.g., ['play-card-response', 'attack-response'])
     * @param suppressValidationMessages - Whether to suppress console output during validation (default: true)
     * @returns Array of legal ResponseMessage actions for handlerData.turn player, filtered by expected response types
     */
    generateLegalActions(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[], suppressValidationMessages: boolean = true): ResponseMessage[] {
        /*
         * Get current player from waiting controller (only reliable source - turn can be wrong for non-turn choices)
         * Examples: selecting active after knockout, selecting target - these happen when it's not your turn
         */
        const currentPlayer = handlerData.players.position;

        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] expectedResponseTypes:', expectedResponseTypes);
            console.error('[LegalActionsGenerator] currentPlayer:', currentPlayer);
        }

        // Generate candidate actions using game-specific action generator
        const candidateActions = this.actionsGenerator.generateCandidateActions(handlerData, currentPlayer, expectedResponseTypes);
        
        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] candidateActions count:', candidateActions.length);
            console.error('[LegalActionsGenerator] candidateActions types:', candidateActions.map((a: ResponseMessage) => a.type));
        }

        // Validate all candidate actions
        const validated = this.validateActions(candidateActions, handlerData, currentPlayer, suppressValidationMessages);
        
        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] validated count:', validated.length);
            console.error('[LegalActionsGenerator] validated types:', validated.map(a => a.type));
        }
        
        return validated;
    }

    private validateActions(actions: ResponseMessage[], handlerData: ControllerHandlerState<Controllers>, currentPlayer: number, suppressValidationMessages: boolean = false): ResponseMessage[] {
        // Reconstruct full game state from player view using config callback
        const gameState = this.reconstructGameState(handlerData);
        
        // Filter actions by testing validation
        return actions.filter(action => {
            try {
                // Use the reconstructed game state that includes turnState
                const testState = JSON.parse(JSON.stringify(gameState));
                
                // Create test driver using the injected factory
                const testDriver = this.driverFactory(testState, this.handlers);

                // Test if the action is valid using helper that correctly accesses validators directly
                const validationError = validateActionWithDriver(testDriver, currentPlayer, action);
                const isValid = !validationError;
                
                return isValid;
            } catch (error) {
                // Action failed validation
                return false;
            }
        });
    }
}
