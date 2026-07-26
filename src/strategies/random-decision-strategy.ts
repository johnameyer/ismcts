import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { DecisionStrategy } from './decision-strategy.js';

/**
 * Random Decision Strategy
 *
 * Chooses randomly from legal actions, with optional game-specific weighting.
 * Works with any game that provides a GameAdapterConfig (game logic functions).
 *
 * Used for:
 * - Baseline comparison (ISMCTS vs Random)
 * - Fallback behavior when ISMCTS fails
 * - Testing
 */
export class RandomDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers & FrameworkControllers,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>;

    constructor(
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.gameAdapterConfig = gameAdapterConfig;
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
        );
    }

    getAction(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        const state = this.gameAdapterConfig.reconstructGameStateForValidation(handlerData);
        const ctx = new GameContext(state, this.gameAdapterConfig);
        const legalActions = this.legalActionsGenerator.generateLegalActions(ctx, expectedResponseTypes);

        if (legalActions.length === 0) {
            return null;
        }

        if (legalActions.length === 1) {
            return legalActions[0];
        }

        if (this.gameAdapterConfig.getActionWeight) {
            return this.selectWeightedAction(legalActions);
        }

        const randomIndex = Math.floor(Math.random() * legalActions.length);
        return legalActions[randomIndex];
    }

    /**
     * Select action using game-provided weights.
     * Higher weight = higher probability of selection.
     */
    private selectWeightedAction(actions: ResponseMessage[]): ResponseMessage {
        const weights: number[] = [];
        let totalWeight = 0;

        for (const action of actions) {
            const weight = this.gameAdapterConfig.getActionWeight?.(action) ?? 1.0;
            weights.push(weight);
            totalWeight += weight;
        }

        const randomValue = Math.random() * totalWeight;
        let currentWeight = 0;

        for (let i = 0; i < actions.length; i++) {
            currentWeight += weights[i];
            if (randomValue <= currentWeight) {
                return actions[i];
            }
        }

        return actions[actions.length - 1];
    }
}
