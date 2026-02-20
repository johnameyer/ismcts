import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { LegalActionsGenerator } from '../legal-actions-generator.js';
import { GameAdapterConfig } from '../adapter-config.js';
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
 *
 * This strategy is completely game-agnostic:
 * - Uses LegalActionsGenerator to find legal actions
 * - Receives game logic through GameAdapterConfig dependency injection
 * - Doesn't import any game-specific types
 * - Works with abstract HandlerData
 */
export class CaptureDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers,
    HandlerData extends ControllerHandlerState<Controllers>,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    private capturedState: HandlerData | null = null;

    private capturedActions: ResponseMessage[] = [];

    private capturedResponseTypes: (ResponseMessage['type'])[] = [];

    constructor(
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    }

    getAction(handlerData: HandlerData, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        // Capture the state, response types, and legal actions
        this.capturedState = handlerData;
        this.capturedResponseTypes = [ ...expectedResponseTypes ];
        this.capturedActions = this.legalActionsGenerator.generateLegalActions(
            handlerData,
            expectedResponseTypes,
        );

        // Return first legal action (or null if none)
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
