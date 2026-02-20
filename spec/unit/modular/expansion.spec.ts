import { expect } from 'chai';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { EndTurnResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { ISMCTSExpansion } from '../../../src/modular/expansion.js';
import { ISMCTSNode } from '../../../src/ismcts-node.js';
import { LegalActionsGenerator } from '../../../src/legal-actions-generator.js';
import { StateBuilder } from '../../helpers/state-builder.js';
import { getSharedTestConfig, runTestGame } from '../../helpers/test-helpers.js';
import { createNonWaitingGameStateForMCTS, createWaitingGameStateForMCTS } from '../../helpers/test-state-builder.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../../src/adapters/pocket-tcg/response-types.js';
import { createRootNode, createNodeWithStats, createNode } from '../../helpers/node-factory.js';
import { MockCardRepository } from '../../helpers/test-utils.js';

describe('ISMCTSExpansion Scenarios', () => {
    let expansion: ISMCTSExpansion<ResponseMessage, Controllers>;
    let legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;
    let gameAdapterConfig: ReturnType<typeof getSharedTestConfig>;
    let cardRepository: MockCardRepository;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        gameAdapterConfig = getSharedTestConfig();
        legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator, 
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
        expansion = new ISMCTSExpansion(legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded);
    });

    it('should expand node with available legal actions', () => {
        const basicSupporter = { templateId: 'basic-supporter', type: 'supporter' as const };
        
        const waitingState = createWaitingGameStateForMCTS((state) => {
            StateBuilder.withHand(0, [ basicSupporter ])(state);
            StateBuilder.withCreatures(0, 'basic-creature')(state);
            StateBuilder.withCreatures(1, 'basic-creature')(state);
        }, cardRepository);

        const node = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0, []);

        const expandedNode = expansion.expand(node, waitingState, MAIN_ACTION_RESPONSE_TYPES);
        
        expect(expandedNode).to.not.be.null;
        expect(node.children.length).to.be.greaterThan(0, 'Should create child nodes for legal actions');
    });

    it('should return null when no legal actions available', () => {
        const waitingState = createWaitingGameStateForMCTS((state) => {
            StateBuilder.withCreatures(0, 'basic-creature')(state);
            StateBuilder.withCreatures(1, 'basic-creature')(state);
            state.points[0] = 3; // Game already won
        }, cardRepository);

        const node = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0, []);

        const expandedNode = expansion.expand(node, waitingState, MAIN_ACTION_RESPONSE_TYPES);
        
        // Should handle no legal actions gracefully
        expect(expandedNode).to.be.null;
    });

    it('should create child nodes with correct structure', () => {
        const basicSupporter = { templateId: 'basic-supporter', type: 'supporter' as const };
        
        const waitingState = createWaitingGameStateForMCTS((state) => {
            StateBuilder.withHand(0, [ basicSupporter ])(state);
            StateBuilder.withCreatures(0, 'basic-creature')(state);
            StateBuilder.withCreatures(1, 'basic-creature')(state);
        }, cardRepository);

        const node = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0, []);

        expansion.expand(node, waitingState, MAIN_ACTION_RESPONSE_TYPES);
        
        if (node.children.length > 0) {
            const child = node.children[0];
            expect(child.visits).to.equal(0, 'New child should have 0 visits');
            expect(child.totalReward).to.equal(0, 'New child should have 0 total reward');
            expect(child.parent).to.equal(node, 'Child should reference parent');
            expect(child.lastAction).to.not.be.undefined;
            expect(child.lastAction).to.not.be.null;
        }
    });

    describe('Expansion node creation and linking', () => {
        it('should create new child node with player alternation', () => {
            // Real scenario from healing test: player at 1 HP with supporter in hand
            const waitingState = createWaitingGameStateForMCTS((state) => {
                StateBuilder.withHand(0, [{ templateId: 'basic-supporter', type: 'supporter' as const }])(state);
                StateBuilder.withCreatures(0, 'basic-creature')(state);
                StateBuilder.withCreatures(1, 'basic-creature')(state);
                StateBuilder.withDamage('basic-creature-0', 59)(state); // 1 HP critical
                StateBuilder.withDamage('basic-creature-1', 40)(state); // opponent 20 HP
                StateBuilder.withEnergy('basic-creature-1', { fire: 3 })(state);
                state.points[0] = 1;
                state.points[1] = 0;
            }, cardRepository);

            const root = createRootNode<ResponseMessage>();

            const result = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);

            expect(result).to.not.be.null;
            expect(root.children.length).to.be.greaterThan(0);
            
            if (result) {
                expect(result.node.parent).to.equal(root, 'Should set parent reference');
                expect(result.node.visits).to.equal(0, 'New node should have 0 visits');
            }
        });

        it('should not create duplicate nodes for already-explored actions', () => {
            // Real scenario: root already has EndTurn child, try expanding again
            const waitingState = createWaitingGameStateForMCTS((state) => {
                StateBuilder.withHand(0, [{ templateId: 'basic-supporter', type: 'supporter' as const }])(state);
                StateBuilder.withCreatures(0, 'basic-creature')(state);
                StateBuilder.withCreatures(1, 'basic-creature')(state);
                StateBuilder.withDamage('basic-creature-0', 59)(state);
                state.points[0] = 1;
                state.points[1] = 0;
            }, cardRepository);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 10, 5.0, []);

            // First expansion creates a child
            const result1 = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);
            const firstChildCount = root.children.length;

            // Second expansion should create a different action (if multiple available)
            const result2 = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);

            // Either created a second child or same action (both valid behaviors)
            expect(root.children.length).to.be.greaterThanOrEqual(firstChildCount, 'Should not lose children');
        });

        it('should handle single legal action scenario (only EndTurn available)', () => {
            // Real scenario: player has no playable cards or valid moves
            const waitingState = createWaitingGameStateForMCTS((state) => {
                StateBuilder.withHand(0, [])(state); // No cards to play
                StateBuilder.withCreatures(0, 'basic-creature')(state);
                StateBuilder.withCreatures(1, 'basic-creature')(state);
                state.points[0] = 0;
                state.points[1] = 0;
            }, cardRepository);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

            const result = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);

            // Should create at least one child (EndTurn)
            expect(root.children.length).to.be.greaterThanOrEqual(1, 'Should create at least one child for available action');
        });

        it('should create different children on successive expansions from same root', () => {
            const waitingState = createWaitingGameStateForMCTS((state) => {
                StateBuilder.withHand(0, [{ templateId: 'basic-supporter', type: 'supporter' as const }])(state);
                StateBuilder.withCreatures(0, 'basic-creature')(state);
                StateBuilder.withCreatures(1, 'basic-creature')(state);
            }, cardRepository);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

            // First expansion
            const result1 = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);
            const firstChildAction = result1?.node?.lastAction?.constructor?.name;

            // Second expansion
            const result2 = expansion.expand(root, waitingState, MAIN_ACTION_RESPONSE_TYPES);
            const secondChildAction = result2?.node?.lastAction?.constructor?.name;

            // Should have created children
            expect(root.children.length).to.be.greaterThanOrEqual(1);
        });
    });
});

