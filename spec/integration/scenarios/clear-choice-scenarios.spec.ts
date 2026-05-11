import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { 
    PlayCardResponseMessage,
    SelectActiveCardResponseMessage,
    AttackResponseMessage,
    EndTurnResponseMessage,
    AttachEnergyResponseMessage,
    RetreatResponseMessage,
    EvolveResponseMessage,
    UseAbilityResponseMessage,
    SelectTargetResponseMessage,
} from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { createWaitingGameStateForMCTS, createNonWaitingGameStateForMCTS } from '../../helpers/test-state-builder.js';
import { ISMCTS } from '../../../src/modular/ismcts.js';
import { StateBuilder } from '../../helpers/state-builder.js';
import { MockCardRepository } from '../../helpers/test-utils.js';
import { createMockCardRepository } from '../../helpers/test-utils.js';
import { MAIN_ACTION_RESPONSE_TYPES, SELECT_ACTIVE_CARD_RESPONSE_TYPES, SELECT_TARGET_RESPONSE_TYPES } from '../../../src/adapters/pocket-tcg/response-types.js';
import { createGameAdapterConfig } from '../../helpers/test-helpers.js';
import { testBinaryChoice } from './utils/binary-choice-test.js';
import { validateScenario } from './utils/scenario-validation.js';

// Standard action response types for main game phase
const STANDARD_GAME_PHASE_ACTIONS = MAIN_ACTION_RESPONSE_TYPES;

// Test-specific repository with creatures that can attack with fire energy
const testRepository = createMockCardRepository({
    creatures: [
        {
            templateId: 'vulnerable-creature',
            name: 'Vulnerable Creature',
            maxHp: 60,
            type: 'fire',
            weakness: 'water',
            retreatCost: 1,
            attacks: [{ name: 'Quick Attack', damage: 10, energyRequirements: [{ type: 'fire', amount: 1 }] }], // Reduced to 10 damage
        },
        {
            templateId: 'strong-creature', 
            name: 'Strong Creature',
            maxHp: 120,
            type: 'fire',
            weakness: 'water',
            retreatCost: 2,
            attacks: [{ name: 'Power Attack', damage: 40, energyRequirements: [{ type: 'fire', amount: 1 }] }],
        },
    ],
});

