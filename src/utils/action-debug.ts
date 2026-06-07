import { Message } from '@cards-ts/core';

function summarizeValue(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return '[unserializable]';
    }
}

export function summarizeAction(action: Message): string {
    const actionRecord = action as unknown as Record<string, unknown>;
    const type = typeof actionRecord.type === 'string' ? actionRecord.type : 'unknown-action';

    const params = Object.entries(actionRecord)
        .filter(([ key ]) => key !== 'type' && key !== 'components')
        .map(([ key, value ]) => `${key}=${summarizeValue(value)}`);

    return params.length > 0
        ? `${type} {${params.join(', ')}}`
        : type;
}

