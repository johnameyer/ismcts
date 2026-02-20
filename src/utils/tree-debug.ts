import { Message } from '@cards-ts/core';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';

export const printTree = (node: ISMCTSNode<Message> | ISMCTSRoot<Message>, depth: number = 0, prefix: string = ''): void => {
    const indent = '  '.repeat(depth);
    if ('lastAction' in node) {
        // Regular node - show who made the move that created this node
        const actionStr = JSON.stringify({ ...node.lastAction, components: undefined });
        const avgReward = node.visits > 0 ? node.totalReward / node.visits : 0;
        console.log(`${indent}${prefix}P${node.lastPlayer} moved: action=${actionStr}: visits=${node.visits}, avg=${avgReward.toFixed(4)}, children=${node.children.length}`);
    } else {
        // Root node
        console.log(`${indent}${prefix}ROOT: visits=${node.visits}, children=${node.children.length}`);
    }
    
    node.children.forEach((child, idx) => {
        printTree(child, depth + 1, `[${idx}] `);
    });
};

/**
 * Build the path from root to a given node, returning a readable string.
 * @param node - The node to trace back to root
 * @returns String like "P0 end-turn-response → P1 attack-response → P0 attach-energy-response"
 */
export const getNodePath = (node: ISMCTSNode<Message> | ISMCTSRoot<Message>): string => {
    const pathNodes: ISMCTSNode<Message>[] = [];
    let current: ISMCTSNode<Message> | ISMCTSRoot<Message> = node;
    
    // Walk up the entire parent chain to root
    while (current && 'lastAction' in current) {
        // This is a regular node (has lastAction and parent)
        pathNodes.unshift(current);
        current = current.parent;
    }
    
    // Build readable path
    return pathNodes.map((n: ISMCTSNode<Message>) => `P${n.lastPlayer} ${(n.lastAction)?.type ?? 'unknown'}`).join(' → ');
};
