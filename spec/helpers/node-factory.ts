import { Message } from '@cards-ts/core';
import { ISMCTSNode, ISMCTSRoot } from '../../src/ismcts-node.js';

/**
 * Factory for creating properly-typed ISMCTSNode and ISMCTSRoot instances for testing.
 */

export function createRootNode<T extends Message = Message>(): ISMCTSRoot<T> {
    return {
        visits: 0,
        children: [],
    };
}

export function createNode<T extends Message = Message>(
    action: T,
    lastPlayer: number,
    parent: ISMCTSNode<T> | ISMCTSRoot<T> | undefined,
    children: ISMCTSNode<T>[] = [],
): ISMCTSNode<T> {
    return {
        visits: 0,
        totalReward: 0,
        lastPlayer,
        lastAction: action,
        parent: parent as ISMCTSNode<T> | ISMCTSRoot<T>,
        children,
    };
}

export function createNodeWithStats<T extends Message = Message>(
    action: T,
    lastPlayer: number,
    parent: ISMCTSNode<T> | ISMCTSRoot<T> | undefined,
    visits: number,
    totalReward: number,
    children: ISMCTSNode<T>[] = [],
): ISMCTSNode<T> {
    return {
        visits,
        totalReward,
        lastPlayer,
        lastAction: action,
        parent: parent as ISMCTSNode<T> | ISMCTSRoot<T>,
        children,
    };
}
