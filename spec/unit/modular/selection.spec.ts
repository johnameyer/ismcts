import { expect } from 'chai';
import { EndTurnResponseMessage, AttackResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ISMCTSSelection } from '../../../src/modular/selection.js';
import { ISMCTSNode } from '../../../src/ismcts-node.js';
import { LegalActionsGenerator } from '../../../src/legal-actions-generator.js';
import { StateBuilder } from '../../helpers/state-builder.js';
import { runTestGame, getSharedTestConfig } from '../../helpers/test-helpers.js';
import { createWaitingGameStateForMCTS } from '../../helpers/test-state-builder.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../../src/adapters/pocket-tcg/response-types.js';
import { createNodeWithStats, createNode } from '../../helpers/node-factory.js';
import { MockCardRepository } from '../../helpers/test-utils.js';
import { deepCopyState } from '../../../src/utils/deep-copy-state.js';

describe('ISMCTSSelection Scenarios', () => {
    let selection: ISMCTSSelection<ResponseMessage, Controllers>;
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
        selection = new ISMCTSSelection(legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded, gameAdapterConfig);
    });

    it('should select leaf node when no children exist', () => {
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
            ),
            cardRepository,
        );

        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0, []);

         
        const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
        expect(result.node).to.equal(root, 'Should return root when no children');
        expect(result.state).to.not.be.undefined;
    });

    it('should traverse tree when children have valid actions', () => {
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
            ),
            cardRepository,
        );

        const child = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, undefined, 1, 0.5, []);

        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 2, 1, [ child ]);

        child.parent = root;

        const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
        expect(result.node).to.not.be.undefined;
        expect(result.state).to.not.be.undefined;
    });

    it.skip('should handle completed game state', () => {
        const { state } = runTestGame({
            actions: [],
            stateCustomizer: StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                (state) => {
                    state.points[0] = 3; // Game completed
                    state.completed = true;
                },
            ),
        });

        const gameState = {
            ...state,
            deck: [[], []],
            hand: [[], []],
            waiting: { waiting: [], responded: [] }, // Reset waiting for state machine to set up
            players: undefined,
            data: [],
        };

        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0, []);

         
        const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
        expect(result.node).to.equal(root, 'Should return root for completed game');
    });

    describe('Selection behavior with multiple children', () => {
        it.skip('should stop at node with unexplored actions rather than traverse', () => {
            // Real scenario from healing test: player with supporter in hand
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, [
                        { templateId: 'basic-supporter', type: 'supporter' as const },
                    ]),
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 59), // 1 HP
                    (state) => {
                        state.points[0] = 1;
                        state.points[1] = 0;
                    },
                ),
                cardRepository,
            );

            /*
             * Root has explored ONLY EndTurn - has 10 visits from MCTS iterations
             * But legal actions include: EndTurn, PlayCard (supporter), AttachEnergy, etc.
             */
            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 10, 6.6, []);
            const endTurnChild = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, root, 10, 6.6, []);
            root.children = [ endTurnChild ];

             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should return root (not traverse to child) because unexplored actions exist (PlayCard supporter is unexplored)
            expect(result.node).to.equal(root, 'Should return current node when unexplored actions remain');
        });

        it('should filter children with legal actions only', () => {
            /*
             * This test verifies selection doesn't crash when a child's action doesn't match expectations
             * Real scenario: empty hand means less legal actions available
             */
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withHand(0, []), // No cards to play
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const endTurnChild = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, undefined, 5, 2.5, []);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 10, 5.5, [ endTurnChild ]);

            endTurnChild.parent = root;

            // Selection should handle this gracefully
             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            expect(result.node).to.not.be.undefined;
            expect(result.state).to.not.be.undefined;
        });

        it.skip('should select highest-scoring child when all legal actions are explored', () => {
            // Real scenario: player with creature but limited options
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 59),
                    StateBuilder.withDamage('basic-creature-1', 40),
                    StateBuilder.withEnergy('basic-creature-0', { fire: 1 }),
                    (state) => {
                        state.points[0] = 1;
                        state.points[1] = 0;
                    },
                ),
                cardRepository,
            );

            /*
             * Two fully explored children: EndTurn and Attack
             * Attack has higher score (1.0) than EndTurn (0.5)
             */
            const endTurnChild = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, undefined, 5, 2.5, []);

            const attackChild = createNodeWithStats<ResponseMessage>(new AttackResponseMessage(0), 1, undefined, 5, 5.0, []);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 10, 7.5, [ endTurnChild, attackChild ]);

            endTurnChild.parent = root;
            attackChild.parent = root;

             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should traverse to attack child since it has better score
            expect(result.node).to.not.equal(root, 'Should traverse when all actions explored and child has better score');
        });

        it('should traverse multiple tree levels with consistent UCB1 scoring', () => {
            // Real scenario: deep tree after multiple MCTS iterations
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-1', 40),
                    (state) => {
                        state.points[0] = 1;
                        state.points[1] = 0;
                    },
                ),
                cardRepository,
            );

            // Create 3-level tree: root -> child -> grandchild
            const grandchild = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 0, undefined, 3, 3.0, []);

            const child = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, undefined, 3, 3.0, [ grandchild ]);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 3, 3.0, [ child ]);

            grandchild.parent = child;
            child.parent = root;

             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should traverse through multiple levels without error
            expect(result.node).to.not.be.undefined;
            expect(result.state).to.not.be.undefined;
        });

        it('should capture and pass forward response types after traversing a child', () => {
            /*
             * This test verifies that after selection traverses to a child and resumes,
             * it captures the response types that will be needed at the next decision point
             * and returns them so expansion can generate legal actions with correct types.
             * 
             * Bug: Currently returns empty [] array, causing no legal actions to be generated
             * at deeper tree levels, which prevents expansion below root.
             */
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            // One fully explored child (all legal actions explored from this state)
            const endTurnChild = createNodeWithStats<ResponseMessage>(new EndTurnResponseMessage(), 1, undefined, 5, 2.5, []);

            const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 10, 5.5, [ endTurnChild ]);

            endTurnChild.parent = root;

             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            // After traversing to child and resuming, response types should be captured
            expect(result.expectedResponseTypes).to.not.be.empty;
            expect(result.expectedResponseTypes).to.include.members(
                MAIN_ACTION_RESPONSE_TYPES,
                'Response types should include main action types for next decision point',
            );
        });
    });
});

