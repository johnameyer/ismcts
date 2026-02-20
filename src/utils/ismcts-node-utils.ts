import { Message } from '@cards-ts/core';
import { ISMCTSNode } from '../ismcts-node.js';

export function calculateAvgScore<ResponseMessage extends Message>(node: ISMCTSNode<ResponseMessage>): number {
    return node.visits > 0 ? node.totalReward / node.visits : 0;
}

/**
 * Calculates the UCB1 (Upper Confidence Bound) score for a node.
 * UCB1 = exploitation + exploration = (total_reward / visits) + sqrt(2 * ln(parent_visits) / visits)
 * Unvisited nodes return Infinity to ensure they are selected first.
 * 
 * @param node - The node to calculate UCB1 score for
 * @returns The UCB1 score, or Infinity for unvisited nodes
 */
export function getUCB1Score<ResponseMessage extends Message>(node: ISMCTSNode<ResponseMessage>): number {
    if (node.visits === 0) {
        return Infinity; 
    }
    
    const exploitation = calculateAvgScore(node);
    const exploration = Math.sqrt(2 * Math.log(node.parent!.visits) / node.visits);
    
    return exploitation + exploration;
}

