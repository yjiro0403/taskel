export function createVirtualRoutineTaskId(routineId: string, date: string) {
    const seed = `virtual-routine-task:${routineId}:${date}`;
    let hash = '';

    for (let offset = 0; offset < 4; offset += 1) {
        let value = 2166136261 ^ offset;
        for (let index = 0; index < seed.length; index += 1) {
            value ^= seed.charCodeAt(index);
            value = Math.imul(value, 16777619);
        }
        hash += (value >>> 0).toString(16).padStart(8, '0');
    }

    const base = hash.slice(0, 32).split('');
    base[12] = '5';
    base[16] = ((Number.parseInt(base[16], 16) & 0x3) | 0x8).toString(16);

    return [
        base.slice(0, 8).join(''),
        base.slice(8, 12).join(''),
        base.slice(12, 16).join(''),
        base.slice(16, 20).join(''),
        base.slice(20, 32).join(''),
    ].join('-');
}
