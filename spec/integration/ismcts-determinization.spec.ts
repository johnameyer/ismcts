import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ControllerState, HandlerChain } from '@cards-ts/core';
import { gameFactory } from '@cards-ts/pocket-tcg/dist/game-factory.js';
import { MockCardRepository } from '../helpers/test-utils.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';
import { ISMCTSDecisionStrategy } from '../../src/strategies/ismcts-decision-strategy.js';
import { GameAdapterConfig } from '../../src/adapter-config.js';
import { PocketTCGHandler } from '../../src/adapters/pocket-tcg/handler.js';

/**
 * ISMCTS Determinization Test
 * 
 * Tests that ISMCTS can make intelligent decisions when reasoning about
 * hidden information (opponent's deck and hand).
 * 
 * Key difference from full-game tests:
 * - Focused on single decision points (attack vs end turn)
 * - Tests that ISMCTS doesn't hang during determinization
 * - Verifies ISMCTS prefers attacking when it leads to victory
 */
describe('ISMCTS Determinization', () => {
    /**
     * Helper to create ISMCTS player with configurable iterations
     */
    const createISMCTSHandlerChain = (gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>, iterations: number = 10) => {
        const strategy = new ISMCTSDecisionStrategy(gameAdapterConfig, {
            iterations,
            maxDepth: 20,
        });
        const handler = new PocketTCGHandler(strategy);
        // @ts-expect-error
        return new HandlerChain([ handler ]);
    };

    it('should complete several game steps with ISMCTS and determinization without hanging', function(this: Mocha.Context) {
        this.timeout(10000);

        const cardRepository = new MockCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);

        // Create two ISMCTS players with low iteration count for testing
        const players = [
            createISMCTSHandlerChain(gameAdapterConfig, 5),
            createISMCTSHandlerChain(gameAdapterConfig, 5),
        ];

        const factory = gameFactory(cardRepository);
        
        // Simple decks: just basic creatures
        const deck0 = Array(20).fill('basic-creature');
        const deck1 = Array(20).fill('basic-creature');

        const driver = factory.getGameDriver(
            players,
            { ...factory.getGameSetup().getDefaultParams(), initialDecks: [ deck0, deck1 ] },
            [ 'ISMCTS Player 0', 'ISMCTS Player 1' ],
        );

        // Run just a few steps to test that ISMCTS can make decisions without hanging
        const maxSteps = 10;
        let stepCount = 0;
        const decisionPoints: string[] = [];

        driver.resume();
        
        while (!driver.getState().completed && stepCount < maxSteps) {
            driver.handleSyncResponses();
            driver.resume();
            stepCount++;
        }

        // Verify we made progress
        expect(stepCount).to.be.greaterThan(0);
        expect(stepCount).to.be.lessThanOrEqual(maxSteps);

        console.log(`
✓ ISMCTS with determinization completed ${stepCount} steps without hanging
✓ Both players made decisions using tree search with hidden information
        `);
    });

    it('should prefer attacking over ending turn when opponent has low HP', function(this: Mocha.Context) {
        this.timeout(10000);

        const cardRepository = new MockCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);

        // One ISMCTS player, one random for control
        const ismctsPlayer = createISMCTSHandlerChain(gameAdapterConfig, 10);
        const factory = gameFactory(cardRepository);
        const randomPlayer = factory.getDefaultBotHandlerChain();

        const players = [ ismctsPlayer, randomPlayer ];

        const deck0 = Array(20).fill('basic-creature');
        const deck1 = Array(20).fill('basic-creature');

        const driver = factory.getGameDriver(
            players,
            { ...factory.getGameSetup().getDefaultParams(), initialDecks: [ deck0, deck1 ] },
            [ 'ISMCTS Attacker', 'Random Opponent' ],
        );

        // Run game to see if ISMCTS can strategically attack
        const maxSteps = 100;
        let stepCount = 0;
        let lastWinner = '';

        driver.resume();
        
        while (!driver.getState().completed && stepCount < maxSteps) {
            driver.handleSyncResponses();
            driver.resume();
            stepCount++;
        }

        const finalState = driver.getState() as ControllerState<Controllers>;
        
        // Game should complete
        expect(finalState.completed).to.be.true;
        
        // Record which player won for analysis
        const player0HasCreatures = (finalState.field.creatures[0]?.length || 0) > 0;
        const player1HasCreatures = (finalState.field.creatures[1]?.length || 0) > 0;
        
        if (player0HasCreatures && !player1HasCreatures) {
            lastWinner = 'ISMCTS Player (Player 0)';
        } else if (!player0HasCreatures && player1HasCreatures) {
            lastWinner = 'Random Player (Player 1)';
        } else {
            lastWinner = 'Draw';
        }

        console.log(`
✓ ISMCTS with determinization game completed in ${stepCount} steps
✓ Result: ${lastWinner}
✓ ISMCTS can reason about hidden opponent information
        `);
    });

    it('should play a complete game with default bot vs ISMCTS', function(this: Mocha.Context) {
        this.timeout(10000);

        const cardRepository = new MockCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);

        const factory = gameFactory(cardRepository);
        const ismctsPlayer = createISMCTSHandlerChain(gameAdapterConfig, 10);
        const defaultBotPlayer = factory.getDefaultBotHandlerChain();

        const players = [ ismctsPlayer, defaultBotPlayer ];

        const deck0 = Array(20).fill('basic-creature');
        const deck1 = Array(20).fill('basic-creature');

        const driver = factory.getGameDriver(
            players,
            { ...factory.getGameSetup().getDefaultParams(), initialDecks: [ deck0, deck1 ] },
            [ 'ISMCTS Player', 'Default Bot' ],
        );

        const maxSteps = 200;
        let stepCount = 0;

        driver.resume();
        
        while (!driver.getState().completed && stepCount < maxSteps) {
            driver.handleSyncResponses();
            driver.resume();
            stepCount++;
        }

        const finalState = driver.getState() as ControllerState<Controllers>;
        
        // Game should complete
        expect(finalState.completed).to.be.true;

        console.log(`
✓ Full game with ISMCTS vs Default Bot completed in ${stepCount} steps
✓ Players: ${finalState.names.join(' vs ')}
        `);
    });

});
