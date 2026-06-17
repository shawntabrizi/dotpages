// Deterministic, dependency-free account avatar. Polkadot's official identicon
// needs @polkadot/ui-shared (not a declared dependency here — importing it would
// break the clean-install build), so we derive a stable two-stop gradient from
// the address instead: the same address always yields the same colours, so an
// account stays visually recognisable everywhere it appears in the app.

// FNV-1a over the seed — cheap, well-distributed, and stable across runs.
function hashSeed(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export interface AvatarColors {
    from: string;
    to: string;
}

/** Two analogous HSL stops for the avatar gradient, derived from the address. */
export function avatarColors(seed: string): AvatarColors {
    const h = hashSeed(seed);
    const hue = h % 360;
    return {
        from: `hsl(${hue} 68% 56%)`,
        to: `hsl(${(hue + 42) % 360} 70% 42%)`,
    };
}

/** First letter/digit of the display name for the avatar glyph (skips a leading
 *  0x on raw H160 addresses); falls back to a dot when there's nothing usable. */
export function avatarInitial(name: string): string {
    const match = name.replace(/^0x/i, "").match(/[a-z0-9]/i);
    return (match ? match[0] : "•").toUpperCase();
}
