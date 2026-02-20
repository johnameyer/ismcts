import { expect } from 'chai';
import { extractWaitingPlayer } from '../../../src/utils/waiting-state-utils.js';

describe('Waiting State Utils', () => {
    describe('extractWaitingPlayer', () => {
        it('should extract player index when waiting is an array', () => {
            const waitingState = { waiting: [ 1 ], responded: [] };
            const player = extractWaitingPlayer(waitingState);
            expect(player).to.equal(1);
        });

        it('should extract first player when waiting has multiple entries', () => {
            const waitingState = { waiting: [ 0, 1 ], responded: [] };
            const player = extractWaitingPlayer(waitingState);
            expect(player).to.equal(0);
        });

        it('should extract player when waiting is a single number', () => {
            const waitingState = { waiting: 1, responded: [] };
            const player = extractWaitingPlayer(waitingState);
            expect(player).to.equal(0);
        });

        it('should return -1 when waiting is empty array', () => {
            const waitingState = { waiting: [], responded: [] };
            const player = extractWaitingPlayer(waitingState);
            expect(player).to.equal(-1);
        });

        it('should return -1 when waiting is 0', () => {
            const waitingState = { waiting: 0, responded: [] };
            const player = extractWaitingPlayer(waitingState);
            expect(player).to.equal(-1);
        });
    });
});
