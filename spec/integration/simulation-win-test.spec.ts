import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ISMCTSSimulation } from '../../src/modular/simulation.js';
import { PocketTCGDeterminization } from '../../src/adapters/pocket-tcg/determinization.js';
import { createMockCardRepository } from '../helpers/test-utils.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { createNonWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';

// Test repository with creatures that can win quickly
const testRepository = createMockCardRepository({
    creatures: [
        {
            templateId: 'strong-attacker',
            name: 'Strong Attacker',
            maxHp: 100,
            type: 'fire',
            weakness: 'water',
            retreatCost: 1,
            attacks: [{ name: 'Power Attack', damage: 70, energyRequirements: [{ type: 'fire', amount: 1 }] }],
        },
        {
            templateId: 'weak-defender',
            name: 'Weak Defender', 
            maxHp: 60,
            type: 'water',
            weakness: 'fire',
            retreatCost: 1,
            attacks: [{ name: 'Weak Attack', damage: 10, energyRequirements: [{ type: 'water', amount: 1 }] }],
        },
    ],
});

describe('Simulation Win Test', () => {
    let simulation: ISMCTSSimulation<ResponseMessage, Controllers>;
    let determinization: PocketTCGDeterminization;

    beforeEach(() => {
        const config = createGameAdapterConfig(testRepository);
        simulation = new ISMCTSSimulation(
            config.driverFactory,
            config.isRoundEnded,
            config.getRoundReward,
            config,
            config.getTimeoutReward,
        );
        determinization = new PocketTCGDeterminization(testRepository);
    });

    it('should have at least one simulation not return 0.5 when Player 0 can win', () => {
        /*
         * Set up a scenario where Player 0 has a strong attacker vs weak defender
         * Player 0 needs to: attach energy (turn 1) -> attack and win (turn 2)
         */
        const gameState = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'strong-attacker'),
                StateBuilder.withCreatures(1, 'weak-defender'),
                StateBuilder.withCurrentEnergy(0, 'fire'), // Player 0 has energy available to attach
            ),
        );

        const results: number[] = [];
        
        // Run 10 simulations to see if any return non-0.5 values
        for (let i = 0; i < 10; i++) {
            const result = simulation.simulate(gameState, 0, 30);
            results.push(result);
        }

        
        // Check that at least one simulation doesn't return 0.5
        const nonDrawResults = results.filter(r => r !== 0.5);
        
        expect(nonDrawResults.length).to.be.greaterThan(0, 
            'At least one simulation should not end in a draw (0.5) when Player 0 can win');
    });

    it('should win immediately when Player 0 can already attack', () => {
        // Player 0 already has energy attached and can attack to win
        const gameState = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'strong-attacker'),
                StateBuilder.withCreatures(1, 'weak-defender'),
                StateBuilder.withEnergy('strong-attacker-0', { fire: 1 }), // Already attached
            ),
        );

        const result = simulation.simulate(gameState, 0, 10);
        
        expect(result).to.not.equal(0.5, 'Should not timeout when can win immediately');
    });

    it('should attach energy then win in 2 turns', () => {
        // Player 0 needs to attach energy first, then attack
        const gameState = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'strong-attacker'),
                StateBuilder.withCreatures(1, 'weak-defender'),
                StateBuilder.withCurrentEnergy(0, 'fire'), // Available to attach
            ),
        );

        const result = simulation.simulate(gameState, 0, 20);
        
        expect(result).to.not.equal(0.5, 'Should not timeout when can attach then win');
    });
});