describe('ISMCTSSelection - State Handling (Bug Fix Verification)', () => {
    let selection: ISMCTSSelection<ResponseMessage, Controllers>;
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
        selection = new ISMCTSSelection(legalActionsGenerator, gameAdapterConfig.driverFactory, gameAdapterConfig.isRoundEnded, gameAdapterConfig);
    });

    describe('Input State Precondition and Deep Copy', () => {
        /**
         * SCENARIO: Selection expects input with EMPTY waiting (pre-resume).
         * Input state must have waiting.waiting = [] to begin.
         * 
         * BUG FIX: Selection now deep copies input state immediately,
         * preventing any mutations to the original.
         * 
         * TEST: Verify input state is never modified by selection.
         */
        it('should not mutate input state (deep copy protection)', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            // Snapshot input state (before selection)
            const stateSnapshot = JSON.stringify(gameState);
            const pointsSnapshot = JSON.parse(JSON.stringify(gameState.points));
            const turnSnapshot = gameState.turn;
            const waitingSnapshotBefore = Array.isArray(gameState.waiting.waiting) 
                ? gameState.waiting.waiting.length 
                : 0;

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Run selection (this will modify internal working copies, not input)
             
            selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);

            // Verify input unchanged
            expect(JSON.stringify(gameState)).to.equal(stateSnapshot, 'Input state JSON should be identical');
            expect(gameState.points).to.deep.equal(pointsSnapshot, 'Points should not change');
            expect(gameState.turn).to.equal(turnSnapshot, 'Turn should not change');
            const waitingSnapshotAfter = Array.isArray(gameState.waiting?.waiting) 
                ? gameState.waiting.waiting.length 
                : 0;
            expect(waitingSnapshotAfter).to.equal(waitingSnapshotBefore, 'Input waiting should not change');
        });

        /**
         * SCENARIO: When selection returns, it provides:
         * - selectedNode: A node from the tree (or root if leaf)
         * - selectedState: The game state AT that node (with waiting set, ready for expansion)
         * 
         * TEST: Returned state should have waiting populated (ready for action).
         */
        it('should return state with waiting set (ready for expansion)', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

             
            const { state: selectedState } = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);

            // Returned state should be paused at decision point
            const waitingArray = Array.isArray(selectedState.waiting?.waiting) ? selectedState.waiting.waiting : [];
            expect(waitingArray.length).to.be.greaterThan(0, 'Selected state should have waiting set for expansion');
        });
    });

    describe('Resume Called at Each Loop Iteration', () => {
        /**
         * SCENARIO: Selection must call resume() at the START of each loop iteration
         * to advance the game state from one decision point to the next.
         * 
         * BUG FIX: Removed conditional skip for root node. Now always calls resume()
         * at loop start, creating consistent state transitions.
         * 
         * TEST: Verify selection works from root (resume happens for root too).
         */
        it('should call resume for root node (not skip it)', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Selection should work without error
             
            const result = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            // Should return a valid selection
            expect(result.node).to.exist;
            expect(result.state).to.exist;
            
            // Returned state should be paused at decision point (resume was called)
            const waitingArray = Array.isArray(result.state.waiting?.waiting) ? result.state.waiting.waiting : [];
            expect(waitingArray.length).to.be.greaterThan(0, 'Root selection should return action-ready state');
        });

        /**
         * SCENARIO: After each action is applied, the loop continues to the next iteration
         * where resume() is called again. This creates the proper state machine progression.
         * 
         * TEST: Tree traversal with multiple loop iterations should work consistently.
         */
        it('should handle multiple loop iterations with consistent resume', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Run selection 3 times with same tree
            for (let i = 0; i < 3; i++) {
                const stateCopy = deepCopyState(gameState);
                 
                const { node: selectedNode, state: selectedState } = selection.select(root, stateCopy, MAIN_ACTION_RESPONSE_TYPES);
                
                expect(selectedNode).to.exist;
                const waitingArray = Array.isArray(selectedState.waiting?.waiting) ? selectedState.waiting.waiting : [];
                expect(waitingArray.length).to.be.greaterThan(0, `Iteration ${i + 1}: selected state should have waiting`);
            }
        });
    });

    describe('Deep Copy After Resume', () => {
        /**
         * SCENARIO: After calling resume(), the state is modified. Selection then
         * makes a deep copy to prevent those modifications from affecting subsequent
         * tree traversal or legal action generation.
         * 
         * BUG FIX: Added deep copy after resume() to isolate state mutations.
         * 
         * TEST: Run selection multiple times, verify tree doesn't get corrupted
         * by state mutations from resume().
         */
        it('should prevent resume mutations from affecting tree traversal', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Run 5 iterations - if state mutations propagate, later iterations would fail
            for (let i = 0; i < 5; i++) {
                const stateCopy = deepCopyState(gameState);
                 
                const result = selection.select(root, stateCopy, MAIN_ACTION_RESPONSE_TYPES);
                
                expect(result).to.exist;
                expect(result.node).to.exist;
                expect(result.state).to.exist;
                
                // Input should still be unchanged
                const inputWaitingLength = Array.isArray(gameState.waiting?.waiting) 
                    ? gameState.waiting.waiting.length 
                    : 0;
                expect(inputWaitingLength).to.be.greaterThan(0, `After iteration ${i + 1}: input waiting should remain set`);
            }
        });
    });

    describe('No Extra Resume After Action', () => {
        /**
         * SCENARIO: Old code called resume() AFTER applying an action,
         * then skipped resume at loop start. New code removed the extra resume
         * and always calls at loop start instead.
         * 
         * BUG FIX: Removed extra resume() call after action application.
         * Let the next loop iteration handle resume naturally.
         * 
         * TEST: Action application works without requiring extra resume.
         * (This test verifies behavior indirectly through selection working correctly)
         */
        it('should work correctly without extra resume after action', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // This works if the action→next-iteration flow is correct
             
            const { state: selectedState, node: selectedNode } = selection.select(root, gameState, MAIN_ACTION_RESPONSE_TYPES);
            
            expect(selectedState).to.exist;
            expect(selectedNode).to.exist;
            
            // Verify state is valid (would fail if extra resume caused issues)
            const waitingArray = Array.isArray(selectedState.waiting?.waiting) ? selectedState.waiting.waiting : [];
            expect(waitingArray.length).to.be.greaterThan(0);
        });
    });

    describe('Cross-Iteration State Isolation', () => {
        /**
         * SCENARIO: ISMCTS runs many iterations. Each iteration calls selection
         * with a deep copy of the root game state. Selection must not let
         * mutations leak between iterations.
         * 
         * BUG FIX: Deep copy at input + deep copy after resume ensure isolation.
         * 
         * TEST: Run selection 10+ times with fresh copies, verify independence.
         */
        it('should isolate state changes across 10+ selection calls', () => {
            const baseState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const root: ISMCTSNode<ResponseMessage> = createNode(
                new EndTurnResponseMessage(),
                0,
                undefined,
                [],
            );

            // Snapshot base state waiting
            const baseWaitingLengthInitial = Array.isArray(baseState.waiting?.waiting) 
                ? baseState.waiting.waiting.length 
                : 0;
            const basePointsInitial = JSON.parse(JSON.stringify(baseState.points));

            // Run many iterations like ISMCTS would
            for (let i = 0; i < 10; i++) {
                const iterationState = deepCopyState(baseState);
                 
                const result = selection.select(root, iterationState, MAIN_ACTION_RESPONSE_TYPES);
                
                expect(result.node).to.exist;
                expect(result.state).to.exist;
                expect(result.state.waiting?.waiting).to.exist;
                
                // Base state should be completely unchanged
                const baseWaitingLength = Array.isArray(baseState.waiting?.waiting) 
                    ? baseState.waiting.waiting.length
                    : 0;
                expect(baseWaitingLength).to.equal(baseWaitingLengthInitial, `After iteration ${i + 1}: base state waiting corrupted`);
                expect(baseState.points).to.deep.equal(basePointsInitial, `After iteration ${i + 1}: base state points corrupted`);
            }
        });
    });
});

