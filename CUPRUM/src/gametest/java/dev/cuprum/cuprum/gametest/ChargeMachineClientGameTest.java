package dev.cuprum.cuprum.gametest;

import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.client.machine.ChargeMachineScreen;
import dev.cuprum.cuprum.multiblock.FormationState;
import net.minecraft.core.BlockPos;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;

/**
 * W1C client end-to-end slice (plan §4-W1C): builds the Diagnostic Coil via commands in a real
 * singleplayer world, waits through formation plus ≥40 self-charge ticks, right-clicks the
 * FORMED core with the real use key (compile probe 8: {@code holdKeyFor(keyUse)} — reliable
 * under Xvfb) and verifies the {@link ChargeMachineScreen} opens over the synced menu.
 * Screenshots: {@code cuprum_diagnostic_coil_formed} + {@code cuprum_charge_machine_screen}.
 * Runs AFTER {@link CuprumClientGameTest} (entrypoint order) so the W1A screenshot numbering
 * expected by {@code scripts/client_smoke.sh} is unchanged.
 */
public class ChargeMachineClientGameTest implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            // Build the 3x3 ring (orientation NONE) with the core at (0, -60, 3):
            // north row W/O/F, middle row F/C/F, south row F/F/F — the committed pattern.
            singleplayer.getServer().runCommand("setblock -1 -60 2 minecraft:waxed_copper_block");
            singleplayer.getServer().runCommand("setblock 0 -60 2 minecraft:oxidized_copper");
            singleplayer.getServer().runCommand("setblock 1 -60 2 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock -1 -60 3 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock 1 -60 3 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock -1 -60 4 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock 0 -60 4 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock 1 -60 4 cuprum:diagnostic_coil_frame");
            singleplayer.getServer().runCommand("setblock 0 -60 3 cuprum:diagnostic_coil_core");

            // View the ring from the south for the formed screenshot; ≥40 ticks also lets the
            // FORMED coil bank a visible self-charge (5 Cg/t) before the screen opens.
            singleplayer.getServer().runCommand("tp @p 0.5 -60 7.5 180 20");
            context.waitTicks(60);
            boolean formedClientState = context.computeOnClient(client -> {
                if (client.level == null) {
                    return false;
                }
                return client.level.getBlockEntity(new BlockPos(0, -60, 3))
                                instanceof DiagnosticCoilCoreBlockEntity coil
                        && coil.multiblockBehavior().state() == FormationState.FORMED
                        && coil.chargeBuffer().capacity() == DiagnosticCoilCoreBlockEntity.CAPACITY_CG
                        && coil.chargeBuffer().stored() > 0L;
            });
            if (!formedClientState) {
                throw new AssertionError(
                        "client BE must be synced FORMED with positive charge and exact capacity before screenshot");
            }
            context.takeScreenshot("cuprum_diagnostic_coil_formed");

            // Stand on the core (its side faces are ring members) and use its top face.
            singleplayer.getServer().runCommand("tp @p 0.5 -59 3.5 0 90");
            context.waitTicks(10);
            context.getInput().holdKeyFor(options -> options.keyUse, 2);
            context.waitForScreen(ChargeMachineScreen.class);
            boolean exactMenuState = context.computeOnClient(client -> {
                if (!(client.screen instanceof ChargeMachineScreen screen)) {
                    return false;
                }
                return screen.getMenu().chargeCg() > 0L
                        && screen.getMenu().chargeCg() <= DiagnosticCoilCoreBlockEntity.CAPACITY_CG
                        && screen.getMenu().capacityCg() == DiagnosticCoilCoreBlockEntity.CAPACITY_CG
                        && screen.getMenu().formationState() == FormationState.FORMED;
            });
            if (!exactMenuState) {
                throw new AssertionError(
                        "screen menu must expose positive charge, capacity=1000 and FORMED before screenshot");
            }
            context.takeScreenshot("cuprum_charge_machine_screen");

            // Close the container screen cleanly (C2S close) before leaving the world.
            context.runOnClient(client -> {
                if (client.player != null) {
                    client.player.closeContainer();
                }
            });
            context.waitTicks(5);
        }
    }
}
