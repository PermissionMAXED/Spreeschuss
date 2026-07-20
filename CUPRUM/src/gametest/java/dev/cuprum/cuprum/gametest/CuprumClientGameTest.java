package dev.cuprum.cuprum.gametest;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.client.net.CuprumClientNet;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * Client smoke test: boots a real client (under Xvfb in headless environments),
 * captures a title screen screenshot, then creates a singleplayer world, places the
 * charge probe in front of the player and screenshots it in-world. Screenshots land
 * in build/run/clientGameTest/screenshots. W1A appends the diag-echo end-to-end
 * exchange and the config sync/overlay lifecycle to the same flow.
 */
public class CuprumClientGameTest implements FabricClientGameTest {
    /**
     * Bound for the post-close cleanup wait. Only covers Netty event-loop delivery jitter of
     * {@code channelInactive} (observed: 0 ticks — the restore is already visible when the
     * world close returns); the production restore itself is synchronous in the DISCONNECT
     * callback, so a regression to queue-deferred cleanup fails this test at any timeout.
     */
    private static final int DISCONNECT_CLEANUP_TIMEOUT_TICKS = 20;

    @Override
    public void runTest(ClientGameTestContext context) {
        context.waitForScreen(TitleScreen.class);
        context.takeScreenshot("cuprum_title_screen");

        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            // W1A config sync: joining must have installed the server's common-config overlay.
            if (!context.computeOnClient(client -> CuprumClientConfigs.hasCommonOverlay())) {
                throw new AssertionError("common-config overlay missing after join (S2C sync)");
            }

            // Stand the player on a fixed spot facing +Z and place the probe in view.
            singleplayer.getServer().runCommand("tp @p 0.5 -60 0.5 0 25");
            singleplayer.getServer().runCommand("setblock 0 -60 3 cuprum:charge_probe");
            context.waitTicks(20);

            context.takeScreenshot("cuprum_charge_probe_in_world");

            // W1A diag echo end-to-end: op the (only) player so cuprum.diagnostics passes,
            // send the C2S echo through the client test hook, expect the S2C reply.
            singleplayer.getServer().runOnServer(server -> server.getPlayerList()
                    .op(server.getPlayerList().getPlayers().get(0).nameAndId()));
            context.waitTicks(2);
            boolean sent = context.computeOnClient(client -> CuprumClientNet.sendDiagEcho(777, "client echo"));
            if (!sent) {
                throw new AssertionError("diag echo channel unavailable (send hook returned false)");
            }
            context.waitTicks(10);
            DiagEchoReplyPayload reply = context.computeOnClient(client -> CuprumClientNet.lastEchoReply());
            if (reply == null) {
                throw new AssertionError("no diag echo reply received");
            }
            if (reply.nonce() != 777) {
                throw new AssertionError("diag echo reply nonce mismatch: " + reply.nonce());
            }
        }

        // W1A overlay lifecycle: leaving the world must restore local config values and clear
        // the diagnostic echo state. The restore runs synchronously inside the production
        // DISCONNECT callback (Netty thread or client thread) — it is never deferred through
        // the client task queue, which teardown's dropAllTasks() wipes. waitFor only absorbs
        // Netty event-loop delivery jitter: if the restore were still queue-scheduled (the
        // dropped-task bug), no amount of waiting would ever satisfy these predicates.
        int overlayTicks = context.waitFor(
                client -> !CuprumClientConfigs.hasCommonOverlay(), DISCONNECT_CLEANUP_TIMEOUT_TICKS);
        int replyTicks = context.waitFor(
                client -> CuprumClientNet.lastEchoReply() == null, DISCONNECT_CLEANUP_TIMEOUT_TICKS);
        if (overlayTicks > 0 || replyTicks > 0) {
            // Diagnostics only: 0 ticks means the cleanup was already visible when the world
            // close returned (the expected immediate path).
            Cuprum.LOGGER.info("[gametest] disconnect cleanup visible after {}/{} extra tick(s)",
                    overlayTicks, replyTicks);
        }
    }
}
