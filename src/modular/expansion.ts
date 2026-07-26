import { isDeepStrictEqual } from 'node:util';
import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { RoundEndDetector, GameAdapterConfig } from '../adapter-config.js';
import { isWaiting } from '../utils/waiting-state-utils.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';
import { getActionKey } from '../utils/action-key.js';
import { GameContext } from '../utils/game-context.js';

/**
 * ISMCTS Expansion Phase Implementation
 *
 * Implements the expansion phase using the RESUME -> GET LEGAL -> APPLY pattern.
 * Takes a leaf node and expands it by adding one new child node corresponding
 * to an unexplored action from the current determinization.
 *
 * Uses GameContext to unify driver creation for inspection, validation, and action
 * application — one driver creation per expand call instead of two.
 */
export class ISMCTSExpansion<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>,
        private isRoundEnded: RoundEndDetector<Controllers>,
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
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
     */
    expand(node: ISMCTSRoot<ResponseMessage> | ISMCTSNode<ResponseMessage>, waitingState: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): { node: ISMCTSNode<ResponseMessage>, state: ControllerState<Controllers> } | null {
        if (process.env.DEBUG_EXPANSION === 'true') {
            console.error(`[EXPANSION] expand called with response types: ${JSON.stringify(expectedResponseTypes)}`);
        }

        if (!isWaiting(waitingState)) {
            throw new Error('[ISMCTS Expansion] Expected state paused at decision point');
        }

        if (this.isRoundEnded(waitingState)) {
            return null;
        }

        if (expectedResponseTypes.length === 0) {
            return null;
        }

        // One driver creation covers inspection, validation, and action application
        const ctx = new GameContext(waitingState, this.gameAdapterConfig);

        const currentPlayer = ctx.waitingPlayer;
        if (currentPlayer < 0) {
            return null;
        }

        const legalActions = this.legalActionsGenerator.generateLegalActions(ctx, expectedResponseTypes);

        const unexploredActions = legalActions.filter((action: ResponseMessage) => {
            const isExplored = node.children.some(c => isDeepStrictEqual(action, c.lastAction));
            if (process.env.DEBUG_EXPANSION === 'true') {
                console.error(`[EXPANSION] action: ${action.type}, explored: ${isExplored}`);
            }
            return !isExplored;
        });

        if (unexploredActions.length === 0) {
            return null;
        }

        const selectedAction = unexploredActions[Math.floor(Math.random() * unexploredActions.length)];

        try {
            // Reuse context's driver — no additional deep copy
            const { newState: newGameState, actingPlayer } = ctx.applyAction(selectedAction);

            const newNode: ISMCTSNode<ResponseMessage> = {
                visits: 0,
                totalReward: 0,
                lastPlayer: actingPlayer,
                children: [],
                parent: node,
                lastAction: selectedAction,
                lastActionKey: getActionKey(selectedAction),
            };

            node.children.push(newNode);

            return { node: newNode, state: newGameState };
        } catch (error) {
            throw new Error(`Expansion failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
