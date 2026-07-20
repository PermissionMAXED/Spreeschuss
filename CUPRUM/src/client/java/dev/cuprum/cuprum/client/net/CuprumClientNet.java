package dev.cuprum.cuprum.client.net;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.config.ConfigSyncPayload;
import dev.cuprum.cuprum.net.CuprumNetVersion;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.multiplayer.ClientPacketListener;

/**
 * Client-side receivers (plan §4-W1A): diag echo reply and the common-config snapshot overlay,
 * plus the diag-echo test hook the client GameTest drives.
 *
 * <p>Threading (verified in the 1.21.9 / Fabric API 0.134.1 sources): play <b>payload</b>
 * handlers run on the client/render thread (off-thread receipt throws
 * {@code RunningOnDifferentThreadException} and vanilla reschedules through the
 * {@code PacketProcessor}), and {@code ClientPlayConnectionEvents.JOIN} fires on the client
 * thread too — but {@code ClientPlayConnectionEvents.DISCONNECT} may fire on a <b>Netty
 * event-loop thread</b> ({@code Connection.channelInactive}). The disconnect restore must
 * <b>not</b> be deferred with {@code Minecraft.execute}: {@code Minecraft.disconnect(Screen,
 * boolean)} calls {@code dropAllTasks()} during teardown, which deletes any queued runnable —
 * a scheduled restore can be silently discarded. Instead the restore runs <b>synchronously
 * inside the DISCONNECT callback</b>, touching only mod-owned session state guarded by
 * {@link #SESSION_LOCK} (never Minecraft state, so running on the Netty thread is safe).
 *
 * <p>The session state machine makes the cleanup idempotent and race-free:
 * <ul>
 *   <li>JOIN (client thread) installs the connection's {@link ClientPacketListener} as the
 *       active session.</li>
 *   <li>Receivers (client thread) mutate overlay / last-reply only while a session is active,
 *       under the same lock — a concurrent disconnect therefore either runs before the write
 *       (the write is skipped: no session) or after it (the write is cleared). A late-delivered
 *       payload can never resurrect state past its connection's cleanup.</li>
 *   <li>DISCONNECT (any thread) clears the state only if the disconnecting handler <i>is</i>
 *       the active session (or none is active): a stale disconnect for a previous connection,
 *       delivered late from a Netty thread, can never wipe a newer session's overlay. Fabric
 *       fires the event at most once per connection (CAS in
 *       {@code AbstractNetworkAddon.handleDisconnect}), and this transition is idempotent
 *       regardless.</li>
 * </ul>
 */
public final class CuprumClientNet {
    /** Guards {@link #activeSession} + the overlay/last-reply writes; never held around MC calls. */
    private static final Object SESSION_LOCK = new Object();

    /** The connection whose receivers may mutate client net state; null between sessions. */
    private static ClientPacketListener activeSession;

    /** Last echo reply of the active session; volatile so any-thread reads are safe. */
    private static volatile DiagEchoReplyPayload lastEchoReply;

    private CuprumClientNet() {
    }

    public static void init() {
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            synchronized (SESSION_LOCK) {
                activeSession = handler;
            }
        });
        ClientPlayNetworking.registerGlobalReceiver(DiagEchoReplyPayload.TYPE, (payload, context) -> {
            synchronized (SESSION_LOCK) {
                if (activeSession == null) {
                    return; // connection already cleaned up; never resurrect post-disconnect state
                }
                lastEchoReply = payload;
            }
            Cuprum.LOGGER.info("[net] diag echo reply: nonce={} gameTime={} catalogSha={}",
                    payload.nonce(), payload.gameTime(), payload.catalogSha());
        });
        ClientPlayNetworking.registerGlobalReceiver(ConfigSyncPayload.TYPE, (payload, context) -> {
            if (!CuprumNetVersion.isCompatible(payload.netVersion())) {
                // Diagnostics only in W1 (plan D3: no handshake); registry sync already
                // refuses genuinely incompatible peers.
                Cuprum.LOGGER.warn("[net] server net version {} != client {} (config sync still applied)",
                        payload.netVersion(), CuprumNetVersion.NET_VERSION);
            }
            synchronized (SESSION_LOCK) {
                if (activeSession == null) {
                    return; // connection already cleaned up; never resurrect post-disconnect state
                }
                CuprumClientConfigs.applyCommonOverlay(payload.toOverlayConfig());
            }
            Cuprum.LOGGER.info("[config] applied server common-config overlay");
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            // Runs on the Netty event-loop thread or the client thread — restore IMMEDIATELY
            // and synchronously. Scheduling via client.execute is forbidden here: teardown's
            // dropAllTasks() would delete the queued restore (see class javadoc).
            synchronized (SESSION_LOCK) {
                if (activeSession != null && activeSession != handler) {
                    return; // stale disconnect of an older connection; a newer session is live
                }
                activeSession = null;
                CuprumClientConfigs.clearCommonOverlay();
                lastEchoReply = null;
            }
            Cuprum.LOGGER.info("[config] disconnected; local config restored");
        });
        Cuprum.LOGGER.info("[net] client receivers registered");
    }

    /**
     * Test hook (client GameTest / QOL-10 groundwork): sends one diag echo C2S. Returns false
     * without sending when the channel is unavailable (not connected / server lacks the type).
     */
    public static boolean sendDiagEcho(int nonce, String note) {
        if (!ClientPlayNetworking.canSend(DiagEchoPayload.TYPE)) {
            return false;
        }
        ClientPlayNetworking.send(new DiagEchoPayload(nonce, note));
        return true;
    }

    /** Last received echo reply, or null (cleared on disconnect); read by the client GameTest. */
    public static DiagEchoReplyPayload lastEchoReply() {
        return lastEchoReply;
    }
}
