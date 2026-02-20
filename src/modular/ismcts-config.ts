export interface ISMCTSConfig {
    iterations: number;
    maxDepth: number;
}

export const DEFAULT_ISMCTS_CONFIG: ISMCTSConfig = {
    iterations: 100,
    maxDepth: 15,
};
