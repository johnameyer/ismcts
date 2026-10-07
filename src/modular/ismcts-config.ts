import { Message } from '@cards-ts/core';
import { ISMCTSRoot } from '../ismcts-node.js';

export interface ISMCTSConfig<ResponseMessage extends Message = Message> {
    iterations: number;
    maxDepth: number;
    /**
     * Called with the completed search tree once all iterations for a decision
     * have run, before the best action is selected. Intended for external tooling
     * (e.g. exporting the tree for a renderer) — has no effect on decision-making.
     */
    onTreeComplete?: (root: ISMCTSRoot<ResponseMessage>) => void;
}

export const DEFAULT_ISMCTS_CONFIG: ISMCTSConfig = {
    iterations: 100,
    maxDepth: 15,
};
