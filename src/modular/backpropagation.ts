import { Message } from '@cards-ts/core';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';

/**
 * ISMCTS Backpropagation Phase Implementation
 * 
 * Implements the backpropagation phase of Information Set Monte Carlo Tree Search.
 * Takes the result of a simulation and propagates it back up the tree to update
 * statistics for all nodes on the path from the simulated node to the root.
 * 
 * NEGAMAX PRINCIPLE:
 * In a two-player zero-sum game, each node stores statistics from the perspective 
 * of the player whose turn it is at that node. When moving up the tree, we negate 
 * the reward only when the player changes, since parent and child may represent 
 * different players' turns.
 * 
 * STATISTICS UPDATED:
 * - visits: Incremented for each node on the path (tracks confidence)
 * - totalReward: Accumulated reward from the player's perspective at each node
 * 
 * REWARD PERSPECTIVE:
 * - 1.0 = win for the player to move at this node
 * - 0.5 = draw/timeout (neutral outcome)
 * - 0.0 = loss for the player to move at this node
 */
export class ISMCTSBackpropagation<ResponseMessage extends Message> {
    /**
     * Backpropagates simulation results up the ISMCTS tree using negamax principle.
     * 
     * NEGAMAX REWARD HANDLING:
     * In a two-player zero-sum game, each node stores statistics from the perspective 
     * of the player whose turn it is at that node. As we move up the tree, we negate 
     * the reward only when the player changes (parent.playerToMove != child.playerToMove).
     * 
     * STATISTICS UPDATE:
     * For each node on the path from simulation node to root:
     * - Increment visits (builds confidence in this path)
     * - Add current reward to totalReward (from this node's player perspective)
     * - Negate reward when moving to parent with different playerToMove
     * 
     * REWARD INTERPRETATION:
     * - reward = 1.0: Win for the player to move at current node
     * - reward = 0.5: Draw/timeout (neutral for both players)
     * - reward = 0.0: Loss for the player to move at current node
     * 
     * @param node - The node where simulation started (typically a newly expanded node)
     * @param reward - The reward value from simulation (0.0 for loss, 0.5 for draw, 1.0 for win)
     */
    backpropagate(node: ISMCTSNode<ResponseMessage>, reward: number): void {
        
        let current: ISMCTSNode<ResponseMessage> | undefined = node;
        let currentReward = reward;
        
        while (current !== undefined) {
            current.visits++;
            current.totalReward += currentReward;
            
            // Move to parent and check if player changed
            const parent: ISMCTSNode<ResponseMessage> | ISMCTSRoot<ResponseMessage> | undefined = current.parent;
            
            // Check if parent is a regular node (not root, not undefined)
            if (parent && 'lastPlayer' in parent) {
                // Parent is a regular node - check if player changed
                const playerChanged = parent.lastPlayer !== current.lastPlayer;
                if (playerChanged) {
                    currentReward = 1 - currentReward; // Negate only when player changes
                }
                current = parent; // Move to parent in next iteration
            } else if (parent && !('lastPlayer' in parent)) {
                // Parent is root - stop here after updating root visits
                parent.visits++;
                current = undefined; // Stop backprop
            } else {
                // No parent - reached top
                current = undefined;
            }
        }
        
    }
}
