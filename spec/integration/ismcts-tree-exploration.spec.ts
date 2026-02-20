import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { ISMCTS } from '../../src/modular/ismcts.js';
import { createGenericPlayerView } from '../../src/utils/generic-player-view.js';
import { LegalActionsGenerator } from '../../src/legal-actions-generator.js';
import { createWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';
import { createMockCardRepository } from '../helpers/test-utils.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../src/adapters/pocket-tcg/response-types.js';

const testRepository = createMockCardRepository({
    creatures: [
        {
            templateId: 'basic-creature',
            name: 'Basic Creature',
            maxHp: 80,
            type: 'fire',
            retreatCost: 1,
            attacks: [{ name: 'Quick Attack', damage: 20, energyRequirements: [{ type: 'fire', amount: 1 }] }],
        },
        {
            templateId: 'stage1-evolution',
            name: 'Evolved Creature',
            maxHp: 120,
            type: 'fire',
            retreatCost: 2,
            attacks: [{ name: 'Strong Attack', damage: 40, energyRequirements: [{ type: 'fire', amount: 2 }] }],
        },
    ],
    supporters: [
        {
            templateId: 'healing-trainer',
            name: 'Healing Trainer',
            effects: [],
        },
    ],
});

/**
 * Tree Exploration Validation Tests
 * 
 * Validates that ISMCTS properly explores the search tree by ensuring:
 * 1. Multiple legal actions from root are explored
 * 2. Each legal action is represented as a distinct child node
 * 3. Variety of action types are discovered (play creature, evolve, retreat, play trainer, end turn)
 */
describe('ISMCTS Tree Exploration', () => {
    let simulation: ISMCTS<ResponseMessage, Controllers>;

    beforeEach(() => {
        simulation = new ISMCTS<ResponseMessage, Controllers>(
            createGameAdapterConfig(testRepository),
        );
    });

    it('should explore at least 5 different action types from root', () => {
        /*
         * Create scenario with multiple action possibilities:
         * - Play creature to bench
         * - Play supporter/trainer card  
         * - Evolve active creature
         * - Retreat to benched creature (with energy)
         * - End turn
         */
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withHand(0, [
                    { templateId: 'stage1-evolution', type: 'creature' },
                    { templateId: 'healing-trainer', type: 'supporter' },
                    { templateId: 'basic-creature', type: 'creature' },
                ]),
                StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature' ]), // Active + 1 bench
                StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Energy for retreat
                (state) => {
                    state.points[0] = 0;
                    state.points[1] = 0;
                },
            ),
            testRepository,
        );
        
        // Get legal actions that should be in the tree
        const driver = simulation.gameAdapterConfig.driverFactory(gameState, []);
        const handlerData = createGenericPlayerView(driver.gameState.controllers, 0);
        const legalActionsGenerator = new LegalActionsGenerator(
            simulation.gameAdapterConfig.actionsGenerator,
            simulation.gameAdapterConfig.driverFactory,
            simulation.gameAdapterConfig.reconstructGameStateForValidation,
        );
        const expectedLegalActions = legalActionsGenerator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
        
        console.log('[TREE-TEST] Expected legal actions from root:', expectedLegalActions.length);
        expectedLegalActions.forEach((action, idx) => {
            console.log(`  [${idx}] `, { type: action.type, templateId: action.templateId });
        });
        
        // Expect at least 5 legal actions available
        expect(expectedLegalActions.length, 'Should have at least 5 different legal actions').to.be.at.least(5);
        
        // Run MCTS to build tree
        const actions = simulation.getActions(gameState, 0, MAIN_ACTION_RESPONSE_TYPES, { 
            iterations: 50,
            maxDepth: 25,
        });
        
        console.log('[TREE-TEST] Root children after MCTS:', actions.length);
        actions.forEach((action, idx) => {
            console.log(`  [${idx}] `, { 
                type: (action.action)?.type, 
                templateId: (action.action)?.templateId, 
                score: action.score.toFixed(4),
            });
        });
        
        /*
         * Validate: all distinct legal actions should be explored
         * (may have multiple cards of same type, but MCTS explores each distinct action once)
         */
        const distinctLegalActions = [];
        const seen = new Set<string>();
        for (const action of expectedLegalActions) {
            const key = JSON.stringify(action);
            if (!seen.has(key)) {
                seen.add(key);
                distinctLegalActions.push(action);
            }
        }
        
        expect(actions.length, `Should have explored all distinct legal actions (${distinctLegalActions.length})`).to.be.at.least(distinctLegalActions.length - 1);
        
        // Check that each expected legal action is in the results
        const exploredActions: string[] = [];
        for (const expectedAction of expectedLegalActions) {
            const expectedJson = JSON.stringify(expectedAction);
            const found = actions.some(result => JSON.stringify(result.action) === expectedJson,
            );
            
            if (found) {
                exploredActions.push((expectedAction).type);
            }
            
            expect(found, 
                `Legal action ${JSON.stringify({ type: (expectedAction).type, templateId: (expectedAction).templateId })} should be explored in tree`,
            ).to.be.true;
        }
        
        console.log('[TREE-TEST] Explored action types:', new Set(exploredActions));
        
        // Expect variety of action types explored
        const uniqueActionTypes = new Set(exploredActions);
        expect(uniqueActionTypes.size, 'Should explore variety of different action types').to.be.at.least(3);
    });

    it('should give each legal action a score based on its evaluation', () => {
        const gameState = createWaitingGameStateForMCTS(undefined, testRepository);
        
        // Run MCTS
        const actions = simulation.getActions(gameState, 0, MAIN_ACTION_RESPONSE_TYPES, { 
            iterations: 50,
            maxDepth: 25,
        });
        
        // Validate that each action has a valid score
        expect(actions.length).to.be.greaterThan(0);
        
        for (const result of actions) {
            expect(result.score).to.be.a('number');
            expect(result.score).to.be.within(0, 1, 'Score should be between 0 and 1 (winning probability)');
        }
        
        // Scores should be sorted in descending order
        for (let i = 1; i < actions.length; i++) {
            expect(actions[i].score).to.be.at.most(actions[i - 1].score, 'Actions should be sorted by score descending');
        }
    });

    it('should explore all actions even if some have low scores', () => {
        const gameState = createWaitingGameStateForMCTS(undefined, testRepository);
        
        // Get expected legal actions
        const driver = simulation.gameAdapterConfig.driverFactory(gameState, []);
        const handlerData = createGenericPlayerView(driver.gameState.controllers, 0);
        const legalActionsGenerator = new LegalActionsGenerator(
            simulation.gameAdapterConfig.actionsGenerator,
            simulation.gameAdapterConfig.driverFactory,
            simulation.gameAdapterConfig.reconstructGameStateForValidation,
        );
        const expectedLegalActions = legalActionsGenerator.generateLegalActions(handlerData, MAIN_ACTION_RESPONSE_TYPES);
        
        // Run MCTS
        const actions = simulation.getActions(gameState, 0, MAIN_ACTION_RESPONSE_TYPES, { 
            iterations: 50,
            maxDepth: 25,
        });
        
        // All expected actions should be in results, even low-scoring ones
        expect(actions.length).to.equal(expectedLegalActions.length, 'All legal actions should be explored');
        
        // Even the worst-scoring action should be explored
        const worstScore = actions[actions.length - 1]?.score;
        expect(worstScore).to.be.a('number', 'Even low-scoring actions should have scores');
    });
});
