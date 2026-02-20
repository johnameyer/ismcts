import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { getUCB1Score } from '../utils/ismcts-node-utils.js';
import { deepCopyState } from '../utils/deep-copy-state.js';
import { isWaiting } from '../utils/waiting-state-utils.js';
import { applyActionResumeAndCapture, getGameStateAndWaitingPlayer } from '../utils/driver-orchestrator.js';
import { RoundEndDetector, DriverFactory, GameAdapterConfig } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';

/**
 * ISMCTS Selection Phase Implementation
 * 
 * Implements the selection phase using the RESUME -> GET LEGAL -> APPLY pattern.
 * This phase traverses the tree from root to leaf using UCB1 selection policy,
 * but only considers children whose actions are valid in the current determinization.
 * 
 * PRECONDITION (select method):
 * - Input gameState.waiting.waiting MUST be empty [] (game state ready for resume)
 * - Input gameState.waiting.responded can have data
 * - Game state is clean and ready to advance (not paused mid-decision)
 * - Root node is passed as first argument
 * 
 * POSTCONDITION (select method):
 * - Returns leaf node and paused state (waiting.waiting has player index)
 * - Returned state is ready to pass to expand() or simulate()
 * - State is paused at a decision point or game is completed
 * 
 * DETERMINIZATION-AWARE SELECTION:
 * At each tree level, the selection must account for the current determinization
 * because actions that were legal in previous determinizations may not be legal now.
 * Only children with currently legal actions are considered for UCB1 selection.
 * 
 * RESUME -> GET LEGAL -> APPLY PATTERN PER LEVEL:
 * 1. RESUME: Call resume() to advance game state to action-ready state
 *    - Skipped for root node (already at decision point)
 *    - Processes state machine phases to reach next decision point
 * 2. GET LEGAL: Generate legal actions for current determinization
 *    - Determines current player from waiting/turn controllers
 *    - Creates player view with visible information only
 *    - Generates valid actions for this specific determinization
 * 3. FILTER: Only consider children with currently legal actions
 *    - Compares child actions against current legal actions
 *    - Uses JSON serialization for action comparison
 * 4. SELECT: Choose child with highest UCB1 score among valid children
 *    - UCB1 balances exploitation (high reward) vs exploration (low visits)
 *    - Unvisited legal actions indicate expansion opportunity
 * 5. APPLY: Apply the selected child's action to advance state
 *    - Uses handleEvent() to validate and execute the action
 *    - Advances to next tree level with updated game state
 * 6. Repeat until reaching a leaf node or no valid children
 */
