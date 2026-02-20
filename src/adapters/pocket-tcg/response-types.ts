import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';

export const MAIN_ACTION_RESPONSE_TYPES = [
    'play-card-response',
    'evolve-response',
    'attack-response',
    'retreat-response',
    'use-ability-response',
    'attach-energy-response',
    'end-turn-response',
] as const satisfies readonly (ResponseMessage['type'])[];

export const SELECT_ACTIVE_CARD_RESPONSE_TYPES = [ 'select-active-card-response' ] as const satisfies readonly (ResponseMessage['type'])[];
