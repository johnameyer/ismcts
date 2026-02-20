import { HandlerResponsesQueue, type ControllerHandlerState } from '@cards-ts/core';
import { GameHandler } from '@cards-ts/euchre/dist/game-handler.js';
import type { ResponseMessage } from '@cards-ts/euchre/dist/messages/response-message.js';
import { OrderUpResponseMessage } from '@cards-ts/euchre/dist/messages/response/index.js';
import { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';

type HandlerData = ControllerHandlerState<Controllers>;

/**
 * Euchre Handler with Pluggable Strategy
 * 
 * Implements the GameHandler interface required by Euchre framework.
 * Maps each Euchre handler method to expectedResponseTypes and delegates
 * decision-making to the pluggable strategy.
 */
export class EuchreISMCTSHandler extends GameHandler {
    constructor(private strategy: DecisionStrategy<ResponseMessage, Controllers>) {
        super();
    }

    handleOrderUp = (handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void => {
        const expectedResponseTypes = [
            'order-up-response',
            'going-alone-response',
        ] as const;

        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            // Default pass action if strategy returns nothing
            responsesQueue.push(new OrderUpResponseMessage(false));
        }
    };

    handleNameTrump = (handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void => {
        const expectedResponseTypes = [
            'name-trump-response',
            'going-alone-response',
        ] as const;

        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no name-trump action');
        }
    };

    handleDealerDiscard = (handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void => {
        const expectedResponseTypes = [ 'dealer-discard-response' ] as const;

        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no dealer-discard action');
        }
    };

    handleTurn = (handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void => {
        const expectedResponseTypes = [ 'turn-response' ] as const;

        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no turn action');
        }
    };
}
