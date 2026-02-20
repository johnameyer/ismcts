import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
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
 *
 * This strategy is completely game-agnostic:
 * - Uses LegalActionsGenerator to find valid actions
 * - Receives game logic through GameAdapterConfig dependency injection
 * - Doesn't import any game-specific types
 * - Works with abstract HandlerData
 */
export class RandomDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>;

    constructor(
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.gameAdapterConfig = gameAdapterConfig;
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    }

    getAction(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        // Get all legal actions
        const legalActions = this.legalActionsGenerator.generateLegalActions(
            handlerData,
            expectedResponseTypes,
        );

        if (legalActions.length === 0) {
            return null;
        }

        // If only one action, return it
        if (legalActions.length === 1) {
            return legalActions[0];
        }

        // Use weighted selection if game provides weight function
        if (this.gameAdapterConfig.getActionWeight) {
            return this.selectWeightedAction(legalActions);
        }

        // Otherwise choose uniformly at random
        const randomIndex = Math.floor(Math.random() * legalActions.length);
        return legalActions[randomIndex];
    }

    /**
     * Select action using game-provided weights.
     * Higher weight = higher probability of selection.
     * Default weight is 1.0 if not specified by game.
     */
    private selectWeightedAction(actions: ResponseMessage[]): ResponseMessage {
        const weights: number[] = [];
        let totalWeight = 0;

        for (const action of actions) {
            const weight = this.gameAdapterConfig.getActionWeight?.(action) ?? 1.0;
            weights.push(weight);
            totalWeight += weight;
        }

        // Select based on weighted probability
        const randomValue = Math.random() * totalWeight;
        let currentWeight = 0;

        for (let i = 0; i < actions.length; i++) {
            currentWeight += weights[i];
            if (randomValue <= currentWeight) {
                return actions[i];
            }
        }

        // Fallback (should never reach here)
        return actions[actions.length - 1];
    }
}
