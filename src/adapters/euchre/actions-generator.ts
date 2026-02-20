/**
 * Euchre Game Adapter - Action Generation
 */

import type { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import { OrderUpResponseMessage, NameTrumpResponseMessage, DealerDiscardResponseMessage, GoingAloneResponseMessage } from '@cards-ts/euchre/dist/messages/response/index.js';
import type { ResponseMessage } from '@cards-ts/euchre/dist/messages/response-message.js';
import { PlayCardResponseMessage, type ControllerHandlerState, Suit } from '@cards-ts/core';
import type { ActionsGenerator } from '../../adapter-config.js';

type HandlerData = ControllerHandlerState<Controllers>;

/**
 * Euchre Actions Generator - generates legal plays for each game state
 */
export class EuchreActionsGenerator implements ActionsGenerator<ResponseMessage, Controllers> {
    private readonly responseTypeGenerators: Record<ResponseMessage['type'], (handlerData: HandlerData) => ResponseMessage[]> = {
        'order-up-response': (hd) => [
            new OrderUpResponseMessage(true),
            new OrderUpResponseMessage(false),
        ],
        'name-trump-response': (hd) => {
            const actions: ResponseMessage[] = [ new NameTrumpResponseMessage(undefined) ];
            const euchreState = hd.euchre;
            const currentTrump = euchreState?.currentTrump;
            for (const suit of Suit.suits) {
                if (suit !== currentTrump) {
                    actions.push(new NameTrumpResponseMessage(suit));
                }
            }
            return actions;
        },
        'dealer-discard-response': (hd) => {
            const hand = hd.hand;
            if (!Array.isArray(hand)) {
                return [];
            }
            return hand.map(card => new DealerDiscardResponseMessage(card));
        },
        'turn-response': (hd) => {
            const hand = hd.hand;
            if (!Array.isArray(hand)) {
                return [];
            }
            return hand.map(card => new PlayCardResponseMessage(card));
        },
        'going-alone-response': () => [ new GoingAloneResponseMessage() ],
    };

    generateCandidateActions(
        handlerData: HandlerData,
        _currentPlayer: number,
        expectedResponseTypes: readonly (ResponseMessage['type'])[],
    ): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        for (const responseType of expectedResponseTypes) {
            const generator = this.responseTypeGenerators[responseType];
            if (generator) {
                actions.push(...generator(handlerData));
            }
        }

        return actions;
    }
}
