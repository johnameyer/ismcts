import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { DecisionStrategy } from './decision-strategy.js';

/**
 * Capture Decision Strategy
 *
 * Captures game state and legal actions without making actual decisions.
 * Works with any game that provides a GameAdapterConfig.
 *
 * Used for:
 * - Testing and debugging
 * - Analyzing game states
 * - Capturing expectedResponseTypes for handlers
 * - Understanding what actions were available
 */
export class CaptureDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers & FrameworkControllers,
    HandlerData extends ControllerHandlerState<Controllers>,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>;

    private capturedState: HandlerData | null = null;

    private capturedActions: ResponseMessage[] = [];

    private capturedResponseTypes: (ResponseMessage['type'])[] = [];

    constructor(
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.gameAdapterConfig = gameAdapterConfig;
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
        );
    }

    getAction(handlerData: HandlerData, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        this.capturedState = handlerData;
        this.capturedResponseTypes = [ ...expectedResponseTypes ];

        const state = this.gameAdapterConfig.reconstructGameStateForValidation(handlerData);
        const ctx = new GameContext(state, this.gameAdapterConfig);
        this.capturedActions = this.legalActionsGenerator.generateLegalActions(ctx, expectedResponseTypes);

        return this.capturedActions.length > 0 ? this.capturedActions[0] : null;
    }

    getCapturedState(): HandlerData | null {
        return this.capturedState;
    }

    getCapturedActions(): ResponseMessage[] {
        return this.capturedActions;
    }

    getCapturedResponseTypes(): (ResponseMessage['type'])[] {
        return this.capturedResponseTypes;
    }
}
