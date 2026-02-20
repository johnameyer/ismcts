import { Message, IndexedControllers, ControllerHandlerState, ControllerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { deepCopyState } from '../utils/deep-copy-state.js';
import { calculateAvgScore } from '../utils/ismcts-node-utils.js';
import { isWaiting, isWaitingForPlayer } from '../utils/waiting-state-utils.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { printTree } from '../utils/tree-debug.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { ISMCTSBackpropagation } from './backpropagation.js';
import { ISMCTSSimulation } from './simulation.js';
import { ISMCTSExpansion } from './expansion.js';
import { ISMCTSSelection } from './selection.js';
import { ISMCTSRoot } from '../ismcts-node.js';
import { ISMCTSConfig, DEFAULT_ISMCTS_CONFIG } from './ismcts-config.js';

export class ISMCTS<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    public legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private determinization;

    private selection: ISMCTSSelection<ResponseMessage, Controllers>;

    private expansion: ISMCTSExpansion<ResponseMessage, Controllers>;

    private simulation: ISMCTSSimulation<ResponseMessage, Controllers>;

    private backpropagation: ISMCTSBackpropagation<ResponseMessage>;

    constructor(
        public gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
        this.determinization = gameAdapterConfig.determinization;

        this.selection = new ISMCTSSelection(this.legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded, gameAdapterConfig);
        this.expansion = new ISMCTSExpansion(this.legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded);
        this.simulation = new ISMCTSSimulation(gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded, gameAdapterConfig.getRoundReward, gameAdapterConfig, gameAdapterConfig.getTimeoutReward);
        this.backpropagation = new ISMCTSBackpropagation();
    }

    getBestActionFromHandlerData(handlerData: ControllerHandlerState<Controllers>, responseTypes: readonly (ResponseMessage['type'])[], config: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG): ResponseMessage | null {
        // Check for only one legal action - return immediately
        const currentLegalActions = this.legalActionsGenerator.generateLegalActions(handlerData, responseTypes);
        
        if (currentLegalActions.length === 0) {
            return null;
        }
        
        if (currentLegalActions.length === 1) {
            return currentLegalActions[0];
        }
        
        // Multiple legal actions - run MCTS to find best one
        const actions = this.getActionsFromHandlerData(handlerData, responseTypes, config);
        
        if (actions.length === 0) {
            // No tree actions, fall back to first legal action
            return currentLegalActions[0];
        }
        
        return this.selectBestFromActions(actions);
    }

    getActionsFromHandlerData(handlerData: ControllerHandlerState<Controllers>, responseTypes: readonly (ResponseMessage['type'])[], config: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG): { action: ResponseMessage | null, score: number }[] {
        // TODO If only one legal action, return it immediately
        const currentPlayer = handlerData.players.position;
    
        const root = this.createRootNode();
        
        for (let i = 0; i < config.iterations; i++) {
            const gameState = this.determinization.determinize(handlerData);
            this.runSingleIteration(root, gameState, config.maxDepth, responseTypes, currentPlayer);
        }
        
        const actions = this.getAllActionsWithScores(root);
        return actions.sort((a, b) => b.score - a.score); // Sort by score descending
    }

    getBestAction(gameState: ControllerState<Controllers>, playerIndex: number, expectedResponseTypes: readonly (ResponseMessage['type'])[], config: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG): ResponseMessage | null {
        const actions = this.getActions(gameState, playerIndex, expectedResponseTypes, config);
        return this.selectBestFromActions(actions);
    }

    getActions(waitingGameState: ControllerState<Controllers>, playerIndex: number, expectedResponseTypes: readonly (ResponseMessage['type'])[], config: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG): { action: ResponseMessage, score: number }[] {
        if (!isWaitingForPlayer(waitingGameState, playerIndex)) {
            throw new Error(`Game state is not waiting for player ${playerIndex}`);
        }
        
        // TODO If only one legal action, return it immediately
        const root = this.createRootNode();

        for (let i = 0; i < config.iterations; i++) {
            /*
             * Deep copy state for each iteration to prevent cross-iteration contamination
             * Process EVERY iteration independently: copy input, clean waiting, run iteration
             */
            const iterationState = deepCopyState(waitingGameState);
            
            this.runSingleIteration(root, iterationState, config.maxDepth, expectedResponseTypes, playerIndex);
        }
        
        const actions = this.getAllActionsWithScores(root);
        
        return actions.sort((a, b) => b.score - a.score); // Sort by score descending
    }

    private createRootNode(): ISMCTSRoot<ResponseMessage> {
        // Root node: container for child action nodes with visit tracking for UCB1
        return {
            visits: 0,
            children: [],
        };
    }


    private runSingleIteration(root: ISMCTSRoot<ResponseMessage>, gameState: ControllerState<Controllers>, maxDepth: number, initialResponseTypes: readonly (ResponseMessage['type'])[], playerIndex: number): void {
        if (!isWaiting(gameState)) {
            throw new Error('Game state should be waiting but is not');
        }
        
        /*
         * PRECONDITION: gameState should be waiting (paused at decision point)
         * SELECTION: Returns waiting state ready for action + expectedResponseTypes
         */
        const { node: selectedNode, state: postSelectionState, expectedResponseTypes } = this.selection.select(root, gameState, initialResponseTypes);
        
        // Check if round ended during selection
        if (this.gameAdapterConfig.isRoundEnded(postSelectionState)) {
            // Only backprop if selectedNode is not root (root can't be backpropped)
            if ('parent' in selectedNode) {
                /*
                 * Use selectedNode.lastPlayer for reward calculation because this node represents
                 * an action taken by that player. Reward must be from that player's perspective,
                 * then negamax will flip signs during backpropagation.
                 */
                const reward = this.gameAdapterConfig.getRoundReward(postSelectionState, selectedNode.lastPlayer);
                this.backpropagation.backpropagate(selectedNode, reward);
            }
            return;
        }
        
        // EXPANSION: Takes waiting state + response types, returns node and state (or null if fully expanded/game ended)
        const expansionResult = this.expansion.expand(selectedNode, postSelectionState, expectedResponseTypes);
        
        if (!expansionResult) {
            /*
             * Node is fully explored or game ended - no new expansion possible
             * Only backprop if selectedNode is not root
             */
            if ('parent' in selectedNode) {
                /*
                 * Use selectedNode.lastPlayer for reward calculation because this node represents
                 * an action taken by that player. Reward must be from that player's perspective,
                 * then negamax will flip signs during backpropagation.
                 */
                const reward = this.gameAdapterConfig.getRoundReward(postSelectionState, selectedNode.lastPlayer);
                this.backpropagation.backpropagate(selectedNode, reward);
            }
            return;
        }
        
        // SIMULATION: Takes non-waiting state, resumes and simulates to completion
        const { node: expandedNode, state: postExpansionState } = expansionResult;
        
        const isNode = expandedNode && 'lastPlayer' in expandedNode;
        
        const reward = this.simulation.simulate(postExpansionState, isNode ? expandedNode.lastPlayer : playerIndex, maxDepth);
        
        this.backpropagation.backpropagate(expandedNode, reward);
    }

    private selectBestActionWithScore(root: ISMCTSRoot<ResponseMessage>): { action: ResponseMessage | null, score: number } {
        let bestChild = root.children[0];
        let bestAverageReward = calculateAvgScore(bestChild);
        
        for (const child of root.children) {
            const averageReward = calculateAvgScore(child);
            if (averageReward > bestAverageReward) {
                bestChild = child;
                bestAverageReward = averageReward;
            }
        }
        
        return { action: bestChild.lastAction || null, score: bestAverageReward };
    }

    private getAllActionsWithScores(root: ISMCTSRoot<ResponseMessage>): { action: ResponseMessage, score: number, visits: number }[] {
        if (process.env.DEBUG_TREE === 'true') {
            console.log('\n[TREE-STRUCTURE] Final MCTS tree:');
            printTree(root);
        }
        
        const result = root.children.map(child => ({
            action: child.lastAction || null,
            score: calculateAvgScore(child),
            visits: child.visits,
        }));
        
        return result;
    }

    private selectBestFromActions(actions: { action: ResponseMessage | null, score: number, visits?: number }[]): ResponseMessage | null {
        if (actions.length === 0) {
            return null; 
        }
        
        if (actions.length > 1 && actions[0].score < actions[1].score) {
            throw new Error('BADDD!');
        }

        // Log top action scores if debug flag set
        if (process.env.LOG_ISMCTS_SCORES === 'true') {
            console.log(`[ISMCTS] ${actions.length} actions evaluated:`);
            actions.slice(0, 5).forEach((a, i) => {
                const actionType = (a.action)?.type || 'unknown';
                const visits = a.visits || 0;
                const score = a.score.toFixed(4);
                
                // Extract action params, omitting 'type' and 'components'
                let params = '';
                try {
                    const actionCopy = { ...a.action };
                    delete actionCopy.type;
                    delete actionCopy.components;
                    const paramEntries = Object.entries(actionCopy);
                    if (paramEntries.length > 0) {
                        params = '{' + paramEntries.map(([ k, v ]) => `${k}=${v}`).join(',') + '}';
                    }
                } catch {
                    // Silent fail
                }
                
                const paramStr = params ? ` ${params}` : '';
                console.log(`  ${i + 1}. ${actionType}${paramStr} | score=${score} | visits=${visits}`);
            });
        }

        return actions[0].action;
    }

    debugSearchTree(gameState: ControllerState<Controllers>, playerIndex: number, expectedResponseTypes: readonly (ResponseMessage['type'])[], config: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG): ISMCTSRoot<ResponseMessage> {
        if (!isWaitingForPlayer(gameState, playerIndex)) {
            throw new Error(`Game state is not waiting for player ${playerIndex}`);
        }
        const root = this.createRootNode();

        for (let i = 0; i < config.iterations; i++) {
            const iterationState = deepCopyState(gameState);
            this.runSingleIteration(root, iterationState, config.maxDepth, expectedResponseTypes, playerIndex);
        }
        
        return root;
    }
}
