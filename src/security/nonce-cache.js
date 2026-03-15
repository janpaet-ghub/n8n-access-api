//Version: 2026-02-25 22:51
/** 
 * Description:
 * src/security/nonce-cache.js
 * Einfacher In-Memory Nonce-Cache mit Time-to-Live(TTL) für die Gültigkeitsdauer einer Nachricht bzw. eines Datenpaketes.
 * Soll verhindern, dass von Angreifern abgefangende Nachrichten später erneut gesendet werden (Replay-Schutz). 
 * Nonce := number used once
*/
class NonceCache {
    /**
     * @param (object) options
     * @param (number) options.ttlMs - Wie lange eine Nonce als "verbraucht" gilt
     * @param (number) options.maxSize - Schutz vor unendlichem Wachstum
     */
    constructor({ ttlMs = 10 * 60 * 1000, maxSize = 50_000 } = {}) {
        this.ttlMs = ttlMs;
        this.maxSize = maxSize;
        this.map = new Map();                   // nonce expiresAt (ms)
    }

    /**
     * @returns {boolean} true = Replay (Nonce schon benutzt), false = frisch
     */
    isReplay(nonce) {
        if (!nonce) {
            return true;                                            // Keine Gültigkeit ohne Nonce 
        };

        const now = Date.now();
        this._cleanup(now);                                         // Lazy clean up: abgelaufene Nonces beim Zugriff entfernen
    
        const expiresAt = this.map.get(nonce);
        if (expiresAt && expiresAt > now) {
            return true;                                            // noch gültige Nonce
        }

        this.map.set(nonce, now + this.ttlMs);                      // neu eintragen

        
        if (this.map.size > this.maxSize) {
            this._cleanup(now, { aggressive: true });               // Größenlimit: wenn zu groß, dann nochmal aggresiver aufräumen
            
            while (this.map.size > this.maxSize) {
                const firstKey = this.map.keys().next().value;
                this.map.delete(firstKey);                          // Falls immer noch zu groß, dann älteste Einträge entfernen
            }
        }

        return false;
    }

    _cleanup(now = Date.now(), { aggressive = false } = {}) {
        for (const [key, expiresAt] of this.map.entries()) {
            if (expiresAt <= now) {
                this.map.delete(key);
            }
        }
        void aggressive;                                            // Platzhalter, um aggressive später ggf. anders zu verwendens
    }    
}
module.exports = NonceCache;