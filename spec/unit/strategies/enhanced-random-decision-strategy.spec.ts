import { expect } from 'chai';
import { ControllerHandlerState, ControllerState, IndexedControllers, Message } from '@cards-ts/core';
import { EnhancedRandomDecisionStrategy } from '../../../src/strategies/enhanced-random-decision-strategy.js';
import { GameAdapterConfig } from '../../../src/adapter-config.js';
import { GameDriver } from '../../../src/utils/driver-types.js';
import { FrameworkControllers } from '../../../src/ismcts-types.js';

type TestControllers = IndexedControllers & FrameworkControllers;

type TestResponseMessage = Message & {
    type: 'attack-response' | 'retreat-response' | 'end-turn-response';
    actionId: string;
};

function createAction(type: TestResponseMessage['type'], actionId: string): TestResponseMessage {
    return {
        type,
        components: [],
        actionId,
    };
}

function createAdapterConfig(
    candidateActions: TestResponseMessage[],
    immediateWinningAction: TestResponseMessage | null,
): GameAdapterConfig<TestResponseMessage, TestControllers> {
    return {
        actionsGenerator: {
            generateCandidateActions: () => candidateActions,
        },
        driverFactory: () => ({
            getValidationError: () => undefined,
            getState: () => ({} as ControllerState<TestControllers>),
            handleEvent: () => true,
            gameState: {
                controllers: {
                    waiting: {
                        get: () => ({ waiting: [ 0 ], responded: [] }),
                    },
                    players: {
                        getFor: (position: number) => ({ position }),
                    },
                },
            },
        }) as unknown as GameDriver<TestResponseMessage, TestControllers>,
        isRoundEnded: () => false,
        getRoundReward: () => 0.5,
        determinization: {
            determinize: (handlerData) => handlerData as unknown as ControllerState<TestControllers>,
        },
        reconstructGameStateForValidation: (handlerData) => handlerData as unknown as ControllerState<TestControllers>,
        getPlayerNames: () => [ 'Player 1', 'Player 2' ],
        createHandler: () => ({}),
        getImmediateWinningAction: () => immediateWinningAction,
    };
}

describe('EnhancedRandomDecisionStrategy', () => {
    const handlerData = {
        players: { position: 0 },
    } as unknown as ControllerHandlerState<TestControllers>;

    it('should prioritize guaranteed immediate winning action when available', () => {
        const retreatAction = createAction('retreat-response', 'retreat');
        const attackAction = createAction('attack-response', 'attack-win');
        const config = createAdapterConfig([ retreatAction, attackAction ], attackAction);
        const strategy = new EnhancedRandomDecisionStrategy(config);

        const action = strategy.getAction(handlerData, [ 'attack-response', 'retreat-response', 'end-turn-response' ]);
        expect(action).to.equal(attackAction);
    });

    it('should fall back to random selection when no immediate win is available', () => {
        const firstAction = createAction('retreat-response', 'retreat');
        const secondAction = createAction('end-turn-response', 'end-turn');
        const config = createAdapterConfig([ firstAction, secondAction ], null);
        const strategy = new EnhancedRandomDecisionStrategy(config);

        const action = strategy.getAction(handlerData, [ 'retreat-response', 'end-turn-response' ]);
        expect(action).to.be.oneOf([ firstAction, secondAction ]);
    });
});
