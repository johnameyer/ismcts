import { expect } from 'chai';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { ISMCTSBackpropagation } from '../../../src/modular/backpropagation.js';
import { ISMCTSNode } from '../../../src/ismcts-node.js';
import { createNode, createNodeWithStats } from '../../helpers/node-factory.js';

describe('ISMCTS Backpropagation Unit Tests', () => {
    let backpropagation: ISMCTSBackpropagation<ResponseMessage>;

    beforeEach(() => {
        backpropagation = new ISMCTSBackpropagation<ResponseMessage>();
    });

    it('should propagate win reward (1.0) up the tree', () => {
        // Create a simple tree: root -> child -> grandchild
        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const child = createNode<ResponseMessage>({} as ResponseMessage, 1, root, []);

        const grandchild = createNode<ResponseMessage>({} as ResponseMessage, 0, child, []);

        root.children.push(child);
        child.children.push(grandchild);

        // Backpropagate a win from grandchild
        backpropagation.backpropagate(grandchild, 1.0);

        // All nodes should have increased visits
        expect(grandchild.visits).to.equal(1);
        expect(child.visits).to.equal(1);
        expect(root.visits).to.equal(1);

        // Rewards should be propagated correctly (inverted for opponent turns)
        expect(grandchild.totalReward).to.equal(1.0, 'Grandchild should get full reward');
        expect(child.totalReward).to.equal(0.0, 'Child (opponent) should get inverted reward');
        expect(root.totalReward).to.equal(1.0, 'Root (same player as grandchild) should get full reward');
    });

    it('should propagate loss reward (0.0) up the tree', () => {
        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const child = createNode<ResponseMessage>({} as ResponseMessage, 1, root, []);

        root.children.push(child);

        // Backpropagate a loss from child
        backpropagation.backpropagate(child, 0.0);

        expect(child.visits).to.equal(1);
        expect(root.visits).to.equal(1);

        expect(child.totalReward).to.equal(0.0, 'Child should get loss reward');
        expect(root.totalReward).to.equal(1.0, 'Root (opponent) should get inverted reward (win)');
    });

    it('should propagate draw reward (0.5) up the tree', () => {
        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const child = createNode<ResponseMessage>({} as ResponseMessage, 1, root, []);

        root.children.push(child);

        // Backpropagate a draw from child
        backpropagation.backpropagate(child, 0.5);

        expect(child.visits).to.equal(1);
        expect(root.visits).to.equal(1);

        expect(child.totalReward).to.equal(0.5, 'Child should get draw reward');
        expect(root.totalReward).to.equal(0.5, 'Root should get same draw reward (0.5 inverted is 0.5)');
    });

    it('should accumulate multiple backpropagations correctly', () => {
        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const child = createNode<ResponseMessage>({} as ResponseMessage, 1, root, []);

        root.children.push(child);

        // Multiple backpropagations
        backpropagation.backpropagate(child, 1.0); // Win
        backpropagation.backpropagate(child, 0.0); // Loss
        backpropagation.backpropagate(child, 0.5); // Draw

        expect(child.visits).to.equal(3);
        expect(root.visits).to.equal(3);

        expect(child.totalReward).to.equal(1.5, 'Child should accumulate: 1.0 + 0.0 + 0.5');
        expect(root.totalReward).to.equal(1.5, 'Root should accumulate inverted: 0.0 + 1.0 + 0.5');
    });

    it('should handle single node (root only) backpropagation', () => {
        const root = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        backpropagation.backpropagate(root, 1.0);

        expect(root.visits).to.equal(1);
        expect(root.totalReward).to.equal(1.0);
    });

    it('should handle deep tree backpropagation', () => {
        // Create a 5-level deep tree
        const nodes: ISMCTSNode<ResponseMessage>[] = [];
        for (let i = 0; i < 5; i++) {
            const parent = i > 0 ? nodes[i - 1] : (undefined);
            const node = createNode<ResponseMessage>({} as ResponseMessage, i % 2, parent, []);
            nodes.push(node);
            if (i > 0) {
                nodes[i - 1].children.push(node);
            }
        }

        const leafNode = nodes[4];
        backpropagation.backpropagate(leafNode, 1.0);

        // All nodes should have 1 visit
        nodes.forEach(node => {
            expect(node.visits).to.equal(1);
        });

        // Rewards should alternate based on player
        expect(nodes[0].totalReward).to.equal(1.0, 'Player 0 node should get reward');
        expect(nodes[1].totalReward).to.equal(0.0, 'Player 1 node should get inverted reward');
        expect(nodes[2].totalReward).to.equal(1.0, 'Player 0 node should get reward');
        expect(nodes[3].totalReward).to.equal(0.0, 'Player 1 node should get inverted reward');
        expect(nodes[4].totalReward).to.equal(1.0, 'Player 0 node should get reward');
    });

    it('should invert scores correctly (negmax) when backpropagating across opponent turns', () => {
        /*
         * This tests the critical negmax property: a win for player A is a loss for player B
         * Setup: Player 0 -> Player 1 -> Player 0
         */
        const player0Turn1 = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const player1Turn = createNode<ResponseMessage>({} as ResponseMessage, 1, player0Turn1, []);

        const player0Turn2 = createNode<ResponseMessage>({} as ResponseMessage, 0, player1Turn, []);

        player0Turn1.children.push(player1Turn);
        player1Turn.children.push(player0Turn2);

        // Player 0 wins (1.0 from their perspective)
        backpropagation.backpropagate(player0Turn2, 1.0);

        // Player 0 nodes should get 1.0 (they won)
        expect(player0Turn1.totalReward).to.equal(1.0, 'Player 0 turn 1: should value winning child path at 1.0');
        expect(player0Turn2.totalReward).to.equal(1.0, 'Player 0 turn 2: leaf node with 1.0 reward');

        // Player 1 node should get 0.0 (opponent winning is bad for them)
        expect(player1Turn.totalReward).to.equal(0.0, 'Player 1 turn: should invert 1.0 to 0.0 (loss)');
    });

    it('should handle negmax with loss propagation (0.0)', () => {
        // Test that a loss (0.0) for player 0 becomes a win (1.0) for player 1
        const player0 = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

        const player1 = createNode<ResponseMessage>({} as ResponseMessage, 1, player0, []);

        player0.children.push(player1);

        // Player 0 loses (0.0)
        backpropagation.backpropagate(player1, 0.0);

        // Player 0 should record 1.0 (inverted from opponent's loss)
        expect(player0.totalReward).to.equal(1.0, 'Player 0: should invert opponent loss (0.0) to win (1.0)');
        expect(player1.totalReward).to.equal(0.0, 'Player 1: should have loss reward');
    });

    describe('Backpropagation of draw scenarios', () => {
        it('should preserve draw reward through negmax (0.5 both directions)', () => {
            const player0 = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 1, 0.5, []);

            const player1 = createNode<ResponseMessage>({} as ResponseMessage, 1, player0, []);

            player0.children.push(player1);

            // Draw for player 1 (0.5)
            backpropagation.backpropagate(player1, 0.5);

            expect(player1.totalReward).to.equal(0.5, 'Player 1: draw remains 0.5');
            expect(player0.totalReward).to.equal(1.0, 'Player 0: draw inverted to 0.5 added to existing 0.5 = 1.0');
        });

        it('should correctly accumulate multiple backpropagations to same node', () => {
            const node = createNodeWithStats<ResponseMessage>({} as ResponseMessage, 0, undefined, 0, 0, []);

            backpropagation.backpropagate(node, 1.0);
            expect(node.visits).to.equal(1);
            expect(node.totalReward).to.equal(1.0);

            backpropagation.backpropagate(node, 0.0);
            expect(node.visits).to.equal(2);
            expect(node.totalReward).to.equal(1.0, 'Should accumulate: 1.0 + 0.0 = 1.0');

            backpropagation.backpropagate(node, 0.5);
            expect(node.visits).to.equal(3);
            expect(node.totalReward).to.equal(1.5, 'Should accumulate: 1.0 + 0.5 = 1.5');
        });

        it('should handle complex negmax with 4-level tree alternating players', () => {
            // Real healing scenario converted to tree: P0 -> P1 -> P0 -> P1
            const level3 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, []);

            const level2 = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level3 ]);

            const level1 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, [ level2 ]);

            const root = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level1 ]);

            // Set up parent pointers
            level3.parent = level2;
            level2.parent = level1;
            level1.parent = root;

            // P1 (at level3) achieves 0.727 score (healing path from scenario)
            backpropagation.backpropagate(level3, 0.727);

            // Verify negmax progression: P1 wins 0.727 -> P0 loses (1-0.727=0.273) -> P1 loses 0.273 -> P0 wins 0.727
            expect(level3.totalReward).to.equal(0.727, 'Level 3 (P1): gets 0.727');
            expect(level2.totalReward).to.be.closeTo(1 - 0.727, 0.001, 'Level 2 (P0): gets inverted 0.273');
            expect(level1.totalReward).to.be.closeTo(0.727, 0.001, 'Level 1 (P1): gets reinverted 0.727');
            expect(root.totalReward).to.be.closeTo(1 - 0.727, 0.001, 'Root (P0): gets final inversion 0.273');
        });

        it('should correctly track visit counts across 4-level tree', () => {
            const level3 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, []);

            const level2 = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level3 ]);

            const level1 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, [ level2 ]);

            const root = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level1 ]);

            level3.parent = level2;
            level2.parent = level1;
            level1.parent = root;

            backpropagation.backpropagate(level3, 0.727);

            // All nodes should have exactly 1 visit
            expect(level3.visits).to.equal(1);
            expect(level2.visits).to.equal(1);
            expect(level1.visits).to.equal(1);
            expect(root.visits).to.equal(1);
        });

        it('should accumulate multiple backpropagations across deep tree', () => {
            const level3 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, []);

            const level2 = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level3 ]);

            const level1 = createNode<ResponseMessage>({} as ResponseMessage, 1, undefined, [ level2 ]);

            const root = createNode<ResponseMessage>({} as ResponseMessage, 0, undefined, [ level1 ]);

            level3.parent = level2;
            level2.parent = level1;
            level1.parent = root;

            // First iteration: P1 wins (1.0)
            backpropagation.backpropagate(level3, 1.0);

            // Second iteration: P1 loses (0.0)
            backpropagation.backpropagate(level3, 0.0);

            // All nodes should have 2 visits
            expect(level3.visits).to.equal(2);
            expect(level2.visits).to.equal(2);
            expect(level1.visits).to.equal(2);
            expect(root.visits).to.equal(2);

            // level3 should have total 1.0 (1.0 + 0.0)
            expect(level3.totalReward).to.equal(1.0);
            // level2 should have total 1.0 (0.0 + 1.0) - inverted
            expect(level2.totalReward).to.equal(1.0);
            // level1 should have total 1.0 (1.0 + 0.0) - reinverted
            expect(level1.totalReward).to.equal(1.0);
            // root should have total 1.0 (0.0 + 1.0) - final inversion
            expect(root.totalReward).to.equal(1.0);
        });
    });
});