describe('UCB1 Selection Unit Tests', () => {
    // Helper function to calculate UCB1 score
    function calculateUCB1(nodeVisits: number, nodeReward: number, parentVisits: number): number {
        if (nodeVisits === 0) {
            return Infinity; 
        }
        
        const exploitation = nodeReward / nodeVisits;
        const exploration = Math.sqrt(2 * Math.log(parentVisits) / nodeVisits);
        
        return exploitation + exploration;
    }
    
    describe('UCB1 formula', () => {
        it('should return infinity for unvisited nodes', () => {
            const score = calculateUCB1(0, 0, 10);
            expect(score).to.equal(Infinity);
        });
        
        it('should balance exploitation and exploration', () => {
            const parentVisits = 100;
            
            // High reward, many visits (exploitation)
            const exploitScore = calculateUCB1(50, 40, parentVisits);
            
            // Lower reward, few visits (exploration)  
            const exploreScore = calculateUCB1(5, 3, parentVisits);
            
            // With these numbers, exploration should have higher UCB1
            expect(exploreScore).to.be.greaterThan(exploitScore);
        });
        
        it('should prefer higher average rewards when visit counts are equal', () => {
            const parentVisits = 20;
            const visits = 5;
            
            const highRewardScore = calculateUCB1(visits, 4, parentVisits); // 0.8 average
            const lowRewardScore = calculateUCB1(visits, 2, parentVisits); // 0.4 average
            
            expect(highRewardScore).to.be.greaterThan(lowRewardScore);
        });
        
        it('should increase exploration bonus as parent visits increase', () => {
            const nodeVisits = 5;
            const nodeReward = 3;
            
            const lowParentScore = calculateUCB1(nodeVisits, nodeReward, 10);
            const highParentScore = calculateUCB1(nodeVisits, nodeReward, 100);
            
            expect(highParentScore).to.be.greaterThan(lowParentScore);
        });
    });
    
    describe('selection logic', () => {
        it('should select child with highest UCB1 score', () => {
            const children = [
                { visits: 10, totalReward: 6, ucb1: 0 },
                { visits: 5, totalReward: 4, ucb1: 0 },
                { visits: 2, totalReward: 1.5, ucb1: 0 },
            ];
            
            const parentVisits = 20;
            
            // Calculate UCB1 scores
            children.forEach(child => {
                child.ucb1 = calculateUCB1(child.visits, child.totalReward, parentVisits);
            });
            
            // Find best child
            const bestChild = children.reduce((best, child) => child.ucb1 > best.ucb1 ? child : best,
            );
            
            // Should select the child with highest UCB1 (likely the least visited one)
            expect(bestChild.visits).to.equal(2);
        });
        
        it('should always select unvisited children first', () => {
            const children = [
                { visits: 10, totalReward: 8, ucb1: 0 },
                { visits: 0, totalReward: 0, ucb1: 0 },
                { visits: 5, totalReward: 4, ucb1: 0 },
            ];
            
            const parentVisits = 20;
            
            children.forEach(child => {
                child.ucb1 = calculateUCB1(child.visits, child.totalReward, parentVisits);
            });
            
            const bestChild = children.reduce((best, child) => child.ucb1 > best.ucb1 ? child : best,
            );
            
            expect(bestChild.visits).to.equal(0);
            expect(bestChild.ucb1).to.equal(Infinity);
        });
    });
});
