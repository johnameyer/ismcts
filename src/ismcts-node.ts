import { ControllerState, Message } from '@cards-ts/core';

/**
 * Represents an information set in ISMCTS - a game position from a player's perspective.
 * Contains the complete game state after determinization and the player's viewpoint.
 * 
 * Information sets are used to handle imperfect information by grouping together
 * all possible game states that are indistinguishable to the observing player.
 */
export interface InformationSet<Controllers> {
    gameState: ControllerState<Controllers>; // Complete game state (post-determinization)
    playerIndex: number;
}

/**
 * Represents a node in the ISMCTS search tree.
 * 
 * Each node corresponds to a game position reached by applying a sequence of actions.
 * Nodes store statistics (visits, total reward) used by the UCB1 selection policy
 * and maintain the tree structure through parent-child relationships.
 * 
 * RESUME -> GET LEGAL -> APPLY PATTERN:
 * 1. Selection: Uses resume() -> generateLegal() -> apply() to traverse tree
 * 2. Expansion: Uses resume() -> generateLegal() -> apply() to create new child
 * 3. Simulation: Receives state ready for resume() with random handlers
 * 
 * The node stores the action that led to this position (lastAction) and may store
 * handler calls needed to resolve waiting game states during simulation.
 * 
 * Actions are managed externally by the expansion phase using the RESUME -> GET LEGAL -> APPLY pattern.
 */
/**
 * Root of an ISMCTS search tree.
 * 
 * Tracks visits for UCB1 calculation but no reward (never backpropped to).
 */
export type ISMCTSRoot<ResponseMessage extends Message> = {
    /** Visit count for UCB1 scoring in child selection */
    visits: number;
    /** Child nodes representing possible actions from the root */
    children: ISMCTSNode<ResponseMessage>[];
};

export type ISMCTSNode<ResponseMessage extends Message> = {
    /** Number of times this node has been visited during ISMCTS iterations */
    visits: number;
    
    /** Cumulative reward from all simulations passing through this node */
    totalReward: number;
    
    /** Parent node in the search tree */
    parent: ISMCTSNode<ResponseMessage> | ISMCTSRoot<ResponseMessage>;
    
    /** The player who made the move creating this node (use for reward perspective) */
    lastPlayer: number;

    /** The action that led to this node from its parent */
    lastAction: ResponseMessage;
    
    /** Child nodes representing possible next actions from this position */
    children: ISMCTSNode<ResponseMessage>[];
};
