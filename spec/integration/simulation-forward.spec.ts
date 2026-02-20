import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ISMCTS } from '../../src/modular/ismcts.js';
import { MockCardRepository } from '../helpers/test-utils.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { createWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../src/adapters/pocket-tcg/response-types.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';

describe('ISMCTS Forward Simulation', () => {
    let simulation: ISMCTS<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        simulation = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)); 
    });

    it('attack action should produce winning state when opponent is at 20 HP', () => {
        /**
         * SCENARIO: Opponent at 20 HP, player can attack for 20 damage.
         * EXPECTED: Attack should guarantee immediate KO and game completion.
         */
        const cardRepository = new MockCardRepository();
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP (60 max)
                StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Can attack for 20 damage
            ),
            cardRepository,
        );
        
        // Verify MCTS scores it correctly
        const actions = simulation.getActions(gameState, 0, MAIN_ACTION_RESPONSE_TYPES, { iterations: 10, maxDepth: 15 });
        
        const attackMCTS = actions.find(a => a.action?.constructor.name === 'AttackResponseMessage');
        const endTurnMCTS = actions.find(a => a.action?.constructor.name === 'EndTurnResponseMessage');
        
        // Attack should score perfectly since it guarantees immediate win
        expect(attackMCTS).to.exist;
        expect(attackMCTS!.score).to.equal(1.0, 'Attack should score 1.0 for guaranteed knockout');
    });

    it('all actions should score high when player is in winning position', () => {
        /**
         * SCENARIO: Player can KO opponent immediately with attack
         * - Player: healthy creature, 1 energy (can attack for 20 damage)
         * - Opponent: at 20 HP (60 max), no energy
         * 
         * EXPECTED: Attack should score 1.0 (guaranteed KO)
         */
        const cardRepository = new MockCardRepository();
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP (60 max)
                StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Can attack for 20 damage = guaranteed KO
            ),
            cardRepository,
        );
         
        const actions = simulation.getActions(gameState, 0, MAIN_ACTION_RESPONSE_TYPES, { iterations: 10, maxDepth: 15 });
        
        expect(actions).to.have.length.of.at.least(1, 'Should return actions');
        
        // Attack should score highest since it's a guaranteed KO
        const attackAction = actions.find(a => a.action?.constructor.name === 'AttackResponseMessage');
        expect(attackAction).to.exist;
        expect(attackAction!.score).to.equal(1.0, 'Attack should score 1.0 for guaranteed knockout');
    });
});
