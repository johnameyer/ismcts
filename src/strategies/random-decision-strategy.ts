import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { DecisionStrategy } from './decision-strategy.js';

/**
 * Picks one action from an already-computed legal-actions list (weighted by
 * gameAdapterConfig.getActionWeight if provided, else uniform random).
 * Extracted from RandomDecisionStrategy.getAction() so a caller that
 * already has a legalActions list from its own generateLegalActions() call
 * (e.g. EnhancedRandomDecisionStrategy, after checking for an immediate
 * winning action) can pick from it directly, instead of delegating to
 * RandomDecisionStrategy.getAction() - which would otherwise redundantly
 * reconstruct game state, build a second driver, and recompute the exact
 * same legal actions from scratch just to make the same kind of choice this
 * function makes on its own.
 */
export function selectRandomAction<ResponseMessage extends Message, Controllers extends IndexedControllers>(
    legalActions: ResponseMessage[],
    gameAdapterConfig: Pick<GameAdapterConfig<ResponseMessage, Controllers>, 'getActionWeight'>,
): ResponseMessage | null {
    if (legalActions.length === 0) {
        return null;
    }

    if (legalActions.length === 1) {
        return legalActions[0];
    }

    if (gameAdapterConfig.getActionWeight) {
        return selectWeightedAction(legalActions, gameAdapterConfig.getActionWeight);
    }

    const randomIndex = Math.floor(Math.random() * legalActions.length);
    return legalActions[randomIndex];
}

/**
 * Select action using game-provided weights.
 * Higher weight = higher probability of selection.
 */
function selectWeightedAction<ResponseMessage extends Message>(
    actions: ResponseMessage[],
    getActionWeight: (action: ResponseMessage) => number,
): ResponseMessage {
    const weights: number[] = [];
    let totalWeight = 0;

    for (const action of actions) {
        const weight = getActionWeight(action) ?? 1.0;
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

        return selectRandomAction(legalActions, this.gameAdapterConfig);
    }
}
