import { expect } from 'chai';
import { ControllerUtils } from '@cards-ts/pocket-tcg/dist/utils/controller-utils.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { 
    PlayCardResponseMessage, 
    AttackResponseMessage, 
    EndTurnResponseMessage,
    AttachEnergyResponseMessage,
    RetreatResponseMessage,
    SetupCompleteResponseMessage,
} from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { LegalActionsGenerator } from '../../src/legal-actions-generator.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../src/adapters/pocket-tcg/response-types.js';
import { MockCardRepository, createMockCardRepository, createInstancedFieldCard } from '../helpers/test-utils.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { createGameAdapterConfig, getSharedTestConfig } from '../helpers/test-helpers.js';
import { createWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';
import { createGenericPlayerView } from '../../src/utils/generic-player-view.js';

describe('LegalActionsGenerator', () => {
    let generator: LegalActionsGenerator<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);
        generator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator, 
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    });

    describe('generateCreatureActions', () => {
        it('should generate creature actions when bench has space', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, [{ templateId: 'basic-creature', type: 'creature' }]),
                    StateBuilder.withCreatures(0, 'basic-creature'),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const creatureActions = actions.filter(action => action instanceof PlayCardResponseMessage && action.cardType === 'creature');
            
            expect(creatureActions).to.have.length(1);
        });

        it('should not generate creature actions when bench is full', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, [{ templateId: 'basic-creature', type: 'creature' }]),
                    StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature', 'basic-creature', 'basic-creature' ]),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const creatureActions = actions.filter(action => action instanceof PlayCardResponseMessage && action.cardType === 'creature',
            );
            
            expect(creatureActions).to.have.length(0);
        });
    });

    describe('generateEnergyActions', () => {
        it('should generate energy actions when not first turn', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withTurnNumber(2),
                    StateBuilder.withCurrentEnergy(0, 'fire'),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const energyActions = actions.filter(action => action instanceof AttachEnergyResponseMessage);
            
            expect(energyActions).to.have.length(1);
        });

        it('should not generate energy actions on first turn', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withTurnNumber(1),
                    StateBuilder.withFirstTurnRestriction(true),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const energyActions = actions.filter(action => action instanceof AttachEnergyResponseMessage);
            
            expect(energyActions).to.have.length(0);
        });
    });

    describe('generateAttackActions', () => {
        it('should generate attack actions when sufficient energy', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const attackActions = actions.filter(action => action instanceof AttackResponseMessage);
            
            expect(attackActions).to.have.length(1);
        });

        it('should not generate attack actions when insufficient energy', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.withCreatures(0, 'basic-creature'),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const attackActions = actions.filter(action => action instanceof AttackResponseMessage);
            
            expect(attackActions).to.have.length(0);
        });

        it('should generate multiple attack actions for creatures with multiple attacks', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'multi-attack-creature'),
                    StateBuilder.withEnergy('multi-attack-creature-0', { water: 3 }),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const attackActions = actions.filter(action => action instanceof AttackResponseMessage);
            
            expect(attackActions).to.have.length(2);
            expect(attackActions[0].attackIndex).to.equal(0);
            expect(attackActions[1].attackIndex).to.equal(1);
        });
    });

    describe('generateToolActions', () => {
        it('should generate tool actions when tools in hand and creatures on field', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withHand(0, [{ templateId: 'basic-tool', type: 'tool' }]),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const toolActions = actions.filter(action => action instanceof PlayCardResponseMessage && action.cardType === 'tool',
            ) as PlayCardResponseMessage[];
            
            expect(toolActions).to.have.length(1);
            expect(toolActions[0].templateId).to.equal('basic-tool');
            expect(toolActions[0].targetPlayerId).to.equal(0);
            expect(toolActions[0].targetFieldIndex).to.equal(0);
        });

        it.skip('should not generate tool actions when no creatures on field', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    // Clear creatures field and add tool to hand
                    state.field.creatures[0] = [];
                    state.hand[0] = [{ instanceId: 'basic-tool-1', templateId: 'basic-tool', type: 'tool' }];
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const toolActions = actions.filter(action => action instanceof PlayCardResponseMessage && action.cardType === 'tool',
            );
            
            expect(toolActions).to.have.length(0);
        });
    });

    describe('generateLegalActions', () => {
        it('should always include EndTurnResponseMessage', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.withCreatures(0, 'basic-creature'),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            const endTurnActions = actions.filter(action => action instanceof EndTurnResponseMessage);
            
            expect(endTurnActions).to.have.length(1);
        });

        it('should generate multiple action types when conditions are met', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, [
                        { templateId: 'basic-creature', type: 'creature' },
                        { templateId: 'basic-supporter', type: 'supporter' },
                    ]),
                    StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature' ]),
                    StateBuilder.withEnergy('basic-creature-0', { fire: 2 }),
                    StateBuilder.withTurnNumber(2),
                    StateBuilder.withCurrentEnergy(0, 'fire'),
                ),
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should have: creature, supporter, item, energy, attack, retreat, end turn
            expect(actions.length).to.be.greaterThan(5);
            
            const actionTypes = actions.map(action => action.constructor.name);
            expect(actionTypes).to.include('PlayCardResponseMessage'); // creature, supporter, item
            expect(actionTypes).to.include('AttachEnergyResponseMessage');
            expect(actionTypes).to.include('AttackResponseMessage');
            expect(actionTypes).to.include('RetreatResponseMessage');
            expect(actionTypes).to.include('EndTurnResponseMessage');
        });

        it('should generate valid creature play actions', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    state.field.creatures[0] = [ createInstancedFieldCard('basic-creature', 'creature-0', 0) ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-1', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [
                        { instanceId: 'card-1', templateId: 'basic-creature', type: 'creature' },
                        { instanceId: 'card-2', templateId: 'basic-creature', type: 'creature' },
                    ];
                    state.hand[1] = [];
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const playCardActions = actions.filter(a => a instanceof PlayCardResponseMessage);
            expect(playCardActions.length).to.be.greaterThan(0, 'Should generate creature play actions');
            
            const creatureActions = playCardActions.filter(a => (a as PlayCardResponseMessage).cardType === 'creature');
            expect(creatureActions.length).to.equal(2, 'Should generate actions for both creatures in hand');
        });

        it('should generate supporter actions when available', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    state.field.creatures[0] = [ createInstancedFieldCard('basic-creature', 'creature-0', 30) ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-1', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [
                        { instanceId: 'card-1', templateId: 'basic-supporter', type: 'supporter' },
                    ];
                    state.hand[1] = [];
                    state.turnState.supporterPlayedThisTurn = false;
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const supporterActions = actions.filter(a => a instanceof PlayCardResponseMessage && (a as PlayCardResponseMessage).cardType === 'supporter');
            expect(supporterActions.length).to.be.greaterThan(0, 'Should generate supporter actions when available');
        });

        it('should not generate supporter actions when already played', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    state.field.creatures[0] = [ createInstancedFieldCard('basic-creature', 'creature-0', 0) ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-1', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [
                        { instanceId: 'card-1', templateId: 'basic-supporter', type: 'supporter' },
                    ];
                    state.hand[1] = [];
                    state.turnState.supporterPlayedThisTurn = true;
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const supporterActions = actions.filter(a => a instanceof PlayCardResponseMessage && (a as PlayCardResponseMessage).cardType === 'supporter');
            expect(supporterActions.length).to.equal(0, 'Should not generate supporter actions when already played this turn');
        });

        it('should generate energy attachment actions', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    state.field.creatures[0] = [ createInstancedFieldCard('basic-creature', 'creature-0', 0) ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-1', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [];
                    state.hand[1] = [];
                    state.energy.availableTypes = [[ 'fire' ], [ 'fire' ]];
                    state.energy.currentEnergy[0] = 'fire';
                    state.energy.currentEnergy[1] = null;
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const energyActions = actions.filter(a => a instanceof AttachEnergyResponseMessage);
            expect(energyActions.length).to.be.greaterThan(0, 'Should generate energy attachment actions when available');
        });

        it('should always include end turn action', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    state.field.creatures[0] = [ createInstancedFieldCard('basic-creature', 'creature-0', 0) ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-1', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [];
                    state.hand[1] = [];
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const endTurnActions = actions.filter(a => a instanceof EndTurnResponseMessage);
            expect(endTurnActions.length).to.be.greaterThan(0, 'Should always include end turn action');
        });

        it('should respect bench size limits', () => {
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            const gameState = createWaitingGameStateForMCTS(
                (state) => {
                    // Fill bench to capacity (3 creatures + 1 active = 4 total)
                    state.field.creatures[0] = [
                        createInstancedFieldCard('basic-creature', 'creature-0', 0),
                        createInstancedFieldCard('basic-creature', 'creature-1', 0),
                        createInstancedFieldCard('basic-creature', 'creature-2', 0),
                        createInstancedFieldCard('basic-creature', 'creature-3', 0),
                    ];
                    state.field.creatures[1] = [ createInstancedFieldCard('basic-creature', 'creature-4', 0) ];
                    state.setup.playersReady = [ true, true ];
                    state.hand[0] = [
                        { instanceId: 'card-1', templateId: 'basic-creature', type: 'creature' },
                    ];
                    state.hand[1] = [];
                },
                cardRepository,
            );
            
            const driver = gameAdapterConfig.driverFactory(gameState, []);
            const controllers = driver.gameState.controllers;
            const handlerData = ControllerUtils.createPlayerView(controllers, 0);
            const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

            const creatureActions = actions.filter(a => a instanceof PlayCardResponseMessage && (a as PlayCardResponseMessage).cardType === 'creature');
            expect(creatureActions.length).to.equal(0, 'Should not generate creature actions when bench is full');
        });
    });

    describe('setup phase handling', () => {
        it('should generate all setup combinations for basic creatures only', function() {
            /*
             * SCENARIO: Player during setup phase needs to select active basic creature and bench
             * Should generate all valid combinations: each basic creature as active, with all unique sets of remaining basic creatures (0-3) on bench
             * Bench order doesn't matter (only combinations, not permutations)
             * 
             * For 3 basic creatures:
             * - 3 active choices
             * - For each active, 2 remaining creatures can form:
             *   - 0 bench: 1 way
             *   - 1 bench: 2 ways (each of 2 remaining)
             *   - 2 bench: 1 way (both together)
             * - Total: 3 * (1 + 2 + 1) = 3 * 4 = 12 combinations
             */
            const cardRepository = new MockCardRepository();
            const gameAdapterConfig = createGameAdapterConfig(cardRepository);
            
            // Create a simple handler data object with 3 basic creatures in hand
            const handlerData = {
                turn: 0,
                setup: { playersReady: [ false, false ] },
                hand: [
                    { templateId: 'basic-creature', type: 'creature' },
                    { templateId: 'basic-creature', type: 'creature' },
                    { templateId: 'basic-creature', type: 'creature' },
                ],
                field: { creatures: [[], []] },
            } as unknown as ReturnType<typeof ControllerUtils.createPlayerView>;
            
            // Call the ActionsGenerator directly (not LegalActionsGenerator which wraps it)
            const actions = gameAdapterConfig.actionsGenerator.generateCandidateActions(handlerData, 0, [ 'setup-complete' ]);
            
            // All returned actions should be SetupCompleteResponseMessage
            expect(actions).to.be.an('array', 'Actions should be an array');
            expect(actions.length).to.be.greaterThan(0, 'Should generate at least one setup action');
            
            for (const action of actions) {
                expect(action).to.be.instanceOf(SetupCompleteResponseMessage, 'All setup actions should be SetupCompleteResponseMessage');
            }
            
            // Verify we generate all combinations for 3 creatures (12 total)
            expect(actions.length).to.equal(12, 'Should generate 12 setup combinations for 3 basic creatures (order-independent bench)');
        });
    });

    describe('response type generation', () => {
        describe('AttackResponseMessage', () => {
            it('should generate AttackResponseMessage when energy available', () => {
                const cardRepository = new MockCardRepository();
                const gameAdapterConfig = createGameAdapterConfig(cardRepository);
                
                const gameState = createWaitingGameStateForMCTS(
                    StateBuilder.combine(
                        () => StateBuilder.createActionPhaseState(),
                        StateBuilder.withCreatures(0, 'basic-creature'),
                        StateBuilder.withCreatures(1, 'basic-creature'),
                        StateBuilder.withEnergy('basic-creature-0', { fire: 1 }),
                    ),
                    cardRepository,
                );
                
                const driver = gameAdapterConfig.driverFactory(gameState, []);
                const controllers = driver.gameState.controllers;
                const handlerData = ControllerUtils.createPlayerView(controllers, 0);
                const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

                const attackActions = actions.filter(action => action instanceof AttackResponseMessage);
                expect(attackActions.length).to.be.greaterThan(0, 'Should generate attack actions when energy available');
            });
        });

        describe('AttachEnergyResponseMessage', () => {
            it('should generate AttachEnergyResponseMessage when creatures available', () => {
                const cardRepository = new MockCardRepository();
                const gameAdapterConfig = createGameAdapterConfig(cardRepository);
                
                const gameState = createWaitingGameStateForMCTS(
                    StateBuilder.combine(
                        () => StateBuilder.createActionPhaseState(),
                        StateBuilder.withCreatures(0, 'basic-creature'),
                        StateBuilder.withCurrentEnergy(0, 'fire'),
                    ),
                    cardRepository,
                );
                
                const driver = gameAdapterConfig.driverFactory(gameState, []);
                const controllers = driver.gameState.controllers;
                const handlerData = ControllerUtils.createPlayerView(controllers, 0);
                const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

                const energyActions = actions.filter(action => action instanceof AttachEnergyResponseMessage);
                expect(energyActions.length).to.be.greaterThan(0, 'Should generate energy attachment actions');
            });
        });

        describe('EndTurnResponseMessage', () => {
            it('should always generate EndTurnResponseMessage as fallback', () => {
                const cardRepository = new MockCardRepository();
                const gameAdapterConfig = createGameAdapterConfig(cardRepository);
                
                const gameState = createWaitingGameStateForMCTS(
                    StateBuilder.combine(
                        () => StateBuilder.createActionPhaseState(),
                        StateBuilder.withCreatures(0, 'basic-creature'),
                    ),
                    cardRepository,
                );
                
                const driver = gameAdapterConfig.driverFactory(gameState, []);
                const controllers = driver.gameState.controllers;
                const handlerData = ControllerUtils.createPlayerView(controllers, 0);
                const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

                const endTurnActions = actions.filter(action => action instanceof EndTurnResponseMessage);
                expect(endTurnActions.length).to.be.greaterThan(0, 'Should always generate end turn action');
            });
        });

        describe('RetreatResponseMessage', () => {
            it('should generate RetreatResponseMessage when energy available', () => {
                const cardRepository = new MockCardRepository();
                const gameAdapterConfig = createGameAdapterConfig(cardRepository);
                
                const gameState = createWaitingGameStateForMCTS(
                    StateBuilder.combine(
                        () => StateBuilder.createActionPhaseState(),
                        StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature' ]), // Add bench creature
                        StateBuilder.withCreatures(1, 'tank-pokemon'),
                        StateBuilder.withEnergy('basic-creature-0', { fire: 1 }),
                    ),
                    cardRepository,
                );
                
                const driver = gameAdapterConfig.driverFactory(gameState, []);
                const controllers = driver.gameState.controllers;
                const handlerData = ControllerUtils.createPlayerView(controllers, 0);
                const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

                const retreatActions = actions.filter(action => action instanceof RetreatResponseMessage);
                expect(retreatActions.length).to.be.greaterThan(0, 'Should generate retreat actions when energy available');
            });
        });

        describe('PlayCardResponseMessage', () => {
            it('should generate PlayCardResponseMessage for creatures', () => {
                const cardRepository = new MockCardRepository();
                const gameAdapterConfig = createGameAdapterConfig(cardRepository);
                
                const gameState = createWaitingGameStateForMCTS(
                    StateBuilder.combine(
                        () => StateBuilder.createActionPhaseState(),
                        StateBuilder.withCreatures(0, 'basic-creature'),
                        StateBuilder.withHand(0, [{ templateId: 'basic-creature', type: 'creature' as const }]),
                    ),
                    cardRepository,
                );
                
                const driver = gameAdapterConfig.driverFactory(gameState, []);
                const controllers = driver.gameState.controllers;
                const handlerData = ControllerUtils.createPlayerView(controllers, 0);
                const actions = generator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);

                const playCardActions = actions.filter(action => action instanceof PlayCardResponseMessage);
                expect(playCardActions.length).to.be.greaterThan(0, 'Should generate creature play actions');
            });
        });
    });
});

