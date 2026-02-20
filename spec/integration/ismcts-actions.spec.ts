import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ISMCTS } from '../../src/modular/ismcts.js';
import { MockCardRepository } from '../helpers/test-utils.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';

describe('ISMCTS Actions Tests', () => {
    let simulation: ISMCTS<ResponseMessage, Controllers>;

    beforeEach(() => {
        const cardRepository = new MockCardRepository();
        simulation = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository));
    });

    it('should handle action generation', () => {
        expect(simulation).to.be.instanceOf(ISMCTS);
    });
});
