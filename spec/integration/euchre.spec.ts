import { ResponseMessage } from '@cards-ts/euchre/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import { ControllerHandlerState } from '@cards-ts/core';
import { expect } from 'chai';
import { HandlerChain } from '@cards-ts/core';
import { gameFactory } from '@cards-ts/euchre/dist/game-factory.js';
import { EuchreAdapterConfig, EuchreISMCTSHandler } from '../../src/adapters/euchre/index.js';
import { RandomDecisionStrategy } from '../../src/strategies/random-decision-strategy.js';

/**
 * Simple event tracker for debugging
 */
class SimpleEventTracker {
    private events: Array<{ playerIndex: number; type: string; validated: boolean; merged: boolean }> = [];

    trackEvent(playerIndex: number, type: string, validated: boolean, merged: boolean) {
        this.events.push({ playerIndex, type, validated, merged });
        if (!validated || !merged) {
            console.log(`[Event] P${playerIndex}.${type}: validated=${validated}, merged=${merged}`);
        }
    }

    getEvents() {
        return this.events;
    }

    getStats() {
        return {
            totalEvents: this.events.length,
            validatedCount: this.events.filter(e => e.validated).length,
            mergedCount: this.events.filter(e => e.merged).length,
        };
    }
}

/**
 * Strategy wrapper that logs action generation
 */
function createTrackedStrategy(baseStrategy: RandomDecisionStrategy<ResponseMessage, Controllers>, tracker: SimpleEventTracker, playerIndex: number) {
    return new Proxy(baseStrategy, {
        get(target, prop) {
            const value = target[prop as keyof RandomDecisionStrategy<ResponseMessage, Controllers>];
            
            if (prop === 'getAction' && typeof value === 'function') {
                return function(handlerData: ControllerHandlerState<Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]) {
                    const action = value.apply(target, [ handlerData, expectedResponseTypes ]);
                    
                    if (action) {
                        const actionType = (action).type || 'unknown';
                        console.log(`[P${playerIndex}] getAction: expecting ${expectedResponseTypes?.join('|')} => ${actionType}`);
                        tracker.trackEvent(playerIndex, actionType, true, true);
                    } else {
                        console.log(`[P${playerIndex}] getAction: expecting ${expectedResponseTypes?.join('|')} => NO ACTION`);
                    }
                    
                    return action;
                };
            }
            
            return value;
        },
    });
}

/**
 * Euchre handler integration test
 * 
 * Tests that given a valid Euchre game state, the handler can generate options
 * and play through a full game
 */
describe.skip('Euchre Handler Integration', () => {
    
    it('should generate order-up action from valid game state', function(this: Mocha.Context) {
        this.timeout(5000);

        const factory = gameFactory;
        const handler = new EuchreISMCTSHandler(new RandomDecisionStrategy(EuchreAdapterConfig));
        
        // @ts-expect-error - HandlerChain expects different handler interface
        const handlerChain = new HandlerChain([ handler ]);
        
        const driver = factory.getGameDriver(
            [ handlerChain, handlerChain, handlerChain, handlerChain ],
            { maxScore: 10 },
            [ 'P0', 'P1', 'P2', 'P3' ],
        );

        try {
            driver.resume();
            expect(driver.isWaitingOnPlayer(), 'Should be waiting on player after first resume').to.be.true;
            console.log('✓ Handler successfully generated action for order-up phase');
        } catch (error) {
            console.error('✗ Handler failed:', error);
            throw error;
        }
    });

    it('should play a full Euchre game', function(this: Mocha.Context) {
        this.timeout(15000);

        const factory = gameFactory;
        const tracker = new SimpleEventTracker();
        
        // Create tracked handlers for each player
        const handlers = [
            new EuchreISMCTSHandler(createTrackedStrategy(new RandomDecisionStrategy(EuchreAdapterConfig), tracker, 0)),
            new EuchreISMCTSHandler(createTrackedStrategy(new RandomDecisionStrategy(EuchreAdapterConfig), tracker, 1)),
            new EuchreISMCTSHandler(createTrackedStrategy(new RandomDecisionStrategy(EuchreAdapterConfig), tracker, 2)),
            new EuchreISMCTSHandler(createTrackedStrategy(new RandomDecisionStrategy(EuchreAdapterConfig), tracker, 3)),
        ];
        
        const handlerChains = handlers.map(h => {
            // @ts-expect-error - HandlerChain expects different handler interface
            return new HandlerChain([ h ]);
        });
        
        const driver = factory.getGameDriver(
            handlerChains,
            { maxScore: 10 },
            [ 'P0', 'P1', 'P2', 'P3' ],
        );

        let stepCount = 0;
        const maxSteps = 500;

        try {
            while (!driver.getState().completed && stepCount < maxSteps) {
                driver.resume();
                stepCount++;
            }

            const state = driver.getState();
            const scores = state.score;
            
            const stats = tracker.getStats();
            console.log(`\nGame state after ${stepCount} steps:`);
            console.log(`  Completed: ${state.completed}`);
            console.log(`  Scores: [${scores.join(', ')}]`);
            console.log(`  Event stats: ${stats.totalEvents} total, ${stats.validatedCount} validated, ${stats.mergedCount} merged`);
            
            // Game should complete
            expect(state.completed, 'Game should complete').to.be.true;
            expect(stepCount, 'Game should complete within 500 steps').to.be.lessThan(maxSteps);
            
            // Find winner - should be one team with 10+ points
            const team0Score = scores[0] + scores[2]; // Players 0 and 2
            const team1Score = scores[1] + scores[3]; // Players 1 and 3
            
            console.log(`✓ Euchre game completed in ${stepCount} steps`);
            console.log(`  Team 0 (P0+P2): ${team0Score} points`);
            console.log(`  Team 1 (P1+P3): ${team1Score} points`);
            
            // At least one team should have 10+ points
            expect(Math.max(team0Score, team1Score), 'Winning team should have 10+ points').to.be.greaterThanOrEqual(10);
        } catch (error) {
            console.error(`✗ Game failed at step ${stepCount}:`, error instanceof Error ? error.message : String(error));
            throw error;
        }
    });
});
