package dev.cuprum.cuprum.net;

/**
 * Cuprum network protocol version (plan D3). Declared from W1A on so every payload era is
 * identifiable, but there is deliberately <b>no</b> config-phase hello/hello_ack handshake yet:
 * registry sync already refuses vanilla/foreign clients (Cuprum registers content), W1–W3 is a
 * single-protocol world, and a version-skewed same-mod client fails loudly on codec decode. The
 * handshake lands at the first protocol-breaking change or W14, whichever is first (plan D10).
 */
public final class CuprumNetVersion {
    /** Bumped only on protocol-breaking changes to any Cuprum payload. */
    public static final int NET_VERSION = 1;

    private CuprumNetVersion() {
    }

    /** Two peers are compatible only when they speak exactly the same protocol version. */
    public static boolean isCompatible(int remote) {
        return remote == NET_VERSION;
    }
}