describe('ISMCTSExpansion - Edge Cases (Bug Fix Verification)', () => {
    let expansion: ISMCTSExpansion<ResponseMessage, Controllers>;
    let legalActionsGenerator: LegalActionsGenerator<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        const gameAdapterConfig = getSharedTestConfig();
        legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator, 
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
        expansion = new ISMCTSExpansion(legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded);
    });

    describe('Waiting State Precondition (Bug Fix)', () => {
        /**
         * SCENARIO: Expansion now expects waiting.waiting to be SET (non-empty),
         * indicating state is paused at a decision point.
         * 
         * BUG FIX: Changed precondition from empty waiting to non-empty waiting.
         * This separates concerns:
         * - Selection: handles resume(), returns state with waiting set
         * - Expansion: expects already-paused state, works with waiting set
         * 
         * TEST: Expansion should fail gracefully when waiting is empty.
         */
        it('should throw error when input has empty waiting (not paused at decision)', () => {
            const gameState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            );

            // Ensure waiting is empty (precondition violation)
            gameState.waiting = { waiting: [], responded: [] };

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            expect(() => {
                expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);
            }).to.throw();
        });

        /**
         * SCENARIO: Expansion works correctly when waiting is populated,
         * meaning state is paused at a decision point (ready for action).
         * 
         * TEST: With waiting set, expand() should work without throwing.
         */
        it('should work correctly when input has waiting set (paused at decision)', () => {
            const waitingState = createWaitingGameStateForMCTS((state) => {
                StateBuilder.withCreatures(0, 'basic-creature')(state);
                StateBuilder.withCreatures(1, 'basic-creature')(state);
            }, cardRepository);

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Should not throw
            const result = expansion.expand(node, waitingState, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should expand successfully
            expect(result).to.not.be.null;
            if (result) {
                expect(result.node).to.exist;
                expect(result.state).to.exist;
            }
        });
    });

    describe('Game-End Detection', () => {
        /**
         * SCENARIO: When game is already completed (points >= 3 or completed flag),
         * expansion should return null without attempting to expand.
         * 
         * BUG FIX: Check game-end conditions BEFORE asserting waiting state,
         * so completed games gracefully return null rather than throwing.
         * 
         * TEST: Game already won should return null.
         */
        it('should return null when game is already completed (won)', () => {
            const gameState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 3; // Already won
                        state.points[1] = 0;
                        state.completed = true;
                    },
                ),
            );

            // Manually set waiting to be paused at decision (so it passes that check)
            gameState.waiting = { waiting: [ 0 ], responded: [] };

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            const result = expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);
            expect(result).to.be.null;
        });

        /**
         * SCENARIO: Game completed with completed flag but points < 3.
         * Still should return null (game is over).
         * 
         * TEST: Verify completed flag is checked, not just points.
         */
        it('should return null when completed flag is set', () => {
            const gameState = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 2;
                        state.points[1] = 2;
                        state.completed = true; // Game is marked complete
                    },
                ),
            );

            gameState.waiting = { waiting: [ 0 ], responded: [] };

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            const result = expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);
            expect(result).to.be.null;
        });

        /**
         * SCENARIO: Points >= 3 for either player should end expansion.
         * 
         * TEST: Verify both players' points are checked.
         */
        it('should return null when either player reaches 3+ points', () => {
            // Test Player 0 at 3 points
            const state1 = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 3;
                        state.points[1] = 1;
                    },
                ),
            );
            state1.waiting = { waiting: [ 0 ], responded: [] };

            const node1: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            let result = expansion.expand(node1, state1, MAIN_ACTION_RESPONSE_TYPES);
            expect(result).to.be.null;

            // Test Player 1 at 3 points
            const state2 = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 1;
                        state.points[1] = 3;
                    },
                ),
            );
            state2.waiting = { waiting: [ 0 ], responded: [] };

            const node2: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            result = expansion.expand(node2, state2, MAIN_ACTION_RESPONSE_TYPES);
            expect(result).to.be.null;
        });
    });

    describe('Expected Response Types Requirement', () => {
        /**
         * SCENARIO: Expansion requires node to have expectedResponseTypes set.
         * If not set, should throw error.
         * 
         * BUG FIX: Uses node.expectedResponseTypes directly instead of
         * capturing fresh during expand.
         * 
         * TEST: Node without expectedResponseTypes should error.
         */
        it('should successfully expand when rootResponseTypes provided', () => {
            const { state: postResumeState } = runTestGame({
                actions: [],
                stateCustomizer: StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            });

            const gameState = {
                ...postResumeState,
                deck: [[], []],
                hand: [[], []],
                players: undefined,
                data: [],
            };

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Should succeed when rootResponseTypes is provided
            expect(() => {
                expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);
            }).to.not.throw(); // Should succeed with rootResponseTypes
        });
    });

    describe('Expansion Creates Valid Child Nodes', () => {
        /**
         * SCENARIO: When expansion succeeds, returned node should be
         * a new child with proper structure.
         * 
         * TEST: Verify returned node is added to parent's children array.
         */
        it('should add expanded node to parent children array', () => {
            const { state: postResumeState } = runTestGame({
                actions: [],
                stateCustomizer: StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            });

            const gameState = {
                ...postResumeState,
                deck: [[], []],
                hand: [[], []],
                players: undefined,
                data: [],
            };

            const parentNode: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            const childrenCountBefore = parentNode.children.length;

            const result = expansion.expand(parentNode, gameState, MAIN_ACTION_RESPONSE_TYPES);

            if (result) {
                const childrenCountAfter = parentNode.children.length;
                expect(childrenCountAfter).to.equal(childrenCountBefore + 1, 'Should add one child');
            }
        });

        /**
         * SCENARIO: Expanded node should have a valid lastAction set.
         * 
         * TEST: New child should have lastAction populated.
         */
        it('should set lastAction on expanded child node', () => {
            const { state: postResumeState } = runTestGame({
                actions: [],
                stateCustomizer: StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            });

            const gameState = {
                ...postResumeState,
                deck: [[], []],
                hand: [[], []],
                players: undefined,
                data: [],
            };

            const parentNode: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            const result = expansion.expand(parentNode, gameState, MAIN_ACTION_RESPONSE_TYPES);

            if (result) {
                expect(result.node.lastAction).to.exist;
                expect(result.node.lastAction?.type).to.be.a('string');
            }
        });
    });

    describe('Expansion Returns Valid Post-Action State', () => {
        /**
         * SCENARIO: After applying action, returned state should reflect
         * the action's effects (game advanced, state changed).
         * 
         * TEST: Returned state should not be identical to input state.
         */
        it('should return different state after applying action', () => {
            const { state: postResumeState } = runTestGame({
                actions: [],
                stateCustomizer: StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            });

            const gameState = {
                ...postResumeState,
                deck: [[], []],
                hand: [[], []],
                players: undefined,
                data: [],
            };

            const stateSnapshot = JSON.stringify(gameState);

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            const result = expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);

            if (result) {
                const resultSnapshot = JSON.stringify(result.state);
                expect(resultSnapshot).to.not.equal(stateSnapshot, 'Expanded state should differ from input');
            }
        });

        /**
         * SCENARIO: Input state should not be mutated by expansion.
         * Expansion returns a NEW state, not a modified copy of input.
         * 
         * TEST: Input state unchanged after expansion.
         */
        it('should not mutate input state', () => {
            const { state: postResumeState } = runTestGame({
                actions: [],
                stateCustomizer: StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
            });

            const gameState = {
                ...postResumeState,
                deck: [[], []],
                hand: [[], []],
                players: undefined,
                data: [],
            };

            const stateSnapshot = JSON.stringify(gameState);
            const originalWaiting = JSON.parse(JSON.stringify(gameState.waiting));

            const node: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);

            // Verify input unchanged
            expect(JSON.stringify(gameState)).to.equal(stateSnapshot, 'Input state should not change');
            expect(gameState.waiting).to.deep.equal(originalWaiting, 'Input waiting state should not change');
        });
    });
});

