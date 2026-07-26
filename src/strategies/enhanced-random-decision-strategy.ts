import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { DecisionStrategy } from './decision-strategy.js';
import { RandomDecisionStrategy } from './random-decision-strategy.js';

/**
 * Enhanced random strategy that prioritizes guaranteed immediate wins
 * before falling back to standard random action selection.
 */
export class EnhancedRandomDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers & FrameworkControllers,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private randomStrategy: RandomDecisionStrategy<ResponseMessage, Controllers>;

    constructor(
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
        );
        this.randomStrategy = new RandomDecisionStrategy(gameAdapterConfig);
    }

    getAction(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        const state = this.gameAdapterConfig.reconstructGameStateForValidation(handlerData);
        const ctx = new GameContext(state, this.gameAdapterConfig);
        const legalActions = this.legalActionsGenerator.generateLegalActions(ctx, expectedResponseTypes);

        if (legalActions.length === 0) {
            return null;
        }

        const immediateWinningAction = this.gameAdapterConfig.getImmediateWinningAction?.(
            handlerData,
            expectedResponseTypes,
            legalActions,
        );

        if (immediateWinningAction) {
            return immediateWinningAction;
        }

        return this.randomStrategy.getAction(handlerData, expectedResponseTypes);
    }
}
