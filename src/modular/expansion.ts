import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { RoundEndDetector, DriverFactory } from '../adapter-config.js';
import { isWaiting, extractWaitingPlayer } from '../utils/waiting-state-utils.js';
import { createGenericPlayerView } from '../utils/generic-player-view.js';
import { applyAction } from '../utils/driver-orchestrator.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';

/**
 * ISMCTS Expansion Phase Implementation
 * 
 * Implements the expansion phase using the RESUME -> GET LEGAL -> APPLY pattern.
 * Takes a leaf node and expands it by adding one new child node corresponding
 * to an unexplored action from the current determinization.
 * 
 * RESUME -> GET LEGAL -> APPLY PATTERN:
 * 1. RESUME: Call resume() to advance game state to action-ready state
 *    - Processes any pending state machine phases (checkup, knockouts, etc.)
 *    - Advances to next decision point where player input is needed
 * 2. GET LEGAL: Generate legal actions for current determinization
 *    - Uses current player from waiting/turn controllers
 *    - Creates player view with visible information only
 *    - Generates all valid actions for this specific determinization
 * 3. FILTER: Find actions not yet explored as children
 *    - Compares against existing child node actions using JSON serialization
 * 4. SELECT: Randomly choose one unexplored action
 * 5. APPLY: Apply the action to create new game state
 *    - Uses handleEvent() to validate and apply the action
 *    - Creates fresh driver instance to avoid state mutation
 * 6. CREATE: Create new child node with the action and resulting state
 */
export class ISMCTSExpansion<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>,
        private driverFactory: DriverFactory<ResponseMessage, Controllers>,
        private isRoundEnded: RoundEndDetector<Controllers>,
    ) {}
    
    /**
     * Expands a node by adding a new child for an unexplored action.
     * 
     * PRECONDITION:
     * - Input state is WAITING (paused at decision point where player needs to respond)
     * - expectedResponseTypes have already been captured by selection phase
     * 
     * POSTCONDITION:
     * - Returns new child node and NON-WAITING state (after applying action, ready for simulation)
     * - Or null if game is ended or node is fully expanded
     * 
     * PROCESS:
     * 1. RESUME: Call resume() to advance from current non-waiting to next decision point or end
     * 2. CAPTURE: Invoke handler to capture expected response types for next decision
     * 3. SELECT: Generate legal actions and randomly choose unexplored action
     * 4. APPLY: Apply action using orchestration, returning non-waiting state
     * 5. CREATE: Create new child node with the action
     * 
     * @param node - The node to expand (can be root or leaf)
     * @param nonWaitingState - Game state ready for resume (NON-WAITING)
     * @returns Object with new child node and post-action state, or null if fully expanded/game ended
     */
    expand(node: ISMCTSRoot<ResponseMessage> | ISMCTSNode<ResponseMessage>, waitingState: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): { node: ISMCTSNode<ResponseMessage>, state: ControllerState<Controllers> } | null {
        // console.error(`[EXPANSION] expand called with ${expectedResponseTypes.length} response types`);
        // PRECONDITION: waitingState is waiting (paused at decision point), expectedResponseTypes already captured by selection
        if (!isWaiting(waitingState)) {
            throw new Error('[ISMCTS Expansion] Expected state paused at decision point');
        }
        
        // Check if round ended
        if (this.isRoundEnded(waitingState)) {
            return null;
        }
        
        if (!expectedResponseTypes || expectedResponseTypes.length === 0) {
            return null;
        }
        
        // SELECT LEGAL: Generate legal actions for current determinization
        const driver = this.driverFactory(waitingState, []);
        const controllers = driver.gameState.controllers;
        
        // Get current player from waiting controller - ONLY reliable source for whose action we need
        const waitingControllerState = controllers.waiting.get();
        const currentPlayer = extractWaitingPlayer(waitingControllerState);
        
        
        if (currentPlayer < 0) {
            // No one is waiting - should not reach here if selection properly stopped
            return null;
        }
        
        // CREATE player view with controllers
        const handlerData = createGenericPlayerView(controllers, currentPlayer);
        
        const legalActions = this.legalActionsGenerator.generateLegalActions(
            handlerData,
            expectedResponseTypes,
        );
        
        // FILTER: Find unexplored actions
        const unexploredActions = legalActions.filter((action: ResponseMessage) => !node.children.some(child => JSON.stringify(child.lastAction) === JSON.stringify(action)),
        );
        
        if (unexploredActions.length === 0) {
            return null;
        }
        
        // RANDOMLY SELECT and APPLY one unexplored action
        const selectedAction = unexploredActions[Math.floor(Math.random() * unexploredActions.length)];
        
        try {
            // Apply the action (returns NON-WAITING state for simulation to handle resume)
            const newGameState = applyAction(waitingState, selectedAction, currentPlayer, this.driverFactory);
            
            /*
             * CREATE: Create new child node
             * lastPlayer is the player who made this move (currentPlayer)
             * This is used for reward perspective during backpropagation
             */
            const newNode: ISMCTSNode<ResponseMessage> = {
                visits: 0,
                totalReward: 0,
                lastPlayer: currentPlayer,
                children: [],
                parent: node,
                lastAction: selectedAction,
            };
            
            node.children.push(newNode);
            
            // Return new node and non-waiting state (ready for simulation)
            return { node: newNode, state: newGameState };
        } catch (error) {
            /*
             * Action validation failed - throw to indicate iteration failed
             * This will be caught by ISMCTSDecisionStrategy which can fall back to random
             */
            throw new Error(`Expansion failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
