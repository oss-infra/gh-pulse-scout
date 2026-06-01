import fs from 'node:fs';
import path from 'node:path';
import NodeCache from 'node-cache';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'gh-pulse-scout');

function ensureCacheDir(): void {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

function safeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function filePathFor(key: string): string {
    return path.join(CACHE_DIR, `${safeKey(key)}.json`);
}

interface CacheEntry<T> {
    expireAt: number;
    value: T;
}

export class Cache {
    private memory: NodeCache;
    private ttlSeconds: number;

    constructor(ttlSeconds: number) {
        this.ttlSeconds = ttlSeconds;
        this.memory = new NodeCache({ stdTTL: ttlSeconds, useClones: false });
        ensureCacheDir();
    }

    get<T>(key: string): T | undefined {
        const mem = this.memory.get<T>(key);
        if (mem !== undefined) return mem;

        const fp = filePathFor(key);
        if (!fs.existsSync(fp)) return undefined;
        try {
            const raw = fs.readFileSync(fp, 'utf8');
            const entry = JSON.parse(raw) as CacheEntry<T>;
            if (Date.now() > entry.expireAt) {
                fs.unlinkSync(fp);
                return undefined;
            }
            this.memory.set(key, entry.value, Math.floor((entry.expireAt - Date.now()) / 1000));
            return entry.value;
        } catch {
            return undefined;
        }
    }

    set<T>(key: string, value: T): void {
        this.memory.set(key, value);
        const entry: CacheEntry<T> = {
            expireAt: Date.now() + this.ttlSeconds * 1000,
            value,
        };
        try {
            fs.writeFileSync(filePathFor(key), JSON.stringify(entry), 'utf8');
        } catch {
            // ignore
        }
    }
}
