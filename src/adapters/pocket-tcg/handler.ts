import { HandlerResponsesQueue } from '@cards-ts/core';
import { GameHandler, HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';

/**
 * Pocket-TCG Handler with Pluggable Strategy
 * 
 * Implements the GameHandler interface required by Pocket-TCG framework.
 * Accepts any strategy that implements DecisionStrategy interface.
 * 
 * The handler's job:
 * - Implements Pocket-TCG's GameHandler interface
 * - Maps each handler method to expectedResponseTypes for that decision
 * - Delegates decision-making to pluggable strategy
 * 
 * The strategy's job:
 * - Decide which action to take given expectedResponseTypes
 * - Can be ISMCTS, Random, Capture, or any other implementation
 * - Completely decoupled from Pocket-TCG specific types
 */
export class PocketTCGHandler extends GameHandler {
    constructor(private strategy: DecisionStrategy<ResponseMessage, Controllers>) {
        super();
    }

    handleAction(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const expectedResponseTypes = [
            'play-card-response',
            'attack-response',
            'evolve-response',
            'retreat-response',
            'attach-energy-response',
            'use-ability-response',
            'end-turn-response',
        ] as const;

        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no action');
        }
    }

    handleSelectActiveCard(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const action = this.strategy.getAction(handlerData, [ 'select-active-card-response' ]);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no active card selection');
        }
    }

    handleSelectTarget(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const action = this.strategy.getAction(handlerData, [ 'select-target-response' ]);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no target selection');
        }
    }

    handleSelectEnergy(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const action = this.strategy.getAction(handlerData, [ 'select-energy-response' ]);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no energy selection');
        }
    }

    handleSelectCard(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const action = this.strategy.getAction(handlerData, [ 'select-card-response' ]);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no card selection');
        }
    }

    handleSelectChoice(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const action = this.strategy.getAction(handlerData, [ 'select-choice-response' ]);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no choice selection');
        }
    }

    handleSetup(handlerData: HandlerData, responsesQueue: HandlerResponsesQueue<ResponseMessage>): void {
        const expectedResponseTypes = [ 'setup-complete' ] as const;
        const action = this.strategy.getAction(handlerData, expectedResponseTypes);
        if (action) {
            responsesQueue.push(action);
        } else {
            throw new Error('Strategy returned no setup response');
        }
    }

    handleMessage(handlerData: HandlerData, message: ResponseMessage): void {
        // Message acknowledgment - strategy doesn't need to decide anything
    }
}
