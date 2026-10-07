import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { DecisionStrategy } from './decision-strategy.js';
import { selectRandomAction } from './random-decision-strategy.js';

/**
 * Enhanced random strategy that prioritizes guaranteed immediate wins
 * before falling back to standard random action selection.
 */
export class EnhancedRandomDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers & FrameworkControllers,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    constructor(
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
        );
    }

    getAction(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        /*
         * reconstructGameStateForValidation(handlerData) builds a fresh
         * object every call, held by nothing else at this point - ownsState
         * lets GameContext skip driverFactory's defensive clone of it
         * (rawDriverFactory instead), since this context is only ever used
         * below for read-only legal-action generation/validation (never
         * applyAction/resumeAndCapture), which doesn't mutate the
         * shallow-aliased nested state reconstructGameStateForValidation
         * shares with handlerData - and handlerData is read again below,
         * so that aliasing has to stay untouched.
         */
        const state = this.gameAdapterConfig.reconstructGameStateForValidation(handlerData);
        const ctx = new GameContext(state, this.gameAdapterConfig, true);
        const legalActions = this.legalActionsGenerator.generateLegalActions(ctx, expectedResponseTypes);

        if (legalActions.length === 0) {
            return null;
        }

        const immediateWinningAction = this.gameAdapterConfig.getImmediateWinningAction?.(
            handlerData,
            expectedResponseTypes,
            legalActions,
            ctx.controllers,
        );

        if (immediateWinningAction) {
            return immediateWinningAction;
        }

        /*
         * Pick directly from the legalActions already computed above,
         * instead of delegating to RandomDecisionStrategy.getAction()
         * (handlerData, expectedResponseTypes) - which would redundantly
         * reconstruct game state, build a second driver, and recompute the
         * exact same legal actions from scratch just to make the same kind
         * of choice selectRandomAction makes on its own.
         */
        return selectRandomAction(legalActions, this.gameAdapterConfig);
    }
}
