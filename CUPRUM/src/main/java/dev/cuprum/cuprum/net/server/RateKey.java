package dev.cuprum.cuprum.net.server;

/**
 * Rate-limit bucket keys. W1 deliberately ships only {@code DEFAULT} (4/s, burst 8) and the
 * aggregate {@code GLOBAL} (16/s) bucket; speculative keys (golem programs, flares, nexus) are
 * declared by the waves that use them (plan D10). The actual numbers are owned by the config
 * module's {@code net.*} section (plan D2) and resolved by {@link NetRateLimiter} at bucket
 * creation. Minecraft-free.
 */
public enum RateKey {
    /** Per-payload default: {@code net.ratePerSecDefault}/s, burst {@code net.burstDefault}. */
    DEFAULT,
    /** Aggregate per-connection bucket, always checked in addition: {@code net.rateGlobalPerSec}/s. */
    GLOBAL
}