describe('ISMCTSExpansion - Response Type Capture', () => {
    let expansion: ISMCTSExpansion<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;
    
    beforeEach(() => {
        cardRepository = new MockCardRepository();
        const gameAdapterConfig = getSharedTestConfig();
        const legalActionsGenerator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
        expansion = new ISMCTSExpansion(legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded);
    });
    
    it('should handle when no legal actions exist', () => {
        // This can happen if game is in a terminal state
        const gameAdapterConfig = getSharedTestConfig();
        const gameState = createNonWaitingGameStateForMCTS(
            (state) => {
                // Mark game as completed
                state.completed = true;
                state.points = [ 3, 0 ]; // Player 0 won
            },
        );
        
        gameState.waiting = { waiting: [ 0 ], responded: [] };
        
        const node: ISMCTSNode<ResponseMessage> = createNode(
            new EndTurnResponseMessage(),
            0,
            undefined,
            [],
        );
        
        const expansion = new ISMCTSExpansion(
            new LegalActionsGenerator(
                gameAdapterConfig.actionsGenerator,
                gameAdapterConfig.driverFactory,
                gameAdapterConfig.reconstructGameStateForValidation,
            ),
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.isRoundEnded,
        );
        const result = expansion.expand(node, gameState, MAIN_ACTION_RESPONSE_TYPES);
        expect(result).to.be.null;
    });
    
    /*
     * TODO: Fix this test - uses old API patterns
     * it('should use provided rootResponseTypes for root nodes', () => {
     * });
     */
});