export class ISMCTSSelection<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>,
        private driverFactory: DriverFactory<ResponseMessage, Controllers>,
        private isRoundEnded: RoundEndDetector<Controllers>,
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {}
    
    /**
     * Selects a leaf node using UCB1 policy with determinization-aware action filtering.
     * 
     * PRECONDITION:
     * - currentState.waiting.waiting MUST be empty []
     * - expectedResponseTypes MUST specify valid actions for root node at this phase
     * 
     * POSTCONDITION:
     * - Returns leaf node and state paused at decision point or game end
     * 
     * RESUME -> GET LEGAL -> APPLY PATTERN IMPLEMENTATION:
     * 
     * RESUME PHASE (skipped for root):
     * - Creates driver from current state and calls resume()
     * - Advances through state machine phases to next decision point
     * - Ensures game is ready for player action
     * 
     * GET LEGAL PHASE:
     * - Determines current player from waiting/turn controllers
     * - Creates player view with information visible to that player
     * - Generates all legal actions for this determinization
     * 
     * FILTER PHASE:
     * - Compares child node actions against currently legal actions
     * - Only children with legal actions are considered for selection
     * - Uses JSON serialization for precise action matching
     * 
     * SELECTION TERMINATION:
     * - Stops when unexplored legal actions exist (expansion opportunity)
     * - Stops when no valid children exist (terminal or invalid state)
     * - Otherwise selects best child via UCB1 and continues descent
     * 
     * APPLY PHASE:
     * - Uses handleEvent() to validate and execute selected action
     * - Advances game state to reflect action's effects
     * - Continues tree descent with updated state
     * 
     * @param root - The root node of the ISMCTS tree
     * @param currentState - The current determinized game state (pre-resume for root)
     * @param expectedResponseTypes - Valid response types for root at this game phase
     * @returns Object with selected leaf node and game state at that node
     */
    select(root: ISMCTSRoot<ResponseMessage>, currentState: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): { node: ISMCTSRoot<ResponseMessage> | ISMCTSNode<ResponseMessage>, state: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[] } {
        /*
         * PRECONDITION: input state should be waiting (paused at decision point)
         * POSTCONDITION: returns waiting state ready for action + expectedResponseTypes for expansion
         */

        // Validate precondition: state must be waiting
        if (!isWaiting(currentState)) {
            throw new Error('Selection precondition failed: game state is not waiting for a player response');
        }

        let currentNode = root;
        let currentGameState = deepCopyState(currentState);
        let latestResponseTypes = expectedResponseTypes;
        const selectionDepth = 0;
        
        while (true) {
            // GET LEGAL: Generate valid actions for current state (which is waiting)
            const { state: gameState, waitingPlayer: currentPlayer, handlerData } = getGameStateAndWaitingPlayer(currentGameState, this.driverFactory);

            // Check if round is completed before generating legal actions
            if (this.isRoundEnded(gameState)) {
                return { node: currentNode, state: currentGameState, expectedResponseTypes: [] };
            }

            if (currentPlayer < 0) {
                throw new Error('Not waiting for any player?');
            }
            
            // Use expected response types for this decision point
            const legalActions = this.legalActionsGenerator.generateLegalActions(handlerData, latestResponseTypes);
            
            // FILTER: Only consider children with currently legal actions
            const validChildren = currentNode.children.filter(child => {
                const isLegal = legalActions.some(legal => legal.constructor.name === child.lastAction?.constructor.name
                    && JSON.stringify(legal) === JSON.stringify(child.lastAction),
                );
                return isLegal;
            });
            
            // CHECK: Find unexplored legal actions
            const exploredActions = validChildren.map(child => child.lastAction);
            const unexploredActions = legalActions.filter(action => !exploredActions.some(explored => JSON.stringify(explored) === JSON.stringify(action)),
            );
            
            // If there are unexplored actions, break for expansion
            if (unexploredActions.length > 0) {
                // Return the current waiting state with the response types for this decision point
                return { node: currentNode, state: currentGameState, expectedResponseTypes: latestResponseTypes };
            }
            
            if (validChildren.length === 0) {
                break; // No valid moves, treat as terminal
            }
            
            // SELECT: Choose child with highest UCB1 score among explored actions
            const selectedChild = this.selectBestChild(validChildren);
            
            /*
             * APPLY, RESUME, and CAPTURE: Use orchestrator to apply action, resume to next decision point, 
             * and capture what response types are expected
             */
            const { newGameState, capturedResponseTypes } = applyActionResumeAndCapture(
                currentGameState,
                selectedChild.lastAction,
                currentPlayer,
                this.gameAdapterConfig,
            );
            
            currentGameState = newGameState;
            currentGameState = deepCopyState(currentGameState);
            latestResponseTypes = capturedResponseTypes as readonly (ResponseMessage['type'])[];
            currentNode = selectedChild;
            
        }
        
        // Terminal node: use the latest response types we have
        return { node: currentNode, state: currentGameState, expectedResponseTypes: latestResponseTypes };
    }
    
    /**
     * Selects the child node with the highest UCB1 score.
     * UCB1 balances exploitation (high average reward) with exploration (low visit count).
     * 
     * @param children - Array of valid child nodes to choose from
     * @returns The child node with the highest UCB1 score
     */
    private selectBestChild(children: ISMCTSNode<ResponseMessage>[]): ISMCTSNode<ResponseMessage> {
        if (children.length === 0) {
            throw new Error('selectBestChild called with empty children array');
        }
        
        let bestChild = children[0];
        let bestScore = getUCB1Score(bestChild);

        for (const child of children) {
            const score = getUCB1Score(child);
            if (score > bestScore) {
                bestScore = score;
                bestChild = child;
            }
        }

        return bestChild;
    }
}
