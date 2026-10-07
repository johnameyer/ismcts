import { Message } from '@cards-ts/core';
import { ISMCTSNode, ISMCTSRoot } from '../ismcts-node.js';

/**
 * JSON-safe representation of an ISMCTS tree node, suitable for writing to disk
 * and loading in an external tool (e.g. a renderer). Omits the circular `parent`
 * reference and the precomputed `lastActionKey` hash.
 */
export type SerializedISMCTSNode<ResponseMessage extends Message> = {
    visits: number;
    totalReward: number;
    avgReward: number;
    lastPlayer: number;
    lastAction: ResponseMessage;
    children: SerializedISMCTSNode<ResponseMessage>[];
};

export type SerializedISMCTSTree<ResponseMessage extends Message> = {
    visits: number;
    children: SerializedISMCTSNode<ResponseMessage>[];
};

const serializeNode = <ResponseMessage extends Message>(node: ISMCTSNode<ResponseMessage>): SerializedISMCTSNode<ResponseMessage> => ({
    visits: node.visits,
    totalReward: node.totalReward,
    avgReward: node.visits > 0 ? node.totalReward / node.visits : 0,
    lastPlayer: node.lastPlayer,
    lastAction: node.lastAction,
    children: node.children.map(serializeNode),
});

/**
 * Convert an in-memory ISMCTS search tree into a JSON-safe structure with no
 * circular references, so it can be serialized (e.g. `JSON.stringify`) and
 * consumed by external tooling such as a tree visualizer.
 */
export const serializeTree = <ResponseMessage extends Message>(root: ISMCTSRoot<ResponseMessage>): SerializedISMCTSTree<ResponseMessage> => ({
    visits: root.visits,
    children: root.children.map(serializeNode),
});
