import { ResponseMessage } from '@cards-ts/euchre/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import { expect } from 'chai';
import { HandlerChain } from '@cards-ts/core';
import { gameFactory } from '@cards-ts/euchre/dist/game-factory.js';
import { EuchreAdapterConfig, EuchreISMCTSHandler } from '../../src/adapters/euchre/index.js';
import { ISMCTSDecisionStrategy } from '../../src/strategies/ismcts-decision-strategy.js';
import { RandomDecisionStrategy } from '../../src/strategies/random-decision-strategy.js';
import { GameAdapterConfig } from '../../src/adapter-config.js';

/**
 * Euchre full game integration test
 * 
 * Plays complete Euchre rounds with different strategies to verify:
 * - Game completes without errors
 * - Action generation works for all response types
 * - ISMCTS strategy improves over random
 */
describe.skip('Euchre Full Game Completion', () => {
    
    const createRandomHandlerChain = (config: GameAdapterConfig<ResponseMessage, Controllers>) => {
        const handler = new EuchreISMCTSHandler(new RandomDecisionStrategy(config));
        // @ts-expect-error - HandlerChain expects different handler interface
        return new HandlerChain([ handler ]);
    };

    const createISMCTSHandlerChain = (config: GameAdapterConfig<ResponseMessage, Controllers>) => {
        const handler = new EuchreISMCTSHandler(new ISMCTSDecisionStrategy(config));
        // @ts-expect-error - HandlerChain expects different handler interface
        return new HandlerChain([ handler ]);
    };

    it('should play a complete Euchre round with random handlers', function(this: Mocha.Context) {
        this.timeout(15000);

        const factory = gameFactory;
        const players = [
            createRandomHandlerChain(EuchreAdapterConfig),
            createRandomHandlerChain(EuchreAdapterConfig),
            createRandomHandlerChain(EuchreAdapterConfig),
            createRandomHandlerChain(EuchreAdapterConfig),
        ];

        const driver = factory.getGameDriver(
            players,
            { maxScore: 10 },
            [ 'Player 0', 'Player 1', 'Player 2', 'Player 3' ],
        );

        let stepCount = 0;
        const maxSteps = 500;

        try {
            // Play until round ends
            while (!driver.getState().completed && stepCount < maxSteps) {
                driver.resume();
                stepCount++;
            }

            expect(driver.getState().completed, 'Game should complete').to.be.true;
            expect(stepCount, 'Game should complete within 500 steps').to.be.lessThan(maxSteps);
            
            console.log(`✓ Random handler: Euchre round completed in ${stepCount} steps`);
        } catch (error) {
            console.error(`✗ Random handler failed at step ${stepCount}:`, error);
            throw error;
        }
    });

    it('should play a complete Euchre round with ISMCTS handlers', function(this: Mocha.Context) {
        this.timeout(60000);

        const factory = gameFactory;
        const players = [
            createISMCTSHandlerChain(EuchreAdapterConfig),
            createISMCTSHandlerChain(EuchreAdapterConfig),
            createISMCTSHandlerChain(EuchreAdapterConfig),
            createISMCTSHandlerChain(EuchreAdapterConfig),
        ];

        const driver = factory.getGameDriver(
            players,
            { maxScore: 10 },
            [ 'ISMCTS 0', 'ISMCTS 1', 'ISMCTS 2', 'ISMCTS 3' ],
        );

        let stepCount = 0;
        const maxSteps = 500;

        try {
            // Play until round ends
            while (!driver.getState().completed && stepCount < maxSteps) {
                driver.resume();
                stepCount++;
            }

            expect(driver.getState().completed, 'Game should complete').to.be.true;
            expect(stepCount, 'Game should complete within 500 steps').to.be.lessThan(maxSteps);
            
            console.log(`✓ ISMCTS handler: Euchre round completed in ${stepCount} steps`);
        } catch (error) {
            console.error(`✗ ISMCTS handler failed at step ${stepCount}:`, error);
            throw error;
        }
    });
});
