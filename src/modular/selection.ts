import { isDeepStrictEqual } from 'node:util';
import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { getUCB1Score } from '../utils/ismcts-node-utils.js';
import { isWaiting } from '../utils/waiting-state-utils.js';
import { applyActionResumeAndCapture } from '../utils/driver-orchestrator.js';
import { RoundEndDetector, GameAdapterConfig } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';
import { GameContext } from '../utils/game-context.js';

/**
 * ISMCTS Selection Phase Implementation
 *
 * Implements the selection phase using the RESUME -> GET LEGAL -> APPLY pattern.
 * This phase traverses the tree from root to leaf using UCB1 selection policy,
 * but only considers children whose actions are valid in the current determinization.
 *
 * Uses GameContext to unify driver creation for state inspection and validation.
 * applyActionResumeAndCapture handles the apply+resume+capture step separately
 * since it requires capture handlers in the driver.
 */
export class ISMCTSSelection<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>,
        private isRoundEnded: RoundEndDetector<Controllers>,
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {}

    select(root: ISMCTSRoot<ResponseMessage>, currentState: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): { node: ISMCTSRoot<ResponseMessage> | ISMCTSNode<ResponseMessage>, state: ControllerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[] } {
        if (!isWaiting(currentState)) {
            throw new Error('Selection precondition failed: game state is not waiting for a player response');
        }

        let currentNode = root;
        let currentGameState = currentState;
        let latestResponseTypes = expectedResponseTypes;

        for (;;) {
            const ctx = new GameContext(currentGameState, this.gameAdapterConfig);

            if (ctx.isEnded()) {
                return { node: currentNode, state: currentGameState, expectedResponseTypes: [] };
            }

            if (ctx.waitingPlayer < 0) {
                throw new Error('Not waiting for any player?');
            }

            const legalActions = this.legalActionsGenerator.generateLegalActions(ctx, latestResponseTypes);

            const validChildren = currentNode.children.filter(child => legalActions.some(a => isDeepStrictEqual(a, child.lastAction)));

            const unexploredActions = legalActions.filter(action => !validChildren.some(child => isDeepStrictEqual(action, child.lastAction)));

            if (unexploredActions.length > 0) {
                return { node: currentNode, state: currentGameState, expectedResponseTypes: latestResponseTypes };
            }

            if (validChildren.length === 0) {
                break;
            }

            const selectedChild = this.selectBestChild(validChildren);

            const { newGameState, capturedResponseTypes } = applyActionResumeAndCapture(
                currentGameState,
                selectedChild.lastAction,
                ctx.waitingPlayer,
                this.gameAdapterConfig,
            );

            currentGameState = newGameState;
            latestResponseTypes = capturedResponseTypes as readonly (ResponseMessage['type'])[];
            currentNode = selectedChild;
        }

        return { node: currentNode, state: currentGameState, expectedResponseTypes: latestResponseTypes };
    }

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