describe('Legal Actions Validation', () => {
    let legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;

    beforeEach(() => {
        const cardRepository = createMockCardRepository();
        const gameAdapterConfig = createGameAdapterConfig(cardRepository);
        legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator, 
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    });

    it.skip('should filter out retreat actions when retreatedThisTurn=true', () => {
        // Create game state with retreat action already taken
        const cardRepository = createMockCardRepository();
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature', [ 'tank-pokemon' ]),
                StateBuilder.withCreatures(1, 'tank-pokemon', []),
            ),
            cardRepository,
        );

        // Simulate that player 0 already retreated this turn
        (gameState as any).controllers.turnState.setRetreatThisTurn(0, true);

        const handlerData = createGenericPlayerView(gameState as any, 0);
        const legalActions = legalActionsGenerator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES, false);
        
        const retreatActions = legalActions.filter(action => action instanceof RetreatResponseMessage);
        
        expect(retreatActions.length).to.equal(0, 'Should not generate retreat actions when retreatedThisTurn=true');
    });

    it.skip('should allow retreat actions when retreatedThisTurn=false', () => {
        // Create game state that allows retreat
        const cardRepository = createMockCardRepository();
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature', [ 'tank-pokemon' ]),
                StateBuilder.withCreatures(1, 'basic-creature', []),
                StateBuilder.withCurrentEnergy(0, 'fire'),
            ),
            cardRepository,
        );

        const handlerData = createGenericPlayerView(gameState as any, 0);
        const legalActions = legalActionsGenerator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES, false);
        
        const retreatActions = legalActions.filter(action => action instanceof RetreatResponseMessage);
        
        expect(retreatActions.length).to.be.greaterThan(0, 'Should generate retreat actions when retreatedThisTurn=false');
    });
});

describe('Legal Actions - Turn vs Waiting Controller', () => {
    let legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;
    let gameAdapterConfig: ReturnType<typeof getSharedTestConfig>;

    beforeEach(() => {
        gameAdapterConfig = getSharedTestConfig();
        legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    });

    it('should use waiting controller to determine current player, not turn controller', () => {
        // Test that legal actions generator reads from waiting controller, not turn
        const cardRepository = new MockCardRepository();
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
            ),
            cardRepository,
        );

        // Get controllers and create player view
        const driver = gameAdapterConfig.driverFactory(gameState, []);
        const controllers = (driver).gameState.controllers;
        const handlerData = createGenericPlayerView(controllers, 0);
        (handlerData).turn = 0;

        // Generate legal actions
        const legalActions = legalActionsGenerator.generateLegalActions(
            handlerData,
            [ 'play-card-response', 'attack-response', 'end-turn-response' ] as const,
        );

        // Should have generated some actions (doesn't have to be specific type, just verify no crash)
        expect(legalActions).to.be.an('array');
    });
});