describe('ISMCTS Binary Choice Scenarios', () => {
    let simulation: ISMCTS<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        simulation = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)); 
    });

    it('should heal damaged creature instead of ending turn', () => {
        const healingSupporter = { templateId: '20-hp-heal-supporter', type: 'supporter' as const };
        
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withHand(0, [
                    healingSupporter,
                ]),
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withDamage('basic-creature-0', 59), // Player active: 1 HP
                StateBuilder.withDamage('basic-creature-1', 40), // Opponent: 20 HP (KO-able in 1 hit)
                StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent can attack
                (state) => {
                    state.points = [ 2, 2 ];
                },
            ),
            cardRepository,
        );
        
        validateScenario({
            gameState,
            gameAdapterConfig: simulation.gameAdapterConfig,
            responseTypes: STANDARD_GAME_PHASE_ACTIONS,
            victoryPath: [
                [ 0, new PlayCardResponseMessage('20-hp-heal-supporter', 'supporter') ], // VICTORY: Heal from 1 HP to 21 HP (player has no energy to attack, so must survive to win)
                [ 0, new EndTurnResponseMessage() ],
                [ 1, new AttackResponseMessage(0) ], // Opponent attacks (21 → 1 HP), but healed creature survives (would have died without heal)
                [ 0, new AttachEnergyResponseMessage(0) ], // Attach newly generated energy (none was attached before, now possible to attack)
                [ 0, new AttackResponseMessage(0) ], // Attack for 20 damage → KO opponent at 20 HP, win 3-2
            ],
            defeatPath: [
                [ 0, new EndTurnResponseMessage() ], // DEFEAT: No heal, active stays at 1 HP
                [ 1, new AttackResponseMessage(0) ], // Opponent attacks 1 HP creature → KO immediately, opponent scores (2→3), game lost
            ],
            description: 'Healing enables survival when at critical health',
        });
        
        testBinaryChoice({
            gameState,
            simulation,
            responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
            expectedAction: new PlayCardResponseMessage('20-hp-heal-supporter', 'supporter'),
            description: 'Healing should be preferred when creature is at critical health',
            allowViableAlternatives: true,
        });
    });

    it('should attach energy when needed instead of ending turn', () => {
        /**
         * SCENARIO: Player must attach energy THIS TURN to attack and win.
         * - Player: 1 basic creature (no energy), already has 2 points
         * - Opponent: 1 basic creature at 20 HP (40 damage), already has 2 points  
         * - Hand: 1 fire energy in zone (must attach to attack)
         * - Both at critical game state: first to score 3 points wins
         * 
         * IF ATTACH ENERGY + ATTACK:
         * 1. Player attaches energy → creature now has 1 energy
         * 2. Player attacks for 20 damage → opponent KO'd at 20 HP
         * 3. Opponent has no bench → player wins (3 points)
         * 
         * IF END TURN (NO ATTACH):
         * 1. Player passes, loses momentum and winning opportunity
         * 2. Opponent can play defensive cards or attack back
         * 3. Game continues without guaranteed win
         */
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withCurrentEnergy(0, 'fire'), // Energy in zone to attach
                StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP
                StateBuilder.withDamage('basic-creature-0', 40), // Player at 20 HP (same - one attack KOs)
                StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent has 1 energy to attack
                (state) => {
                    // Set points - both at 2 (one away from victory)
                    state.points = [ 2, 2 ];
                },
            ),
            cardRepository,
        );

        // Validate scenario - attach enables immediate winning attack
        validateScenario({
            gameState,
            gameAdapterConfig: simulation.gameAdapterConfig,
            responseTypes: STANDARD_GAME_PHASE_ACTIONS,
            victoryPath: [
                [ 0, new AttachEnergyResponseMessage(0) ], // VICTORY: Attach fire energy to active (now has 1 energy)
                [ 0, new AttackResponseMessage(0) ], // Attack for 20 damage → KO opponent at 20 HP, player wins 3-2
            ],
            defeatPath: [
                [ 0, new EndTurnResponseMessage() ], // DEFEAT: End turn without attaching energy, no path to immediate win
                [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 20 (player at 20 HP, survives but game continues)
            ],
            description: 'Energy attachment required for immediate winning attack',
        });

        testBinaryChoice({
            gameState,
            simulation,
            responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
            expectedAction: new AttachEnergyResponseMessage(0),
            description: 'Should attach energy to enable winning attack',
            allowViableAlternatives: false,
        });
    });

    it.skip('should play creatures to build board presence', () => {
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'), // Active only, no bench
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withDamage('basic-creature-0', 20), // Player active at 40 HP (survives 20 damage twice)
                StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP (will die to our attack)
                StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Player can attack for 20
                StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent can attack for 20
                StateBuilder.withHand(0, [{ templateId: 'basic-creature', type: 'creature' }]), // 1 creature to play
                (state) => {
                    state.points = [ 2, 2 ]; // Both at 2 points (close game)
                },
            ),
            cardRepository,
        );
        
        validateScenario({
            gameState,
            gameAdapterConfig: simulation.gameAdapterConfig,
            responseTypes: STANDARD_GAME_PHASE_ACTIONS,
            victoryPath: [
                [ 0, new PlayCardResponseMessage('basic-creature', 'creature') ], // VICTORY: Play creature to bench (now have backup)
                [ 0, new AttackResponseMessage(0) ], // Attack for 20 → KO opponent at 20 HP, player scores (2→3), wins
            ],
            defeatPath: [
                [ 0, new EndTurnResponseMessage() ], // DEFEAT: Don't play creature, pass without board presence
                [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 20 (40 → 20 HP)
                [ 0, new EndTurnResponseMessage() ], // Continue passing
                [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 20 (20 → 0 HP), KO our only creature, scores (2→3), opponent wins
            ],
            description: 'Board presence scenario - play creature for survival',
        });
        
        testBinaryChoice({
            gameState,
            simulation,
            responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
            expectedAction: new PlayCardResponseMessage('basic-creature', 'creature'),
            description: 'Should play creatures to build board presence for survival',
            allowViableAlternatives: false,
        });
    });

    // Strategic Decision Tests (from strategic-decisions.spec.ts)
    describe('Survival Decisions', () => {
        it('should prioritize healing over ending turn when near death', () => {
            /**
             * SCENARIO: Player is on the brink of losing. Healing is the ONLY action that prevents immediate loss.
             * - Player: 2 points (needs 1 to WIN), but will LOSE if active creature dies
             * - Player active creature: 1 HP (critical, will die to ANY attack)
             * - Player bench: EMPTY (no retreat option, cannot switch out)
             * - Player hand: healing supporter (ONLY card that can save the creature)
             * - Opponent: 1 point (also at disadvantage)
             * - Opponent active creature: 20 HP (low but still dangerous)
             * 
             * CRITICAL CONSTRAINT: No bench creatures means:
             * - Cannot retreat (not an option)
             * - Cannot play new creatures (hand is empty except supporter)
             * - Cannot attack effectively (creature at 1 HP is paralyzed by fear of death)
             * - ONLY ACTION: Play the healing supporter
             * 
             * EXPECTED GAME FLOW:
             * 
             * If PLAY SUPPORTER (heal):
             * - Turn 1: Player heals → creature back to 60 HP (full health)
             * - Creature now survives any attack
             * - Player survives critical moment and can build back up
             * - Next turn: Player attacks/builds toward winning the remaining points
             * - Path to victory: heal → survive → accumulate points → WIN at 3 points
             * 
             * If END TURN:
             * - Turn 1: Player does nothing, creature still at 1 HP
             * - Turn 2: Opponent will attack with any creature
             * - Creature dies immediately (1 HP, no bench to switch to)
             * - Player loses active creature, opponent gains momentum
             * - Player loses both points next (opponent KOs again)
             * - Game is LOST (0-3)
             * 
             * WHY HEALING IS UNAMBIGUOUSLY BETTER:
             * - At 1 HP with no bench: creature will 100% die if opponent attacks
             * - Healing restores to 60 HP, effectively prevents a turn of damage
             * - This is survival vs immediate loss
             * - No other action can save the creature or provide path to victory
             * 
             * EXPECTED: Heal should score >> 0.5 (clear survival and path to victory)
             */
            const cardRepository = new MockCardRepository();
            const fullHealSupporter = { templateId: 'full-heal-supporter', type: 'supporter' as const };
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, [ fullHealSupporter ]), // Only healing option
                    StateBuilder.withCreatures(0, 'basic-creature'), // Active creature, no energy yet
                    // NO BENCH CREATURES - cannot retreat
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 59), // Player creature: 1 HP (critical)
                    StateBuilder.withDamage('basic-creature-1', 40), // Opponent creature: 20 HP
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent has energy to attack
                    // NO ENERGY TO ATTACH - player must heal or will die
                ),
                cardRepository,
            );

            // Validate scenario before running expensive MCTS
            validateScenario({
                gameState,
                gameAdapterConfig: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)).gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new PlayCardResponseMessage('full-heal-supporter', 'supporter') ], // VICTORY: Heal creature to 60 HP from critical 1 HP, no bench available so creature must survive
                    [ 0, new EndTurnResponseMessage() ],
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks healed creature (survives)
                    [ 0, new AttachEnergyResponseMessage(0) ], // Player attaches energy (generated turn 2)
                    [ 0, new AttackResponseMessage(0) ], // Player attacks for KO, wins 3-1
                ],
                defeatPath: [
                    [ 0, new EndTurnResponseMessage() ], // DEFEAT: End turn without healing, creature still at 1 HP
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks 1 HP creature for guaranteed KO (20 damage > 1 HP), opponent wins 3-2
                ],
                description: 'Healing scenario - player at critical 1 HP',
            });

            testBinaryChoice({
                gameState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)),
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new PlayCardResponseMessage('full-heal-supporter', 'supporter'),
                description: 'Healing should be prioritized when creature at critical health',
                allowViableAlternatives: true,
            });
        });

        it('should retreat damaged active creature when bench available', () => {
            const cardRepository = new MockCardRepository();
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature' ]), // Active + 1 bench
                    StateBuilder.withCreatures(1, 'basic-creature'), // Opponent no bench
                    StateBuilder.withDamage('basic-creature-0', 50), // Heavily damaged (10 HP)
                    StateBuilder.withDamage('basic-creature-1', 20), // Opponent at 40 HP
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // 1 energy for retreat or attack
                    StateBuilder.withEnergy('basic-creature-0-0', { fire: 2 }), // Bench creature has 2 fire energy to KO next turn
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent has energy to attack back
                    (state) => {
                        state.points[0] = 2; // Player at 2 points (1 away from winning!)
                        state.points[1] = 2; // Opponent at 2 points (1 away from winning!)
                    },
                ),
                cardRepository,
            );

            validateScenario({
                gameState,
                gameAdapterConfig: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)).gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new RetreatResponseMessage(0) ], // VICTORY: Retreat active's 10 HP (uses 1 fire energy for cost 1), bench 60 HP becomes active
                    [ 0, new EndTurnResponseMessage() ],
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks bench for 20 damage (60 - 20 = 40 HP, bench survives)
                    [ 0, new AttackResponseMessage(0) ], // Bench now has 2 fire energy, attacks opponent (20 → 40 HP)
                    [ 1, new EndTurnResponseMessage() ], // Opponent cannot counter in time
                    [ 0, new AttackResponseMessage(0) ], // Player attacks for KO, wins 3-2
                ],
                defeatPath: [
                    [ 0, new EndTurnResponseMessage() ], // DEFEAT: Player passes, 10 HP active stays
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 20 damage, KO's 10 HP active, scores 1 (2→3), opponent wins immediately
                ],
                description: 'Retreat scenario - active at 10 HP, bench available',
            });

            testBinaryChoice({
                gameState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)),
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new RetreatResponseMessage(0),
                description: 'Retreat to preserve board and survive lethal attack',
                allowViableAlternatives: true,
            });
        });
    });

    describe('Offensive Decisions', () => {
        it('should prioritize attacking when opponent is near knockout', () => {
            const cardRepository = new MockCardRepository();
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature', [ 'basic-creature' ]), // Opponent can retreat if needed
                    StateBuilder.withDamage('basic-creature-0', 50), // Player at 10 HP (will die to 60 damage attack)
                    StateBuilder.withDamage('basic-creature-1', 50), // Opponent at 10 HP (one hit away)
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Player can attack
                    StateBuilder.withEnergy('basic-creature-1', { fire: 3 }), // Opponent has lethal attack prepared
                    (state) => {
                        state.points[0] = 2; // Player at 2 points (1 away from winning)
                        state.points[1] = 2; // Opponent also at 2 points (1 away from winning) - so if they score, they win
                    },
                ),
                cardRepository,
            );

            validateScenario({
                gameState,
                gameAdapterConfig: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)).gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new AttackResponseMessage(0) ], // VICTORY: Attack opponent for 20 damage → KO at 10 HP, player scores (2→3), wins immediately
                ],
                defeatPath: [
                    [ 0, new EndTurnResponseMessage() ], // DEFEAT: Don't attack, opponent gets lethal attack turn
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 60 damage → KO player at 30 HP, opponent wins
                ],
                description: 'Lethal attack scenario - opponent at 10 HP',
            });

            testBinaryChoice({
                gameState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)),
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new AttackResponseMessage(0),
                description: 'Attack should be considered when opponent at low health',
                allowViableAlternatives: true,
            });
        });
    });

    describe('Resource Management', () => {
        it.skip('should evolve creatures when evolution provides advantage', () => {
            const cardRepository = new MockCardRepository();
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'), // Active only, no bench
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 40), // Player at 20 HP (exactly KO-able with 20 damage)
                    StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // Player can attack after evolution
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent can attack for 20
                    StateBuilder.withHand(0, [{ templateId: 'evolved-creature' }]), // Evolution card in hand
                    (state) => {
                        state.points[0] = 2;
                        state.points[1] = 2;
                    },
                ),
                cardRepository,
            );

            validateScenario({
                gameState,
                gameAdapterConfig: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)).gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new EvolveResponseMessage('evolved-creature', 0) ], // VICTORY: Evolve active creature (now has 1 fire energy, can attack)
                    [ 0, new AttackResponseMessage(0) ], // Evolved creature attacks for 20 → KO opponent at 20 HP, win 3-2
                ],
                defeatPath: [
                    [ 0, new EndTurnResponseMessage() ], // DEFEAT: Don't evolve, pass turn with basic creature
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 20 → KO basic 60 HP creature, opponent scores (2→3), wins
                ],
                description: 'Evolution scenario - enables winning attack path',
            });

            testBinaryChoice({
                gameState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)),
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new EvolveResponseMessage('evolved-creature', 0),
                description: 'Evolve should unlock stronger attack path',
                allowViableAlternatives: true,
            });
        });
    });

    describe('Ability Usage', () => {
        it.skip('should use beneficial abilities when available', () => {
            const cardRepository = new MockCardRepository();
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'healing-creature'), // Creature with healing ability
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('healing-creature-0', 50), // Player at 10 HP (critical)
                    StateBuilder.withDamage('basic-creature-1', 40), // Opponent at 20 HP (KO-able with 20 damage)
                    StateBuilder.withEnergy('healing-creature-0', { fire: 1 }), // Player has 1 energy (enough to use ability or attack)
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // Opponent can attack
                    (state) => {
                        state.points[0] = 2; // Player at 2 points (1 away from winning)
                        state.points[1] = 2; // Opponent at 2 points (1 away from winning)
                    },
                ),
                cardRepository,
            );

            validateScenario({
                gameState,
                gameAdapterConfig: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)).gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new UseAbilityResponseMessage(0) ], // VICTORY: Use healing ability to heal from 10 HP
                    [ 0, new AttackResponseMessage(0) ], // Attack for 20 → KO opponent at 20 HP, player scores (2→3), wins
                ],
                defeatPath: [
                    [ 0, new AttackResponseMessage(0) ], // DEFEAT: Attack directly without healing (20 damage to 20 HP = KO too!)
                ],
                description: 'Ability usage scenario - healing enables better positioning',
            });

            testBinaryChoice({
                gameState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository)),
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new UseAbilityResponseMessage(0),
                description: 'Ability usage should be considered when beneficial for survival',
                allowViableAlternatives: false,
            });
        });
    });

    describe('Post-KO Decisions', () => {
        it('should switch to benched strong creature after opponent KO to counter-attack', () => {
            /**
             * SCENARIO: After Player 0 knocks out Player 1's active creature, Player 1 must choose from bench.
             * 
             * SETUP: We use runTestGame to:
             * 1. Have Player 0 attack and KO Player 1's active creature (which starts at full HP)
             * 2. Game automatically transitions to Player 1's select-active-card phase
             * 3. We extract the waiting state directly from the game driver
             * 
             * KEY: After runTestGame dispatches P0's attack, the game is waiting for P1 to select
             * their new active. We use playerIndex 1 since that's whose turn it is to respond.
             */
            const knockoutRepository = createMockCardRepository({
                creatures: [
                    {
                        templateId: 'basic-creature',
                        name: 'Basic Creature',
                        maxHp: 60,
                        type: 'fire',
                        weakness: 'water',
                        retreatCost: 1,
                        attacks: [{ name: 'Quick Attack', damage: 60, energyRequirements: [{ type: 'fire', amount: 1 }] }],
                    },
                    {
                        templateId: 'high-retreat-creature',
                        name: 'High Retreat Creature',
                        maxHp: 60,
                        type: 'water',
                        retreatCost: 2,
                        attacks: [{ name: 'Weak Attack', damage: 10, energyRequirements: [{ type: 'water', amount: 1 }] }],
                    },
                    {
                        templateId: 'attacking-creature',
                        name: 'Attacking Creature',
                        maxHp: 80,
                        type: 'fire',
                        retreatCost: 1,
                        attacks: [{ name: 'Counter Attack', damage: 60, energyRequirements: [{ type: 'fire', amount: 1 }] }],
                    },
                ],
            });

            // Drive the game to the post-KO state by applying P0's attack directly.
            // We use driverFactory with no handlers (empty array) to avoid sync handler issues,
            // then manually apply the attack via handleEvent.
            const initialState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature', [ 'high-retreat-creature', 'attacking-creature' ]),
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }), // P0 can attack
                ),
                knockoutRepository,
            );
            const knockoutAdapterConfig = createGameAdapterConfig(knockoutRepository);
            const knockoutDriver = knockoutAdapterConfig.driverFactory(initialState, []);
            knockoutDriver.resume(); // advance to waiting=[0] (P0's attack turn)
            knockoutDriver.handleEvent(0, new AttackResponseMessage(0), undefined); // apply KO attack
            knockoutDriver.resume(); // advance through KO handling to waiting=[1] (P1 selects active)

            // Extract the state directly from the driver after knockout
            const postKnockoutState = knockoutDriver.getState();

            // P0 now has 1 prize from the KO. Advance to 2 prizes so the scenario is decisive:
            // - bench[0] (high-retreat, water type, needs water energy): P1 can't attack since the
            //   energy zone only produces fire energy. P0 immediately KOs it → P0 reaches 3 prizes → P0 wins.
            // - bench[1] (attacking-creature, fire type): P1 gets fire energy, attacks P0's only creature,
            //   KOs it (P0 has no bench) → P0 runs out of creatures → P1 wins.
            (postKnockoutState as unknown as Record<string, unknown[]>).points[0] = 2;

            const knockoutSimulation = new ISMCTS<ResponseMessage, Controllers>(
                createGameAdapterConfig(knockoutRepository),
            );

            testBinaryChoice({
                gameState: postKnockoutState,
                simulation: knockoutSimulation,
                responseTypes: SELECT_ACTIVE_CARD_RESPONSE_TYPES,
                // Bench position 1 is 'attacking-creature' (80 HP, 60-damage attack)
                expectedAction: new SelectActiveCardResponseMessage(1),
                description: 'Should switch to the strong attacking creature for counter-attack potential',
                playerIndex: 1,
            });
        });

        it.skip('should attack with risky 50/50 damage chance to KO opponent', () => {
            /**
             * SCENARIO: Player has an attack with variable damage (coin-flip based).
             * - Player active creature: has coin-flip attack (two independent flips = 0/20/40 damage)
             * - Opponent active creature: 40 HP (vulnerable to 40 damage KO, survives 0-20 damage)
             * - Probabilities: 25% KO (both heads), 50% damage (one heads), 25% miss (both tails)
             * 
             * EXPECTED GAME FLOW:
             * 
             * If ATTACK (risky but high upside):
             * - 25% chance: Both coins heads → 40 damage → KO opponent → WIN
             * - 50% chance: One heads → 20 damage → opponent at 20 HP (still dangerous)
             * - 25% chance: Both tails → 0 damage → opponent attacks back (likely lethal)
             * - Expected value: 0.25 * 1.0 + 0.50 * 1.0 + 0.25 * 0.0 = 0.75
             * 
             * If END TURN (passive):
             * - Pass the turn to opponent
             * - Opponent attacks with lethal force
             * - Very likely outcome: lose next turn
             * - Expected value: ~0.0 (almost guaranteed loss)
             * 
             * WHY ATTACKING IS BETTER:
             * - Even 25% KO chance is better than guaranteed loss
             * - 50% partial damage case still leaves game contested
             * - 25% miss case is only equal to doing nothing
             * - Attack has positive expected value despite variance
             * 
             * EXPECTED: Attack should score > 0.5 (better than end turn)
             */
            const coinFlipRepository = createMockCardRepository({
                creatures: [
                    {
                        templateId: 'coin-flip-attacker',
                        name: 'Coin Flip Attacker',
                        maxHp: 60,
                        type: 'darkness',
                        retreatCost: 1,
                        attacks: [
                            {
                                name: 'Variable Strike',
                                damage: 0,
                                energyRequirements: [{ type: 'darkness', amount: 1 }],
                                description: 'Flip 2 coins. This attack does 20 damage for each heads.',
                                effects: [
                                    {
                                        type: 'hp',
                                        amount: {
                                            type: 'coin-flip',
                                            headsValue: 20,
                                            tailsValue: 0,
                                        },
                                        target: { type: 'fixed', player: 'opponent', position: 'active' },
                                        operation: 'damage',
                                    },
                                    {
                                        type: 'hp',
                                        amount: {
                                            type: 'coin-flip',
                                            headsValue: 20,
                                            tailsValue: 0,
                                        },
                                        target: { type: 'fixed', player: 'opponent', position: 'active' },
                                        operation: 'damage',
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        templateId: 'vulnerable-opponent',
                        name: 'Vulnerable Opponent',
                        maxHp: 40,
                        type: 'fire',
                        retreatCost: 1,
                        attacks: [{ name: 'Lethal Attack', damage: 60, energyRequirements: [{ type: 'fire', amount: 1 }] }],
                    },
                ],
            });

            const coinFlipSimulation = new ISMCTS<ResponseMessage, Controllers>(
                createGameAdapterConfig(coinFlipRepository),
            );

            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'coin-flip-attacker'),
                    StateBuilder.withCreatures(1, 'vulnerable-opponent'),
                    StateBuilder.withDamage('coin-flip-attacker-0', 0), // Player 0 at full 60 HP
                    StateBuilder.withDamage('vulnerable-opponent-1', 0), // Opponent at 40 HP (survives 20 but not 40)
                    StateBuilder.withEnergy('coin-flip-attacker-0', { darkness: 1 }), // Can use coin-flip attack
                    StateBuilder.withEnergy('vulnerable-opponent-1', { fire: 1 }), // Opponent ready to attack back
                    (state) => {
                        state.points[0] = 2; // Player at 2 points (1 away from winning)
                        state.points[1] = 2; // Opponent at 2 points (1 away from winning)
                    },
                ),
                coinFlipRepository,
            );

            // Validate scenario before running expensive MCTS
            validateScenario({
                gameState,
                gameAdapterConfig: coinFlipSimulation.gameAdapterConfig,
                responseTypes: STANDARD_GAME_PHASE_ACTIONS,
                victoryPath: [
                    [ 0, new AttackResponseMessage(0) ], // VICTORY: 25% both coins heads (40 dmg) → KO opponent at 40 HP and win 3-2, 50% one heads (20 dmg) → opponent at 20 HP still dangerous, 25% both tails (0 dmg) → risky but can try
                ],
                defeatPath: [
                    [ 0, new EndTurnResponseMessage() ], // DEFEAT: Pass without attacking
                    [ 1, new AttackResponseMessage(0) ], // Opponent attacks for 60 damage → KO player at 60 HP, opponent scores (2→3), wins
                ],
                description: 'Coin-flip attack scenario - opponent at 40 HP',
            });

            testBinaryChoice({
                gameState,
                simulation: coinFlipSimulation,
                responseTypes: [ ...STANDARD_GAME_PHASE_ACTIONS ],
                expectedAction: new AttackResponseMessage(0),
                description: 'Should prefer risky coin-flip attack with KO potential over passive end turn',
                allowViableAlternatives: true,
            });
        });
    });

    // Setup Phase Tests (from initial-setup.spec.ts)
    describe('Setup Scenarios', () => {
        it.skip('should choose high HP Pokemon as active when opponent has immediate threat', () => {
            /**
             * SCENARIO: After KO, select strongest creature to survive.
             * - Player bench: 2 healthy creatures (60 HP each)
             * - Opponent: creature at 60 HP with 3 fire energy (can attack for 60 damage)
             * 
             * IF SELECT HEALTHY CREATURE:
             * - Player switches to 60 HP creature
             * - Opponent attacks for 60 damage but player survives with defensive play
             * - Path to WIN exists
             * 
             * IF SELECT WEAK CREATURE:
             * - Same outcome but with less advantage
             */
            const cardRepository = new MockCardRepository();
            const testSimulation = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository));
            
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature', 'basic-creature' ]),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 60),
                    StateBuilder.withEnergy('basic-creature-1', { fire: 3 }),
                ),
                cardRepository,
            );

            const responseTypes = SELECT_ACTIVE_CARD_RESPONSE_TYPES;

            const action = testSimulation.getBestAction(gameState, 0, responseTypes, { iterations: 50, maxDepth: 20 });

            expect(action).to.be.instanceOf(SelectActiveCardResponseMessage, 'Should select active card during KO recovery');
            
            const selectAction = action as SelectActiveCardResponseMessage;
            // Should select a healthy bench creature - index 0
            expect(selectAction.benchIndex).to.equal(0, 'Should select available bench creature');
            
            // Also verify via JSON serialization that it's a valid SelectActiveCardResponseMessage
            const expectedAction = new SelectActiveCardResponseMessage(0);
            expect(JSON.stringify(action)).to.equal(JSON.stringify(expectedAction));
        });
    });

    describe('Target Selection Decisions', () => {
        /**
         * These tests cover scenarios where an attack effect requires the player to choose
         * which of the opponent's bench creatures to deal damage to.  The "bench-sniper"
         * card mimics real cards like Heatmor (Tongue Whip) – its attack deals 0 damage
         * to the active creature and instead asks the attacker to choose a bench target
         * for 30 damage.
         *
         * P0's bench-sniper is nearly dead (60/80 damage taken, 20 HP left).
         * P1's active basic-creature has fire energy and can finish it off next turn.
         *
         * Two bench targets are available:
         *   - fieldIndex 1: fragile-pokemon  (30 HP max, currently full) → KO-able by the 30 bench snipe
         *   - fieldIndex 2: basic-creature   (60 HP max, currently full) → only wounded
         *
         * With both players at 2 points, KO'ing the fragile bench immediately brings P0 to
         * 3 points and wins the game.  Targeting the healthy bench leaves the game open and
         * P1 counter-KOs P0's dying bench-sniper next turn to win instead.
         */
        it('should target near-dead bench Pokemon for a game-winning KO', () => {
            const sniperAdapterConfig = createGameAdapterConfig(new MockCardRepository());

            // Drive to the state where P0 has just attacked and now must choose a bench target.
            // P0: bench-sniper (active, fire energy, 60 damage taken = 20 HP left)
            // P1: basic-creature active (fire energy, can KO P0 next turn) +
            //     fragile-pokemon bench (30 HP = exactly KO-able by bench snipe) +
            //     basic-creature bench (60 HP = survives the snipe)
            const initialState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'bench-sniper'),
                    StateBuilder.withCreatures(1, 'basic-creature', [ 'fragile-pokemon', 'basic-creature' ]),
                    StateBuilder.withEnergy('bench-sniper-0', { fire: 1 }),
                    StateBuilder.withDamage('bench-sniper-0', 60), // 20 HP left – will lose if P1 gets to attack
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // P1 can counter-KO
                    (state) => {
                        state.points = [ 2, 2 ]; 
                    },
                ),
                new MockCardRepository(),
            );

            const driver = sniperAdapterConfig.driverFactory(initialState, []);
            driver.resume(); // → waiting=[0], P0's action turn
            driver.handleEvent(0, new AttackResponseMessage(0), undefined); // bench-sniper attacks
            driver.resume(); // → waiting=[0] for SelectTargetResponseMessage

            const selectTargetState = driver.getState();

            testBinaryChoice({
                gameState: selectTargetState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(sniperAdapterConfig),
                responseTypes: SELECT_TARGET_RESPONSE_TYPES,
                // fieldIndex 1 = fragile-pokemon (30 HP) → KO → P0 wins 3-2
                expectedAction: new SelectTargetResponseMessage([{ playerId: 1, fieldIndex: 1 }]),
                description: 'Should snipe the fragile bench Pokemon for a game-winning KO',
            });
        });

        it('should snipe the bench creature closest to KO when multiple are damaged', () => {
            const sniperAdapterConfig = createGameAdapterConfig(new MockCardRepository());

            // P1's bench has two creatures: one already wounded (20 HP left) and one at full health.
            // Sniping the wounded one guarantees a KO; sniping the healthy one does not.
            const initialState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'bench-sniper'),
                    StateBuilder.withCreatures(1, 'basic-creature', [ 'basic-creature', 'basic-creature' ]),
                    StateBuilder.withEnergy('bench-sniper-0', { fire: 1 }),
                    StateBuilder.withDamage('bench-sniper-0', 60), // P0 active at 20 HP
                    StateBuilder.withEnergy('basic-creature-1', { fire: 1 }), // P1 active can counter-KO
                    StateBuilder.withDamage('basic-creature-1-0', 40), // bench[0]: 20 HP left → KO-able
                    // bench[1] ('basic-creature-1-1') is at full 60 HP
                    (state) => {
                        state.points = [ 2, 2 ]; 
                    },
                ),
                new MockCardRepository(),
            );

            const driver = sniperAdapterConfig.driverFactory(initialState, []);
            driver.resume();
            driver.handleEvent(0, new AttackResponseMessage(0), undefined);
            driver.resume();

            const selectTargetState = driver.getState();

            testBinaryChoice({
                gameState: selectTargetState,
                simulation: new ISMCTS<ResponseMessage, Controllers>(sniperAdapterConfig),
                responseTypes: SELECT_TARGET_RESPONSE_TYPES,
                // fieldIndex 1 = bench[0] (already 40 damage, 20 HP left → KO by 30 snipe)
                expectedAction: new SelectTargetResponseMessage([{ playerId: 1, fieldIndex: 1 }]),
                description: 'Should snipe the already-damaged bench creature for a game-winning KO',
            });
        });
    });
});
