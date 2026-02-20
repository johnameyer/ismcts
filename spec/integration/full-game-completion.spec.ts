import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { HandlerChain, ControllerHandlerState } from '@cards-ts/core';
import { gameFactory } from '@cards-ts/pocket-tcg/dist/game-factory.js';
import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import type { CreatureData } from '@cards-ts/pocket-tcg/dist/repository/card-types.js';
import type { GameDriver } from '../../src/utils/driver-types.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';
import { ISMCTSDecisionStrategy } from '../../src/strategies/ismcts-decision-strategy.js';
import { RandomDecisionStrategy } from '../../src/strategies/random-decision-strategy.js';
import { GameAdapterConfig } from '../../src/adapter-config.js';
import { PocketTCGHandler } from '../../src/adapters/pocket-tcg/handler.js';
import { DecisionStrategy } from '../../src/strategies/decision-strategy.js';
import { ISMCTSConfig } from '../../src/modular/ismcts-config.js';
import { GameEventTracker } from './helpers/game-event-tracker.js';
import { runGameWithTracking } from './helpers/game-test-helpers.js';
import { GameOutcomeValidator } from './helpers/game-outcome-validator.js';

/**
 * Test card repository with minimal fire creatures for integration tests
 */
function createTestCardRepository(): CardRepository {
    const fireBasicCreature: CreatureData = {
        templateId: 'fire-basic',
        name: 'Fire Basic',
        maxHp: 60,
        type: 'fire',
        retreatCost: 1,
        attacks: [
            {
                name: 'Flame Burst',
                damage: 20,
                energyRequirements: [{ type: 'fire', amount: 1 }],
            },
        ],
    };

    const fireStage1Creature: CreatureData = {
        templateId: 'fire-stage1',
        name: 'Fire Stage 1',
        maxHp: 90,
        type: 'fire',
        previousStageName: 'Fire Basic',
        retreatCost: 2,
        attacks: [
            {
                name: 'Flame Strike',
                damage: 50,
                energyRequirements: [{ type: 'fire', amount: 2 }],
            },
        ],
    };

    const creatureMap = new Map<string, CreatureData>();
    creatureMap.set(fireBasicCreature.templateId, fireBasicCreature);
    creatureMap.set(fireStage1Creature.templateId, fireStage1Creature);

    return new CardRepository(
        creatureMap,
        new Map(),
        new Map(),
        new Map(),
        new Map(),
    );
}

/**
 * Creates a proxy strategy that intercepts getAction calls and tracks events
 */
function createTrackedStrategy(baseStrategy: DecisionStrategy<ResponseMessage, Controllers>, tracker: GameEventTracker, playerIndex: number): DecisionStrategy<ResponseMessage, Controllers> {
    return new Proxy(baseStrategy, {
        get(target, prop) {
            const value = (target as unknown as Record<string, unknown>)[prop as string];
            
            // Intercept getAction method
            if (prop === 'getAction' && typeof value === 'function') {
                return function(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]) {
                    // Call the original strategy's getAction
                    const action = (value as Function).apply(target, [ handlerData, expectedResponseTypes ]);
                    
                    if (process.env.DEBUG_HANDLER === 'true') {
                        console.log(`[Handler] P${playerIndex}.getAction called, expecting: ${expectedResponseTypes?.join(',')} => action: ${action?.type || 'null'}`);
                    }
                    
                    // Track the action if one was returned
                    if (action) {
                        const eventType = extractEventType(action);
                        tracker.trackEvent(playerIndex, eventType, true, true);
                    }
                    
                    return action;
                };
            }
            
            return value;
        },
    });
}

function extractEventType(action: ResponseMessage): string {
    if (!action) {
        return 'unknown'; 
    }
    
    return action.type;
}

/**
 * Integration test: Play games to completion using different handlers
 */
describe('Full Game Completion with Different Handlers', () => {
    
    const createTrackedRandomHandlerChain = (
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
        tracker: GameEventTracker,
        playerIndex: number,
    ) => {
        const baseStrategy = new RandomDecisionStrategy(gameAdapterConfig);
        const trackedStrategy = createTrackedStrategy(baseStrategy, tracker, playerIndex);
        const handler = new PocketTCGHandler(trackedStrategy);
        // @ts-expect-error
        return new HandlerChain([ handler ]);
    };

    const createTrackedISMCTSHandlerChain = (
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
        tracker: GameEventTracker,
        playerIndex: number,
        ismctsConfig?: ISMCTSConfig,
    ) => {
        const baseStrategy = new ISMCTSDecisionStrategy(gameAdapterConfig, ismctsConfig);
        const trackedStrategy = createTrackedStrategy(baseStrategy, tracker, playerIndex);
        const handler = new PocketTCGHandler(trackedStrategy);
        // @ts-expect-error
        return new HandlerChain([ handler ]);
    };

    it('should play a complete game with random handler', function(this: Mocha.Context) {
        this.timeout(15000);

        const cardRepository = createTestCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);
        const tracker = new GameEventTracker();

        const factory = gameFactory(cardRepository);
        const deck0 = Array(20).fill('fire-basic');
        const deck1 = Array(20).fill('fire-basic');

        // Create players with tracked strategies
        const players = [
            createTrackedRandomHandlerChain(gameAdapterConfig, tracker, 0),
            createTrackedRandomHandlerChain(gameAdapterConfig, tracker, 1),
        ];

        const driver = factory.getGameDriver(
            players,
            { 
                ...factory.getGameSetup().getDefaultParams(), 
                initialDecks: [ deck0, deck1 ],
                playerEnergyTypes: [[ 'fire' ], [ 'fire' ]], // Both players get fire energy
            },
            [ 'Random 0', 'Random 1' ],
        ) as unknown as GameDriver<ResponseMessage, Controllers>;

        const result = runGameWithTracking(driver, tracker, 200);

        // Game must complete
        expect(result.completed, 'Random handler: game should complete').to.be.true;
        expect(result.stepCount, 'Random handler: should take at least 1 step').to.be.greaterThan(0);
        expect(result.stepCount, 'Random handler: should complete within 200 steps').to.be.lessThan(200);

        // End turn and retreat must be less than 50% of events
        const stats = result.eventStats;
        const endTurnRetreatPercentage = stats.endTurnRetreatRatio * 100;
        console.log(`✓ Random handler game completed in ${result.stepCount} steps`);
        console.log(`  Winner: Player ${result.outcomeValidation.winner}`);
        console.log(`  Outcome: ${result.outcomeValidation.details}`);
        console.log('  Event distribution:');
        console.log(`    Total events: ${stats.totalEvents}`);
        console.log(`    End turn: ${stats.endTurnCount}`);
        console.log(`    Retreat: ${stats.retreatCount}`);
        console.log(`    End turn + retreat: ${endTurnRetreatPercentage.toFixed(1)}%`);
        
        // Log action sequence
        const eventSequence = tracker.getEventSequence();
        console.log(`\n  Action sequence (${eventSequence.length} actions):`);
        for (let i = 0; i < Math.min(eventSequence.length, 50); i++) {
            const event = eventSequence[i];
            console.log(`    [${i}] P${event.position}: ${event.type}`);
        }
        if (eventSequence.length > 50) {
            console.log(`    ... and ${eventSequence.length - 50} more actions`);
        }
        
        if (stats.totalEvents > 0) {
            expect(stats.endTurnRetreatRatio, 'Random handler: End turn + retreat should be less than 50% of events').to.be.lessThan(0.5);
        }
    });

    it('should play a full game with ISMCTS handler', function(this: Mocha.Context) {
        this.timeout(120000);

        const cardRepository = createTestCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);
        const tracker = new GameEventTracker();

        const factory = gameFactory(cardRepository);
        // Create a realistic deck: 10 basic + 10 stage-1 evolution cards (max 2 copies of each)
        const deck0 = [
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
        ];
        const deck1 = [
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-basic', 'fire-basic',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
            'fire-stage1', 'fire-stage1',
        ];

        // Create players with tracked strategies using reduced ISMCTS iterations for speed
        const fastISMCTSConfig: ISMCTSConfig = { iterations: 20, maxDepth: 15 };
        const players = [
            createTrackedISMCTSHandlerChain(gameAdapterConfig, tracker, 0, fastISMCTSConfig),
            createTrackedISMCTSHandlerChain(gameAdapterConfig, tracker, 1, fastISMCTSConfig),
        ];

        const driver = factory.getGameDriver(
            players,
            { 
                ...factory.getGameSetup().getDefaultParams(), 
                initialDecks: [ deck0, deck1 ],
                playerEnergyTypes: [[ 'fire' ], [ 'fire' ]], // Both players get fire energy
            },
            [ 'ISMCTS Player 0', 'ISMCTS Player 1' ],
        ) as unknown as GameDriver<ResponseMessage, Controllers>;

        const result = runGameWithTracking(driver, tracker, 200);
        const finalState = driver.getState();
        const fieldState = GameOutcomeValidator.getFieldState(finalState, cardRepository);

        // Game must complete
        expect(result.completed, 'ISMCTS full game: game should complete').to.be.true;
        expect(result.stepCount, 'ISMCTS full game: should take at least 1 step').to.be.greaterThan(0);
        expect(result.stepCount, 'ISMCTS full game: should complete within 200 steps').to.be.lessThan(200);

        // Must not end in tie - with these cards, one player MUST have more points
        expect(result.outcomeValidation.noTie, 'ISMCTS full game: game should not end in tie').to.be.true;
        expect(result.outcomeValidation.winner, 'ISMCTS full game: winner should be player 0 or 1').to.be.oneOf([ 0, 1 ]);

        // Log if game reached turn limit (warning, not failure - indicates game didn't finish by points)
        if (fieldState.reachedTurnLimit) {
            console.log(`⚠️  WARNING: Game reached turn limit (${fieldState.currentTurn}/${fieldState.maxTurns})`);
        }

        // Log detailed results
        const stats = result.eventStats;
        const endTurnRetreatPercentage = stats.endTurnRetreatRatio * 100;
        console.log(`✓ ISMCTS full game completed in ${result.stepCount} steps (${Math.round(result.stepCount / 2.3)} estimated turns)`);
        console.log(`  Winner: Player ${result.outcomeValidation.winner}`);
        console.log(`  Outcome: ${result.outcomeValidation.details}`);
        console.log(`  Turn count: ${fieldState.currentTurn}/${fieldState.maxTurns}`);
        console.log('  Event distribution:');
        console.log(`    Total events: ${stats.totalEvents}`);
        console.log(`    End turn: ${stats.endTurnCount}`);
        console.log(`    Retreat: ${stats.retreatCount}`);
        console.log(`    Attack: ${stats.totalEvents - stats.endTurnCount - stats.retreatCount}`);
        console.log(`    End turn + retreat: ${endTurnRetreatPercentage.toFixed(1)}%`);
        console.log('\n⚠️  ANALYSIS: ISMCTS rarely selects attack-response despite it being the winning move.');
        console.log('  This suggests simulation/scoring issues - attacks may not be evaluated favorably during MCTS playouts.');
        
        // Log field state (HP)
        console.log('\n  Final field state:');
        fieldState.players.forEach((playerState) => {
            console.log(`    Player ${playerState.player}:`);
            if (playerState.active) {
                console.log(`      Active: ${playerState.active.hp}/${playerState.active.maxHp} HP`);
            } else {
                console.log('      Active: (knocked out)');
            }
            if (playerState.bench.length > 0) {
                console.log(`      Bench (${playerState.bench.length}): ${playerState.bench.map((c) => `${c.hp}/${c.maxHp}`).join(', ')}`);
            } else {
                console.log('      Bench: (empty)');
            }
        });
        
        // Log action sequence
        const eventSequence = tracker.getEventSequence();
        console.log(`\n  Action sequence (${eventSequence.length} actions):`);
        for (let i = 0; i < Math.min(eventSequence.length, 50); i++) {
            const event = eventSequence[i];
            console.log(`    [${i}] P${event.position}: ${event.type}`);
        }
        if (eventSequence.length > 50) {
            console.log(`    ... and ${eventSequence.length - 50} more actions`);
        }
    });

    /*
     * it('should compare action generation across full state vs handler state', function (this: Mocha.Context) {
     *     this.timeout(30000);
     */

    /*
     *     const cardRepository = new MockCardRepository();
     *     const gameAdapterConfig = createGameAdapterConfig(cardRepository);
     */

    /*
     *     // Test with both Random and ISMCTS handlers
     *     const testHandlers = [
     *         {
     *             name: 'Random',
     *             strategy: new RandomDecisionStrategy(gameAdapterConfig),
     *         },
     *         {
     *             name: 'ISMCTS',
     *             strategy: new ISMCTSDecisionStrategy(gameAdapterConfig),
     *         },
     *     ];
     */

    /*
     *     for (const handlerTest of testHandlers) {
     *         const players = [
     *             // @ts-expect-error
     *             new HandlerChain([new PocketTCGHandler(handlerTest.strategy)]),
     *             // @ts-expect-error
     *             new HandlerChain([new PocketTCGHandler(new RandomDecisionStrategy(gameAdapterConfig))]),
     *         ];
     */

    /*
     *         const factory = gameFactory(cardRepository);
     *         const deck0 = Array(20).fill('basic-creature');
     *         const deck1 = Array(20).fill('basic-creature');
     */

    /*
     *         const driver = factory.getGameDriver(
     *             players,
     *             { ...factory.getGameSetup().getDefaultParams(), initialDecks: [deck0, deck1] },
     *             [`${handlerTest.name} Test`, 'Random Opponent'],
     *         );
     */

    /*
     *         const tracker = new GameEventTracker();
     *         const comparator = new ActionGenerationComparator();
     *         const result = runGameWithTracking(driver, tracker, 50, comparator);
     */

    /*
     *         // Log action generation comparison
     *         console.log(`\n✓ ${handlerTest.name} handler action generation comparison:`);
     *         console.log(`  Total decision points: ${result.actionComparisonReport?.totalComparisons || 0}`);
     *         console.log(`  Identical action sets: ${result.actionComparisonReport?.identicalCount || 0}`);
     *         console.log(`  Divergent action sets: ${result.actionComparisonReport?.divergentCount || 0}`);
     *         console.log(`  Divergence rate: ${((result.actionComparisonReport?.divergenceRate || 0) * 100).toFixed(1)}%`);
     *         console.log(`  Avg full state actions: ${(result.actionComparisonReport?.avgFullStateActions || 0).toFixed(1)}`);
     *         console.log(`  Avg handler state actions: ${(result.actionComparisonReport?.avgHandlerStateActions || 0).toFixed(1)}`);
     */

    /*
     *         // Log detailed divergences if any
     *         if ((result.actionComparisonReport?.divergentCount || 0) > 0) {
     *             console.log(`\n  Divergent decisions:`);
     *             const divergent = (result.actionComparisonReport?.comparisons || []).filter((c) => !c.identical);
     *             divergent.slice(0, 5).forEach((c) => {
     *                 console.log(
     *                     `    Step ${c.step}, Player ${c.position}: ` +
     *                     `Full=${c.fullStateActionCount}, Handler=${c.handlerStateActionCount}, ` +
     *                     `Common=${c.commonActions}, Divergence=+${c.fullStateOnly}/-${c.handlerStateOnly}`,
     *                 );
     *             });
     *             if (divergent.length > 5) {
     *                 console.log(`    ... and ${divergent.length - 5} more divergent decisions`);
     *             }
     *         }
     *     }
     * });
     */
});
